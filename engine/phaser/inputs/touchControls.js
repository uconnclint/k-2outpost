// touchControls.js — on-screen d-pad + action buttons, shown only on touch devices (netrunner's
// device-gated pattern). Generalized from a fixed left/right/up/jump set to an arbitrary
// direction + action list so any 2D game (platformer, top-down, etc.) can reuse it. Assumes a
// global `Phaser`; only touched inside function bodies below.

const DEFAULT_DIRECTIONS = ['left', 'right', 'up'];
const DEFAULT_ACTIONS = [{ name: 'jump', label: 'JUMP' }];

// House style floors interactive targets at 44px effective; netrunner's original pad/action
// buttons were 24/36px. Bumped up here to clear that floor by default — still overridable.
const DEFAULT_DPAD_SIZE = 48;
const DEFAULT_ACTION_RADIUS = 26;

function drawDirectionTriangle(g, dir, x, y, size) {
  const cx = x + size / 2;
  const cy = y + size / 2;
  const r = size * 0.32;
  if (dir === 'left') g.fillTriangle(cx - r, cy, cx + r * 0.6, cy - r, cx + r * 0.6, cy + r);
  else if (dir === 'right') g.fillTriangle(cx + r, cy, cx - r * 0.6, cy - r, cx - r * 0.6, cy + r);
  else if (dir === 'up') g.fillTriangle(cx, cy - r, cx - r, cy + r * 0.6, cx + r, cy + r * 0.6);
  else if (dir === 'down') g.fillTriangle(cx, cy + r, cx - r, cy - r * 0.6, cx + r, cy - r * 0.6);
}

/**
 * A virtual d-pad (left/right/up/down, any subset) plus zero or more circular action buttons,
 * created only on touch devices. Poll `getInput()` from your update loop.
 * @example
 * this.touch = new TouchControls(this, { directions: ['left', 'right'], actions: [{ name: 'jump', label: 'JUMP' }, { name: 'shoot', label: 'FIRE' }] });
 * // in update(): const { left, right, jump, shoot } = this.touch.getInput();
 */
export class TouchControls {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} [opts]
   * @param {boolean} [opts.force] skip the touch-device gate (testing, or a "show anyway" setting)
   * @param {string[]} [opts.directions] any of 'left'|'right'|'up'|'down' (default ['left','right','up'])
   * @param {{ name: string, label?: string }[]} [opts.actions] action buttons, bottom-right,
   *   nearest-to-thumb first (default a single 'jump')
   * @param {number} [opts.dpadSize=48] d-pad button size (square) in px
   * @param {number} [opts.actionRadius=26] action button radius in px
   * @param {number} [opts.color=0x00f5ff] accent color
   * @param {number} [opts.alpha=0.35]
   * @param {number} [opts.margin=45] distance from the screen edges
   * @param {number} [opts.depth=300]
   */
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.opts = opts;
    this.directions = opts.directions ?? DEFAULT_DIRECTIONS;
    this.actions = opts.actions ?? DEFAULT_ACTIONS;
    this.enabled = opts.force ?? !!scene.sys?.game?.device?.input?.touch;
    this.state = {};
    [...this.directions, ...this.actions.map((a) => a.name)].forEach((k) => { this.state[k] = false; });
    this._zones = [];
    this._graphics = [];
    if (this.enabled) this.create();
  }

  /** Build the graphics + hit zones. Called automatically by the constructor when enabled. */
  create() {
    const scene = this.scene;
    const cam = scene.cameras.main;
    const w = cam.width;
    const h = cam.height;
    const opts = this.opts;
    const depth = opts.depth ?? 300;
    const alpha = opts.alpha ?? 0.35;
    const color = opts.color ?? 0x00f5ff;
    const margin = opts.margin ?? 45;
    const padSize = opts.dpadSize ?? DEFAULT_DPAD_SIZE;

    const padX = margin;
    const padY = h - margin;
    const dirRect = {
      left: { x: padX - padSize - 4, y: padY - padSize / 2 },
      right: { x: padX + 4, y: padY - padSize / 2 },
      up: { x: padX - padSize / 2, y: padY - padSize - 16 },
      down: { x: padX - padSize / 2, y: padY + 16 },
    };

    this.directions.forEach((dir) => {
      const pos = dirRect[dir];
      if (!pos) return; // unknown direction name — skip quietly rather than throw at kids
      const g = scene.add.graphics().setScrollFactor(0).setDepth(depth);
      g.fillStyle(0xffffff, alpha);
      g.fillRoundedRect(pos.x, pos.y, padSize, padSize, 4);
      g.fillStyle(color, alpha + 0.1);
      drawDirectionTriangle(g, dir, pos.x, pos.y, padSize);
      this._graphics.push(g);
      this.createHitZone(pos.x, pos.y, padSize, padSize, dir, depth + 1);
    });

    const r = opts.actionRadius ?? DEFAULT_ACTION_RADIUS;
    this.actions.forEach((action, i) => {
      // Stack multiple action buttons in a row near the bottom-right, nearest-thumb first.
      const ax = w - margin - i * (r * 1.9);
      const ay = h - margin;
      const g = scene.add.graphics().setScrollFactor(0).setDepth(depth);
      g.fillStyle(0xffffff, alpha);
      g.fillCircle(ax, ay, r);
      g.fillStyle(color, alpha + 0.1);
      g.fillCircle(ax, ay, r - 4);
      this._graphics.push(g);
      if (action.label) {
        const label = scene.add.text(ax, ay, action.label, {
          fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '11px', color: '#ffffff',
        }).setOrigin(0.5).setScrollFactor(0).setDepth(depth + 1).setAlpha(alpha + 0.2);
        this._graphics.push(label);
      }
      this.createHitZone(ax - r, ay - r, r * 2, r * 2, action.name, depth + 1);
    });
  }

  /** Register an invisible interactive zone that sets `state[key]` while pressed. */
  createHitZone(x, y, w, h, key, depth) {
    const zone = this.scene.add.zone(x + w / 2, y + h / 2, w, h).setScrollFactor(0).setDepth(depth ?? 301).setInteractive();
    zone.on('pointerdown', () => { this.state[key] = true; });
    zone.on('pointerup', () => { this.state[key] = false; });
    zone.on('pointerout', () => { this.state[key] = false; });
    this._zones.push(zone);
  }

  /**
   * Poll from your scene's `update()`.
   * @returns {Record<string, boolean>} one boolean per configured direction/action; all false
   *   when disabled (non-touch device and `opts.force` wasn't set)
   */
  getInput() {
    if (!this.enabled) {
      const off = {};
      Object.keys(this.state).forEach((k) => { off[k] = false; });
      return off;
    }
    return { ...this.state };
  }

  /** Destroy every graphic and hit zone this created. */
  destroy() {
    this._graphics.forEach((g) => g.destroy());
    this._zones.forEach((z) => z.destroy());
    this._graphics = [];
    this._zones = [];
  }
}
