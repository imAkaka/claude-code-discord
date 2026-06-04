/**
 * Offline Message Catch-up — fetches user messages sent while bot was offline,
 * posts an inbox-style prompt with Process / Ignore buttons in the original
 * channel, and routes the user's choice to the existing thread / workspace
 * message handlers.
 *
 * @module discord/offline-catchup
 */

import type { ButtonInteraction, Client, TextChannel, ThreadChannel } from "npm:discord.js@14.14.1";
import type { SessionThreadManager } from "./session-threads.ts";
import type { WorkspaceManager } from "../core/workspace-manager.ts";

export interface CatchupMessage {
  id: string;
  content: string;
  createdAt: Date;
}

const CATCHUP_PREFIX = "offline-catchup";

export type CatchupAction = "process" | "ignore";

export interface DecodedCatchupId {
  action: CatchupAction;
  channelId: string;
  oldestId: string;
  newestId: string;
}

export function encodeCatchupCustomId(
  action: CatchupAction,
  channelId: string,
  oldestId: string,
  newestId: string,
): string {
  return CATCHUP_PREFIX + ":" + action + ":" + channelId + ":" + oldestId + ":" + newestId;
}

export function decodeCatchupCustomId(customId: string): DecodedCatchupId | null {
  if (!customId.startsWith(CATCHUP_PREFIX + ":")) return null;
  const parts = customId.split(":");
  if (parts.length !== 5) return null;
  const [, action, channelId, oldestId, newestId] = parts;
  if (action !== "process" && action !== "ignore") return null;
  return { action, channelId, oldestId, newestId };
}

export function isCatchupCustomId(customId: string): boolean {
  return customId.startsWith(CATCHUP_PREFIX + ":");
}

export function formatMergedPrompt(messages: CatchupMessage[]): string {
  const header =
    `[这是你离线期间用户在该 thread/频道累积发送的 ${messages.length} 条消息，按时间顺序排列。请综合判断如何处理：]`;
  const body = messages
    .map((m, i) => `${i + 1}. (${m.createdAt.toISOString()}) ${m.content}`)
    .join("\n");
  return `${header}\n\n${body}`;
}

export function pLimit(n: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    active--;
    const r = queue.shift();
    if (r) r();
  };
  return <T>(fn: () => Promise<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const run = async () => {
        active++;
        try {
          resolve(await fn());
        } catch (e) {
          reject(e);
        } finally {
          next();
        }
      };
      if (active < n) run();
      else queue.push(run);
    });
  };
}

const FETCH_LIMIT = 100;
const FETCH_CONCURRENCY = 5;

export interface CatchupTarget {
  channelId: string;
  kind: "thread" | "workspace";
  lastActivityMs: number;
}

export interface MissedBatch {
  target: CatchupTarget;
  channel: TextChannel | ThreadChannel;
  messages: CatchupMessage[];
  oldestId: string;
  newestId: string;
}

export interface OfflineCatchupDeps {
  client: Client;
  sessionThreads: SessionThreadManager;
  workspaceManager: WorkspaceManager;
}

export class OfflineCatchupManager {
  constructor(private deps: OfflineCatchupDeps) {}

  collectTargets(): CatchupTarget[] {
    const targets: CatchupTarget[] = [];

    for (const meta of this.deps.sessionThreads.getAllSessionThreads()) {
      if (meta.sessionId.startsWith("pending_")) continue;
      const live = this.deps.sessionThreads.getThread(meta.sessionId);
      if (!live) continue;
      targets.push({
        channelId: meta.threadId,
        kind: "thread",
        lastActivityMs: meta.lastActivity.getTime(),
      });
    }

    for (const channelId of this.deps.workspaceManager.getManagedChannelIds()) {
      if (targets.some((t) => t.channelId === channelId)) continue;
      targets.push({ channelId, kind: "workspace", lastActivityMs: 0 });
    }

    targets.sort((a, b) => b.lastActivityMs - a.lastActivityMs);
    return targets;
  }

