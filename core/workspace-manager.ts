/**
 * WorkspaceManager — manages channel → workDir mappings for multi-workspace support.
 * Persists to .bot-data/workspaces.json.
 */

import * as path from "https://deno.land/std@0.208.0/path/mod.ts";

export interface WorkspaceEntry {
  name: string;
  path: string;
  channelId: string;
  autoThread?: boolean;
  /** Last Discord message ID seen in this channel — used as the offline catch-up bookmark. */
  lastSeenMessageId?: string;
}

interface WorkspaceData {
  workspaces: WorkspaceEntry[];
}

const DATA_DIR = ".bot-data";
const DATA_FILE = "workspaces.json";

export class WorkspaceManager {
  private workspaces: WorkspaceEntry[] = [];
  private dataPath: string;
  private defaultChannelId: string | null = null;

  constructor(private defaultWorkDir: string) {
    this.dataPath = path.join(defaultWorkDir, DATA_DIR, DATA_FILE);
  }

  setDefaultChannelId(channelId: string): void {
    this.defaultChannelId = channelId;
  }

  resolve(channelId: string): string {
    const entry = this.workspaces.find((w) => w.channelId === channelId);
    return entry?.path ?? this.defaultWorkDir;
  }

  add(entry: WorkspaceEntry): void {
    // Replace if name already exists
    const idx = this.workspaces.findIndex((w) => w.name === entry.name);
    if (idx >= 0) {
      this.workspaces[idx] = entry;
    } else {
      this.workspaces.push(entry);
    }
  }

  remove(name: string): WorkspaceEntry | undefined {
    const idx = this.workspaces.findIndex((w) => w.name === name);
    if (idx < 0) return undefined;
    const [removed] = this.workspaces.splice(idx, 1);
    return removed;
  }

  list(): WorkspaceEntry[] {
    return [...this.workspaces];
  }

  findByChannel(channelId: string): WorkspaceEntry | undefined {
    const explicit = this.workspaces.find((w) => w.channelId === channelId);
    if (explicit) return explicit;
    if (channelId === this.defaultChannelId) {
      return { name: "default", path: this.defaultWorkDir, channelId };
    }
    return undefined;
  }

  findByName(name: string): WorkspaceEntry | undefined {
    return this.workspaces.find((w) => w.name === name);
  }

  isAutoThreadChannel(channelId: string): boolean {
    const entry = this.workspaces.find((w) => w.channelId === channelId);
    return !!entry?.autoThread;
  }

  setAutoThread(name: string, enabled: boolean): WorkspaceEntry | undefined {
    const entry = this.workspaces.find((w) => w.name === name);
    if (!entry) return undefined;
    entry.autoThread = enabled;
    return entry;
  }

  setLastSeenMessageId(channelId: string, messageId: string): void {
    const entry = this.workspaces.find((w) => w.channelId === channelId);
    if (entry) {
      entry.lastSeenMessageId = messageId;
    }
  }

  getLastSeenMessageId(channelId: string): string | undefined {
    return this.workspaces.find((w) => w.channelId === channelId)?.lastSeenMessageId;
  }

  getManagedChannelIds(): Set<string> {
    const ids = new Set<string>();
    if (this.defaultChannelId) ids.add(this.defaultChannelId);
    for (const w of this.workspaces) {
      ids.add(w.channelId);
    }
    return ids;
  }

  async loadFromDisk(): Promise<void> {
    try {
      const raw = await Deno.readTextFile(this.dataPath);
      const data: WorkspaceData = JSON.parse(raw);
      this.workspaces = data.workspaces ?? [];
    } catch {
      // File doesn't exist yet — start fresh
      this.workspaces = [];
    }
  }

  async saveToDisk(): Promise<void> {
    const dir = path.dirname(this.dataPath);
    try {
      await Deno.mkdir(dir, { recursive: true });
    } catch {
      // already exists
    }
    const data: WorkspaceData = { workspaces: this.workspaces };
    await Deno.writeTextFile(this.dataPath, JSON.stringify(data, null, 2) + "\n");
  }
}
