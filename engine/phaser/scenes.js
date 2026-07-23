// scenes.js — scene transitions: a synchronous switch plus a fade-in for the incoming scene's
// create(). Only two exports, deliberately: see the note on goScene() for why this module does
// NOT also offer a "fade out, then switch" helper.

/**
 * Switch scenes immediately (a thin wrapper — exists so every call site says the same thing
 * and stays greppable).
 *
 * WHY synchronous: the transition LOOK comes entirely from the incoming scene fading in from
 * black (every scene calls `fadeIn()` in its own `create()`), so a hard, synchronous
 * `scene.start()` already reads as a clean fade-through-black. We deliberately do NOT gate the
 * switch on a fade-OUT callback first — e.g. `cameras.main.fadeOut(dur, ...)` followed by a
 * `time.delayedCall()` that calls `scene.start()` (a pattern that shows up elsewhere in this
 * portfolio, such as newtyping's TitleScene). Starting a scene from a deferred/render-phase
 * callback can wedge the next scene at INIT in this Phaser build, whereas a direct, synchronous
 * `scene.start()` is 100% reliable. If you want a fade-out flourish too, drive it visually
 * without waiting for it: call `goScene()` right away and let the old scene fade under the new
 * one, or skip it — the new scene's own `fadeIn()` is usually enough.
 * @param {Phaser.Scene} scene the CURRENT scene (its `.scene` plugin does the switch)
 * @param {string} key the scene key to start
 * @param {object} [data] passed through to the new scene's `init()`/`create()`
 */
export function goScene(scene, key, data) {
  scene.scene.start(key, data);
}

/**
 * Fade a scene in from a solid color on create() — call this as the first line of `create()`.
 * @param {Phaser.Scene} scene
 * @param {number} [dur=260] fade duration in ms
 * @param {[number, number, number]} [rgb=[0,0,0]] fade-from color
 */
export function fadeIn(scene, dur = 260, rgb = [0, 0, 0]) {
  const [r, g, b] = rgb;
  scene.cameras.main.fadeIn(dur, r, g, b);
}
