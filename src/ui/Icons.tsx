// Inline icons (currentColor). No emojis — crisp, themeable, consistent stroke.

type P = { size?: number; className?: string };

const stroke = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

/** Settings — a clean toothed cog. */
export function CogIcon({ size = 18, className }: P) {
  return (
    <svg {...stroke(size)} className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="2.6" />
      <circle cx="12" cy="12" r="5.6" />
      <path d="M12 6.4V4.3M12 17.6v2.1M17.6 12h2.1M4.3 12H6.4M15.96 8.04l1.48-1.48M6.56 17.44l1.48-1.48M15.96 15.96l1.48 1.48M6.56 6.56l1.48 1.48" />
    </svg>
  );
}

/** Camera lock — a camera body with a small padlock shackle. */
export function CameraLockIcon({ size = 18, className }: P) {
  return (
    <svg {...stroke(size)} className={className} aria-hidden="true">
      <rect x="3.2" y="8.2" width="13.6" height="10" rx="1.6" />
      <path d="M7.4 8.2 8.8 5.8h3.4l1.4 2.4" />
      <circle cx="10" cy="13.2" r="2.9" />
      <path d="M17.8 13.6v-1.8a2.2 2.2 0 0 1 4.4 0v1.8M17.2 13.6h5.6v4.6h-5.6z" />
    </svg>
  );
}

/** Rule Book — an open tome. */
export function BookIcon({ size = 18, className }: P) {
  return (
    <svg {...stroke(size)} className={className} aria-hidden="true">
      <path d="M12 6.2C10.4 4.9 8 4.4 4.5 4.4v13.2c3.5 0 5.9.5 7.5 1.8 1.6-1.3 4-1.8 7.5-1.8V4.4c-3.5 0-5.9.5-7.5 1.8Z" />
      <path d="M12 6.2v13.2" />
      <path d="M7 8.4c1.2.1 2.2.3 3 .7M7 11.4c1.2.1 2.2.3 3 .7M17 8.4c-1.2.1-2.2.3-3 .7M17 11.4c-1.2.1-2.2.3-3 .7" />
    </svg>
  );
}

export function CloseIcon({ size = 18, className }: P) {
  return (
    <svg {...stroke(size)} className={className} aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

/** MageStones — a 4-point diamond/sparkle. Centred on a 15-unit box. */
export function StoneIcon({ size = 16, className }: P) {
  return (
    <svg {...stroke(size)} className={className} aria-hidden="true">
      <path d="M12 4.5C12.8 9 15 11.2 19.5 12 15 12.8 12.8 15 12 19.5 11.2 15 9 12.8 4.5 12 9 11.2 11.2 9 12 4.5Z" />
    </svg>
  );
}

/** Kills — a sword at 45° (tip up-right). Mirrored + scaled to match StoneIcon's box. */
export function SwordIcon({ size = 16, className }: P) {
  return (
    <svg {...stroke(size)} className={className} aria-hidden="true">
      <g transform="translate(12 12) scale(-0.83 0.83) translate(-12 -12)" strokeWidth={1.9}>
        <path d="M14.5 17.5 3 6V3h3l11.5 11.5" />
        <path d="M13 19l6-6" />
        <path d="M16 16l4 4" />
        <path d="M19 21l2-2" />
      </g>
    </svg>
  );
}

/** Gravestone — a rounded-top headstone with a cross. */
export function GraveIcon({ size = 16, className }: P) {
  return (
    <svg {...stroke(size)} className={className} aria-hidden="true">
      <path d="M6 21V10a6 6 0 0 1 12 0v11z" />
      <path d="M12 8.5v5M9.5 11h5" />
      <path d="M4.5 21h15" />
    </svg>
  );
}

/** Siege — crossed swords (a base under attack). */
export function SiegeIcon({ size = 16, className }: P) {
  return (
    <svg {...stroke(size)} className={className} aria-hidden="true">
      <path d="M4 4l9.5 9.5M13.5 13.5l3 3-1.5 1.5-3-3" />
      <path d="M20 4l-9.5 9.5M10.5 13.5l-3 3 1.5 1.5 3-3" />
    </svg>
  );
}

/** Mage die mark — a filled 4-point star (✦). */
export function DieStar({ size = 12, className }: P) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 1.5c.9 5.4 3.6 8.1 9 9-5.4.9-8.1 3.6-9 9-.9-5.4-3.6-8.1-9-9 5.4-.9 8.1-3.6 9-9Z" />
    </svg>
  );
}

/** Priest die mark — a filled cross (✚). */
export function DieCross({ size = 12, className }: P) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M9.6 2.5h4.8v4.7h4.7v4.8h-4.7v9.5H9.6v-9.5H4.9V7.2h4.7z" />
    </svg>
  );
}
