// ui.js — DOM element builder + small widget factories shared by every
// vanilla-DOM game. el() merges Math Arcade's el(tag, cls, html), k-2outpost's
// el(tag, cls, attrs), and scratchy's attrs-with-children-array convenience
// behind one contract shape. button()/dialog()/armToConfirm()/muteButton()
// are thin, dependency-light wrappers so a game never hand-rolls a
// 44px-tap-target button or a two-tap destructive-action guard again.
// DOM-only (uses `document` freely) — syntax-checked, not unit-tested (see
// docs/CONTRACTS.md "Tests").

/** Class every tap target gets; overlay.css sizes it to >= --ce-min-tap. */
export const MIN_TAP_CLASS = 'ce-btn';

/**
 * @param {string} tag
 * @param {string} [cls]
 * @param {Object<string,*>} [attrs] - HTML attributes; `text`/`html` set
 *   content, `style` merges a style object, `on{Event}` (or an `on: {...}`
 *   map) attaches listeners, `false`/`null`/`undefined` values are skipped.
 * @param {string|(Node|string)[]} [html] - innerHTML string, or an array of
 *   child nodes/strings to append.
 * @returns {HTMLElement}
 */
export function el(tag, cls, attrs, html) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  applyAttrs(node, attrs);
  applyContent(node, html);
  return node;
}

