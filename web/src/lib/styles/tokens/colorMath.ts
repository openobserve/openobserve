// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

/**
 * Colour maths over the design-token CSS, in plain TypeScript.
 *
 * The token sheets are the only place both themes exist side by side, and a
 * browser is the only thing that normally understands them: the values are
 * `color-mix()` over `var()` over `oklch()`, several layers deep. Anything that
 * wants to *check* a token — contrast, separation, a theme's coverage — has to
 * resolve that chain itself, without a DOM.
 *
 * This module is that resolver plus the WCAG maths on top of it. It is a test
 * and tooling utility; nothing in the running app should import it.
 */

/** A colour that has been reduced to sRGB: channels 0-255, alpha 0-1. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const FULL = 255;

const WCAG_R = 0.2126;
const WCAG_G = 0.7152;
const WCAG_B = 0.0722;

/** WCAG's flare term, applied to both luminances before the ratio. */
const WCAG_FLARE = 0.05;

/** `oklch()` accepts chroma as a percentage, where 100% is this much chroma. */
const OKLCH_CHROMA_FULL = 0.4;

/** Half a 16-bit step: below this, an out-of-range channel is rounding noise. */
const GAMUT_EPSILON = 1 / 100000;

/** CSS Color 4's just-noticeable difference in OKLab, used by gamut mapping. */
const GAMUT_JND = 0.02;

const GAMUT_PRECISION = 0.0001;

/**
 * The only bare colour keywords the token sheets use, plus black for symmetry.
 * Spelled numerically because `check-design-consistency` bans quoted hex in
 * non-spec `.ts` files.
 */
const NAMED_COLORS: Record<string, Rgba> = {
  transparent: { r: 0, g: 0, b: 0, a: 0 },
  black: { r: 0, g: 0, b: 0, a: 1 },
  white: { r: FULL, g: FULL, b: FULL, a: 1 },
};

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

const collapseSpace = (value: string): string => value.replace(/\s+/g, " ").trim();

const srgbToLinear = (channel: number): number =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

const linearToSrgb = (channel: number): number =>
  channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;

