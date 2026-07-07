/**
 * Avatar — profile photo (via ade-photo://) or an initials-on-gradient
 * fallback. The gradient hue set is lifted verbatim from mockup/index.html;
 * the hue is chosen deterministically from a seed so a given category/agent
 * always keeps the same colour.
 */

import type { CSSProperties } from 'react';

/** mockup HUES — [from, to] gradient stops. */
export const HUES: ReadonlyArray<readonly [string, string]> = [
  ['#E8B45A', '#C97B2E'],
  ['#7BC9A0', '#3E8A63'],
  ['#7BA9C9', '#3E6A8A'],
  ['#C98A7B', '#8A4A3E'],
  ['#B99BD6', '#7A5A9A'],
  ['#D6C05A', '#9A8A2E'],
];

export function gradientFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const [a, b] = HUES[h % HUES.length];
  return `linear-gradient(135deg, ${a}, ${b})`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const chars = parts.map((w) => w[0]).slice(0, 2).join('');
  return chars.toUpperCase() || '?';
}

/** Build the renderer URL for a stored photo filename. */
export function photoUrl(file: string): string {
  return `ade-photo://${file}`;
}

interface AvatarProps {
  name: string;
  photo?: string;
  /** round (agents) or square-ish (categories). */
  shape?: 'round' | 'square';
  /** px — 30 for categories, 26 for agents in the mockup. */
  size?: number;
  /** stable colour seed; defaults to name. */
  seed?: string;
  className?: string;
}

export function Avatar({
  name,
  photo,
  shape = 'round',
  size = 26,
  seed,
  className,
}: AvatarProps): React.ReactElement {
  const radius = shape === 'square' ? '8px' : '50%';
  const base: CSSProperties = {
    width: size,
    height: size,
    borderRadius: radius,
    flex: 'none',
    display: 'grid',
    placeItems: 'center',
    fontWeight: 700,
    fontSize: Math.round(size * 0.44),
    color: '#0E0F12',
    position: 'relative',
    overflow: 'hidden',
  };

  const classes = ['avatar', className].filter(Boolean).join(' ');

  if (photo) {
    return (
      <span className={classes} style={base}>
        <img
          src={photoUrl(photo)}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      </span>
    );
  }

  return (
    <span className={classes} style={{ ...base, background: gradientFor(seed ?? name) }}>
      {initials(name)}
    </span>
  );
}
