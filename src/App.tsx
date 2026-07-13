import { useEffect } from 'react';
import { Scene } from './three/Scene';
import { BotDriver } from './ui/BotDriver';
import { HUD } from './ui/HUD';
import { AlphaWelcome } from './ui/AlphaWelcome';
import { CopyrightNotice } from './ui/CopyrightNotice';
import { LoadingGate } from './ui/LoadingGate';
import { OrientationGate } from './ui/OrientationGate';
import { TutorialCoach } from './ui/tutorial/TutorialCoach';
import { EntryScreens } from './ui/screens/Screens';
import { MusicToggle } from './ui/MusicToggle';
import { FullscreenToggle } from './ui/FullscreenToggle';
import { useMusic } from './audio/music';
import { initSfx } from './audio/sfx';
import { useNet } from './net/useNet';
import { useGame } from './store';
import './App.css';

export default function App() {
  const screen = useNet((s) => s.screen);
  const init = useNet((s) => s.init);
  useEffect(() => init(), [init]);

  // Compact phone layout: a body class scopes the CSS overrides so it also
  // reaches the entry screens, modals and floating toggles (Settings → Layout).
  const layout = useGame((s) => s.settings.layout);
  useEffect(() => {
    document.body.classList.toggle('ui-mobile', layout === 'mobile');
    return () => document.body.classList.remove('ui-mobile');
  }, [layout]);

  // Autoplay is blocked until the player interacts, so kick off the score on the
  // first gesture anywhere (a landing button, the board, etc.). It then plays
  // continuously across screens — the audio graph is a singleton in audio/music.
  useEffect(() => {
    const begin = () => useMusic.getState().start();
    window.addEventListener('pointerdown', begin, { once: true });
    return () => window.removeEventListener('pointerdown', begin);
  }, []);

  // Sound effects: UI clicks + game events (moves, clashes, dice, horns…).
  useEffect(() => initSfx(), []);

  return (
    <>
      {screen !== 'game' ? (
        <EntryScreens />
      ) : (
        <div className="app">
          <Scene />
          <HUD />
          <BotDriver />
          <AlphaWelcome />
          {/* Cover the board with "Loading Game" until the 3D assets are ready. */}
          <LoadingGate />
          {/* Guided tutorial: spotlights + notes that drive the game itself. */}
          <TutorialCoach />
          <div className="brand">
            Mage<span>Stone</span> <em>prototype</em>
          </div>
        </div>
      )}
      <MusicToggle />
      <FullscreenToggle />
      {/* Mobile-only: prompt to rotate when the phone is held in portrait. */}
      <OrientationGate />
      {/* Blocking copyright / alpha notice — sits over everything on first load
          (the front page) until acknowledged. */}
      <CopyrightNotice />
    </>
  );
}
