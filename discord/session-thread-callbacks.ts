/**
 * Session thread callback factory — creates the SessionThreadCallbacks
 * that connect Claude sessions to Discord threads.
 *
 * @module discord/session-thread-callbacks
 */

import type { TextChannel } from "npm:discord.js@14.14.1";
import { createClaudeSender } from "../claude/discord-sender.ts";
import type { SessionThreadCallbacks } from "../claude/command.ts";
import type { SessionThreadManager } from "./session-threads.ts";
import { createChannelSenderAdapter, sendMessageContent } from "./message-sender.ts";

export interface SessionThreadCallbackDeps {
  sessionThreadManager: SessionThreadManager;
  getBot: () => any;
  commandChannels: Map<string, any>;
}

export function createSessionThreadCallbacks(
  deps: SessionThreadCallbackDeps,
): SessionThreadCallbacks {
  const { sessionThreadManager, getBot, commandChannels } = deps;

  return {
    async createThreadSender(
      prompt: string,
      sessionId?: string,
      threadName?: string,
      channelId?: string,
    ) {
      let channel: TextChannel | null = (channelId && commandChannels.get(channelId)) ||
        null;
      // Fallback: fetch from Discord client (e.g. scheduled tasks where
      // no prior slash command has populated commandChannels for this channel)
      if (!channel && channelId) {
        const bot = getBot();
        const cached = bot?.client?.channels?.cache?.get(channelId) ?? null;
        if (cached) {
          channel = cached as TextChannel;
        } else if (bot?.client?.channels) {
          try {
            const fetched = await bot.client.channels.fetch(channelId);
            if (fetched) channel = fetched as TextChannel;
          } catch { /* channel not accessible */ }
        }
        if (channel) commandChannels.set(channelId, channel);
      }
      if (!channel) {
        channel = getBot()?.getChannel() as TextChannel | null;
      }
      if (!channel) throw new Error("Bot channel not ready");

      if (sessionId) {
        const existingThread = sessionThreadManager.getThread(sessionId);
        if (existingThread) {
          if (existingThread.archived) {
            await existingThread.setArchived(false);
          }
          sessionThreadManager.recordActivity(sessionId);
          const threadSender = createClaudeSender(createChannelSenderAdapter(existingThread), {
            isThread: true,
          });
          return {
            sender: threadSender,
            threadSessionKey: sessionId,
            threadChannelId: existingThread.id,
          };
        }
      }

      const placeholderKey = `pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const thread = await sessionThreadManager.createSessionThread(
        channel,
        placeholderKey,
        prompt,
        threadName,
      );
      sessionThreadManager.recordActivity(placeholderKey);

      await sendMessageContent(channel, {
        embeds: [{
          color: 0x5865F2,
          title: "🧵 New Claude Session",
          description: `A new session thread has been created.\n\n**Prompt:** \`${
            prompt.substring(0, 200)
          }${prompt.length > 200 ? "..." : ""}\``,
          fields: [
            { name: "Thread", value: `<#${thread.id}>`, inline: true },
          ],
          timestamp: true,
        }],
      });

      const threadSender = createClaudeSender(createChannelSenderAdapter(thread), {
        isThread: true,
      });
      return { sender: threadSender, threadSessionKey: placeholderKey, threadChannelId: thread.id };
    },

    async getThreadSender(sessionId: string) {
      const existingThread = sessionThreadManager.getThread(sessionId);
      if (!existingThread) return undefined;

      if (existingThread.archived) {
        await existingThread.setArchived(false);
      }
      sessionThreadManager.recordActivity(sessionId);
      const threadSender = createClaudeSender(createChannelSenderAdapter(existingThread), {
        isThread: true,
      });
      return { sender: threadSender, threadSessionKey: sessionId };
    },

    updateSessionId(oldKey: string, newSessionId: string) {
      sessionThreadManager.updateSessionId(oldKey, newSessionId);
    },
  };
}
