/** @module discord/bot — Discord.js client creation, slash command registration, and event routing. */
import {
  ActionRowBuilder,
  AttachmentBuilder,
  AutocompleteInteraction,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  Client,
  CommandInteraction,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  Message,
  MessageFlags,
  MessageType,
  REST,
  Routes,
  TextChannel,
} from "npm:discord.js@14.14.1";

import { sanitizeChannelName } from "./utils.ts";
import { handlePaginationInteraction } from "./pagination.ts";
import {
  createQueueClearHandler,
  QUEUE_CLEAR_PREFIX,
} from "./queue-button-handler.ts";
import { pendingFileUploads } from "../claude/discord-sender.ts";
import { isVoiceTranscriptionEnabled, transcribeAudio } from "../voice/transcribe.ts";
import { checkCommandPermission } from "../core/rbac.ts";
import { SETTINGS_ACTIONS, SETTINGS_VALUES } from "../settings/unified-settings.ts";
import { BOT_VERSION } from "../util/version-check.ts";
import type {
  BotConfig,
  BotDependencies,
  ButtonHandlers,
  CommandHandlers,
  InteractionContext,
  MessageContent,
} from "./types.ts";

// ================================
// Helper Functions
// ================================

function convertMessageContent(content: MessageContent): any {
  const payload: any = {};

  if (content.content) payload.content = content.content;

  if (content.embeds) {
    payload.embeds = content.embeds.map((e) => {
      const embed = new EmbedBuilder();
      if (e.color !== undefined) embed.setColor(e.color);
      if (e.title) embed.setTitle(e.title);
      if (e.description) embed.setDescription(e.description);
      if (e.fields) e.fields.forEach((f) => embed.addFields(f));
      if (e.footer) embed.setFooter(e.footer);
      if (e.timestamp) embed.setTimestamp();
      return embed;
    });
  }

  if (content.components) {
    payload.components = content.components.map((row) => {
      const actionRow = new ActionRowBuilder<ButtonBuilder>();
      row.components.forEach((comp) => {
        const button = new ButtonBuilder().setLabel(comp.label);

        switch (comp.style) {
          case "primary":
            button.setStyle(ButtonStyle.Primary);
            break;
          case "secondary":
            button.setStyle(ButtonStyle.Secondary);
            break;
          case "success":
            button.setStyle(ButtonStyle.Success);
            break;
          case "danger":
            button.setStyle(ButtonStyle.Danger);
            break;
          case "link":
            button.setStyle(ButtonStyle.Link);
            break;
        }

        if (comp.style === "link" && comp.url) {
          button.setURL(comp.url);
        } else if (comp.customId) {
          button.setCustomId(comp.customId);
        }

        actionRow.addComponents(button);
      });
      return actionRow;
    });
  }

  // Handle file attachments
  if (content.files && content.files.length > 0) {
    payload.files = content.files.map((f) => ({
      attachment: f.path,
      name: f.name || "attachment",
      description: f.description,
    }));
  }

  return payload;
}

// ================================
// Main Bot Creation Function
// ================================

