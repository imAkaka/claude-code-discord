/**
 * Session Thread Manager — Maps Claude sessions to dedicated Discord threads.
 *
 * Each `/claude` invocation creates a new thread in the bot's main channel.
 * All output, AskUser prompts, and permission requests for that session
 * are routed into the thread, keeping the main channel clean.
 *
 * Session-to-thread mappings are persisted to disk so that conversations
 * survive bot restarts.
 *
 * @module discord/session-threads
 */

import { ChannelType, type TextChannel, type ThreadChannel } from "npm:discord.js@14.14.1";

import { ensureDir } from "https://deno.land/std@0.208.0/fs/mod.ts";
import * as path from "https://deno.land/std@0.208.0/path/mod.ts";

import type { SessionThread } from "./types.ts";

/** Shape stored on disk (dates serialized as ISO strings). */
interface PersistedSession {
  sessionId: string;
  threadId: string;
  threadName: string;
  createdAt: string;
  lastActivity: string;
  messageCount: number;
  hotQuery?: boolean;
  lastSeenMessageId?: string;
}

const DATA_DIR = ".bot-data";
const SESSIONS_FILE = "session-threads.json";

/**
 * Truncate and sanitise a user prompt into a thread name (max 100 chars for Discord).
 */
export function threadNameFromPrompt(prompt: string): string {
  // Strip code fences and excessive whitespace
  const cleaned = prompt
    .replace(/```[\s\S]*?```/g, "[code]")
    .replace(/\n+/g, " ")
    .trim();

  const maxLen = 80; // Leave room for potential prefix
  if (cleaned.length <= maxLen) return cleaned || "Claude Session";
  return cleaned.substring(0, maxLen - 1) + "…";
}

/**
 * Manages the mapping between Claude sessions and Discord threads.
 */
export class SessionThreadManager {
  /** sessionId → SessionThread metadata */
  private threads = new Map<string, SessionThread>();
  /** sessionId → live ThreadChannel reference (may be stale) */
  private threadChannels = new Map<string, ThreadChannel>();

  private filePath: string;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(dataDir?: string) {
    this.filePath = path.join(dataDir || DATA_DIR, SESSIONS_FILE);
  }

  // ───────────────────── Persistence ─────────────────────

