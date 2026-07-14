import type { CSSProperties } from 'react';
import { useGame } from '../store';
import { COLORS } from '../three/coords';
import { useTokenUrl } from '../three/tokens';
import { usePlayerLabel } from './playerNames';
import { magePowerDie, siegedPlayers, warriorCount } from '../game/rules';
import { StoneIcon, SwordIcon } from './Icons';

/** Top status strip — one compact card per player: MageStones (carried +
 *  activated), kills, warriors alive, Mage power die, priest/ritual/siege
 *  status. Nobody should have to count pieces on the board. */
export function PlayerStrip() {
  const game = useGame((s) => s.game);
  const bots = useGame((s) => s.bots);
  const label = usePlayerLabel();
  const silverUrl = useTokenUrl('unactivated');
  const goldUrl = useTokenUrl('activated');
  const sieged = siegedPlayers(game);

  return (
    <div className="player-strip">
      {game.players.map((p) => {
        const mage = game.units.find((u) => u.kind === 'mage' && u.owner === p);
        const queuedMage = game.pendingRespawns.find((r) => r.owner === p && r.kind === 'mage');
        const priest = game.units.find((u) => u.kind === 'priest' && u.owner === p);
        const queuedPriest = game.pendingRespawns.find((r) => r.owner === p && r.kind === 'priest');
        // Carried = held but not yet activated (silver); activated = scored (gold).
        const carried = mage ? mage.carried : 0;
        const activated = mage ? mage.activated : (queuedMage?.activated ?? 0);
        const kills = game.kills[p];
        const warriors = warriorCount(game, p);
        const powerDie = magePowerDie(activated);
        const active = game.current === p && !game.winner;
        const out = game.eliminated.includes(p);
        const ritual = game.ritual?.player === p;
        const underSiege = sieged.includes(p);
        return (
          <div
            key={p}
            className={`pstat${active ? ' active' : ''}${out ? ' out' : ''}`}
            style={{ '--pc': COLORS[p] } as CSSProperties}
          >
            <span className="pstat-name">{label(p)}</span>
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
            <span className="pstat-metric tip" data-tut="activated" data-tip="Activated MageStones — 6 on your base wins">
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
            <span className="pstat-metric tip" data-tip="Warriors alive (of 6)">
              <span className="pstat-glyph">W</span>
              {warriors}
            </span>
            <span
              className="pstat-die tip"
              data-tip={`Mage attack die (grows with activated stones)${mage ? '' : queuedMage ? ' — Mage waiting to respawn' : ''}`}
            >
              d{powerDie}
            </span>
            {!priest && queuedPriest && (
              <span className="pstat-flag tip" data-tip="Priest waiting to respawn">
                P…
              </span>
            )}
            {ritual && (
              <span className="pstat-flag ritual tip" data-tip="Ritual in progress — survives a full round to win">
                RITUAL
              </span>
            )}
            {underSiege && !out && (
              <span className="pstat-flag siege tip" data-tip="Base occupied by an enemy — Mage/Priest cannot respawn">
                SIEGE
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
