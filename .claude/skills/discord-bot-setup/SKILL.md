---
name: discord-bot-setup
description: Set up and configure the claude-code-discord bot — check prerequisites, create .env, configure Bedrock or Anthropic API auth, and start the bot
user_invocable: true
---

# Setup claude-code-discord

Guide the user through setting up the bot. Check each step, skip what's already done, and help fix issues.

## Checklist

1. **Check prerequisites**
   - `node` / `npm` installed (`node --version`)
   - `claude` CLI installed (`which claude`) — if missing: `npm install -g @anthropic-ai/claude-code`
   - `git` installed and this directory is a git repo
   - `npx deno` works (`npx deno --version`)

2. **Create `.env`**
   - If `.env` doesn't exist, copy from `.env.example`: `cp .env.example .env`
   - Ask the user for required values:
     - `DISCORD_TOKEN` — from Discord Developer Portal > Bot > Token
     - `APPLICATION_ID` — from Discord Developer Portal > General Information
   - Recommend setting `GUILD_ID` for instant slash command registration
   - Ask if they want `USER_ID` for @mention notifications

3. **Configure authentication** (ask user which method)

   **Option A: AWS Bedrock (recommended)**
   - Set in `.env`:
     ```
     CLAUDE_CODE_USE_BEDROCK=1
     AWS_PROFILE=enterprise-ai
     AWS_REGION=ap-southeast-1
     ANTHROPIC_MODEL=global.anthropic.claude-opus-4-6-v1
     ANTHROPIC_SMALL_FAST_MODEL=global.anthropic.claude-haiku-4-5-20251001-v1:0
     ```
   - Run `aws sso login --profile enterprise-ai` (user completes in browser)
   - Remind: use `/refresh-bedrock` in Discord when credentials expire

   **Option B: Anthropic API**
   - Set `ANTHROPIC_API_KEY` in `.env`
   - Run `claude /login` if CLI auth is also needed

4. **Discord bot setup** — if user hasn't created a bot yet, point them to `docs/setup-discord.md` and summarize the key steps:
   - Create app at Discord Developer Portal
   - Copy token and application ID
   - Enable **Message Content Intent** (needed for auto-resume and channel monitoring)
   - Invite bot with correct permissions (use the invite URL from the doc)

5. **Start the bot**
   - Production: `chmod +x start.sh && ./start.sh start`
   - Development: `npx deno task start`
   - Verify: check logs in `logs/` directory or terminal output for successful startup

## Notes
- Don't write secrets to files directly — tell the user to edit `.env` manually or use `read -s` for sensitive input
- If any step fails, diagnose and help fix before moving on
- After successful start, suggest testing with `/claude hello` in Discord