/** Split on `separator`, ignoring separators nested inside parentheses. */
const splitTopLevel = (input: string, separator: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (char === separator && depth === 0) {
      parts.push(input.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(input.slice(start));
  return parts;
};

/** Matches only when the whole string is one function call, so `a b` is not one. */
const asFunctionCall = (value: string): { name: string; args: string } | null => {
  const head = /^([a-zA-Z][a-zA-Z0-9-]*)\(/.exec(value);
  if (!head) return null;
  const open = head[0].length - 1;
  let depth = 0;
  for (let i = open; i < value.length; i++) {
    if (value[i] === "(") depth++;
    else if (value[i] === ")") {
      depth--;
      if (depth === 0) {
        return i === value.length - 1
          ? { name: head[1].toLowerCase(), args: value.slice(open + 1, i) }
          : null;
      }
    }
  }
  return null;
};

const parseNumber = (token: string): number => {
  const parsed = Number.parseFloat(token);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const parseChannel = (token: string): number =>
  token.endsWith("%") ? (parseNumber(token) / 100) * FULL : parseNumber(token);

const parseAlpha = (token: string): number =>
  token.endsWith("%") ? parseNumber(token) / 100 : parseNumber(token);

const parseHex = (digits: string): Rgba | null => {
  if (!/^[0-9a-fA-F]+$/.test(digits)) return null;
  const short = digits.length === 3 || digits.length === 4;
  if (!short && digits.length !== 6 && digits.length !== 8) return null;
  const width = short ? 1 : 2;
  const at = (index: number): number => {
    const slice = digits.slice(index * width, index * width + width);
    return Number.parseInt(short ? slice + slice : slice, 16);
  };
  const hasAlpha = digits.length === 4 || digits.length === 8;
  return { r: at(0), g: at(1), b: at(2), a: hasAlpha ? at(3) / FULL : 1 };
};

/** Accepts both the legacy comma form and the modern `rgb(N N N / A)` form. */
const parseRgbArgs = (args: string): Rgba | null => {
  const slashed = splitTopLevel(collapseSpace(args), "/");
  if (slashed.length > 2) return null;
  const tokens = slashed[0].split(/[,\s]+/).filter(Boolean);
  if (tokens.length < 3 || tokens.length > 4) return null;
  if (tokens.length === 4 && slashed.length === 2) return null;
  const alphaToken = slashed[1] ?? (tokens.length === 4 ? tokens[3] : null);
  const channels = tokens.slice(0, 3).map(parseChannel);
  const alpha = alphaToken === null ? 1 : parseAlpha(alphaToken.trim());
  if (channels.some(Number.isNaN) || Number.isNaN(alpha)) return null;
  return {
    r: clamp(channels[0], 0, FULL),
    g: clamp(channels[1], 0, FULL),
    b: clamp(channels[2], 0, FULL),
    a: clamp(alpha, 0, 1),
  };
};

const oklabToLinearSrgb = (lightness: number, aAxis: number, bAxis: number): number[] => {
  const l = (lightness + 0.3963377774 * aAxis + 0.2158037573 * bAxis) ** 3;
  const m = (lightness - 0.1055613458 * aAxis - 0.0638541728 * bAxis) ** 3;
  const s = (lightness - 0.0894841775 * aAxis - 1.291485548 * bAxis) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
};

const linearSrgbToOklab = (linear: number[]): number[] => {
  const [red, green, blue] = linear;
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};

const inGamut = (linear: number[]): boolean =>
  linear.every((channel) => channel >= -GAMUT_EPSILON && channel <= 1 + GAMUT_EPSILON);

const clipToGamut = (linear: number[]): number[] => linear.map((c) => clamp(c, 0, 1));

const deltaEOk = (one: number[], two: number[]): number =>
  Math.hypot(one[0] - two[0], one[1] - two[1], one[2] - two[2]);

/**
 * CSS Color 4 gamut mapping: bisect chroma, and stop at the least-reduced
 * chroma whose channel-clipped form is still within a JND of the request.
 * Plain per-channel clipping alone shifts hue badly on saturated tokens
 * (oklch(64.6% 0.222 41.116) is orange, not the brown chroma reduction gives).
 */
const oklchToLinearSrgb = (lightness: number, chroma: number, hueDeg: number): number[] => {
  const radians = (hueDeg * Math.PI) / 180;
  const lab = (c: number): number[] => [lightness, c * Math.cos(radians), c * Math.sin(radians)];
  const at = (c: number): number[] => {
    const [l, aAxis, bAxis] = lab(c);
    return oklabToLinearSrgb(l, aAxis, bAxis);
  };
  if (lightness >= 1) return [1, 1, 1];
  if (lightness <= 0) return [0, 0, 0];
  if (inGamut(at(chroma))) return at(chroma);

  let clipped = clipToGamut(at(chroma));
  if (deltaEOk(linearSrgbToOklab(clipped), lab(chroma)) < GAMUT_JND) return clipped;
  let low = 0;
  let high = chroma;
  let lowInGamut = true;
  while (high - low > GAMUT_PRECISION) {
    const mid = (low + high) / 2;
    const linear = at(mid);
    if (lowInGamut && inGamut(linear)) {
      low = mid;
      continue;
    }
    clipped = clipToGamut(linear);
    const distance = deltaEOk(linearSrgbToOklab(clipped), lab(mid));
    if (distance >= GAMUT_JND) {
      high = mid;
    } else if (GAMUT_JND - distance < GAMUT_PRECISION) {
      return clipped;
    } else {
      lowInGamut = false;
      low = mid;
    }
  }
  return clipped;
};

const parseOklchArgs = (args: string): Rgba | null => {
  const slashed = splitTopLevel(collapseSpace(args), "/");
  if (slashed.length > 2) return null;
  const tokens = slashed[0].split(/[,\s]+/).filter(Boolean);
  if (tokens.length !== 3) return null;
  const lightness = tokens[0].endsWith("%") ? parseNumber(tokens[0]) / 100 : parseNumber(tokens[0]);
  const chroma = tokens[1].endsWith("%")
    ? (parseNumber(tokens[1]) / 100) * OKLCH_CHROMA_FULL
    : parseNumber(tokens[1]);
  const hue = parseNumber(tokens[2]);
  const alpha = slashed[1] === undefined ? 1 : parseAlpha(slashed[1].trim());
  if ([lightness, chroma, hue, alpha].some(Number.isNaN)) return null;
  const linear = oklchToLinearSrgb(clamp(lightness, 0, 1), Math.max(0, chroma), hue);
  const [r, g, b] = linear.map((channel) => clamp(linearToSrgb(clamp(channel, 0, 1)), 0, 1) * FULL);
  return { r, g, b, a: clamp(alpha, 0, 1) };
};

/** One side of a `color-mix()`: a colour and, optionally, its own percentage. */
const splitMixOperand = (operand: string): { color: string; percent: number | null } => {
  const text = collapseSpace(operand);
  const trailing = /\s([0-9.]+)%$/.exec(text);
  if (trailing) {
    return { color: text.slice(0, trailing.index).trim(), percent: parseNumber(trailing[1]) };
  }
  const leading = /^([0-9.]+)%\s/.exec(text);
  if (leading) {
    return { color: text.slice(leading[0].length).trim(), percent: parseNumber(leading[1]) };
  }
  return { color: text, percent: null };
};

const parseColorMixArgs = (
  args: string,
  scope: Map<string, string>,
  seen: Set<string>,
): Rgba | null => {
  const parts = splitTopLevel(args, ",");
  if (parts.length !== 3) return null;
  if (collapseSpace(parts[0]).toLowerCase() !== "in srgb") return null;
  const first = splitMixOperand(parts[1]);
  const second = splitMixOperand(parts[2]);
  const left = resolveValue(first.color, scope, seen);
  const right = resolveValue(second.color, scope, seen);
  if (!left || !right) return null;

  let leftPercent = first.percent;
  let rightPercent = second.percent;
  if (leftPercent === null && rightPercent === null) {
    leftPercent = 50;
    rightPercent = 50;
  } else if (leftPercent === null) leftPercent = 100 - (rightPercent as number);
  else if (rightPercent === null) rightPercent = 100 - leftPercent;
  const total = leftPercent + (rightPercent as number);
  if (total <= 0) return null;

  // Weighting is premultiplied, so mixing into `transparent` fades the colour
  // out instead of dragging it toward transparent's black.
  const leftWeight = leftPercent / total;
  const rightWeight = (rightPercent as number) / total;
  const alpha = leftWeight * left.a + rightWeight * right.a;
  // Clamped because un-premultiplying divides by the alpha it just multiplied
  // in, and a 70%-of-white mix lands a few ulps above 255 without it.
  const channel = (from: number, to: number): number =>
    alpha === 0
      ? 0
      : clamp((leftWeight * from * left.a + rightWeight * to * right.a) / alpha, 0, FULL);
  return {
    r: channel(left.r, right.r),
    g: channel(left.g, right.g),
    b: channel(left.b, right.b),
    a: clamp(alpha * (total < 100 ? total / 100 : 1), 0, 1),
  };
};

const resolveVarArgs = (
  args: string,
  scope: Map<string, string>,
  seen: Set<string>,
): Rgba | null => {
  const parts = splitTopLevel(args, ",");
  const name = parts[0].trim();
  const fallback = parts.length > 1 ? parts.slice(1).join(",").trim() : null;
  if (!name.startsWith("--")) return null;
  if (!seen.has(name)) {
    const value = scope.get(name);
    if (value !== undefined) {
      const resolved = resolveValue(value, scope, new Set(seen).add(name));
      if (resolved) return resolved;
    }
  }
  return fallback === null ? null : resolveValue(fallback, scope, seen);
};

function resolveValue(value: string, scope: Map<string, string>, seen: Set<string>): Rgba | null {
  const text = collapseSpace(value);
  if (!text) return null;
  const keyword = NAMED_COLORS[text.toLowerCase()];
  if (keyword) return { ...keyword };
  if (text.startsWith("#")) return parseHex(text.slice(1));
  const call = asFunctionCall(text);
  if (!call) return null;
  switch (call.name) {
    case "var":
      return resolveVarArgs(call.args, scope, seen);
    case "rgb":
    case "rgba":
      return parseRgbArgs(call.args);
    case "oklch":
      return parseOklchArgs(call.args);
    case "color-mix":
      return parseColorMixArgs(call.args, scope, seen);
    default:
      return null;
  }
}

/** Declarations at the block's own level; nested rules carry no tokens. */
function readDeclarations(body: string): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  let depth = 0;
  let start = 0;
  const push = (text: string): void => {
    const colon = text.indexOf(":");
    if (colon === -1) return;
    const name = text.slice(0, colon).trim();
    if (!name.startsWith("--")) return;
    // Prettier wraps long values across lines; without this every wrapped
    // `color-mix()` in the sheets would fail to parse.
    found.push([name, collapseSpace(text.slice(colon + 1))]);
  };
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (char === "{") {
      let nested = 1;
      let j = i + 1;
      while (j < body.length && nested > 0) {
        if (body[j] === "{") nested++;
        else if (body[j] === "}") nested--;
        j++;
      }
      i = j - 1;
      start = j;
    } else if (char === ";" && depth === 0) {
      push(body.slice(start, i));
      start = i + 1;
    }
  }
  push(body.slice(start));
  return found;
}

/**
 * Parse a self-contained CSS colour. `var()` needs a scope, so it resolves to
 * null here; use `resolveColor` for anything read out of a token sheet.
 */
export function parseColor(value: string): Rgba | null {
  return resolveValue(value, new Map(), new Set());
}

/** Composite `fg` over `bg` (source-over), returning the visible colour. */
export function composite(fg: Rgba, bg: Rgba): Rgba {
  const alpha = fg.a + bg.a * (1 - fg.a);
  if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const channel = (top: number, bottom: number): number =>
    clamp((top * fg.a + bottom * bg.a * (1 - fg.a)) / alpha, 0, FULL);
  return {
    r: channel(fg.r, bg.r),
    g: channel(fg.g, bg.g),
    b: channel(fg.b, bg.b),
    a: alpha,
  };
}

/** WCAG 2.x relative luminance. Alpha is ignored — composite first. */
export function relativeLuminance(color: Rgba): number {
  const [r, g, b] = [color.r, color.g, color.b].map((c) => srgbToLinear(clamp(c, 0, FULL) / FULL));
  return WCAG_R * r + WCAG_G * g + WCAG_B * b;
}

/**
 * WCAG 2.x contrast ratio, 1-21. BOTH colours must already be opaque: WCAG is defined on
 * composited pixels, so a translucent argument would yield a plausible, silently wrong
 * number. Composite over the real backdrop first — see `composite`.
 */
export function contrastRatio(fg: Rgba, bg: Rgba): number {
  if (fg.a < 1 || bg.a < 1) {
    throw new Error(
      `contrastRatio needs opaque colours; got alpha ${fg.a} on ${bg.a}. Composite first.`,
    );
  }
  const one = relativeLuminance(fg);
  const two = relativeLuminance(bg);
  const light = Math.max(one, two);
  const dark = Math.min(one, two);
  return (light + WCAG_FLARE) / (dark + WCAG_FLARE);
}

/** Resolve one token to a colour. Returns null for gradients and dead chains. */
export function resolveColor(name: string, scope: Map<string, string>): Rgba | null {
  const key = name.startsWith("--") ? name : `--${name}`;
  const value = scope.get(key);
  if (value === undefined) return null;
  return resolveValue(value, scope, new Set([key]));
}

/**
 * Read custom-property declarations out of raw token CSS, per theme.
 *
 * `@theme` blocks are skipped: Tailwind's registration pass restates every token
 * as `--color-x: var(--color-x)`, which is a self-reference that would shadow
 * the real declaration and collapse resolution to almost nothing.
 */
export function resolveTokens(cssSources: string[]): {
  light: Map<string, string>;
  dark: Map<string, string>;
} {
  const light = new Map<string, string>();
  const darkOverrides = new Map<string, string>();

  for (const source of cssSources) {
    const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
    let cursor = 0;
    while (cursor < css.length) {
      const open = css.indexOf("{", cursor);
      if (open === -1) break;
      const prelude = css.slice(cursor, open).trim();
      let depth = 1;
      let end = open + 1;
      while (end < css.length && depth > 0) {
        if (css[end] === "{") depth++;
        else if (css[end] === "}") depth--;
        end++;
      }
      cursor = end;
      if (/@(theme|font-face|keyframes|supports|media)\b/.test(prelude)) continue;
      // Variant blocks ([data-variant=...]) are opt-in states, not the theme baseline —
      // skip them BEFORE the dark test, or `.dark [data-variant]` overwrites the real
      // unscoped dark values (it sorts later in the sheet).
      if (prelude.includes("[data-")) continue;
      const darkBlock = prelude.includes(".dark");
      const target = darkBlock ? darkOverrides : light;
      for (const [name, value] of readDeclarations(css.slice(open + 1, end - 1))) {
        target.set(name, value);
      }
    }
  }

  const dark = new Map(light);
  for (const [name, value] of darkOverrides) dark.set(name, value);
  return { light, dark };
}