  async resolveChannel(
    target: CatchupTarget,
  ): Promise<TextChannel | ThreadChannel | null> {
    if (target.kind === "thread") {
      const sessionId = this.deps.sessionThreads.findSessionByThreadId(target.channelId);
      if (sessionId) {
        const ch = this.deps.sessionThreads.getThread(sessionId);
        if (ch) return ch;
      }
    }
    for (const guild of this.deps.client.guilds.cache.values()) {
      try {
        const fetched = await guild.channels.fetch(target.channelId);
        if (fetched && (fetched.isTextBased() || fetched.isThread())) {
          return fetched as unknown as TextChannel | ThreadChannel;
        }
      } catch {
        // try next guild
      }
    }
    return null;
  }

  async fetchMissed(
    target: CatchupTarget,
    channel: TextChannel | ThreadChannel,
  ): Promise<MissedBatch | null> {
    const sessionId = target.kind === "thread"
      ? this.deps.sessionThreads.findSessionByThreadId(target.channelId)
      : undefined;
    let bookmark = target.kind === "thread"
      ? (sessionId ? this.deps.sessionThreads.getLastSeenMessageId(sessionId) : undefined)
      : this.deps.workspaceManager.getLastSeenMessageId(target.channelId);

    if (!bookmark) {
      // Threads: fall back to threadId (a snowflake equal to the starter
      // message ID) so the entire thread's user messages get picked up.
      // Workspace channels: keep the baseline-and-skip behavior to avoid
      // dumping unrelated historical messages on first startup.
      if (target.kind === "thread") {
        bookmark = target.channelId;
      } else {
        try {
          const latest = await channel.messages.fetch({ limit: 1 });
          const newest = latest.first();
          if (newest) {
            await this.advanceBookmark(target, newest.id);
          }
        } catch (err) {
          console.warn("[OfflineCatchup] Baseline fetch failed for " + target.channelId + ":", err);
        }
        return null;
      }
    }

    let fetched;
    try {
      fetched = await channel.messages.fetch({ after: bookmark, limit: FETCH_LIMIT });
    } catch (err) {
      console.warn("[OfflineCatchup] Catch-up fetch failed for " + target.channelId + ":", err);
      return null;
    }

    const ourBotId = this.deps.client.user?.id;
    const filtered = Array.from(fetched.values())
      .filter((m) => !m.author.bot)
      .filter((m) => !m.content.startsWith("/"))
      .filter((m) => {
        if (m.mentions.users.size === 0) return true;
        const mentionsMe = ourBotId ? m.mentions.users.has(ourBotId) : false;
        const mentionsOtherBot = m.mentions.users.some((u) => u.bot && u.id !== ourBotId);
        return !(mentionsOtherBot && !mentionsMe);
      })
      .sort((a, b) => Number(BigInt(a.id) - BigInt(b.id)));

    if (filtered.length === 0) return null;

    return {
      target,
      channel,
      messages: filtered.map((m) => ({ id: m.id, content: m.content, createdAt: m.createdAt })),
      oldestId: filtered[0].id,
      newestId: filtered[filtered.length - 1].id,
    };
  }

  private async advanceBookmark(target: CatchupTarget, messageId: string): Promise<void> {
    if (target.kind === "thread") {
      const sessionId = this.deps.sessionThreads.findSessionByThreadId(target.channelId);
      if (sessionId) this.deps.sessionThreads.setLastSeenMessageId(sessionId, messageId);
    } else {
      this.deps.workspaceManager.setLastSeenMessageId(target.channelId, messageId);
      await this.deps.workspaceManager.saveToDisk();
    }
  }

  async scanAll(): Promise<MissedBatch[]> {
    const targets = this.collectTargets();
    const limit = pLimit(FETCH_CONCURRENCY);
    const tasks = targets.map((t) =>
      limit(async () => {
        const channel = await this.resolveChannel(t);
        if (!channel) return null;
        return await this.fetchMissed(t, channel);
      })
    );
    const results = await Promise.all(tasks);
    return results.filter((r): r is MissedBatch => r !== null);
  }

