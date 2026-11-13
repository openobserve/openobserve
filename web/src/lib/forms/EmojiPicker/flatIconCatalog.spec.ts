// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { iconRegistry } from "@/lib/core/Icon/OIcon.icons";
import {
  FLAT_ICONS,
  FLAT_ICON_GROUPS,
  flatIconToken,
  isUnresolvedFlatToken,
  resolveFlatIcon,
} from "./flatIconCatalog";
import { MONO_LOGO_REGISTRY, monoLogoToken, resolveMonoLogo } from "./monoLogoRegistry";
import { GLYPH_REGISTRY } from "./glyphRegistry";
import { ALL_EMOJIS, EMOJI_GROUPS } from "./emojiCatalog";

describe("flatIconCatalog", () => {
  it("should only offer names the OIcon registry has", () => {
    const missing = FLAT_ICONS.map(({ name }) => name).filter((name) => !(name in iconRegistry));
    expect(missing).toEqual([]);
  });

  it("should never repeat an icon or give a keyword two owners", () => {
    const names = FLAT_ICONS.map(({ name }) => name);
    expect(new Set(names).size).toBe(names.length);
    const keywords = FLAT_ICONS.flatMap(({ keywords }) => keywords);
    const repeated = keywords.filter((keyword, i) => keywords.indexOf(keyword) !== i);
    expect(repeated).toEqual([]);
  });

  it("should use lowercase keywords with no whitespace, as the matcher assumes", () => {
    for (const option of FLAT_ICON_GROUPS.flatMap((group) => group.emojis)) {
      for (const keyword of option.keywords) {
        expect(keyword).toBe(keyword.toLowerCase());
        expect(keyword).not.toMatch(/\s/);
      }
    }
  });

  it("should offer a useful spread of folder icons", () => {
    expect(FLAT_ICONS.length).toBeGreaterThanOrEqual(60);
    expect(FLAT_ICONS.length).toBeLessThanOrEqual(100);
  });

  it("should resolve flat tokens and reject unknown or foreign ones", () => {
    expect(resolveFlatIcon(flatIconToken("dashboard"))).toBe("dashboard");
    expect(resolveFlatIcon("icon:no-such-icon")).toBeNull();
    expect(resolveFlatIcon("icon:constructor")).toBeNull();
    expect(resolveFlatIcon("o2:redis")).toBeNull();
    expect(resolveFlatIcon("🚀")).toBeNull();
  });

  it("should flag only unresolvable icon:/mono: tokens for fallback", () => {
    expect(isUnresolvedFlatToken("icon:no-such-icon")).toBe(true);
    expect(isUnresolvedFlatToken("mono:no-such-logo")).toBe(true);
    expect(isUnresolvedFlatToken("icon:dashboard")).toBe(false);
    expect(isUnresolvedFlatToken("mono:docker")).toBe(false);
    expect(isUnresolvedFlatToken("🚀")).toBe(false);
    expect(isUnresolvedFlatToken("o2:retired")).toBe(false);
    expect(isUnresolvedFlatToken(null)).toBe(false);
  });

  it("should not collide with the emoji catalog's group ids", () => {
    const emojiIds = new Set(["results", ...EMOJI_GROUPS.map((group) => group.id)]);
    for (const group of FLAT_ICON_GROUPS) expect(emojiIds.has(group.id)).toBe(false);
  });
});

describe("monoLogoRegistry", () => {
  it("should only carry services the colour glyph registry also has", () => {
    const orphans = Object.keys(MONO_LOGO_REGISTRY).filter((name) => !(name in GLYPH_REGISTRY));
    expect(orphans).toEqual([]);
  });

  it("should offer every mono logo with its colour glyph's keywords", () => {
    const monoGroup = FLAT_ICON_GROUPS.find((group) => group.id === "monoLogos")!;
    for (const name of Object.keys(MONO_LOGO_REGISTRY) as (keyof typeof MONO_LOGO_REGISTRY)[]) {
      const option = monoGroup.emojis.find((entry) => entry.token === monoLogoToken(name));
      const colour = ALL_EMOJIS.find((entry) => entry.token === `o2:${name}`);
      expect(option?.keywords).toEqual(colour?.keywords);
    }
  });

  it("should resolve known mono tokens and reject unknown ones", () => {
    expect(resolveMonoLogo("mono:docker")).toBeTruthy();
    expect(resolveMonoLogo("mono:no-such-logo")).toBeNull();
    expect(resolveMonoLogo("mono:toString")).toBeNull();
    expect(resolveMonoLogo("o2:docker")).toBeNull();
  });
});
