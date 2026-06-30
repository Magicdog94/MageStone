// Loads the photographed token art (public/tokens.png — gold | silver | skull),
// slices it into three square tiles, and exposes:
//   • THREE textures (raw, UV-cropped to the coin) for the solid 3D disk tops, and
//   • transparent PNG data-URLs (background keyed out) for flat 2D HUD icons.
//   activated   = glowing gold MageStone
//   unactivated = silver MageStone (the stones sitting on the board)
//   gravestone  = skull token
import { useEffect, useState } from 'react';
import * as THREE from 'three';

export type TokenKind = 'activated' | 'unactivated' | 'gravestone';
export type TokenTextures = Record<TokenKind, THREE.Texture>;

const SRC = '/tokens.png';
const TILE = 724; // source is 2172×724 → three 724² tiles
const OUT = 512; // output texture size

/** Flood-fill from the four corners, clearing pixels close to the corner
 *  background colour — removes the studio backdrop + soft shadow, leaving the
 *  coin as a clean cut-out (its dark rim stops the fill leaking inside). */
function keyBackground(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const br = d[0];
  const bg = d[1];
  const bb = d[2];
  const tol = 68; // a touch wider so the soft drop-shadow is removed too
  const seen = new Uint8Array(w * h);
  const stack: number[] = [0, w - 1, (h - 1) * w, h * w - 1];
  const close = (i: number) =>
    Math.abs(d[i * 4] - br) < tol && Math.abs(d[i * 4 + 1] - bg) < tol && Math.abs(d[i * 4 + 2] - bb) < tol;
  while (stack.length) {
    const i = stack.pop()!;
    if (seen[i]) continue;
    seen[i] = 1;
    if (!close(i)) continue;
    d[i * 4 + 3] = 0;
    const x = i % w;
    const y = (i / w) | 0;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - w);
    if (y < h - 1) stack.push(i + w);
  }
  ctx.putImageData(img, 0, 0);
}

// Keyed PNG data-URLs of each tile, captured during decode for 2D UI use.
const urlCache: Partial<Record<TokenKind, string>> = {};

function tileCanvas(img: HTMLImageElement, third: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = OUT;
  c.getContext('2d')!.drawImage(img, third * TILE, 0, TILE, TILE, 0, 0, OUT, OUT);
  return c;
}

/** Re-centre the coin: find the bounding box of opaque pixels and redraw it,
 *  centred, filling a fresh square — so the decal is dead-centre and the coin
 *  spans the whole disk (no off-centre, no margin). */
function recentre(c: HTMLCanvasElement): HTMLCanvasElement {
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  let minX = c.width;
  let minY = c.height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (d[(y * c.width + x) * 4 + 3] > 150) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) return c;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const side = Math.max(maxX - minX, maxY - minY) * 1.0; // coin fills the frame
  const out = document.createElement('canvas');
  out.width = out.height = OUT;
  out.getContext('2d')!.drawImage(c, cx - side / 2, cy - side / 2, side, side, 0, 0, OUT, OUT);
  return out;
}

function makeTile(img: HTMLImageElement, third: number, kind: TokenKind): THREE.Texture {
  // Key out the backdrop, then re-centre/crop so the coin fills the frame — used
  // both as the 3D decal texture and (via toDataURL) as the flat HUD icon.
  const keyed = tileCanvas(img, third);
  keyBackground(keyed.getContext('2d')!, OUT, OUT);
  const c = recentre(keyed);
  urlCache[kind] = c.toDataURL('image/png');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

let promise: Promise<TokenTextures> | null = null;
export function loadTokens(): Promise<TokenTextures> {
  if (promise) return promise;
  promise = new Promise<TokenTextures>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({
        activated: makeTile(img, 0, 'activated'),
        unactivated: makeTile(img, 1, 'unactivated'),
        gravestone: makeTile(img, 2, 'gravestone'),
      });
    };
    img.onerror = reject;
    img.src = SRC;
  });
  return promise;
}

/** React hook: token textures (cropped to the coin) for the 3D disks, else null. */
export function useTokens(): TokenTextures | null {
  const [tex, setTex] = useState<TokenTextures | null>(null);
  useEffect(() => {
    let alive = true;
    loadTokens()
      .then((t) => alive && setTex(t))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return tex;
}

/** React hook: transparent PNG data-URL for one token, for 2D UI (HUD icons). */
export function useTokenUrl(kind: TokenKind): string | null {
  const [url, setUrl] = useState<string | null>(urlCache[kind] ?? null);
  useEffect(() => {
    let alive = true;
    loadTokens()
      .then(() => alive && setUrl(urlCache[kind] ?? null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [kind]);
  return url;
}