  /**
   * Load persisted session mappings from disk.
   * Call once at startup, before the bot starts receiving messages.
   * ThreadChannel references are NOT restored here — call restoreThreadChannels()
   * after the Discord client is ready.
   */
  async loadFromDisk(): Promise<number> {
    try {
      const content = await Deno.readTextFile(this.filePath);
      const records: PersistedSession[] = JSON.parse(content);
      for (const r of records) {
        // Skip placeholder sessions that never got a real ID
        if (r.sessionId.startsWith("pending_")) continue;
        this.threads.set(r.sessionId, {
          sessionId: r.sessionId,
          threadId: r.threadId,
          threadName: r.threadName,
          createdAt: new Date(r.createdAt),
          lastActivity: new Date(r.lastActivity),
          messageCount: r.messageCount,
          hotQuery: r.hotQuery,
          lastSeenMessageId: r.lastSeenMessageId,
        });
      }
      console.log(`SessionThreads: Restored ${this.threads.size} sessions from disk`);
      return this.threads.size;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        console.log("SessionThreads: No persisted sessions found, starting fresh");
      } else {
        console.error("SessionThreads: Failed to load from disk:", error);
      }
      return 0;
    }
  }

  /**
   * After Discord client is ready, resolve threadId → ThreadChannel for restored sessions.
   * Uses guild.channels.fetch() so threads in ANY channel can be restored (multi-workspace).
   * Sessions whose threads can't be found are removed.
   */
  async restoreThreadChannels(channel: TextChannel): Promise<number> {
    let restored = 0;
    const toRemove: string[] = [];
    const guild = channel.guild;

    for (const [sessionId, meta] of this.threads) {
      // Skip if we already have a live channel reference
      if (this.threadChannels.has(sessionId)) continue;
      try {
        // Fetch from guild directly — works for threads in any channel
        const fetched = await guild.channels.fetch(meta.threadId);
        if (fetched && fetched.isThread()) {
          this.threadChannels.set(sessionId, fetched as unknown as ThreadChannel);
          restored++;
        } else {
          toRemove.push(sessionId);
        }
      } catch {
        toRemove.push(sessionId);
      }
    }

    for (const id of toRemove) {
      this.threads.delete(id);
    }

    if (toRemove.length > 0) {
      console.log(`SessionThreads: Removed ${toRemove.length} stale sessions (thread not found)`);
      this.schedulePersist();
    }
    console.log(`SessionThreads: Restored ${restored} thread channels`);
    return restored;
  }

  /** Write current state to disk (debounced). */
  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.persistToDisk(), 1000);
  }

  private async persistToDisk(): Promise<void> {
    try {
      await ensureDir(path.dirname(this.filePath));
      const records: PersistedSession[] = [];
      for (const meta of this.threads.values()) {
        // Don't persist placeholder sessions
        if (meta.sessionId.startsWith("pending_")) continue;
        records.push({
          sessionId: meta.sessionId,
          threadId: meta.threadId,
          threadName: meta.threadName,
          createdAt: meta.createdAt.toISOString(),
          lastActivity: meta.lastActivity.toISOString(),
          messageCount: meta.messageCount,
          ...(meta.hotQuery !== undefined && { hotQuery: meta.hotQuery }),
          ...(meta.lastSeenMessageId !== undefined && { lastSeenMessageId: meta.lastSeenMessageId }),
        });
      }
      await Deno.writeTextFile(this.filePath, JSON.stringify(records, null, 2));
    } catch (error) {
      console.error("SessionThreads: Failed to persist:", error);
    }
  }

  // ───────────────────── Create ─────────────────────

  /**
   * Create a new Discord thread for a session and register it.
   *
   * @param channel  The bot's main text channel
   * @param sessionId  Claude session ID (may be placeholder before SDK returns one)
   * @param prompt  The user's prompt — used to name the thread
   * @returns The created ThreadChannel
   */
  async createSessionThread(
    channel: TextChannel,
    sessionId: string,
    prompt: string,
    threadName?: string,
  ): Promise<ThreadChannel> {
    const name = threadName || threadNameFromPrompt(prompt);

    const thread = await channel.threads.create({
      name,
      type: ChannelType.PublicThread,
      autoArchiveDuration: 1440, // 24 hours
      reason: `Claude session ${sessionId}`,
    });

    const meta: SessionThread = {
      sessionId,
      threadId: thread.id,
      threadName: name,
      createdAt: new Date(),
      lastActivity: new Date(),
      messageCount: 0,
      // Discord thread IDs equal their starter message ID; using it as the
      // baseline guarantees every subsequent user message has a strictly
      // greater snowflake and will be picked up by offline catch-up.
      lastSeenMessageId: thread.id,
    };

    this.threads.set(sessionId, meta);
    this.threadChannels.set(sessionId, thread);
    this.schedulePersist();

    return thread;
  }

  // ───────────────────── Lookup ─────────────────────

  /**
   * Get the ThreadChannel for a session, if it exists.
   */
  getThread(sessionId: string): ThreadChannel | undefined {
    return this.threadChannels.get(sessionId);
  }

  /**
   * Get the metadata for a session thread.
   */
  getSessionThread(sessionId: string): SessionThread | undefined {
    return this.threads.get(sessionId);
  }

  /**
   * Find a session ID by its Discord thread ID.
   */
  findSessionByThreadId(threadId: string): string | undefined {
    for (const [sessionId, meta] of this.threads) {
      if (meta.threadId === threadId) return sessionId;
    }
    return undefined;
  }

  /**
   * List all tracked session threads.
   */
  getAllSessionThreads(): SessionThread[] {
    return Array.from(this.threads.values());
  }

  /**
   * List active session threads (those with recent activity).
   */
  getActiveSessionThreads(maxAgeMs = 3_600_000): SessionThread[] {
    const cutoff = Date.now() - maxAgeMs;
    return Array.from(this.threads.values()).filter(
      (t) => t.lastActivity.getTime() > cutoff,
    );
  }

  /**
   * List session threads whose parent channel matches the given channelId.
   */
  getSessionsByChannel(channelId: string): SessionThread[] {
    const results: SessionThread[] = [];
    for (const [sessionId, meta] of this.threads) {
      const thread = this.threadChannels.get(sessionId);
      if (thread && (thread as unknown as { parentId: string }).parentId === channelId) {
        results.push(meta);
      }
    }
    return results;
  }

  // ───────────────────── Update ─────────────────────

  /**
   * Set the hot query override for a session.
   * Pass undefined to clear the override (revert to global default).
   */
  setHotQuery(sessionId: string, enabled: boolean | undefined): void {
    const meta = this.threads.get(sessionId);
    if (meta) {
      meta.hotQuery = enabled;
      this.schedulePersist();
    }
  }

  /**
   * Get the hot query override for a session (undefined = use global default).
   */
  getHotQuery(sessionId: string): boolean | undefined {
    return this.threads.get(sessionId)?.hotQuery;
  }

  /**
   * Record that a message was sent in a session thread.
   * If `messageId` is provided, also advances the offline catch-up bookmark.
   */
  recordActivity(sessionId: string, messageId?: string): void {
    const meta = this.threads.get(sessionId);
    if (meta) {
      meta.lastActivity = new Date();
      meta.messageCount++;
      if (messageId) {
        meta.lastSeenMessageId = messageId;
      }
      this.schedulePersist();
    }
  }

  /**
   * Explicitly advance the offline catch-up bookmark without bumping activity counters.
   * Used by the catch-up flow when ignoring or batch-processing offline messages.
   */
  setLastSeenMessageId(sessionId: string, messageId: string): void {
    const meta = this.threads.get(sessionId);
    if (meta) {
      meta.lastSeenMessageId = messageId;
      this.schedulePersist();
    }
  }

  /** Get the offline catch-up bookmark for a session (undefined if never seen). */
  getLastSeenMessageId(sessionId: string): string | undefined {
    return this.threads.get(sessionId)?.lastSeenMessageId;
  }

  /**
   * Update the session ID mapping (e.g., when the real SDK session ID arrives
   * after we created the thread with a placeholder).
   */
  updateSessionId(oldId: string, newId: string): void {
    const meta = this.threads.get(oldId);
    const channel = this.threadChannels.get(oldId);

    if (meta) {
      meta.sessionId = newId;
      this.threads.delete(oldId);
      this.threads.set(newId, meta);
    }

    if (channel) {
      this.threadChannels.delete(oldId);
      this.threadChannels.set(newId, channel);
    }

    this.schedulePersist();
  }

  /**
   * Store a ThreadChannel reference obtained externally (e.g., fetched from cache).
   */
  setThreadChannel(sessionId: string, thread: ThreadChannel): void {
    this.threadChannels.set(sessionId, thread);
  }

  // ───────────────────── Cleanup ─────────────────────

  /**
   * Remove sessions older than the given age.
   * Does NOT archive the Discord threads — that's handled by autoArchiveDuration.
   */
  cleanup(maxAgeMs = 24 * 3_600_000): number {
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;
    for (const [id, meta] of this.threads) {
      if (meta.lastActivity.getTime() < cutoff) {
        this.threads.delete(id);
        this.threadChannels.delete(id);
        removed++;
      }
    }
    if (removed > 0) this.schedulePersist();
    return removed;
  }

  /**
   * Delete a specific session by ID.
   * Returns the thread ID if found (caller can use it to delete the Discord thread).
   */
  deleteSession(sessionId: string): string | undefined {
    const meta = this.threads.get(sessionId);
    if (!meta) return undefined;
    const threadId = meta.threadId;
    this.threads.delete(sessionId);
    this.threadChannels.delete(sessionId);
    this.schedulePersist();
    return threadId;
  }
}
