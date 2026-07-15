import { Component, type ReactNode } from 'react';
import { useGame } from '../store';
import { useNet } from '../net/useNet';

export const RECOVER_KEY = 'ms-recover';
const RECOVER_COUNT_KEY = 'ms-recover-count';

/** Snapshot the running match and reload the page. A Rapier WASM panic can
 *  poison the MODULE (not just the world), so fresh worlds keep crashing —
 *  only a reload truly resets it. Hotseat games restore from the snapshot;
 *  online games rejoin their room (existing players skip the password). */
function hardRecover() {
  try {
    const n = Number(sessionStorage.getItem(RECOVER_COUNT_KEY) || '0');
    if (n >= 2) return false; // reload loop guard — give up gracefully
    sessionStorage.setItem(RECOVER_COUNT_KEY, String(n + 1));
    const s = useGame.getState();
    const net = useNet.getState();
    sessionStorage.setItem(
      RECOVER_KEY,
      JSON.stringify(
        s.online
          ? { kind: 'online', gameId: net.room?.gameId ?? null }
          : {
              kind: 'local',
              game: s.game,
              bots: s.bots,
              playerColors: s.playerColors,
              playerCount: s.playerCount,
              stoneLayoutId: s.stoneLayoutId,
              settings: s.settings,
            },
      ),
    );
  } catch {
    /* storage unavailable — reload anyway; worst case the menu comes back */
  }
  location.reload();
  return true;
}

/**
 * Error boundary around the 3D scene. A physics/WebGL crash must never take
 * the HUD, bots or engine down with it (React would otherwise unmount the
 * whole root). Recovery ladder: two in-place scene rebuilds; if the fresh
 * worlds die too, snapshot the match and reload the page (restored on boot);
 * if even reloads keep crashing, stay up with an honest message.
 */
export class SceneBoundary extends Component<
  { children: ReactNode },
  { down: boolean; tries: number; exhausted: boolean }
> {
  state = { down: false, tries: 0, exhausted: false };

  static getDerivedStateFromError() {
    return { down: true };
  }

  componentDidCatch(err: unknown) {
    console.warn('MageStone: the 3D view crashed — attempting recovery.', err);
    const s = useGame.getState();
    s.setSceneDown(true);
    s.bumpPhysicsEpoch();
    const next = this.state.tries + 1;
    this.setState({ tries: next });
    if (next <= 2) {
      // In-place retry: remount a fresh scene + physics world in a moment.
      window.setTimeout(() => {
        useGame.getState().setSceneDown(false);
        this.setState({ down: false });
      }, 3000);
    } else {
      // The WASM module itself is likely poisoned — reload with the match saved.
      window.setTimeout(() => {
        if (!hardRecover()) this.setState({ exhausted: true });
      }, 800);
    }
  }

  render() {
    if (this.state.down) {
      return (
        <div className="scene-down">
          {this.state.exhausted
            ? 'The 3D view keeps crashing on this device — the match engine is still running. Please refresh the page.'
            : 'Recovering the board view…'}
        </div>
      );
    }
    // Key by recovery attempt so every retry mounts a completely fresh scene.
    return (
      <div className="scene-holder" key={this.state.tries}>
        {this.props.children}
      </div>
    );
  }
}
