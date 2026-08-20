// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import OGlyph from "./OGlyph.vue";
import { GLYPH_REGISTRY, glyphToken, resolveGlyph, isGlyphToken } from "./glyphRegistry";

describe("OGlyph", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("should render a Unicode emoji as text", () => {
    wrapper = mount(OGlyph, { props: { token: "🚀" } });
    expect(wrapper.find('[data-test="glyph-emoji"]').text()).toBe("🚀");
    expect(wrapper.find('[data-test="glyph-svg"]').exists()).toBe(false);
  });

  it("should render a registry token as an inline svg", () => {
    wrapper = mount(OGlyph, { props: { token: "o2:redis" } });
    expect(wrapper.find("svg").exists()).toBe(true);
    expect(wrapper.find('[data-test="glyph-emoji"]').exists()).toBe(false);
  });

  it("should render an asset-backed glyph as an image", () => {
    wrapper = mount(OGlyph, { props: { token: "o2:telegraf" } });
    const img = wrapper.find('[data-test="glyph-img"]');
    expect(img.exists()).toBe(true);
    expect(img.attributes("src")).toBeTruthy();
    expect(img.attributes("loading")).toBe("lazy");
  });

  it("should back colour glyphs with the theme-owned plate, not a dark: class", () => {
    // Brand logos keep their own colours, so legibility on dark comes from the
    // --color-glyph-plate token flipping, not from a per-component conditional.
    wrapper = mount(OGlyph, { props: { token: "o2:redis" } });
    const plate = wrapper.find('[data-test="glyph-plate"]');
    expect(plate.classes()).toContain("bg-glyph-plate");
    expect(plate.classes().join(" ")).not.toContain("dark:");
  });

  it("should not put a plate behind a plain emoji", () => {
    wrapper = mount(OGlyph, { props: { token: "🚀" } });
    expect(wrapper.find('[data-test="glyph-plate"]').exists()).toBe(false);
  });

  it("should render nothing for an empty token", () => {
    wrapper = mount(OGlyph, { props: { token: null } });
    expect(wrapper.find('[data-test="glyph-emoji"]').exists()).toBe(false);
    expect(wrapper.find("svg").exists()).toBe(false);
  });

  it("should render nothing — not the raw string — for a retired glyph token", () => {
    wrapper = mount(OGlyph, { props: { token: "o2:no-such-glyph" } });
    expect(wrapper.text()).toBe("");
  });

  it("should size emoji by font-size and glyphs by box, from one scale", () => {
    wrapper = mount(OGlyph, { props: { token: "🚀", size: "sm" } });
    expect(wrapper.find('[data-test="glyph-emoji"]').classes()).toContain("text-sm");
    wrapper.unmount();

    wrapper = mount(OGlyph, { props: { token: "o2:redis", size: "sm" } });
    expect(wrapper.find("svg").classes()).toContain("size-3.5");
  });

  it("should mark the icon decorative, since the label carries the meaning", () => {
    wrapper = mount(OGlyph, { props: { token: "🚀" } });
    expect(wrapper.find('[data-test="glyph-emoji"]').attributes("aria-hidden")).toBe("true");
  });
});

describe("glyphRegistry", () => {
  it("should resolve every registered name", () => {
    for (const name of Object.keys(GLYPH_REGISTRY)) {
      expect(resolveGlyph(`o2:${name}`)).toBeTruthy();
    }
  });

  // A wordmark lockup ("icon + brand name") letterboxes to an illegible smear
  // in a 14px square, so prefer the icon-only variant — in the logos collection
  // that is usually a `-icon` sibling. Measured from the rendered viewBox, so it
  // checks what actually ships rather than the import name.
  it("should use icon-only marks, not wordmark lockups", () => {
    // Brands whose ONLY official mark is inherently wide — there is no
    // icon-only variant to switch to, so these are accepted as-is.
    const INHERENTLY_WIDE = new Set(["sqlite", "cloudflare", "saphana", "aws", "curl"]);
    const MAX_RATIO = 1.6;

    const offenders: string[] = [];
    for (const name of Object.keys(GLYPH_REGISTRY)) {
      if (INHERENTLY_WIDE.has(name)) continue;
      const w = mount(OGlyph, { props: { token: `o2:${name}` } });
      const svg = w.find("svg");
      // Image-backed glyphs render an <img>, so there is no viewBox to measure.
      const viewBox = svg.exists() ? svg.attributes("viewBox") : undefined;
      w.unmount();
      if (!viewBox) continue;
      const [, , vw, vh] = viewBox.split(/\s+/).map(Number);
      if (vh > 0 && vw / vh > MAX_RATIO) offenders.push(`${name} (${(vw / vh).toFixed(2)})`);
    }
    expect(offenders).toEqual([]);
  });

  it("should build tokens with the o2 prefix", () => {
    expect(glyphToken("redis")).toBe("o2:redis");
  });

  it("should not resolve emoji or unknown names", () => {
    expect(resolveGlyph("🚀")).toBeNull();
    expect(resolveGlyph("o2:nope")).toBeNull();
    expect(resolveGlyph(null)).toBeNull();
  });

  it("should identify glyph tokens by prefix regardless of registration", () => {
    expect(isGlyphToken("o2:redis")).toBe(true);
    expect(isGlyphToken("o2:retired")).toBe(true);
    expect(isGlyphToken("🚀")).toBe(false);
    expect(isGlyphToken(null)).toBe(false);
  });
});
