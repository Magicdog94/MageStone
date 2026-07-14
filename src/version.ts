// Bumped with each notable alpha update — shown in the landing footer.
export const VERSION = 'v0.5.0-alpha';
export const UPDATED = '13 July 2026';

export const PATCH_NOTES = [
  'v0.5 — Ranked matchmaking + ELO ladder (five tiers), guided tutorial with all three victories played out, in-game Rule Book, guest play with invite links, alpha feedback form.',
  'v0.4 — Guided tutorial mode, action-bar attacks with win odds, online usernames, loading screen, landscape prompt.',
  'v0.3 — Real physics combat dice (d6/d12/d20), leaderboard, victory methods named, alpha + copyright notices.',
  'v0.2 — Online multiplayer with rooms, AI bots (easy/medium/hard), mobile layout, fullscreen/PWA.',
  'v0.1 — Core rules engine, 3D board and chamber, hotseat play.',
];

export const KNOWN_ISSUES = [
  'The free-tier server sleeps when idle — the first online action can take ~30 seconds while it wakes.',
  'If the online host disconnects mid-game, bots idle until the host returns.',
  'iPhone Safari cannot enter fullscreen from the button — use Add to Home Screen instead.',
  'Choosing which Warrior falls in a lost coordinated attack is automatic for now.',
];
