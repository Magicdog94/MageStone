import type { CSSProperties } from 'react';
import { useGame } from '../store';
import { COLORS } from '../three/coords';
import { useTokenUrl } from '../three/tokens';
import { usePlayerLabel } from './playerNames';
import { StoneIcon, SwordIcon } from './Icons';

/** Top status strip — per player: unactivated + activated MageStones and kills. */
export function PlayerStrip() {
  const game = useGame((s) => s.game);
  const bots = useGame((s) => s.bots);
  const label = usePlayerLabel();
  const silverUrl = useTokenUrl('unactivated');
  const goldUrl = useTokenUrl('activated');

  return (
    <div className="player-strip">
      {game.players.map((p) => {
        const mage = game.units.find((u) => u.kind === 'mage' && u.owner === p);
        const queued = game.pendingRespawns.find((r) => r.owner === p && r.kind === 'mage');
        // Carried = held but not yet activated (silver); activated = scored (gold).
        const carried = mage ? mage.carried : 0;
        const activated = mage ? mage.activated : (queued?.activated ?? 0);
        const kills = game.kills[p];
        const active = game.current === p && !game.winner;
        const out = game.eliminated.includes(p);
        return (
          <div
            key={p}
            className={`pstat${active ? ' active' : ''}${out ? ' out' : ''}`}
            style={{ '--pc': COLORS[p] } as CSSProperties}
          >
            <span className="pstat-name" data-tut="pname">{label(p)}</span>
            {out ? (
              <span className="pstat-badge tip" data-tip="Eliminated — no units left">
                OUT
              </span>
            ) : (
              bots[p] && (
                <span className="pstat-badge tip" data-tip={`AI bot — ${bots[p]}`}>
                  BOT
                </span>
              )
            )}
            <span className="pstat-metric tip" data-tut="carried" data-tip="Unactivated MageStones (carried)">
              {silverUrl ? (
                <img className="pstat-token" src={silverUrl} alt="" width={20} height={20} />
              ) : (
                <StoneIcon size={20} />
              )}
              {carried}
            </span>
            <span className="pstat-metric tip" data-tut="activated" data-tip="Activated MageStones">
              {goldUrl ? (
                <img className="pstat-token" src={goldUrl} alt="" width={20} height={20} />
              ) : (
                <StoneIcon size={20} />
              )}
              {activated}
            </span>
            <span className="pstat-metric tip" data-tut="kills" data-tip="Enemies defeated">
              <SwordIcon size={20} />
              {kills}
            </span>
          </div>
        );
      })}
    </div>
  );
}
