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

// Die kind is conveyed by colour: warrior red, mage blue, priest green.
const STYLE: Record<DieKind, { face: string; pip: string; border: string }> = {
  mage: { face: '#2f5fb0', pip: '#eef4ff', border: '#84a6e0' },
  priest: { face: '#2e8b57', pip: '#ecfaf1', border: '#79c6a0' },
  warrior: { face: '#b23636', pip: '#f7efe3', border: '#dd9a9a' },
};

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
  const face = sk.face;
  const pip = sk.pip;
  const border = state === 'selected' ? '#ffd54a' : sk.border;
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
        background: face,
        border: `2px solid ${border}`,
        boxShadow: state === 'selected' ? '0 0 10px #ffd54a' : '0 2px 4px rgba(0,0,0,.4)',
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
              left: `${15 + cx * 28}%`,
              top: `${15 + cy * 28}%`,
              width: size * 0.16,
              height: size * 0.16,
              borderRadius: '50%',
              background: pip,
              transform: 'translate(-50%,-50%)',
            }}
          />
        ))}
    </button>
  );
}
