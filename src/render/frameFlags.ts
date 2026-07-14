// Per-frame flags that effects can raise and the post pass consumes.
// Reset by the renderer at the top of every frame.

export const frameFlags = {
  invert: 0, // 0..1, drives the post-shader invert uniform (strobeInvert)
};

export function resetFrameFlags(): void {
  frameFlags.invert = 0;
}
