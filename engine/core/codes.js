// codes.js — short join codes + id-based colors. Crypto-secure alphabet with
// no ambiguous glyphs (no I/L/O/0/1) so a kid reading a code off a shared
// screen can type it back correctly (voxel type's race-share.js).

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const DEFAULT_PALETTE = ['#e63946', '#f1a208', '#2a9d8f', '#264653', '#e76f51', '#457b9d', '#8338ec', '#3a86ff'];

/**
 * A short, crypto-secure, ambiguity-free join code (default 5 chars).
 * These are short-lived room names, not security tokens — if crypto is ever
 * unavailable (very old/locked-down browser) it falls back to Math.random
 * rather than throwing; the weaker randomness is an acceptable degrade.
 * @param {number} [len=5]
 * @returns {string}
 */
export function makeCode(len = 5) {
  const n = Math.max(1, len | 0);
  const values = randomBytes(n);
  let out = '';
  for (let i = 0; i < n; i++) out += ALPHABET[values[i] % ALPHABET.length];
  return out;
}

function randomBytes(n) {
  try {
    if (typeof crypto !== 'undefined' && crypto && typeof crypto.getRandomValues === 'function') {
      return crypto.getRandomValues(new Uint8Array(n));
    }
  } catch { /* fall through to Math.random */ }
  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

/**
 * Clean up a kid-typed code: uppercase, strip anything that isn't A-Z0-9.
 * @param {string} raw
 * @returns {string}
 */
export function normalizeCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * A stable color for an id — identity without identity (no names/avatars,
 * just a consistent color so kids can tell players/rooms apart).
 * @param {string} id
 * @param {string[]} [palette]  defaults to an 8-color house palette
 * @returns {string} hex color, e.g. '#e63946'
 */
export function idColor(id, palette) {
  const p = Array.isArray(palette) && palette.length ? palette : DEFAULT_PALETTE;
  const s = String(id ?? '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return p[h % p.length];
}
