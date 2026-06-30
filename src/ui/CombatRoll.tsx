// Animated combat dice: when an attack resolves, the attacker and defender dice
// tumble through random faces for a beat, then settle on the values the engine
// actually rolled (`combat`). Purely presentational — the result is already final.
import { useEffect, useState } from 'react';
import type { CombatResult } from '../game/types';
import { PipDie } from './Die';

type DieKind = 'mage' | 'priest' | 'warrior';

function NumDie({ value, size = 44 }: { value: number; size?: number }) {
  return (
    <div className="numdie" style={{ width: size, height: size, fontSize: size * 0.46 }}>
      {value}
    </div>
  );
}

function RollingDie({
  final,
  faces,
  kind,
  runId,
}: {
  final: number;
  faces: number;
  kind: DieKind;
  runId: number;
}) {
  const [val, setVal] = useState(final);
  useEffect(() => {
    const iv = setInterval(() => setVal(1 + Math.floor(Math.random() * faces)), 70);
    const to = setTimeout(
      () => {
        clearInterval(iv);
        setVal(final);
      },
      620 + Math.random() * 260,
    );
    return () => {
      clearInterval(iv);
      clearTimeout(to);
    };
  }, [runId, final, faces]);
  return faces <= 6 ? <PipDie value={val} kind={kind} size={44} /> : <NumDie value={val} />;
}

export function CombatRoll({ combat, runId }: { combat: CombatResult; runId: number }) {
  // Keyed by combatNonce upstream, so this mounts fresh per attack: `done` starts
  // false and flips true once the dice have settled.
  const [done, setDone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDone(true), 950);
    return () => clearTimeout(t);
  }, []);

  const isMage = combat.attackerKind === 'mage';
  const atkLabel = isMage
    ? `Mage (d${combat.attackFaces})`
    : combat.attackerIds.length > 1
      ? `${combat.attackerIds.length} Warriors`
      : 'Warrior';
  const result =
    combat.outcome === 'win'
      ? 'Defeated!'
      : combat.outcome === 'lose'
        ? combat.defeatedId
          ? 'Repelled & lost'
          : 'Repelled'
        : 'Draw';

  return (
    <div className={`combat-roll ${done ? combat.outcome : 'rolling'}`}>
      <div className="cr-side">
        <span className="cr-name">{atkLabel}</span>
        <div className="cr-dice">
          {combat.attackDice.map((v, i) => (
            <RollingDie
              key={i}
              final={v}
              faces={combat.attackFaces}
              kind={combat.attackerKind}
              runId={runId}
            />
          ))}
        </div>
        <span className="cr-total">{done ? combat.attackRoll : '…'}</span>
      </div>

      <span className="cr-vs">vs</span>

      <div className="cr-side">
        <span className="cr-name">
          {combat.defenderKind === 'mage' && combat.defenseFaces > 6
            ? `Defender (d${combat.defenseFaces})`
            : 'Defender'}
        </span>
        <div className="cr-dice">
          <RollingDie final={combat.defenseRoll} faces={combat.defenseFaces} kind={combat.defenderKind} runId={runId} />
        </div>
        <span className="cr-total">{done ? combat.defenseRoll : '…'}</span>
      </div>

      <div className="cr-result">{done ? result : 'Rolling…'}</div>
    </div>
  );
}