  /**
   * Delete any leftover catch-up prompts from previous startups in this channel.
   * Returns the union of [oldest, newest] ranges decoded from those prompts so
   * caller can extend the new prompt's range to cover them.
   */
  async cleanupStalePrompts(
    channel: TextChannel | ThreadChannel,
  ): Promise<{ olderThanCurrent: { oldestId: string; newestId: string } | null }> {
    const ourBotId = this.deps.client.user?.id;
    if (!ourBotId) return { olderThanCurrent: null };

    let recent;
    try {
      recent = await channel.messages.fetch({ limit: 20 });
    } catch {
      return { olderThanCurrent: null };
    }

    let oldestIdSeen: string | null = null;
    let newestIdSeen: string | null = null;
    for (const msg of recent.values()) {
      if (msg.author.id !== ourBotId) continue;
      const row = msg.components?.[0] as any;
      const button = row?.components?.[0];
      const customId = button?.customId ?? button?.custom_id;
      if (typeof customId !== "string") continue;
      const decoded = decodeCatchupCustomId(customId);
      if (!decoded) continue;
      if (decoded.oldestId) {
        if (!oldestIdSeen || BigInt(decoded.oldestId) < BigInt(oldestIdSeen)) {
          oldestIdSeen = decoded.oldestId;
        }
      }
      if (!newestIdSeen || BigInt(decoded.newestId) > BigInt(newestIdSeen)) {
        newestIdSeen = decoded.newestId;
      }
      try {
        await msg.delete();
      } catch {
        // ignore — message may have been deleted already
      }
    }

    return {
      olderThanCurrent: oldestIdSeen && newestIdSeen
        ? { oldestId: oldestIdSeen, newestId: newestIdSeen }
        : null,
    };
  }

  async postInboxPrompt(batch: MissedBatch): Promise<void> {
    const stale = await this.cleanupStalePrompts(batch.channel);
    let oldestId = batch.oldestId;
    let newestId = batch.newestId;
    let count = batch.messages.length;

    if (stale.olderThanCurrent) {
      if (BigInt(stale.olderThanCurrent.oldestId) < BigInt(oldestId)) {
        oldestId = stale.olderThanCurrent.oldestId;
      }
      if (BigInt(stale.olderThanCurrent.newestId) > BigInt(newestId)) {
        newestId = stale.olderThanCurrent.newestId;
      }
      // Re-count by re-fetching the union range
      try {
        const cursor = (BigInt(oldestId) - 1n).toString();
        const refetched = await batch.channel.messages.fetch({ after: cursor, limit: FETCH_LIMIT });
        const ourBotId = this.deps.client.user?.id;
        count = Array.from(refetched.values())
          .filter((m) => !m.author.bot && !m.content.startsWith("/"))
          .filter((m) => {
            if (m.mentions.users.size === 0) return true;
            const mentionsMe = ourBotId ? m.mentions.users.has(ourBotId) : false;
            const mentionsOtherBot = m.mentions.users.some((u) => u.bot && u.id !== ourBotId);
            return !(mentionsOtherBot && !mentionsMe);
          })
          .filter((m) => BigInt(m.id) <= BigInt(newestId)).length;
      } catch {
        // keep batch.messages count if refetch fails
      }
    }

    const truncationNote = batch.messages.length >= FETCH_LIMIT
      ? `\n\n_（仅含最近 ${FETCH_LIMIT} 条）_`
      : "";

    await batch.channel.send({
      embeds: [{
        color: 0x5865F2,
        title: "👋 我刚回来",
        description: `发现这里有 **${count}** 条新消息没处理。${truncationNote}`,
      }],
      components: [{
        type: 1,
        components: [
          {
            type: 2,
            style: 3,
            label: "▶️ 处理",
            custom_id: encodeCatchupCustomId("process", batch.target.channelId, oldestId, newestId),
          },
          {
            type: 2,
            style: 4,
            label: "🚫 忽略",
            custom_id: encodeCatchupCustomId("ignore", batch.target.channelId, "", newestId),
          },
        ],
      }] as any,
    });
  }

  async runOnStartup(): Promise<void> {
    console.log("[OfflineCatchup] Starting scan...");
    let batches: MissedBatch[];
    try {
      batches = await this.scanAll();
    } catch (err) {
      console.error("[OfflineCatchup] Scan failed:", err);
      return;
    }
    console.log(`[OfflineCatchup] Found ${batches.length} channels with missed messages`);
    for (const batch of batches) {
      try {
        await this.postInboxPrompt(batch);
      } catch (err) {
        console.error(
          "[OfflineCatchup] Failed to post inbox in " + batch.target.channelId + ":",
          err,
        );
      }
    }
  }
}

