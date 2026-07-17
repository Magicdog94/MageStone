// Bumped with each notable alpha update — shown in the landing footer.
export const VERSION = 'v0.6.3-alpha';
export const UPDATED = '17 July 2026';

export const PATCH_NOTES = [
  'v0.6.3 — Dice now land showing their actual result first time: no more settling on one number and flicking to another, and they rest where they fall instead of snapping into a row. All gold buttons cleaned up to a flat style with crisp borders.',
  'v0.6.2 — Tutorial rebuilt around what confused playtesters: sieges now play out on the board (respawns visibly blocked, then freed when the besieger falls), a failed coordinated attack + resurrection demo, Bolt range highlighting, Nova friendly-fire and the stones scattering. New rule: if the home square is taken, a respawning Mage/Priest appears on the closest free base square. Rule Book corrected; attack buttons cleaned up.',
  'v0.6.1 — Hard AI plays like a master: it now reads 5–10 plays ahead, simulating your whole reply turn before it commits, spots wins and blocks yours turns in advance. Beats the previous Hard bot 2 games to 1.',
  'v0.6 — AI bots improved intelligence: the hard bot now plans turns ahead and uses Mage sorcery (Bolt & Nova). Plus layout fixes across desktop and mobile.',
  'v0.5 — Ranked matchmaking + ELO ladder (five tiers), guided tutorial with all three victories played out, in-game Rule Book, guest play with invite links, alpha feedback form.',
  'v0.4 — Guided tutorial mode, action-bar attacks with win odds, online usernames, loading screen, landscape prompt.',
  'v0.3 — Real physics combat dice (d6/d12/d20), leaderboard, victory methods named, alpha + copyright notices.',
  'v0.2 — Online multiplayer with rooms, AI bots (easy/medium/hard), mobile layout, fullscreen/PWA.',
  'v0.1 — Core rules engine, 3D board and chamber, hotseat play.',
];

export const KNOWN_ISSUES = [
  'All artwork is placeholders for the open alpha and is subject to change.',
  'The free-tier server sleeps when idle — the first online action can take ~30 seconds while it wakes.',
  'If the online host disconnects mid-game, bots idle until the host returns.',
  'iPhone Safari cannot enter fullscreen from the button — use Add to Home Screen instead.',
  'Choosing which Warrior falls in a lost coordinated attack is automatic for now.',
];
