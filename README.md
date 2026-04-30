<div align="center">

# claude-code-discord

**Self-hosted Discord interface for Claude Code — your existing MCP servers, skills, and CLAUDE.md just work.**

Based on [zebbern/claude-code-discord](https://github.com/zebbern/claude-code-discord), enhanced for production team use.

</div>

## Why This Exists

Run Claude Code through Discord without giving up anything you've already configured locally:

- **Zero third-party dependencies** — only [`discord.js`](https://discord.js.org/) and [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk). No wrapper services, no proxy layers, no data leaves your machine except to Discord and Anthropic/Bedrock.
- **Your config, automatically** — the bot reads your project's `.claude/mcp.json`, `CLAUDE.md`, and `settings.local.json` at session start. MCP servers, skills, hooks, and custom instructions carry over as-is.
- **AWS Bedrock native** — route all inference through your organization's Bedrock endpoint. No Anthropic API key required; credentials managed via AWS SSO with in-Discord refresh (`/refresh-bedrock`).
- **No magic, no reinvention** — this bot doesn't bolt on its own memory system, RAG pipeline, or tool framework. Claude Code already has MCP, skills, hooks, and project memory — this project just exposes them through Discord. The capabilities you get are exactly the capabilities you've configured in your Claude Code environment. Want more? Add an MCP server or write a skill.

## Features

<kbd>

| Feature | Details |
|---------|---------|
| Thread-per-session | Each `/claude-thread` conversation gets its own Discord thread with custom names |
| Session persistence & auto-resume | Sessions survive restarts; posting in a thread auto-resumes Claude |
| Live status indicator | Compact, auto-updating status line for hidden tool/system messages |
| MCP server injection | Loads `.claude/mcp.json` from project; all `mcp__*` tools auto-approved |
| Config inheritance | Reads `CLAUDE.md`, `settings.local.json`, and user-level settings — same context as local CLI |
| AWS Bedrock support | `/refresh-bedrock` for enterprise AWS SSO credential refresh |
| Mid-session controls | Interrupt, change model, change permissions, stop tasks, and rewind without restarting |
| Granular sandbox | Full SDK sandbox with network rules, filesystem ACLs, and excluded commands |
| Role-based access control | Restrict destructive commands (`/shell`, `/git`, worktree ops) to specific Discord roles |
| Interactive permission prompts | Allow/Deny buttons when Claude wants to use unapproved tools |
| Channel monitoring | Watch a channel for bot/webhook messages and auto-investigate in a thread |
| Audit trail | Channel history provides a searchable record of who ran what and when |

</kbd>

## Quick Start

```bash
git clone https://github.com/imAkaka/claude-code-discord.git
cd claude-code-discord
claude   # launch Claude Code, then run /discord-bot-setup
```

The `/discord-bot-setup` skill will guide you through prerequisites, `.env` configuration, Discord bot creation, authentication (AWS Bedrock or Anthropic API), and starting the bot.

If you insist on doing everything by hand in 2026, the skill source is right there at [`.claude/skills/discord-bot-setup.md`](.claude/skills/discord-bot-setup.md) — good luck.

## Documentation

| Doc | Description |
| --- | --- |
| [Discord Bot Setup](docs/setup-discord.md) | Create a Discord app, get your token and application ID, invite the bot |
| [Commands](docs/commands.md) | Full reference for all 45+ slash commands |
| [Features](docs/features.md) | Thinking modes, agents, MCP, rewind, structured output, mid-session controls |
| [Architecture](docs/architecture.md) | Project structure and SDK integration details |
| [Updating](docs/updating.md) | How to update (git pull, version check) |

## Select Newest Model Available

```
/settings category:claude action:set-model value:opus
/settings category:claude action:set-model value:sonnet
/quick-model model:haiku
```

## Configuration

Create a `.env` file (or copy `.env.example`):

```env
# Required
DISCORD_TOKEN=your_bot_token_here
APPLICATION_ID=your_application_id_here

# Optional
GUILD_ID=your_guild_id                # Instant slash command registration (skip 1h global propagation)
ANTHROPIC_API_KEY=sk-ant-...          # Enables dynamic model discovery & refresh
USER_ID=your_discord_user_id          # @mention when Claude finishes a task
CATEGORY_NAME=claude-code             # Discord category for bot channels
WORK_DIR=/path/to/project             # Working directory (default: current dir)

# AWS Bedrock (alternative to Anthropic API)
# CLAUDE_CODE_USE_BEDROCK=1
# AWS_PROFILE=enterprise-ai
# AWS_REGION=ap-southeast-1
# ANTHROPIC_MODEL=global.anthropic.claude-opus-4-6-v1

# Access Control (RBAC) — leave blank to keep all commands open
ADMIN_ROLE_IDS=123456789,987654321    # Comma-separated Discord role IDs
ADMIN_USER_IDS=111111111              # Comma-separated Discord user IDs

# Channel Monitoring (optional)
MONITOR_CHANNEL_ID=123456789012345678    # Channel to monitor for alerts
MONITOR_BOT_IDS=987654321,111111111      # Bot/webhook user IDs to trigger auto-investigation
```

| Variable | Required | Description |
| --- | :---: | --- |
| `DISCORD_TOKEN` | **Yes** | Bot token from the [Discord Developer Portal](https://discord.com/developers/applications) |
| `APPLICATION_ID` | **Yes** | Application ID from the Developer Portal |
| `GUILD_ID` | No | Server ID for instant slash command registration |
| `ANTHROPIC_API_KEY` | No | Enables dynamic model discovery; refreshes hourly |
| `USER_ID` | No | Your Discord user ID — bot @mentions you when tasks finish |
| `CATEGORY_NAME` | No | Discord category name for channels (default: repo name) |
| `WORK_DIR` | No | Working directory for Claude operations (default: current dir) |
| `CLAUDE_CODE_USE_BEDROCK` | No | Set to `1` to use AWS Bedrock instead of Anthropic API |
| `AWS_PROFILE` | No | AWS SSO profile name (for Bedrock auth) |
| `AWS_REGION` | No | AWS region for Bedrock |
| `ANTHROPIC_MODEL` | No | Override default model (Bedrock ARN or Anthropic model ID) |
| `ADMIN_ROLE_IDS` | No | Comma-separated role IDs for RBAC (shell, git, system, admin) |
| `ADMIN_USER_IDS` | No | Comma-separated user IDs for RBAC — grants access regardless of roles |
| `MONITOR_CHANNEL_ID` | No | Discord channel ID to watch for bot/webhook messages |
| `MONITOR_BOT_IDS` | No | Comma-separated bot/webhook user IDs that trigger auto-investigation |
| `ALLOW_ANY_CHANNEL` | No | Set to `true` to allow slash commands in any channel (default: false) |

> CLI flags override environment variables. Environment variables override `.env` file values.

## Authentication: AWS Bedrock (Recommended)

Using AWS Bedrock avoids the need for an Anthropic API key and leverages your organization's AWS infrastructure. This is the recommended setup.

### 1. Configure AWS SSO

```bash
aws configure sso --profile enterprise-ai
# Follow the prompts: SSO start URL, region, account, role
```

### 2. Login and set `.env`

```bash
aws sso login --profile enterprise-ai
```

```env
CLAUDE_CODE_USE_BEDROCK=1
AWS_PROFILE=enterprise-ai
AWS_REGION=ap-southeast-1
ANTHROPIC_MODEL=global.anthropic.claude-opus-4-6-v1
ANTHROPIC_SMALL_FAST_MODEL=global.anthropic.claude-haiku-4-5-20251001-v1:0
```

### 3. Refresh credentials

When AWS SSO credentials expire, use the `/refresh-bedrock` slash command in Discord — it runs `aws sso login` and refreshes the session automatically.

> **Alternative:** If you prefer the Anthropic API directly, set `ANTHROPIC_API_KEY` and omit the Bedrock variables. You'll also need `claude /login` for the CLI.

## Startup Options

```bash
# Production daemon (start / stop / restart)
./start.sh start
./start.sh stop
./start.sh restart

# Standard start (uses npx deno — no global deno install required)
npx deno task start

# Development mode (hot reload)
npx deno task dev

# Direct with environment variables
npx deno run --allow-all index.ts

# With optional flags
npx deno run --allow-all index.ts --category myproject --user-id YOUR_DISCORD_ID
```

| Flag | Env Variable | Description |
| --- | --- | --- |
| `--category <name>` | `CATEGORY_NAME` | Discord category name for channels (default: `claude-code`) |
| `--user-id <id>` | `USER_ID` | Your Discord user ID for mentions when tasks finish |

> CLI flags override environment variables. Environment variables override `.env` file values.

## Channel Monitoring

Automatically investigate alerts from other bots or webhooks. When a monitored bot posts in the configured channel, the bot batches messages over a 30-second debounce window, creates a thread on the alert message, and streams Claude's investigation there.

### Setup

1. **Enable the Message Content intent** — In the [Developer Portal](https://discord.com/developers/applications), go to your app → Bot → enable **Message Content Intent**. The bot needs this to read messages from other bots.

2. **Get the channel ID** — Right-click the channel in Discord (Developer Mode must be on) and copy the ID. Set `MONITOR_CHANNEL_ID` in `.env`.

3. **Get the bot/webhook user IDs** — The easiest way is to look at a message from the bot in the channel, right-click the author, and copy the ID. For webhooks, check the webhook's user ID in the channel's integration settings. Set `MONITOR_BOT_IDS` as a comma-separated list.

4. **Bot permissions** — Ensure the bot has these permissions in the monitored channel:
   - Read Messages
   - Create Public Threads
   - Send Messages in Threads
