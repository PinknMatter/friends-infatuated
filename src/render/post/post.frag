#version 300 es
precision highp float;

uniform sampler2D u_scene;    // this frame's 2D text layer
uniform sampler2D u_prev;     // previous post output (feedback trails)
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_rgbSplit;      // 0..1
uniform float u_feedbackDecay; // 0..0.97
uniform float u_displacement;  // 0..1 (already audio-scaled on CPU)
uniform float u_scanlines;     // 0..1
uniform float u_noise;         // 0..1
uniform float u_bloomish;      // 0..1
uniform float u_invert;        // 0/1 strobe
uniform float u_brightness;    // 0..1 master

in vec2 v_uv;
out vec4 fragColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1, 0)), f.x),
    mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x),
    f.y
  );
}

void main() {
  vec2 uv = v_uv;

  // Displacement: low-frequency noise warp.
  if (u_displacement > 0.001) {
    vec2 warp = vec2(
      vnoise(uv * 6.0 + vec2(u_time * 0.7, 0.0)) - 0.5,
      vnoise(uv * 6.0 + vec2(0.0, u_time * 0.9) + 31.7) - 0.5
    );
    uv += warp * 0.03 * u_displacement;
  }

  // Chromatic aberration, radial.
  vec2 dir = uv - 0.5;
  float split = u_rgbSplit * 0.012;
  vec3 col;
  col.r = texture(u_scene, uv + dir * split).r;
  col.g = texture(u_scene, uv).g;
  col.b = texture(u_scene, uv - dir * split).b;

  // Cheap bloom-ish: 4 offset taps added back, weighted.
  if (u_bloomish > 0.001) {
    vec2 px = 3.0 / u_resolution;
    vec3 blur =
      texture(u_scene, uv + vec2(px.x, 0)).rgb +
      texture(u_scene, uv - vec2(px.x, 0)).rgb +
      texture(u_scene, uv + vec2(0, px.y)).rgb +
      texture(u_scene, uv - vec2(0, px.y)).rgb;
    col += blur * 0.25 * u_bloomish * 0.6;
  }

  // Feedback trails: keep the brighter of (scene, decayed previous frame).
  if (u_feedbackDecay > 0.001) {
    vec3 prev = texture(u_prev, uv).rgb;
    col = max(col, prev * u_feedbackDecay);
  }

  // Scanlines.
  if (u_scanlines > 0.001) {
    float line = sin(v_uv.y * u_resolution.y * 3.14159) * 0.5 + 0.5;
    col *= 1.0 - u_scanlines * 0.35 * line;
  }

  // Grain.
  if (u_noise > 0.001) {
    col += (hash(v_uv * u_resolution + fract(u_time) * 100.0) - 0.5) * 0.18 * u_noise;
  }

  if (u_invert > 0.5) col = 1.0 - col;
  col *= u_brightness;

  fragColor = vec4(col, 1.0);
}
