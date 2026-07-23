// moderation.js — shared child-safety text filtering: names, chat, sign
// text, world snapshots. Pure ESM, zero I/O, runs identically in a browser
// (client-side hinting) and a Worker (the check that actually matters,
// since only the server can't be bypassed by a modified client).
//
// The two-tier BANNED list is voxel type's design (src/worker.js:48-76):
// `substrings` match anywhere in the de-leeted, repeat-collapsed text;
// `words` match only as a whole token. That split exists because a flat
// substring list false-positives on real kids' names — "Michelle" contains
// "hell", "Cassie" contains "ass", "Shelly" contains "hell" too — so
// anything that can appear INSIDE an ordinary name lives in `words` (exact
// token match only), and only genuinely name-safe substrings go in
// `substrings`. This file merges voxel type's original list with the
// widened word list wonderglade's Phase 0.5 patch added (worker.js
// engine-migration branch) for general chat/sign text; the merge keeps
// every entry in the tier its source already proved safe, so the
// Michelle/Cassie/Shelly guard still holds for the combined list (see
// test/net.moderation.test.mjs).

/** @type {{substrings: string[], words: string[]}} */
export const BANNED = {
  substrings: [
    'fuck', 'shit', 'bitch', 'cunt', 'nigg', 'fagg', 'retard', 'penis', 'vagin',
    'boob', 'porn', 'sexy', 'pussy', 'whore', 'slut', 'bastard', 'dick', 'nazi',
    'hitler', 'molest', 'orgasm', 'hentai', 'blowjob', 'dildo', 'jizz', 'puta',
    'mierda', 'shutup',
  ],
  words: [
    'ass', 'arse', 'sex', 'fag', 'hoe', 'cum', 'tit', 'cock', 'kkk', 'rape',
    'meth', 'crap', 'piss', 'pendejo', 'damn', 'hell', 'stupid', 'dumb', 'hate',
    'idiot', 'butt', 'fart', 'poop', 'kill', 'die', 'sucks', 'loser',
  ],
};

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', $: 's', '@': 'a', '!': 'i', '+': 't' };
const NAME_CHARSET = /^[a-zA-Z0-9 '!-]+$/;
const FALLBACK_NAMES = ['Star Wizard', 'Moon Wizard', 'Sun Wizard', 'Fern Wizard', 'Frog Wizard', 'Bolt Wizard'];

/**
 * Lowercase + collapse common leetspeak substitutions (0→o, 1→i, 3→e, 4→a,
 * 5→s, 7→t, $→s, @→a, !→i, +→t) so "fuuuck"/"sh1t"/"a$$" are still caught.
 * @param {string} s
 * @returns {string}
 */
export function deleet(s) {
  return String(s ?? '').toLowerCase().replace(/[013457$@!+]/g, (c) => LEET[c] || c);
}

// Shared scan used by checkName/safeName/cleanText: true if `text` trips
// the two-tier list (voxel type's original scan, generalized over an
// optional extra per-game blocklist applied as whole words, same as
// KeyQuest/WWA's `blocklist` argument).
function isBanned(text, extraBlocklist) {
  const leet = deleet(text);
  const collapsed = leet.replace(/(.)\1+/g, '$1'); // catches "fuuuck" -> "fuck"
  const extra = new Set((extraBlocklist || []).map((w) => String(w).toLowerCase()));
  for (const form of [leet, collapsed]) {
    const compact = form.replace(/[^a-z]/g, '');
    for (const w of BANNED.substrings) {
      if (compact.includes(w)) return true;
    }
    const tokens = form.split(/[^a-z]+/).filter(Boolean);
    for (const t of tokens) {
      if (BANNED.words.includes(t) || extra.has(t)) return true;
    }
  }
  return false;
}

/**
 * Validate a free-typed display name. Rejects (never silently rewrites) —
 * use this wherever a rejection + retry prompt is the right UX; use
 * safeName() wherever the flow needs SOME name no matter what (seat-reclaim
 * reconnects, bot naming).
 * @param {string} raw
 * @param {object} [options]
 * @param {string[]} [options.blocklist]  extra game-specific banned words
 *   (whole-token match), merged with the shared list
 * @param {number} [options.maxLen=20]
 * @returns {{ok: true, name: string} | {ok: false, reason: string}}
 */
export function checkName(raw, options = {}) {
  const { blocklist, maxLen = 20 } = options;
  const name = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > maxLen) {
    return { ok: false, reason: `Name must be 2–${maxLen} characters` };
  }
  if (!NAME_CHARSET.test(name)) {
    return { ok: false, reason: 'Letters, numbers, and spaces only' };
  }
  if (isBanned(name, blocklist)) {
    return { ok: false, reason: "That name isn't allowed — pick something classroom-friendly!" };
  }
  return { ok: true, name };
}

// Deterministic hash -> stable fallback pick, so the SAME raw input always
// lands on the SAME fallback name (WWA shared/gameplay.cjs `safeName`
// pattern) — a filtered kid's seat-reclaim-by-name reconnect still works,
// because their rejoin sends the same raw text and gets the same fallback.
function hashOf(s) {
  let h = 0;
  const str = String(s ?? '');
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * Like checkName, but NEVER rejects — always returns a usable name, falling
 * back to a deterministic classroom-friendly placeholder when the input is
 * empty, too long, wrong-charset, or banned. Use this at connection time for
 * rooms that can't show a "name rejected, try again" UI mid-join (WWA's
 * GameRoom.fetch()).
 * @param {string} raw
 * @param {object} [options]
 * @param {string[]} [options.blocklist]  extra game-specific banned words
 * @param {string[]} [options.fallbacks]  override the default fallback pool
 * @param {number} [options.maxLen=14]
 * @returns {string}
 */
export function safeName(raw, options = {}) {
  const { blocklist, fallbacks, maxLen = 14 } = options;
  const pool = Array.isArray(fallbacks) && fallbacks.length ? fallbacks : FALLBACK_NAMES;
  const fallback = () => {
    const h = hashOf(raw ?? 'player');
    return `${pool[h % pool.length]} ${h % 10}`;
  };
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
  if (name.length < 2) return fallback();
  if (!NAME_CHARSET.test(name)) return fallback();
  if (isBanned(name, blocklist)) return fallback();
  return name;
}

/**
 * Sanitize free text (sign messages, build labels, chat) for server-side
 * relay/storage. Whitespace-collapsed and length-capped either way; content
 * that trips the banned-word scan is swapped for `replacement` wholesale
 * (wonderglade's `cleanSignText` — no partial redaction, since a partially
 * blanked slur is still readable). Never throws; empty/missing input
 * returns an empty string.
 * @param {string} raw
 * @param {object} [options]
 * @param {number} [options.maxLen=60]
 * @param {string} [options.replacement='...']
 * @param {string[]} [options.blocklist]  extra game-specific banned words
 * @returns {string}
 */
export function cleanText(raw, options = {}) {
  const { maxLen = 60, replacement = '...', blocklist } = options;
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
  if (!text) return text;
  return isBanned(text, blocklist) ? replacement : text;
}
