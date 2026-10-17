/**
 * Selective glow: a bloom pass, and the reasons it is shaped the way it is.
 *
 * ## Why this is safe to add now, when it was not before
 *
 * V1.0.4 added bloom and V1.0.8 removed it, because the frame could not afford it. That was the
 * right call at the time - the frame was running 400 to 1,000 draw calls and 576 point lights, and
 * a full-screen post chain on top of that was the difference between slow and unusable. V1.0.16
 * paid both of those down (gates batched, the light pool cut to eight), and the `?perf` readout
 * now measures about 4 ms of work inside a 16.6 ms interval - so a bloom pass has room that simply
 * did not exist when it was tried.
 *
 * It is still gated: only the **high** preset turns it on, so a machine that cannot afford it
 * never pays for it, and the graphics menu already offers the way out.
 *
 * ## The three details that make it correct rather than merely present
 *
 *  - **Antialiasing has to be carried over.** `antialias: true` on a `WebGLRenderer` multisamples
 *    the *default framebuffer*, and a composer renders into a texture instead - so a naive post
 *    chain silently turns MSAA off and every edge in the city goes jagged. The render target is
 *    created with `samples`, which is what puts multisampling back on the off-screen buffer.
 *  - **Tone mapping must move to the end of the chain.** three.js only applies a material's tone
 *    mapping when it is drawing to the screen (`_currentRenderTarget === null`), which is exactly
 *    what a bloom threshold needs: the pass has to see *linear* values so it can pick out the neon
 *    before ACES compresses everything into the same bright band. `OutputPass` then applies the
 *    renderer's own tone mapping and output colour space, so the final picture is the same one the
 *    scene shaders would have produced.
 *  - **The threshold has to sit above the city.** A threshold low enough to catch lit concrete
 *    would bloom the whole frame into a haze; it is set high enough that only the emissive
 *    surfaces - the neon, the signs, the lit eyes of the cat - cross it.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * What the bloom looks like.
 *
 * Deliberately restrained. The city is already carried by emissive surfaces, so this is *glow on
 * the glow* rather than a lighting pass, and the numbers are the difference between "the neon
 * reads as lit glass" and "the screen is smeared".
 */
export interface BloomOptions {
  /** How bright a pixel must be to bloom at all, in linear pre-tone-mapping terms. */
  readonly threshold?: number;
  /** How far the glow spreads from its source. */
  readonly radius?: number;
  /** How much of the glow is added back over the scene. */
  readonly strength?: number;
  /** MSAA samples on the off-screen buffer. 0 turns multisampling off. */
  readonly samples?: number;
}

/** Conservative defaults: enough to see, not enough to look like a filter. */
export const BLOOM_DEFAULTS = {
  // Above the brightest lit surface and under the emissive tints, so only the neon crosses it.
  threshold: 0.85,
  // Wide enough to read as a halo rather than a halo of pixels.
  radius: 0.45,
  // A third of the glow added on top. This is the number that decides whether it reads as light.
  strength: 0.36,
  samples: 4,
} as const;

/**
 * The post-processing chain: render, bloom, tone-map, present.
 *
 * Owns three render targets it does not share with anything, so it must be disposed with the view.
 * Constructed only when a preset asks for bloom - on any other preset the game renders straight to
 * the canvas exactly as it did before, and this costs nothing at all.
 */
