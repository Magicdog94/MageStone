import type { CSSProperties } from 'react';
import { useGame } from '../store';
import { COLORS } from '../three/coords';
import { StoneIcon, SwordIcon } from './Icons';

/** Top status strip — per player: MageStones held and kills. */
export function PlayerStrip() {
  const game = useGame((s) => s.game);

  return (
    <div className="player-strip">
      {game.players.map((p) => {
        const mage = game.units.find((u) => u.kind === 'mage' && u.owner === p);
        const queued = game.pendingRespawns.find((r) => r.owner === p && r.kind === 'mage');
        const stones = mage ? mage.carried + mage.activated : (queued?.activated ?? 0);
        const kills = game.kills[p];
        const active = game.current === p && !game.winner;
        return (
          <div
            key={p}
            className={`pstat${active ? ' active' : ''}`}
            style={{ '--pc': COLORS[p] } as CSSProperties}
          >
            <span className="pstat-name">{p}</span>
            <span className="pstat-metric tip" data-tip="MageStones held">
              <StoneIcon size={20} />
              {stones}
            </span>
            <span className="pstat-metric tip" data-tip="Enemies defeated">
              <SwordIcon size={20} />
              {kills}
            </span>
          </div>
        );
      })}
    </div>
  );
}