export interface CatchupHandlerDeps extends OfflineCatchupDeps {
  onThreadMessage?: (
    channelId: string,
    content: string,
    meta?: { messageId?: string; userId?: string },
  ) => Promise<void>;
  onWorkspaceMessage?: (
    channelId: string,
    content: string,
    meta?: { messageId?: string; userId?: string },
  ) => Promise<void>;
}

export function createCatchupButtonHandler(deps: CatchupHandlerDeps) {
  return async function handle(interaction: ButtonInteraction): Promise<void> {
    const decoded = decodeCatchupCustomId(interaction.customId);
    if (!decoded) return;

    if (decoded.action === "ignore") {
      const sessionId = deps.sessionThreads.findSessionByThreadId(decoded.channelId);
      if (sessionId) {
        deps.sessionThreads.setLastSeenMessageId(sessionId, decoded.newestId);
      } else {
        deps.workspaceManager.setLastSeenMessageId(decoded.channelId, decoded.newestId);
        await deps.workspaceManager.saveToDisk();
      }
      await interaction.update({
        embeds: [{
          color: 0x808080,
          title: "🚫 已忽略",
          description: "下次启动不会再提示这批消息。",
        }],
        components: [],
      });
      return;
    }

    await interaction.update({
      embeds: [{
        color: 0xFAA61A,
        title: "⏳ 正在处理…",
        description: "已读取离线期间的消息，正在转交给 Claude。",
      }],
      components: [],
    });

    const channel = interaction.channel;
    if (!channel || !("messages" in channel)) {
      await interaction.followUp({ content: "❌ 无法访问此频道的消息。", ephemeral: true });
      return;
    }

    let collected;
    try {
      const afterCursor = (BigInt(decoded.oldestId) - 1n).toString();
      collected = await (channel as TextChannel | ThreadChannel).messages.fetch({
        after: afterCursor,
        limit: FETCH_LIMIT,
      });
    } catch (err) {
      console.error("[OfflineCatchup] Re-fetch on Process failed:", err);
      await interaction.followUp({ content: "❌ 拉取离线消息失败，请稍后再试。", ephemeral: true });
      return;
    }

    const ourBotId = deps.client.user?.id;
    const messages: CatchupMessage[] = Array.from(collected.values())
      .filter((m) => !m.author.bot && !m.content.startsWith("/"))
      .filter((m) => {
        if (m.mentions.users.size === 0) return true;
        const mentionsMe = ourBotId ? m.mentions.users.has(ourBotId) : false;
        const mentionsOtherBot = m.mentions.users.some((u) => u.bot && u.id !== ourBotId);
        return !(mentionsOtherBot && !mentionsMe);
      })
      .filter((m) => BigInt(m.id) <= BigInt(decoded.newestId))
      .sort((a, b) => Number(BigInt(a.id) - BigInt(b.id)))
      .map((m) => ({ id: m.id, content: m.content, createdAt: m.createdAt }));

    if (messages.length === 0) {
      await interaction.followUp({
        content: "ℹ️ 没有可处理的消息（可能已被删除）。",
        ephemeral: true,
      });
      const sessionId = deps.sessionThreads.findSessionByThreadId(decoded.channelId);
      if (sessionId) {
        deps.sessionThreads.setLastSeenMessageId(sessionId, decoded.newestId);
      } else {
        deps.workspaceManager.setLastSeenMessageId(decoded.channelId, decoded.newestId);
        await deps.workspaceManager.saveToDisk();
      }
      return;
    }

    const prompt = formatMergedPrompt(messages);
    const sessionId = deps.sessionThreads.findSessionByThreadId(decoded.channelId);
    if (sessionId && deps.onThreadMessage) {
      await deps.onThreadMessage(decoded.channelId, prompt, { messageId: decoded.newestId });
    } else if (deps.onWorkspaceMessage) {
      await deps.onWorkspaceMessage(decoded.channelId, prompt, { messageId: decoded.newestId });
    } else {
      console.warn("[OfflineCatchup] No handler for " + decoded.channelId);
    }
  };
}
