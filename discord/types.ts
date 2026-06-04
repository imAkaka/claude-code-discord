/** @module discord/types — Shared type definitions for the Discord layer. */
import type { ButtonInteraction, TextChannel } from "npm:discord.js@14.14.1";
import type { BotSettings } from "../types/shared.ts";

export interface EmbedData {
  color?: number;
  title?: string;
  description?: string;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
  timestamp?: boolean;
}

export interface ComponentData {
  type: "button";
  customId?: string;
  url?: string;
  label: string;
  style: "primary" | "secondary" | "success" | "danger" | "link";
  disabled?: boolean;
}

export interface FileAttachment {
  /** File path or URL */
  path: string;
  /** Optional display name */
  name?: string;
  /** Optional description */
  description?: string;
}

export interface MessageContent {
  content?: string;
  embeds?: EmbedData[];
  components?: Array<{ type: "actionRow"; components: ComponentData[] }>;
  /** File attachments to include */
  files?: FileAttachment[];
}

export interface InteractionContext {
  deferReply(): Promise<void>;
  editReply(content: MessageContent): Promise<void>;
  followUp(content: MessageContent & { ephemeral?: boolean }): Promise<void>;
  reply(content: MessageContent & { ephemeral?: boolean }): Promise<void>;
  update(content: MessageContent): Promise<void>;
  getString(name: string, required?: boolean): string | null;
  getInteger(name: string, required?: boolean): number | null;
  getBoolean(name: string, required?: boolean): boolean | null;
  /** Returns the set of role IDs the invoking member has */
  getMemberRoleIds(): Set<string>;
  /** Returns the invoking member's user ID */
  getUserId(): string;
  /** Returns the channel or thread ID the interaction was sent in */
  getChannelId(): string;
  /** Returns the subcommand name if the command has subcommands */
  getSubcommand(): string | null;
}

export interface BotConfig {
  discordToken: string;
  applicationId: string;
  workDir: string;
  repoName: string;
  branchName: string;
  categoryName?: string;
  defaultMentionUserId?: string;
}

// Abstract command handler interface
export interface CommandHandler {
  // Execute the command
  execute(ctx: InteractionContext): Promise<void> | void;
  // Optional: Handle button interactions for this command
  handleButton?(ctx: InteractionContext, customId: string): Promise<void> | void;
}

// Map of command name to handler
export type CommandHandlers = Map<string, CommandHandler>;

// Button handler type
export type ButtonHandler = (ctx: InteractionContext) => Promise<void> | void;

// Button handler registry
export type ButtonHandlers = Map<string, ButtonHandler>;

// Interfaces for dependency injection

export interface SlashCommand {
  name: string;
  description: string;
  options?: any[];
  toJSON(): any;
}

export interface MonitorConfig {
  /** Discord channel ID to watch for messages */
  channelId: string;
  /** Bot/webhook user IDs whose messages trigger auto-response */
  botIds: string[];
  /** Callback invoked with batched alert content and the thread to stream output to */
  onAlertMessage: (content: string, thread: TextChannel) => Promise<void>;
}

/**
 * Tracks the mapping between a Claude session and its dedicated Discord thread.
 */
export interface SessionThread {
  /** Claude session ID */
  sessionId: string;
  /** Discord thread ID */
  threadId: string;
  /** Thread name (derived from the first prompt) */
  threadName: string;
  /** When the session thread was created */
  createdAt: Date;
  /** When the last message was sent in this thread */
  lastActivity: Date;
  /** Number of messages sent in this thread */
  messageCount: number;
  /** Per-session hot query override (undefined = use global default) */
  hotQuery?: boolean;
  /** ID of the last user message the bot processed in this thread (offline catch-up bookmark). */
  lastSeenMessageId?: string;
}

export interface BotDependencies {
  commands: SlashCommand[];
  cleanSessionId?: (sessionId: string) => string;
  /** Optional bot settings for mention functionality */
  botSettings?: BotSettings;
  /** Optional channel monitoring config for auto-responding to messages */
  monitorConfig?: MonitorConfig;
  /** Callback for plain text messages in session threads (auto-resume) */
  onThreadMessage?: (
    channelId: string,
    content: string,
    meta?: { messageId?: string; userId?: string },
  ) => Promise<void>;
  /** Set the channel where Claude output should be sent (multi-channel support) */
  setResponseChannel?: (channel: any) => void;
  /** Returns set of channel IDs managed by workspace system (checked by isOurChannel) */
  getManagedChannelIds?: () => Set<string>;
  /** Returns true when the given channel has the auto-thread workspace option enabled */
  isAutoThreadChannel?: (channelId: string) => boolean;
  /** Callback for plain text messages in auto-thread-enabled workspace channels */
  onWorkspaceMessage?: (
    channelId: string,
    content: string,
    meta?: { messageId?: string; userId?: string },
  ) => Promise<void>;
  /** Resolve a HotQuerySession by sessionId — used by the queue-clear button handler. */
  resolveHotSession?: (sessionId: string) => unknown;
  /** Routes offline-catchup:* button interactions. */
  catchupButtonHandler?: (interaction: ButtonInteraction) => Promise<void>;
}
