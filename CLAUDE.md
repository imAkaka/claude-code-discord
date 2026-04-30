# CLAUDE.md

## Project Overview

Discord bot that exposes Claude Code capabilities through Discord slash commands. Built on two dependencies only: `discord.js` and `@anthropic-ai/claude-agent-sdk`. Runs on Deno via `npx deno`.

## Architecture

```
Discord slash command
  → core/handler-registry.ts    (route + build query options)
  → claude/client.ts            (SDK query with MCP/settings/permissions)
  → @anthropic-ai/claude-agent-sdk  (streaming async generator)
  → claude/discord-sender.ts    (SDK messages → Discord embeds/status line)
```

Key directories:
- `claude/` — SDK integration: query execution, streaming, model fetching, permissions, MCP loading
- `core/` — Bot infrastructure: command routing, signal handling, RBAC, button handlers
- `discord/` — Discord layer: message formatting, session-thread persistence, pagination
- `settings/` — Unified settings state and `/settings` command handlers
- `system/` — System monitoring commands (processes, disk, network, etc.)
- `shell/` — Shell command execution via Discord
- `agent/` — Built-in agent definitions (code-review, debug, architect, etc.)

## Config Injection

At session start, the SDK query loads:
- `.claude/mcp.json` — MCP servers (auto-injected, all `mcp__*` tools auto-approved)
- `CLAUDE.md` — project instructions (this file)
- `settings.local.json` — local settings
- User-level `~/.claude/` settings via `settingSources: ['project', 'local', 'user']`

## Runtime

- **Runtime:** Deno (via `npx deno`, no global install required)
- **Entry:** `index.ts`
- **Start:** `./start.sh start` (production daemon) or `npx deno task start`
- **Auth:** AWS Bedrock (`CLAUDE_CODE_USE_BEDROCK=1`) or Anthropic API key
- **Platform:** Linux / macOS only (no Windows support)

## Development Commands

```bash
npx deno task start     # run bot
npx deno task dev       # run with hot reload
npx deno check index.ts # type check
npx deno lint           # lint
npx deno fmt            # format
```

## Code Conventions

- TypeScript strict mode, Deno APIs (not Node.js unless unavoidable)
- Imports: `npm:` specifiers in `deno.json`, Deno std via URL imports
- No third-party packages beyond discord.js and claude-agent-sdk
- Permission mode default: `acceptEdits` (allows file edits, prompts for others)
- Hidden message types: system, tool_use, tool_result, tool_progress are hidden by default, shown via `/show-*` toggle commands
- Session persistence: thread mappings stored in `.bot-data/session-threads.json`

## Important Patterns

- **MCP auto-allow:** Any tool starting with `mcp__` is auto-approved in `canUseTool` callback (`claude/client.ts:263`)
- **Status line:** Single editable Discord message that tracks hidden tool activity, auto-repositions below new visible content (`claude/discord-sender.ts`)
- **Thread auto-resume:** Plain text in a session thread triggers automatic Claude resume via Message Content Intent (`index.ts`)
- **Crash handler:** `process/crash-handler.ts` registers SIGINT/SIGTERM, manages graceful shutdown
- **Auto-upload screenshots:** After generating a screenshot or exported file, the bot auto-detects the file path in your response and uploads it to Discord. **Always `echo` the absolute file path after taking a screenshot**, e.g.:
  ```
  screencapture -x /tmp/screenshot.png
  echo /tmp/screenshot.png
  ```
  This ensures the file path appears in the tool result output, triggering the auto-upload.

## Environment Variables

Required: `DISCORD_TOKEN`, `APPLICATION_ID`

Key optional: `GUILD_ID` (instant slash command registration), `CLAUDE_CODE_USE_BEDROCK`, `AWS_PROFILE`, `AWS_REGION`, `ANTHROPIC_MODEL`, `ADMIN_USER_IDS`

Full reference in `.env.example`.