export async function createDiscordBot(
  config: BotConfig,
  handlers: CommandHandlers,
  buttonHandlers: ButtonHandlers,
  dependencies: BotDependencies,
  crashHandler?: any,
) {
  const { discordToken, applicationId, workDir, repoName, branchName, categoryName } = config;
  const actualCategoryName = categoryName || repoName;

  let myChannel: TextChannel | null = null;
  let myCategory: any = null;

  const botSettings = dependencies.botSettings || {
    mentionEnabled: !!config.defaultMentionUserId,
    mentionUserId: config.defaultMentionUserId || null,
  };

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  // Use commands from dependencies
  const commands = dependencies.commands;

  // Channel management
  async function ensureChannelExists(guild: any): Promise<TextChannel> {
    const channelName = sanitizeChannelName(branchName);

    console.log(`Checking category "${actualCategoryName}"...`);

    let category = guild.channels.cache.find(
      (c: any) => c.type === ChannelType.GuildCategory && c.name === actualCategoryName,
    );

    if (!category) {
      console.log(`Creating category "${actualCategoryName}"...`);
      try {
        category = await guild.channels.create({
          name: actualCategoryName,
          type: ChannelType.GuildCategory,
        });
        console.log(`Created category "${actualCategoryName}"`);
      } catch (error) {
        console.error(`Category creation error: ${error}`);
        throw new Error(
          `Cannot create category. Please ensure the bot has "Manage Channels" permission.`,
        );
      }
    }

    myCategory = category;

    let channel = guild.channels.cache.find(
      (c: any) =>
        c.type === ChannelType.GuildText && c.name === channelName && c.parentId === category.id,
    );

    if (!channel) {
      console.log(`Creating channel "${channelName}"...`);
      try {
        channel = await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: category.id,
          topic:
            `Repository: ${repoName} | Branch: ${branchName} | Machine: ${Deno.hostname()} | Path: ${workDir}`,
        });
        console.log(`Created channel "${channelName}"`);
      } catch (error) {
        console.error(`Channel creation error: ${error}`);
        throw new Error(
          `Cannot create channel. Please ensure the bot has "Manage Channels" permission.`,
        );
      }
    }

    return channel as TextChannel;
  }

  // Create interaction context wrapper
  function createInteractionContext(
    interaction: CommandInteraction | ButtonInteraction,
  ): InteractionContext {
    return {
      async deferReply(): Promise<void> {
        await interaction.deferReply();
      },

      async editReply(content: MessageContent): Promise<void> {
        await interaction.editReply(convertMessageContent(content));
      },

      async followUp(content: MessageContent & { ephemeral?: boolean }): Promise<void> {
        const payload = convertMessageContent(content);
        payload.ephemeral = content.ephemeral || false;
        await interaction.followUp(payload);
      },

      async reply(content: MessageContent & { ephemeral?: boolean }): Promise<void> {
        const payload = convertMessageContent(content);
        payload.ephemeral = content.ephemeral || false;
        await interaction.reply(payload);
      },

      async update(content: MessageContent): Promise<void> {
        if ("update" in interaction) {
          await (interaction as ButtonInteraction).update(convertMessageContent(content));
        }
      },

      getString(name: string, required?: boolean): string | null {
        if (interaction.isCommand && interaction.isCommand()) {
          return (interaction as any).options.getString(name, required ?? false);
        }
        return null;
      },

      getInteger(name: string, required?: boolean): number | null {
        if (interaction.isCommand && interaction.isCommand()) {
          return (interaction as any).options.getInteger(name, required ?? false);
        }
        return null;
      },

      getBoolean(name: string, required?: boolean): boolean | null {
        if (interaction.isCommand && interaction.isCommand()) {
          return (interaction as any).options.getBoolean(name, required ?? false);
        }
        return null;
      },

      getMemberRoleIds(): Set<string> {
        const member = interaction.member;
        if (member && "roles" in member && member.roles && "cache" in member.roles) {
          const cache = (member.roles as any).cache;
          if (cache && typeof cache.keys === "function") {
            return new Set([...cache.keys()]);
          }
        }
        return new Set();
      },

      getUserId(): string {
        return interaction.user?.id ?? "";
      },

      getChannelId(): string {
        return interaction.channelId ?? "";
      },

      getSubcommand(): string | null {
        if (interaction.isCommand && interaction.isCommand()) {
          try {
            return (interaction as any).options.getSubcommand(false) ?? null;
          } catch {
            return null;
          }
        }
        return null;
      },
    };
  }

  // Helper: check if an interaction belongs to our bot channel or a thread inside it
  function isOurChannel(channelId: string): boolean {
    const envVal = Deno.env.get("ALLOW_ANY_CHANNEL");
    // [NEW] Allow commands in any channel if env var is set
    if (envVal === "true") {
      return true;
    }
    if (!myChannel) return false;
    if (channelId === myChannel.id) return true;

    // Check workspace-managed channels
    const managedIds = dependencies.getManagedChannelIds?.();
    if (managedIds?.has(channelId)) return true;

    // Check if the interaction is inside a thread whose parent is a managed channel
    const channel = client.channels.cache.get(channelId);
    if (channel && (channel as any).parentId) {
      const parentId = (channel as any).parentId;
      if (parentId === myChannel.id) return true;
      if (managedIds?.has(parentId)) return true;
    }
    return false;
  }

  // Command handler - completely generic
  async function handleCommand(interaction: CommandInteraction) {
    if (!isOurChannel(interaction.channelId)) {
      return;
    }

    // [Multi-channel] Redirect Claude output to the invoking channel
    if (dependencies.setResponseChannel && interaction.channelId !== myChannel?.id) {
      const channel = client.channels.cache.get(interaction.channelId) || interaction.channel;
      dependencies.setResponseChannel(channel);
    }

    const ctx = createInteractionContext(interaction);

    // RBAC check for restricted commands
    const allowed = await checkCommandPermission(interaction.commandName, ctx);
    if (!allowed) return;

    const handler = handlers.get(interaction.commandName);

    if (!handler) {
      await ctx.reply({
        content: `Unknown command: ${interaction.commandName}`,
        ephemeral: true,
      });
      return;
    }

    try {
      await handler.execute(ctx);
    } catch (error) {
      console.error(`Error executing command ${interaction.commandName}:`, error);
      // Try to send error message if possible
      try {
        if (interaction.deferred) {
          await ctx.editReply({
            content: `Error executing command: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
          });
        } else {
          await ctx.reply({
            content: `Error executing command: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
            ephemeral: true,
          });
        }
      } catch {
        // Ignore errors when sending error message
      }
    }
  }

  // Autocomplete handler for /settings action & value fields
  async function handleAutocomplete(interaction: AutocompleteInteraction) {
    if (interaction.commandName !== "settings") return;

    const focused = interaction.options.getFocused(true);
    const category = interaction.options.getString("category") ?? "";
    const action = interaction.options.getString("action") ?? "";
    const typed = focused.value.toLowerCase();

    let choices: { name: string; value: string }[] = [];

    if (focused.name === "action") {
      choices = SETTINGS_ACTIONS[category] ?? [];
    } else if (focused.name === "value") {
      choices = SETTINGS_VALUES[action] ?? [];
    }

    // Filter by what the user has typed so far
    const filtered = choices
      .filter((c) => c.name.toLowerCase().includes(typed) || c.value.toLowerCase().includes(typed))
      .slice(0, 25); // Discord max 25 choices

    await interaction.respond(filtered);
  }

  // Button handler - completely generic
  async function handleButton(interaction: ButtonInteraction) {
    if (!isOurChannel(interaction.channelId)) {
      return;
    }

    const ctx = createInteractionContext(interaction);

    // Handle pagination buttons first
    if (interaction.customId.startsWith("pagination:")) {
      try {
        const paginationResult = handlePaginationInteraction(interaction.customId);
        if (paginationResult) {
          await ctx.update({
            embeds: [paginationResult.embed],
            components: paginationResult.components
              ? [{ type: "actionRow", components: paginationResult.components }]
              : [],
          });
          return;
        }
      } catch (error) {
        console.error("Error handling pagination:", error);
        if (crashHandler) {
          await crashHandler.reportCrash(
            "main",
            error instanceof Error ? error : new Error(String(error)),
            "pagination",
            "Button interaction",
          );
        }
      }
    }

    if (interaction.customId.startsWith(QUEUE_CLEAR_PREFIX)) {
      if (!dependencies.resolveHotSession) return;
      const handler = createQueueClearHandler({
        resolveSession: (sid) =>
          dependencies.resolveHotSession!(sid) as
            | import("../claude/hot-query.ts").HotQuerySession
            | undefined,
      });
      try {
        await handler(interaction);
      } catch (err) {
        console.error("[queue-clear] handler error:", err);
      }
      return;
    }

    if (interaction.customId.startsWith("offline-catchup:")) {
      if (!dependencies.catchupButtonHandler) return;
      try {
        await dependencies.catchupButtonHandler(interaction);
      } catch (err) {
        console.error("[offline-catchup] handler error:", err);
      }
      return;
    }

    const handler = buttonHandlers.get(interaction.customId);

    if (handler) {
      try {
        await handler(ctx);
      } catch (error) {
        console.error(`Error handling button ${interaction.customId}:`, error);
        if (crashHandler) {
          await crashHandler.reportCrash(
            "main",
            error instanceof Error ? error : new Error(String(error)),
            "button",
            `ID: ${interaction.customId}`,
          );
        }
        try {
          await ctx.followUp({
            content: `Error handling button: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
            ephemeral: true,
          });
        } catch {
          // Ignore errors when sending error message
        }
      }
      return;
    }

    // Handle dynamic button IDs with patterns
    const buttonId = interaction.customId;

    // Handle copy session ID pattern: "copy-session:sessionId" (legacy — kept for old messages)
    if (buttonId.startsWith("copy-session:")) {
      const sessionId = buttonId.split(":")[1];
      try {
        await ctx.update({
          embeds: [{
            color: 0x00ff00,
            title: "\ud83d\udccb Session ID",
            description: `\`${sessionId}\``,
            fields: [
              {
                name: "Usage",
                value: "Copy this ID to use with `/claude session_id:...`",
                inline: false,
              },
            ],
            timestamp: true,
          }],
        });
      } catch (error) {
        console.error(`Error handling copy-session button:`, error);
      }
      return;
    }

    // Handle file upload button: "file:fileId"
    if (buttonId.startsWith("file:")) {
      const fileId = buttonId.substring(5);
      const fileInfo = pendingFileUploads.get(fileId);
      if (!fileInfo) {
        try {
          await interaction.reply({
            content: "⚠️ 文件已过期，请重新生成。",
            ephemeral: true,
          });
        } catch { /* ignore */ }
        return;
      }
      try {
        const attachment = new AttachmentBuilder(fileInfo.path, { name: fileInfo.name });
        await interaction.reply({
          files: [attachment],
          ephemeral: false,
        });
      } catch (error) {
        console.error(`[File Upload] Error:`, error);
        try {
          await interaction.reply({
            content: `❌ 文件上传失败: ${error instanceof Error ? error.message : String(error)}`,
            ephemeral: true,
          });
        } catch { /* ignore */ }
      }
      return;
    }

    // Handle expand content pattern: "expand:contentId"
    if (buttonId.startsWith("expand:")) {
      // Try to find a handler that can process expand buttons
      for (const [handlerName, handler] of handlers.entries()) {
        if (handler.handleButton) {
          try {
            await handler.handleButton(ctx, buttonId);
            return;
          } catch (error) {
            console.error(`Error in ${handlerName} handleButton for expand:`, error);
          }
        }
      }

      // If no handler found, show default message
      try {
        await ctx.update({
          embeds: [{
            color: 0xffaa00,
            title: "📖 Content Not Available",
            description: "The full content is no longer available for expansion.",
            timestamp: true,
          }],
          components: [],
        });
      } catch (error) {
        console.error(`Error handling expand button fallback:`, error);
      }
      return;
    }

    // If no specific handler found, try to delegate to command handlers with handleButton method
    const commandHandler = Array.from(handlers.values()).find((h) => h.handleButton);
    if (commandHandler?.handleButton) {
      try {
        await commandHandler.handleButton(ctx, interaction.customId);
      } catch (error) {
        console.error(`Error handling button ${interaction.customId} via command handler:`, error);
        try {
          await ctx.followUp({
            content: `Error handling button: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
            ephemeral: true,
          });
        } catch {
          // Ignore errors when sending error message
        }
      }
    } else {
      console.warn(`No handler found for button: ${interaction.customId}`);
    }
  }

  // Register commands
  const rest = new REST({ version: "10" }).setToken(discordToken);

  try {
    console.log("Registering slash commands...");
    await rest.put(
      Routes.applicationGuildCommands(applicationId, Deno.env.get("GUILD_ID") || ""),
      { body: commands.map((cmd) => cmd.toJSON()) },
    );
    console.log("Slash commands registered");
  } catch (error) {
    console.error("Failed to register slash commands:", error);
    throw error;
  }

  // Wait for ClientReady to fully complete (including async channel setup)
  // before returning, so callers can safely call getChannel() immediately.
  const readyPromise = new Promise<void>((resolve, _reject) => {
    client.once(Events.ClientReady, async () => {
      console.log(`Bot logged in: ${client.user?.tag}`);
      console.log(`Category: ${actualCategoryName}`);
      console.log(`Branch: ${branchName}`);
      console.log(`Working directory: ${workDir}`);

      const guilds = client.guilds.cache;
      if (guilds.size === 0) {
        console.error("Error: Bot is not in any servers");
        resolve();
        return;
      }

      const guild = guilds.first();
      if (!guild) {
        console.error("Error: Guild not found");
        resolve();
        return;
      }

      try {
        myChannel = await ensureChannelExists(guild);
        console.log(`Using channel "${myChannel.name}"`);

        await myChannel.send(convertMessageContent({
          embeds: [{
            color: 0x00ff00,
            title: `🚀 v${BOT_VERSION} — Startup Complete`,
            description: `Claude Code bot for branch ${branchName} has started`,
            fields: [
              { name: "Category", value: actualCategoryName, inline: true },
              { name: "Repository", value: repoName, inline: true },
              { name: "Branch", value: branchName, inline: true },
              { name: "Working Directory", value: `\`${workDir}\``, inline: false },
            ],
            timestamp: true,
          }],
          components: [{
            type: "actionRow",
            components: [
              {
                type: "button",
                customId: "startup:sessions",
                label: "📂 Sessions",
                style: "secondary",
              },
              {
                type: "button",
                customId: "workflow:git-status",
                label: "📋 Git Status",
                style: "secondary",
              },
              {
                type: "button",
                customId: "startup:system-info",
                label: "💻 System Info",
                style: "secondary",
              },
              {
                type: "button",
                url: `http://localhost:${Number(Deno.env.get("ADMIN_PORT")) || 7860}`,
                label: "🌐 Admin Web",
                style: "link",
              },
            ],
          }],
        }));
        resolve();
      } catch (error) {
        console.error("Channel creation/retrieval error:", error);
        resolve(); // resolve even on error so the bot doesn't hang
      }
    });
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isCommand()) {
      await handleCommand(interaction as CommandInteraction);
    } else if (interaction.isAutocomplete()) {
      await handleAutocomplete(interaction as AutocompleteInteraction);
    } else if (interaction.isButton()) {
      await handleButton(interaction as ButtonInteraction);
    }
  });

  // Auto-resume: plain text or voice messages in session threads trigger Claude.
  // Auto-thread: plain text in workspace channels (with autoThread on) spawns a new thread.
  if (dependencies.onThreadMessage || dependencies.onWorkspaceMessage) {
    const onThreadMessage = dependencies.onThreadMessage;
    const onWorkspaceMessage = dependencies.onWorkspaceMessage;
    const isAutoThreadChannel = dependencies.isAutoThreadChannel;

    client.on(Events.MessageCreate, async (message: Message) => {
      if (message.author.bot) return;
      // Skip system messages (channel name change, pin, member add, etc.).
      // Their author is the user who triggered the action, so author.bot won't filter them.
      // The `content` of a ChannelNameChange is the new name itself, which would otherwise be sent to Claude.
      if (message.type !== MessageType.Default && message.type !== MessageType.Reply) return;
      if (message.content.startsWith("/")) return;

      const inThread = message.channel.isThread();
      const autoThreadEnabled = !inThread &&
        !!onWorkspaceMessage &&
        !!isAutoThreadChannel &&
        isAutoThreadChannel(message.channelId);

      // Ignore messages that neither trigger thread-resume nor auto-thread
      if (!inThread && !autoThreadEnabled) return;
      if (inThread && !onThreadMessage) return;

      // Multi-bot coexistence: if the message mentions another bot but not us, skip
      const mentionedUsers = message.mentions.users;
      const mentionsMe = mentionedUsers.has(client.user!.id);
      if (mentionedUsers.size > 0) {
        const mentionsOtherBot = mentionedUsers.some((u) => u.bot && u.id !== client.user!.id);
        if (mentionsOtherBot && !mentionsMe) return;
      }

      // THREAD_MENTION_ONLY mode: only respond when explicitly @mentioned
      if (Deno.env.get("THREAD_MENTION_ONLY") === "true" && !mentionsMe) return;

      // Check if this is a voice message
      const isVoiceMessage = message.flags.has(MessageFlags.IsVoiceMessage);
      let textContent = message.content.trim();

      if (isVoiceMessage) {
        const audioAttachment = message.attachments.find((a) =>
          a.contentType?.startsWith("audio/")
        );
        if (!audioAttachment) return;

        if (!isVoiceTranscriptionEnabled()) {
          await message.reply(
            "⚠️ Voice transcription is not configured. Set `OPENAI_API_KEY` to enable.",
          );
          return;
        }

        try {
          await message.react("🎙️");
          textContent = await transcribeAudio(audioAttachment.url);
          await message.reply(`🎙️ *Transcribed:* ${textContent}`);
        } catch (error) {
          console.error("[Voice] Transcription failed:", error);
          await message.reply(
            "❌ Voice transcription failed. Please try again or type your message.",
          );
          return;
        }
      }

      // Process all attachments: images → temp files, text → inline, others → temp files.
      // Skip for voice messages — the .ogg is already transcribed; saving it to /tmp would just leak.
      if (message.attachments.size > 0 && !isVoiceMessage) {
        const notes: string[] = [];
        for (const att of message.attachments.values()) {
          try {
            const resp = await fetch(att.url);
            const buf = await resp.arrayBuffer();
            const ct = att.contentType ?? "";
            const filename = att.name ?? "attachment";

            if (ct.startsWith("image/")) {
              const ext = ct.split("/")[1]?.split(";")[0] ?? "png";
              const tmpPath =
                `/tmp/discord-img-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
              await Deno.writeFile(tmpPath, new Uint8Array(buf));
              notes.push(`[Image attached: ${tmpPath}]`);
            } else if (
              ct.startsWith("text/") ||
              ct === "application/json" ||
              ct === "application/xml" ||
              /\.(txt|md|csv|json|xml|yaml|yml|toml|ini|log|sh|ts|js|py|rb|go|rs|java|c|cpp|h|css|html)$/i
                .test(filename)
            ) {
              const text = new TextDecoder().decode(buf);
              const MAX_INLINE = 8000;
              if (text.length <= MAX_INLINE) {
                notes.push(`[File: ${filename}]\n\`\`\`\n${text}\n\`\`\``);
              } else {
                const tmpPath =
                  `/tmp/discord-file-${Date.now()}-${Math.random().toString(36).slice(2)}-${filename}`;
                await Deno.writeFile(tmpPath, new Uint8Array(buf));
                notes.push(`[File attached: ${tmpPath} (${filename})]`);
              }
            } else {
              // Binary / ZIP / other — save to temp and tell Claude the path
              const tmpPath =
                `/tmp/discord-file-${Date.now()}-${Math.random().toString(36).slice(2)}-${filename}`;
              await Deno.writeFile(tmpPath, new Uint8Array(buf));
              notes.push(`[File attached: ${tmpPath} (${filename})]`);
            }
          } catch (err) {
            console.error(`[Attachment] Failed to download ${att.name}:`, err);
            notes.push(`[Attachment download failed: ${att.name}]`);
          }
        }
        if (notes.length > 0) {
          textContent = textContent ? `${textContent}\n${notes.join("\n")}` : notes.join("\n");
        }
      }

      if (!textContent) return;

      try {
        if (inThread) {
          await onThreadMessage!(message.channelId, textContent, {
            messageId: message.id,
            userId: message.author.id,
          });
        } else {
          await onWorkspaceMessage!(message.channelId, textContent, {
            messageId: message.id,
            userId: message.author.id,
          });
        }
      } catch (error) {
        console.error("[MessageCreate] Error handling message:", error);
      }
    });
  }

  // Channel monitoring -- auto-respond to messages from specific bots/webhooks
  if (dependencies.monitorConfig) {
    const { channelId, botIds, onAlertMessage } = dependencies.monitorConfig;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingAlerts: string[] = [];
    let lastAlertMessage: Message | null = null;

    // deno-lint-ignore require-await
    client.on(Events.MessageCreate, async (message: Message) => {
      if (message.author.id === client.user?.id) return;
      if (message.channelId !== channelId) return;
      if (!botIds.includes(message.author.id)) return;

      const content = message.content;
      if (!content) return;

      console.log(
        `[Monitor] Alert detected from ${message.author.id}: ${content.substring(0, 100)}...`,
      );

      pendingAlerts.push(content);
      lastAlertMessage = message;

      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      debounceTimer = setTimeout(async () => {
        const alertBatch = [...pendingAlerts];
        const threadAnchor = lastAlertMessage!;
        pendingAlerts = [];
        lastAlertMessage = null;
        debounceTimer = null;

        const combined = alertBatch.join("\n---\n");
        const channel = threadAnchor.channel as TextChannel;

        try {
          const thread = await threadAnchor.startThread({
            name: `Alert Investigation`,
            autoArchiveDuration: 60,
          });

          await onAlertMessage(combined, thread as unknown as TextChannel);
        } catch (error) {
          console.error("[Monitor] Error handling alert:", error);
          await channel.send(
            `Failed to investigate alert: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
          );
        }
      }, 30_000);
    });

    console.log(`[Monitor] Watching channel ${channelId} for messages from ${botIds.join(", ")}`);
  }

  // Login and wait for ClientReady handler to complete
  await client.login(discordToken);
  await readyPromise;

  // Return bot control functions
  return {
    client,
    getChannel() {
      return myChannel;
    },
    getGuild() {
      return myChannel?.guild ?? null;
    },
    getCategory() {
      return myCategory;
    },
    updateBotSettings(settings: { mentionEnabled: boolean; mentionUserId: string | null }) {
      botSettings.mentionEnabled = settings.mentionEnabled;
      botSettings.mentionUserId = settings.mentionUserId;
    },
    getBotSettings() {
      return { ...botSettings };
    },
  };
}
