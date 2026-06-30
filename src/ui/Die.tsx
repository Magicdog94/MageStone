// A no-numeral d6 rendered with pips. Die kind is conveyed by colour only.
const PIPS: Record<number, [number, number][]> = {
  // grid positions on a 3x3 (col,row), 0..2
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

type DieKind = 'mage' | 'priest' | 'warrior';

// Die kind is conveyed by colour: warrior red, mage blue, priest green. Marbled
// stone face + gilt frame + gold-dome pips, matching the 3D dice & token art.
const STYLE: Record<DieKind, { c1: string; c2: string }> = {
  mage: { c1: '#2f63b6', c2: '#163a82' },
  priest: { c1: '#22844c', c2: '#0e5530' },
  warrior: { c1: '#ab2d31', c2: '#6e171a' },
};
const GOLD = '#c9a23a';
const GOLD_BRIGHT = '#f0d27a';
// A shaded gold dome for the pips.
const PIP_BG = 'radial-gradient(circle at 35% 30%, #fff2bf 0%, #f6e191 42%, #c9a23a 76%, #7c5a1e 100%)';

interface DieProps {
  value: number;
  kind?: DieKind;
  state?: 'idle' | 'selected' | 'used' | 'discarded';
  onClick?: () => void;
  size?: number;
  title?: string;
}

export function PipDie({ value, kind = 'warrior', state = 'idle', onClick, size = 48, title }: DieProps) {
  const sk = STYLE[kind];
  const border = state === 'selected' ? '#ffd54a' : GOLD;
  const dim = state === 'used' || state === 'discarded';
  const cells = PIPS[value] ?? [];

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={!onClick}
      style={{
        position: 'relative',
        width: size,
        height: size,
        borderRadius: size * 0.18,
        background: `linear-gradient(135deg, ${sk.c1}, ${sk.c2})`,
        border: `2px solid ${border}`,
        boxShadow:
          state === 'selected'
            ? `0 0 10px #ffd54a, inset 0 0 0 1px ${GOLD_BRIGHT}`
            : `inset 0 0 0 1px rgba(240,210,122,0.45), 0 2px 4px rgba(0,0,0,.4)`,
        cursor: onClick ? 'pointer' : 'default',
        opacity: dim ? 0.32 : 1,
        padding: 0,
        transition: 'opacity .15s, box-shadow .15s, border-color .15s',
      }}
    >
      {state === 'discarded' && (
        <span
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            color: '#c0392b',
            fontSize: size * 0.6,
            fontWeight: 700,
          }}
        >
          ✕
        </span>
      )}
      {state !== 'discarded' &&
        cells.map(([cx, cy], i) => (
          <span
            key={i}
            style={{
              position: 'absolute',
              left: `${22 + cx * 28}%`,
              top: `${22 + cy * 28}%`,
              width: size * 0.18,
              height: size * 0.18,
              borderRadius: '50%',
              background: PIP_BG,
              boxShadow: 'inset 0 -1px 1px rgba(0,0,0,.35), 0 1px 1.5px rgba(0,0,0,.5)',
              transform: 'translate(-50%,-50%)',
            }}
          />
        ))}
    </button>
  );
}