function applyAttrs(node, attrs) {
  if (!attrs) return;
  for (const key of Object.keys(attrs)) {
    const value = attrs[key];
    if (value === false || value == null) continue; // skip rather than stringify "null"/"false"
    if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key === 'on' && typeof value === 'object') { for (const ev of Object.keys(value)) node.addEventListener(ev, value[ev]); }
    else if (/^on[A-Z]/.test(key) && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
}

function applyContent(node, html) {
  if (html === undefined) return;
  if (Array.isArray(html)) { for (const child of html) node.append(child); }
  else node.innerHTML = html;
}

/**
 * A button meeting the shared minimum tap target (overlay.css's
 * --ce-min-tap). `sfx`, if given, is called (no args) on press, before
 * `onPress` — pass e.g. `() => ctx.audio.sfx('click')`; this module never
 * assumes a particular audio API shape.
 * @param {{label?: string, onPress?: Function, sfx?: Function, cls?: string, attrs?: Object}} opts
 * @returns {HTMLButtonElement}
 */
export function button({ label = '', onPress, sfx, cls = '', attrs = {} } = {}) {
  const classes = [MIN_TAP_CLASS, cls].filter(Boolean).join(' ');
  const node = el('button', classes, { type: 'button', 'aria-label': attrs['aria-label'] || label || undefined, ...attrs });
  if (!attrs.html && !attrs.text) node.textContent = label;
  if (typeof onPress === 'function') {
    node.addEventListener('click', (event) => {
      if (typeof sfx === 'function') { try { sfx(); } catch { /* a bad sfx callback must not block the press */ } }
      onPress(event);
    });
  }
  return node;
}

/**
 * A native <dialog> wired with a close button and optional backdrop-click-
 * to-close (scratchy's paper-dialog pattern, cleaned up to use the platform
 * element instead of a hand-rolled overlay div).
 * @param {{id?: string, cls?: string, title?: string, body?: string|(Node|string)[], actions?: HTMLElement[], closeLabel?: string, closeOnBackdrop?: boolean}} opts
 * @returns {{el: HTMLDialogElement, open: Function, close: Function}}
 */
export function dialog({ id, cls = '', title = '', body, actions = [], closeLabel = 'Close', closeOnBackdrop = true } = {}) {
  const dlg = el('dialog', ['ce-dialog', cls].filter(Boolean).join(' '), id ? { id } : null);
  const head = el('div', 'ce-dialog-head', null, [
    el('h2', '', { text: title }),
    button({ label: closeLabel, cls: 'ce-dialog-close', attrs: { 'aria-label': closeLabel }, onPress: () => api.close() }),
  ]);
  const bodyEl = el('div', 'ce-dialog-body');
  applyContent(bodyEl, body);
  dlg.append(head, bodyEl);
  if (actions.length) dlg.append(el('div', 'ce-dialog-actions', null, actions));
  if (closeOnBackdrop) {
    // Clicking the <dialog> element outside its padded content box hits the
    // element itself (its box fills the "top layer"), not a child — that's
    // the reliable native-dialog backdrop-click signal.
    dlg.addEventListener('click', (e) => { if (e.target === dlg) api.close(); });
  }
  document.body.appendChild(dlg);
  const api = {
    el: dlg,
    open() { try { dlg.showModal(); } catch { dlg.setAttribute('open', ''); } },
    close() { try { dlg.close(); } catch { dlg.removeAttribute('open'); } },
  };
  return api;
}

/**
 * K-2outpost's two-tap destructive-action guard: first press arms the button
 * (swaps its label, starts an auto-disarm timer); a second press within
 * `armedMs` confirms and fires `onConfirm`. Any other UI can call `disarm()`
 * to cancel the arm (e.g. closing the panel it lives in).
 * `btn` must already have its resting label/content set — armToConfirm reads
 * it once (to restore on disarm) and only swaps it while armed.
 * @param {HTMLElement} btn
 * @param {{armedLabel?: string, armedMs?: number, armedCls?: string, onArm?: Function, onConfirm?: Function, sfx?: Function}} opts
 * @returns {{disarm: Function, armed: boolean}}
 */
export function armToConfirm(btn, { armedLabel = '❓', armedMs = 2600, armedCls = 'armed', onArm, onConfirm, sfx } = {}) {
  const restLabel = btn.textContent;
  let armed = false;
  let timer = null;

  function doDisarm() {
    armed = false;
    btn.classList.remove(armedCls);
    btn.textContent = restLabel;
    if (timer) { clearTimeout(timer); timer = null; }
  }

  btn.addEventListener('click', () => {
    if (armed) {
      doDisarm();
      if (typeof onConfirm === 'function') onConfirm();
      return;
    }
    armed = true;
    btn.classList.add(armedCls);
    btn.textContent = armedLabel;
    if (typeof sfx === 'function') { try { sfx(); } catch { /* ignore */ } }
    if (typeof onArm === 'function') onArm();
    timer = setTimeout(doDisarm, armedMs);
  });

  return { disarm: doDisarm, get armed() { return armed; } };
}

/**
 * A speaker button bound to core settings + (optionally) core audio.
 * Reflects `settings.muted` immediately and stays in sync via
 * `settings.onChange`, so it's correct even when muted is toggled elsewhere
 * (a settings panel, a keyboard shortcut).
 * @param {{get: Function, set?: Function, onChange?: Function}} settings
 * @param {{unlock?: Function, setMuted?: Function}} [audio]
 * @param {{cls?: string, onLabel?: string, offLabel?: string}} [opts]
 * @returns {HTMLButtonElement}
 */
export function muteButton(settings, audio, { cls = '', onLabel = '🔊', offLabel = '🔇' } = {}) {
  const btn = button({
    cls: ['ce-mute-btn', cls].filter(Boolean).join(' '),
    attrs: { 'aria-label': 'Sound on or off' },
    onPress: () => {
      // Every entry gesture is a valid unlock point (iOS/Chromebook autoplay rules).
      if (audio && typeof audio.unlock === 'function') { try { audio.unlock(); } catch { /* ignore */ } }
      const next = !settings.get('muted');
      if (audio && typeof audio.setMuted === 'function') audio.setMuted(next);
      else if (typeof settings.set === 'function') settings.set('muted', next);
    },
  });

  function sync() {
    const muted = !!settings.get('muted');
    btn.textContent = muted ? offLabel : onLabel;
    btn.setAttribute('aria-pressed', String(!muted));
  }
  sync();
  if (typeof settings.onChange === 'function') {
    settings.onChange((key) => { if (key === 'muted') sync(); });
  }
  return btn;
}
