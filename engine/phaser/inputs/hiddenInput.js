// hiddenInput.js — a hidden, off-screen DOM <input> that keeps the on-screen keyboard alive on
// iPads and feeds clean characters to the game; Chromebook hardware keys land here too, so
// there is exactly one input path. Kept essentially verbatim from KeyQuest's input.js: the
// refocus-on-blur/pointerdown behavior is the whole point (an iPad dismisses its soft keyboard
// on blur, and the only reliable recovery is refocusing this element on the next tap anywhere).

/**
 * @typedef {object} HiddenInputOptions
 * @property {number} [maxLength=3]
 * @property {RegExp} [filter=/[a-zA-Z]/] applied per-character to clean pasted/IME input
 * @property {string} [autocapitalize='characters']
 * @property {(value: string) => void} [onChange] fires with the cleaned value on every input
 * @property {(e: KeyboardEvent) => void} [onKey] fires on every keydown (e.g. for Backspace/Enter)
 */
export class HiddenInput {
  /** @param {HiddenInputOptions} [options] */
  constructor({ maxLength = 3, filter = /[a-zA-Z]/, autocapitalize = 'characters', onChange = null, onKey = null } = {}) {
    const el = document.createElement('input');
    el.type = 'text';
    el.autocapitalize = autocapitalize;
    el.autocomplete = 'off';
    el.spellcheck = false;
    el.setAttribute('autocorrect', 'off');
    el.style.cssText =
      'position:fixed;left:50%;bottom:0;width:2px;height:2px;opacity:0.01;border:0;padding:0;background:transparent;color:transparent;caret-color:transparent;z-index:5;';
    document.body.appendChild(el);
    this.el = el;
    this.maxLength = maxLength;
    this.filter = filter;
    this.onChange = onChange;
    this.onKey = onKey;

    el.addEventListener('input', () => {
      const cleaned = [...el.value].filter((c) => this.filter.test(c)).join('').slice(0, this.maxLength);
      if (el.value !== cleaned) el.value = cleaned;
      this.onChange?.(cleaned);
    });
    el.addEventListener('keydown', (e) => {
      this.onKey?.(e);
    });
    this.refocus = () => { setTimeout(() => el.focus(), 0); };
    el.addEventListener('blur', this.refocus);
    this.refocus();
    // clicking/tapping anywhere refocuses (iPad keyboard dismissal recovery)
    this.tapHandler = () => el.focus();
    document.addEventListener('pointerdown', this.tapHandler);
  }

  get value() { return this.el.value; }
  set value(v) {
    this.el.value = v;
    this.onChange?.(v);
  }

  destroy() {
    this.el.removeEventListener('blur', this.refocus);
    document.removeEventListener('pointerdown', this.tapHandler);
    this.el.remove();
  }
}
