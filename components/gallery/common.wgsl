// What a tile shader gets (components/gallery/render.ts sets it): its params, the logo as a distance
// field (r) and coverage (g), and a linear clamped sampler. uv runs 0..1 across the square, (0,0) at
// the top left; colours are linear, and a shader returns encode(colour) for the canvas's sRGB bytes.

export struct Params {
  /** The square's size in device pixels: one pixel in uv is 1.0 / size.x. */
  size: vec2f,
  /** Where the pointer is, in uv; (0.5, 0.5) at rest. */
  pointer: vec2f,
  /** 0 at rest, 1 while the pointer is over the square (eased). */
  hover: f32,
  /** Seconds; it only advances while something animates. */
  time: f32,
  /** 0 light, 1 dark. */
  dark: f32,
  /** The agent's own seed, 0..1: picks its palette from the brand's colours. */
  seed: f32,
  /** The page colour and the ink colour of the scheme, linear. */
  bg: vec4f,
  fg: vec4f,
  /** The agent's own colour, linear: each tile gets one. */
  hue: vec4f,
}

/** The logo box's side in uv: the drawn logo is 80% of it, so about 40% of the square. */
export const LOGO_BOX: f32 = 0.5;
const SPREAD: f32 = 24.0;
const TEX: f32 = 256.0;

/** Square uv to the logo texture's uv. */
export fn logo_uv(uv: vec2f) -> vec2f {
  return (uv - vec2f(0.5)) / LOGO_BOX + vec2f(0.5);
}

/** The field's red channel as a signed distance in square-uv units (negative inside). */
export fn logo_distance(r: f32) -> f32 {
  return (r - 0.5) * 2.0 * SPREAD / TEX * LOGO_BOX;
}

/** Coverage with a one-pixel antialiased edge, from a distance and the square's size. */
export fn logo_mask(d: f32, size: vec2f) -> f32 {
  let px = 1.0 / size.x;
  return clamp(0.5 - d / px, 0.0, 1.0);
}

/** Linear colour to the canvas's sRGB bytes, opaque. Every style returns through this. */
export fn encode(c: vec3f) -> vec4f {
  let x = clamp(c, vec3f(0.0), vec3f(1.0));
  let lo = x * 12.92;
  let hi = 1.055 * pow(x, vec3f(1.0 / 2.4)) - 0.055;
  return vec4f(select(hi, lo, x <= vec3f(0.0031308)), 1.0);
}