export class BloomChain {
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly renderer: THREE.WebGLRenderer;
  private disposed = false;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, options: BloomOptions = {}) {
    const samples = Math.max(0, Math.floor(options.samples ?? BLOOM_DEFAULTS.samples));
    this.renderer = renderer;

    // **Sized to the drawing buffer, not to a placeholder.** `EffectComposer` reads its own extent
    // from whatever target it is handed, so a 1x1 target means the first `setSize` resizes every
    // buffer in the chain twice - and the bloom pass rebuilds its whole mip chain each time, which
    // is a visible hitch on the frame the setting is applied.
    const size = renderer.getSize(new THREE.Vector2());
    const ratio = renderer.getPixelRatio();
    const width = Math.max(1, Math.round(size.x * ratio));
    const height = Math.max(1, Math.round(size.y * ratio));

    const target = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      samples,
      depthBuffer: true,
      stencilBuffer: false,
    });
    target.texture.name = 'bloom-scene';

    this.composer = new EffectComposer(renderer, target);
    // `EffectComposer` already took `renderer.getPixelRatio()`, so this is the CSS size it needs to
    // turn into the device size the target now has. Calling `setPixelRatio` here as well would make
    // it resize to `device * ratio` first - a transient buffer four times the size of the canvas,
    // allocated and thrown away on the frame the setting is applied.
    this.composer.setSize(size.x, size.y);
    this.composer.addPass(new RenderPass(scene, camera));

    // **Half resolution, and it is the difference between affordable and not.** A bloom mip chain
    // is a chain of blurs, and their cost is in pixels: at the drawing buffer's own size this pass
    // measured 8 to 23 ms of render time on an integrated GPU - doubling the frame and taking it
    // from sixty to the low forties. At half, the halo is the same *shape* (it is a wide, soft
    // blur; nobody can see the resolution) for a quarter of the taps, which puts it back inside the
    // frame's budget. See the numbers in the V1.0.22 notes.
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(Math.max(1, Math.round(width / 2)), Math.max(1, Math.round(height / 2))),
      options.strength ?? BLOOM_DEFAULTS.strength,
      options.radius ?? BLOOM_DEFAULTS.radius,
      options.threshold ?? BLOOM_DEFAULTS.threshold,
    );
    this.composer.addPass(this.bloom);

    // Tone mapping and the output colour space, applied *after* the bloom so the glow is itself
    // tone-mapped with the scene it sits on.
    this.composer.addPass(new OutputPass());
  }

  /**
   * Resizes the chain to a CSS pixel size and drawing-buffer ratio.
   *
   * Both halves matter: the composer's own buffers are sized in device pixels (`css * ratio`), and
   * the bloom pass's own mip chain is sized from its input, so it has to be told too or the glow
   * stays at its old resolution after a window resize - a blur that is subtly the wrong size.
   */
  setSize(width: number, height: number, pixelRatio: number): void {
    if (this.disposed) return;
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
  }

  /**
   * Draws one frame through the chain.
   *
   * **`renderer.info` is accumulated across the whole chain, not reset per pass.** three.js resets
   * it at the start of every `render()` call when `autoReset` is on, which through a composer means
   * the last thing to render wins - and the last thing is a full-screen quad. The `?perf` readout
   * would have reported *one* draw call and a couple of triangles for a frame that submitted nearly
   * three hundred, which is the exact kind of lying measurement this project spent five versions
   * learning not to trust. Resetting once here and letting the passes add up gives the number that
   * means something: everything the frame asked the GPU for.
   */
  render(): void {
    if (this.disposed) return;
    const info = this.renderer.info;
    const autoReset = info.autoReset;
    info.autoReset = false;
    info.reset();
    try {
      this.composer.render();
    } finally {
      info.autoReset = autoReset;
    }
  }

  /** How strong the glow is. Written through, so a settings change does not need a rebuild. */
  setStrength(strength: number): void {
    if (this.disposed) return;
    this.bloom.strength = Math.max(0, strength);
  }

  /**
   * Releases the buffers.
   *
   * Everything here is GPU memory the composer allocated - the scene target, its clone, the bloom
   * mip chain and the OutputPass's target - and none of it belongs to the scene, so the scene's own
   * disposal cannot reach it. A post chain left undisposed is a leak per view, and a view is rebuilt
   * on every context-loss recovery.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const pass of this.composer.passes) pass.dispose?.();
    this.composer.renderTarget1.dispose();
    this.composer.renderTarget2.dispose();
    this.composer.passes.length = 0;
  }
}
