# MageStone — app

The MageStone application (React + TypeScript + React Three Fiber + Zustand, built
with Vite).

```bash
npm install
npm run dev      # dev server
npm run build    # type-check + production build
npm run lint
```

Project documentation lives at the repository root:

- **[../README.md](../README.md)** — overview and quick start.
- **[../CLAUDE.md](../CLAUDE.md)** — full game rules, architecture, engine API, and
  known gaps. Read this before changing game logic.

Source map: `src/game/` is the headless rules engine (pure TS); `src/three/` is the
3D scene; `src/ui/` is the HUD; `src/store.ts` bridges engine ⇄ UI.
