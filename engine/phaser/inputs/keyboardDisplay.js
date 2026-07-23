// keyboardDisplay.js — tap-interactive on-screen QWERTY for touch-typing games: finger-zone
// color guides, home-row bumps (F/J), and a per-key hint/flash-feedback API. Two-phase like a
// Phaser scene helper: construct with config, then call create() once the scene is ready to add
// game objects. Assumes a global `Phaser`; only touched inside function bodies below.

const KEYBOARD_ROWS = [
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M'],
];

/** Which finger presses each key, touch-typing convention (l/r + pinky/ring/middle/index). */
export const FINGER = Object.freeze({
  Q: 'lp', A: 'lp', Z: 'lp',
  W: 'lr', S: 'lr', X: 'lr',
  E: 'lm', D: 'lm', C: 'lm',
  R: 'li', F: 'li', V: 'li', T: 'li', G: 'li', B: 'li',
  Y: 'ri', H: 'ri', N: 'ri', U: 'ri', J: 'ri', M: 'ri',
  I: 'rm', K: 'rm',
  O: 'rr', L: 'rr',
  P: 'rp',
});

/** A kid-friendly default color per finger zone (see FINGER); override via opts.fingerColors. */
export const FINGER_COLOR = Object.freeze({
  lp: 0xff6b6b, lr: 0xf6ad55, lm: 0xffd93d, li: 0x68d391,
  ri: 0x38bdf8, rm: 0x90cdf4, rr: 0xb794f4, rp: 0xf472b6,
});

const DEFAULT_COLORS = Object.freeze({
  keyInactive: 0x384157,
  keyBorder: 0x232a3d,
  text: 0xffffff,
  textDark: 0x1a1a1a,
  hint: 0xffd23f,
  hintBorder: 0xc9a220,
  wrong: 0xff6b6b,
  wrongBorder: 0xb83a3a,
  bump: 0xffffff,
});

const hex = (n) => '#' + n.toString(16).padStart(6, '0');

/**
 * A tap-interactive QWERTY keyboard rendered as Phaser game objects.
 * @example
 * this.kb = new KeyboardDisplay(this, { onKeyPress: (letter) => this.handleKey(letter) });
 * this.kb.create();
 * this.kb.activateHint('F');
 */
