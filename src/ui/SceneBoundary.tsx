import { Component, type ReactNode } from 'react';
import { useGame } from '../store';

/**
 * Error boundary around the 3D scene. A Rapier WASM panic poisons its physics
 * world — the next physics call from a React commit (mounting/unmounting dice
 * bodies) then THROWS, and without a boundary React unmounts the ENTIRE app:
 * HUD gone, bot driver gone, game frozen with a healthy engine underneath.
 * This boundary confines the blast radius to the 3D view, asks the store for a
 * fresh physics world, and remounts the scene after a beat (up to 3 tries).
 * The HUD and bots live outside it, so play continues even while it's down.
 */
export class SceneBoundary extends Component<{ children: ReactNode }, { down: boolean; tries: number }> {
  state = { down: false, tries: 0 };

  static getDerivedStateFromError() {
    return { down: true };
  }

  componentDidCatch(err: unknown) {
    console.warn('MageStone: the 3D view crashed — rebuilding it.', err);
    const s = useGame.getState();
    s.setSceneDown(true);
    s.bumpPhysicsEpoch();
    this.setState((prev) => ({ tries: prev.tries + 1 }));
    if (this.state.tries < 3) {
      window.setTimeout(() => {
        useGame.getState().setSceneDown(false);
        this.setState({ down: false });
      }, 4000);
    }
  }

  render() {
    if (this.state.down) {
      return <div className="scene-down">Rebuilding the board view…</div>;
    }
    // Key by recovery attempt so every retry mounts a completely fresh scene.
    return <div className="scene-holder" key={this.state.tries}>{this.props.children}</div>;
  }
}
