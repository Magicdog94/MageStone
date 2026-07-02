import { useEffect } from 'react';
import { Scene } from './three/Scene';
import { BotDriver } from './ui/BotDriver';
import { HUD } from './ui/HUD';
import { EntryScreens } from './ui/screens/Screens';
import { MusicToggle } from './ui/MusicToggle';
import { FullscreenToggle } from './ui/FullscreenToggle';
import { useMusic } from './audio/music';
import { useNet } from './net/useNet';
import './App.css';

export default function App() {
  const screen = useNet((s) => s.screen);
  const init = useNet((s) => s.init);
  useEffect(() => init(), [init]);

  // Autoplay is blocked until the player interacts, so kick off the score on the
  // first gesture anywhere (a landing button, the board, etc.). It then plays
  // continuously across screens — the audio graph is a singleton in audio/music.
  useEffect(() => {
    const begin = () => useMusic.getState().start();
    window.addEventListener('pointerdown', begin, { once: true });
    return () => window.removeEventListener('pointerdown', begin);
  }, []);

  return (
    <>
      {screen !== 'game' ? (
        <EntryScreens />
      ) : (
        <div className="app">
          <Scene />
          <HUD />
          <BotDriver />
          <div className="brand">
            Mage<span>Stone</span> <em>prototype</em>
          </div>
        </div>
      )}
      <MusicToggle />
      <FullscreenToggle />
    </>
  );
}