export class KeyboardDisplay {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} [opts]
   * @param {number} [opts.x=0] left edge the rows are centered within
   * @param {number} [opts.width] centering width (default `scene.scale.width`)
   * @param {number} [opts.y] top of the first row (default: bottom-anchored with a margin)
   * @param {number} [opts.keySize=44] square key size in px (>= the house 44px tap-target floor)
   * @param {number} [opts.keyGap=4]
   * @param {boolean} [opts.lowercase=false]
   * @param {boolean} [opts.fingerGuides=true] show the finger-zone color bar under each key
   * @param {string} [opts.fontFamily]
   * @param {Partial<typeof DEFAULT_COLORS>} [opts.colors]
   * @param {Partial<typeof FINGER_COLOR>} [opts.fingerColors]
   * @param {(letter: string) => void} [opts.onKeyPress] fired on tap/click of any key
   */
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.keySize = opts.keySize ?? 44;
    this.keyGap = opts.keyGap ?? 4;
    this.keyRadius = opts.keyRadius ?? 8;
    this.width = opts.width ?? scene.scale.width;
    this.x = opts.x ?? 0;
    this.y = opts.y ?? Math.round(scene.scale.height - 3 * (this.keySize + this.keyGap) - 24);
    this.lowercase = opts.lowercase ?? false;
    this.fingerGuides = opts.fingerGuides ?? true;
    this.fontFamily = opts.fontFamily ?? '"Trebuchet MS", "Segoe UI", system-ui, sans-serif';
    this.colors = { ...DEFAULT_COLORS, ...opts.colors };
    this.fingerColors = { ...FINGER_COLOR, ...opts.fingerColors };
    this.onKeyPress = opts.onKeyPress ?? null;

    this.keys = {};
    this.hintKey = null;
    this.hintTween = null;
    this.hintTimer = null;
  }

  /**
   * Build the Phaser game objects. Call once, after construction, once the scene can `add.*`.
   * @returns {this}
   */
  create() {
    const scene = this.scene;

    KEYBOARD_ROWS.forEach((row, rowIdx) => {
      const rowWidth = row.length * this.keySize + (row.length - 1) * this.keyGap;
      const startX = this.x + (this.width - rowWidth) / 2;
      const y = this.y + rowIdx * (this.keySize + this.keyGap);

      row.forEach((letter, colIdx) => {
        const x = startX + colIdx * (this.keySize + this.keyGap) + this.keySize / 2;
        const cy = y + this.keySize / 2;

        // Each key is a Container at the key CENTER; children draw relative to (0,0) so
        // scaling the container (the hint pulse) scales in place instead of drifting.
        const container = scene.add.container(x, cy);

        const shadow = scene.add.graphics();
        shadow.fillStyle(0x000000, 0.35);
        shadow.fillRoundedRect(-this.keySize / 2 + 2, -this.keySize / 2 + 3, this.keySize, this.keySize, this.keyRadius);

        const bg = scene.add.graphics();
        this.drawKey(bg, this.colors.keyInactive, this.colors.keyBorder);

        const guide = scene.add.graphics();
        if (this.fingerGuides) {
          const fc = this.fingerColors[FINGER[letter]] ?? this.colors.keyInactive;
          guide.fillStyle(fc, 0.9);
          guide.fillRoundedRect(-this.keySize / 2 + 6, this.keySize / 2 - 8, this.keySize - 12, 4, 2);
        }

        const text = scene.add.text(0, 0, this.lowercase ? letter.toLowerCase() : letter, {
          fontFamily: this.fontFamily, fontSize: '20px', fontStyle: 'bold', color: hex(this.colors.text),
        }).setOrigin(0.5);

        container.add([shadow, bg, guide, text]);

        // Home-row bumps on F and J, like a real keyboard.
        if (letter === 'F' || letter === 'J') {
          const bump = scene.add.graphics();
          bump.fillStyle(this.colors.bump, 0.85);
          bump.fillRoundedRect(-7, this.keySize / 2 - 15, 14, 3, 1.5);
          container.add(bump);
        }

        const hit = scene.add.rectangle(0, 0, this.keySize, this.keySize).setInteractive().setAlpha(0.001);
        hit.on('pointerdown', () => this.onKeyPress?.(letter));
        container.add(hit);

        this.keys[letter] = { container, bg, text };
      });
    });

    return this;
  }

  /** Redraw a key's background face. Internal, but exposed for custom skinning. */
  drawKey(graphics, fillColor, strokeColor) {
    graphics.clear();
    graphics.fillStyle(fillColor, 1);
    graphics.fillRoundedRect(-this.keySize / 2, -this.keySize / 2, this.keySize, this.keySize, this.keyRadius);
    graphics.lineStyle(2, strokeColor, 1);
    graphics.strokeRoundedRect(-this.keySize / 2, -this.keySize / 2, this.keySize, this.keySize, this.keyRadius);
  }

  /**
   * Highlight `letter` as the "type this next" hint: gold fill + a slow pulse. Clears any
   * previous hint first.
   * @param {string} letter
   * @param {number} [ms=Infinity] auto-fade delay; `Infinity` leaves it up until
   *   `clearHint()`/`fadeHint()` is called explicitly (e.g. when the round advances)
   */
  activateHint(letter, ms = Infinity) {
    this.clearHint();
    const keyObj = this.keys[letter];
    if (!keyObj) return;

    this.hintKey = letter;
    this.drawKey(keyObj.bg, this.colors.hint, this.colors.hintBorder);
    keyObj.text.setColor(hex(this.colors.textDark));

    this.hintTween = this.scene.tweens.add({
      targets: keyObj.container, scaleX: 1.12, scaleY: 1.12, duration: 400, yoyo: true, repeat: -1, ease: 'Sine.InOut',
    });

    if (ms !== Infinity) {
      this.hintTimer = this.scene.time.delayedCall(ms, () => this.fadeHint());
    }
  }

  /** Fade out the current hint (if any) back to the inactive key style. */
  fadeHint() {
    if (!this.hintKey) return;
    const keyObj = this.keys[this.hintKey];
    if (keyObj) {
      if (this.hintTween) { this.hintTween.stop(); this.hintTween = null; }
      keyObj.container.setScale(1);
      this.drawKey(keyObj.bg, this.colors.keyInactive, this.colors.keyBorder);
      keyObj.text.setColor(hex(this.colors.text));
    }
    this.hintKey = null;
  }

  /** Cancel the current hint immediately (tween + timer + visual reset). */
  clearHint() {
    if (this.hintTween) { this.hintTween.stop(); this.hintTween = null; }
    if (this.hintTimer) { this.hintTimer.destroy(); this.hintTimer = null; }
    if (this.hintKey) {
      const keyObj = this.keys[this.hintKey];
      if (keyObj) {
        keyObj.container.setScale(1);
        this.drawKey(keyObj.bg, this.colors.keyInactive, this.colors.keyBorder);
        keyObj.text.setColor(hex(this.colors.text));
      }
      this.hintKey = null;
    }
  }

  /**
   * Flash `letter` white-on-gold for a moment — a correct keystroke landed there.
   * @param {string} letter
   */
  flashCorrect(letter) {
    const keyObj = this.keys[letter];
    if (!keyObj) return;
    this.drawKey(keyObj.bg, 0xffffff, this.colors.hintBorder);
    this.scene.time.delayedCall(150, () => {
      this.drawKey(keyObj.bg, this.colors.keyInactive, this.colors.keyBorder);
      keyObj.text.setColor(hex(this.colors.text));
    });
  }

  /**
   * Flash `letter` red (a wrong key was pressed), then re-highlight `correctLetter` with a
   * short bounce so the child can see exactly which key to try instead. The re-highlight is
   * intentionally left gold after the bounce settles — it stays the active hint until the game
   * calls `flashCorrect()`/`activateHint()`/`clearHint()` on it, not reset here.
   * @param {string} letter the key actually pressed
   * @param {string} correctLetter the key that should have been pressed
   */
  flashWrong(letter, correctLetter) {
    const keyObj = this.keys[letter];
    if (keyObj) {
      this.drawKey(keyObj.bg, this.colors.wrong, this.colors.wrongBorder);
      this.scene.time.delayedCall(150, () => {
        this.drawKey(keyObj.bg, this.colors.keyInactive, this.colors.keyBorder);
      });
    }
    const correctObj = this.keys[correctLetter];
    if (correctObj) {
      this.drawKey(correctObj.bg, this.colors.hint, this.colors.hintBorder);
      correctObj.text.setColor(hex(this.colors.textDark));
      if (!this.hintTween) {
        this.hintKey = correctLetter;
        this.hintTween = this.scene.tweens.add({
          targets: correctObj.container, scaleX: 1.12, scaleY: 1.12, duration: 400, yoyo: true, repeat: 2, ease: 'Sine.InOut',
          onComplete: () => { correctObj.container.setScale(1); this.hintTween = null; }, // re-arm so later misses bounce again
        });
      }
    }
  }

  /** Tear down every key's game objects and tweens. */
  destroy() {
    this.clearHint();
    Object.values(this.keys).forEach((k) => {
      this.scene.tweens.killTweensOf(k.container);
      k.container.destroy();
    });
    this.keys = {};
  }
}
