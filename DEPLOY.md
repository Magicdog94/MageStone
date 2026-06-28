# Deploying MageStone (public link)

The whole thing — website **and** the multiplayer server — runs as **one Node web
service**. Deploy that one service and you get a single public URL that hosts the
game and the live multiplayer. The free path below uses **GitHub + Render** (free,
no credit card, supports WebSockets).

> I (Claude) can't create accounts or push to your GitHub/Render for you, so the
> account + push steps are yours. Everything else is already wired up: this `app/`
> folder is a ready-to-deploy git repo with a `render.yaml` blueprint.

## 1. Put the code on GitHub
1. Create a new **empty** repo at <https://github.com/new> (e.g. `magestone`). Don't add a README/.gitignore there.
2. In a terminal **in this `app/` folder** (with the portable Node on PATH):
   ```bash
   git remote add origin https://github.com/<you>/magestone.git
   git branch -M main
   git push -u origin main
   ```
   (The folder is already `git init`-ed with a first commit, so this just pushes it.)

## 2. Deploy on Render
1. Sign up / log in at <https://render.com> (free, no card needed).
2. **New ▸ Blueprint** → connect your GitHub → pick the `magestone` repo.
   Render reads `render.yaml` and configures a free web service automatically.
   *(Or **New ▸ Web Service** manually: Runtime **Node**, Build `npm ci && npm run build`, Start `npm run server`.)*
3. Click **Apply / Create**. First build takes a few minutes.
4. When it's live you'll get a URL like `https://magestone.onrender.com` — share it.
   Anyone can open it, **Sign Up**, create a game, and others join by **Game ID + password**.

## How it works
- `npm run build` produces `dist/`; `npm run server` (`server/server.mjs`) serves
  `dist/` **and** the WebSocket on the same port (`process.env.PORT`).
- The client auto-targets the right server: `:8787` in local dev, same-origin
  `wss://` in production. Override with the `VITE_SERVER_URL` env var if needed.

## Good to know (free tier)
- Render's free service **sleeps after ~15 min idle**; the first visit after that
  takes ~30–60 s to wake. Fine for playing with friends.
- **Accounts persist** to `server/data/users.json` on the service's disk. On the
  free tier that disk is **ephemeral** (wiped on redeploy/restart), so accounts can
  reset. For durable accounts, attach a Render disk or a database (ask me).
- **Game rooms are in memory** — a server restart ends any in-progress match.
- It's a trust-based prototype (the player whose turn it is is authoritative).

## Other hosts
Any host that runs a long-lived Node process with WebSockets works (Railway,
Fly.io, a VPS, etc.) — same `build` + `server` commands. Render is just the
simplest free, no-card option.
