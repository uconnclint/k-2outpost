// assets.js — raster-first images with automatic SVG self-heal + a paint
// guard for lazily-decoded images (Scoop Troop's assets-raster.js pattern).
// Each raster asset is registered with a `key` tying it to an inline SVG
// fallback: if the raster 404s (offline, missing file, filtered network),
// `onerror` swaps the <img> for the SVG in place — the game never shows a
// broken-image icon. A MutationObserver gives every newly-inserted <img> a
// one-shot reveal animation, which forces the browser to rasterize it even
// when it was injected into a hidden (visibility:hidden) screen — the bug
// Scoop Troop hit where a background stayed blank until something else
// forced a repaint.
// DOM-only — syntax-checked, not unit-tested (see docs/CONTRACTS.md "Tests").

const fallbacks = new Map(); // key -> fallback HTML string

let guardInstalled = false;
function installPaintGuard() {
  if (guardInstalled) return;
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
  guardInstalled = true;
  ensureRevealStyle();
  const reveal = (node) => {
    if (!node || node.nodeType !== 1) return;
    if (node.tagName === 'IMG') node.classList.add('ce-ras-reveal');
    if (node.querySelectorAll) node.querySelectorAll('img').forEach((img) => img.classList.add('ce-ras-reveal'));
  };
  new MutationObserver((mutations) => {
    for (const m of mutations) for (const n of m.addedNodes) reveal(n);
  }).observe(document.documentElement, { childList: true, subtree: true });
}

let styleInstalled = false;
function ensureRevealStyle() {
  if (styleInstalled || typeof document === 'undefined') return;
  styleInstalled = true;
  const style = document.createElement('style');
  style.setAttribute('data-ce-assets', '');
  // A one-shot, near-invisible animation: animating elements are guaranteed
  // to rasterize every frame, which is the reliable trigger that forces a
  // paint even under prefers-reduced-motion (duration clamped to ~0, but the
  // one frame it does run still forces the paint).
  style.textContent = `
@keyframes ce-ras-reveal { from { opacity: 0.9999; } to { opacity: 1; } }
.ce-ras-reveal { animation: ce-ras-reveal 1ms linear; }
@media (prefers-reduced-motion: reduce) { .ce-ras-reveal { animation-duration: 0.01ms; } }
`;
  document.head.appendChild(style);
}

function handleError(imgEl, key) {
  const html = fallbacks.get(key);
  if (!imgEl || !html) return;
  try {
    const template = document.createElement('template');
    template.innerHTML = html.trim();
    imgEl.replaceWith(template.content);
  } catch { /* if even the fallback can't be inserted, leave the broken img — nothing else to do */ }
}

function installGlobalHook() {
  if (typeof window === 'undefined' || window.__ceAssetFallback) return;
  window.__ceAssetFallback = (imgEl, key) => handleError(imgEl, key);
}

/**
 * Build an `<img>` DOM node for a raster asset with an SVG self-heal
 * fallback registered under `key`.
 * @param {string} key - unique id tying this image to its fallback
 * @param {string} url - raster (webp/png/jpg) source
 * @param {{fallbackHtml?: string, cls?: string, alt?: string}} [opts]
 * @returns {HTMLImageElement}
 */
export function img(key, url, { fallbackHtml = '', cls = '', alt = '' } = {}) {
  installPaintGuard();
  if (fallbackHtml) fallbacks.set(key, fallbackHtml);
  const node = document.createElement('img');
  node.src = url;
  if (cls) node.className = cls;
  node.alt = alt;
  node.draggable = false;
  node.decoding = 'async';
  node.addEventListener('error', () => handleError(node, key), { once: true });
  return node;
}

/**
 * Same as img(), but returns an HTML STRING for template-literal-built
 * markup (mirrors Scoop Troop's `window.__scoopRasterFallback` hook, since
 * an inline `onerror=""` attribute can't close over a DOM reference).
 * @param {string} key
 * @param {string} url
 * @param {{fallbackHtml?: string, cls?: string, alt?: string}} [opts]
 * @returns {string}
 */
export function imgHtml(key, url, { fallbackHtml = '', cls = '', alt = '' } = {}) {
  installPaintGuard();
  installGlobalHook();
  if (fallbackHtml) fallbacks.set(key, fallbackHtml);
  return `<img src="${url}" class="${cls}" alt="${alt}" draggable="false" decoding="async" onerror="window.__ceAssetFallback(this,'${key}')">`;
}
