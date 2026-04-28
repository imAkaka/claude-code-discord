# Updating

## Update Steps

```bash
git pull origin main
./start.sh restart
```

Or if running directly:

```bash
git pull origin main
npx deno run --allow-all index.ts
```

## Startup Version Check

The bot automatically checks for updates on startup. If a newer version is available on GitHub, it sends an orange embed in your Discord channel:

> **Update Available** Update available! You are X commits behind.

This check is non-blocking and compares your local git commit against the latest commit on `main` via the GitHub API.
