// Shared pieces for the ceramic package variations (K01–K10). Pure: no bindings. Sintered grain, the
// optics of a glaze and of gold plating under the brand's gels (m01-metal.wgsl), and the white ink.
import { CAM, h21, h22, gnoise, Studio, env, diffuse, fresnel } from "./studio.wgsl";

/** The nearest sintered grain to q (cell units): xy its offset from the grain's centre, zw two randoms. */
export fn grains(q: vec2f) -> vec4f {
  let i = vec2i(floor(q));
  let f = fract(q);
  var bd = 9.0;
  var best = vec2f(0.0);
  var id = vec2f(0.0);
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let c = i + vec2i(x, y);
      let h = h22(c + vec2i(71, 3));
      let d = vec2f(f32(x), f32(y)) + h - f;
      let l = dot(d, d);
      if (l < bd) { bd = l; best = -d; id = h22(c + vec2i(5, 919)); }
    }
  }
  return vec4f(best, id);
}

/** A uv-space tilt (x right, y down) to a plate normal (y up). */
export fn tilt_n(t: vec2f) -> vec3f {
  return normalize(vec3f(t.x, -t.y, 1.0));
}

/** Light off a dielectric coat (glaze, lacquer) of index-ish f0 with roughness alpha: Fresnel times the
 *  studio seen in the mirror direction. */
export fn coat(st: Studio, p: vec3f, V: vec3f, n: vec3f, f0: f32, alpha: f32) -> vec3f {
  let F = fresnel(vec3f(f0), dot(n, V));
  return F * env(st, p, reflect(-V, n), alpha);
}

/** Gold plating (nickel-gold over Kovar or tungsten): rough 0..1 spreads the gels across it. */
export fn gold(st: Studio, p: vec3f, V: vec3f, n: vec3f, rough: f32) -> vec3f {
  let F = fresnel(vec3f(1.0, 0.74, 0.32), dot(n, V));
  let r = reflect(-V, n);
  let e0 = env(st, p, r, rough) * 0.6 + env(st, p, r, rough * 2.5 + 0.2) * 0.4;
  // gold under a coloured gel still reads as gold: keep half the light's colour, take the rest as brightness
  let e = mix(e0, vec3f(dot(e0, vec3f(0.2126, 0.7152, 0.0722))), 0.55);
  return F * e;
}

/** The logo's white epoxy ink: flat, matte, barely touched by the gels. cover from the distance field. */
export fn ink(st: Studio, p: vec3f, uv: vec2f, size: vec2f) -> vec3f {
  let l = clamp(diffuse(st, p, vec3f(0.0, 0.0, 1.0)), vec3f(0.0), vec3f(1.2));
  return vec3f(0.82, 0.82, 0.80) * (0.62 + 0.25 * l) * (1.0 + gnoise(uv * size.x * 0.5) * 0.025);
}

/** A soft ring of grains brighter and darker: the slow mottling of a fired body, 0-centred. */
export fn mottle(uv: vec2f, s: f32) -> f32 {
  return gnoise(uv * s) * 0.6 + gnoise(uv * s * 2.3 + vec2f(5.0, 2.0)) * 0.4;
}

/** A few dust motes and lint on the surface: 0..1 coverage. */
export fn dust(uv: vec2f, px: f32, chance: f32) -> f32 {
  let q = uv * 40.0;
  let i = vec2i(floor(q));
  let h = h22(i + vec2i(401, 77));
  if (h21(i + vec2i(13, 501)) > chance) { return 0.0; }
  let c = (vec2f(i) + vec2f(0.2) + h * 0.6) / 40.0;
  let r = px * (0.6 + 1.4 * h.y);
  return smoothstep(r, r * 0.3, length(uv - c));
}
