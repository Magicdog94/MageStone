import { useEffect } from 'react';
import { Scene } from './three/Scene';
import { HUD } from './ui/HUD';
import { EntryScreens } from './ui/screens/Screens';
import { useNet } from './net/useNet';
import './App.css';

export default function App() {
  const screen = useNet((s) => s.screen);
  const init = useNet((s) => s.init);
  useEffect(() => init(), [init]);

  if (screen !== 'game') return <EntryScreens />;

  return (
    <div className="app">
      <Scene />
      <HUD />
      <div className="brand">
        Mage<span>Stone</span> <em>prototype</em>
      </div>
    </div>
  );
}
