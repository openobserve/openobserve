import { describe, it, expect, beforeEach } from "vitest";
import { applyThemeColors, cssToken } from "./theme";
import type { SemanticColors } from "./theme";

describe("cssToken", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("style");
  });

  it("returns the resolved token value when the custom property is set", () => {
    document.documentElement.style.setProperty("--color-indigo-500", "#6366f1");
    expect(cssToken("--color-indigo-500", "#000000")).toBe("#6366f1");
  });

  it("accepts a token name without the leading --", () => {
    document.documentElement.style.setProperty("--color-indigo-300", "#a5b4fc");
    expect(cssToken("color-indigo-300", "#000000")).toBe("#a5b4fc");
  });

  it("returns the fallback when the token is unset", () => {
    expect(cssToken("--color-does-not-exist", "#deadbe")).toBe("#deadbe");
  });
});

const SEMANTIC: SemanticColors = {
  error: "#F45B49",
  errorBg: "#FEF0EE",
  errorText: "#C0392B",
  success: "#5ACA7A",
  successBg: "#EAF9EF",
  successText: "#208A3C",
  secondaryBtnBg: "#EFF1FD",
  secondaryBtnText: "#575FC5",
  secondaryBtnBorder: "#C8D0F9",
};

describe("applyThemeColors with semanticColors", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("style");
    document.body.removeAttribute("style");
    document.body.className = "";
    document.documentElement.className = "";
  });

  it("sets semantic tokens on documentElement in light mode", () => {
    applyThemeColors("#6B76E3", "light", false, SEMANTIC);
    const style = document.documentElement.style;
    expect(style.getPropertyValue("--color-status-negative")).toBe("#F45B49");
    expect(style.getPropertyValue("--color-status-positive")).toBe("#5ACA7A");
    expect(style.getPropertyValue("--color-button-secondary")).toBe("#EFF1FD");
    expect(style.getPropertyValue("--color-button-secondary-foreground")).toBe("#575FC5");
    expect(style.getPropertyValue("--color-button-secondary-border")).toBe("#C8D0F9");
  });

  it("sets semantic tokens on body in dark mode", () => {
    applyThemeColors("#8B8DF0", "dark", false, SEMANTIC);
    const style = document.body.style;
    expect(style.getPropertyValue("--color-status-negative")).toBe("#F45B49");
    expect(style.getPropertyValue("--color-status-positive")).toBe("#5ACA7A");
    expect(style.getPropertyValue("--color-button-secondary")).toBe("#EFF1FD");
  });

  it("clears semantic tokens from both targets when semanticColors is omitted", () => {
    applyThemeColors("#6B76E3", "light", false, SEMANTIC);
    applyThemeColors("#7678ed", "light", false);
    expect(document.documentElement.style.getPropertyValue("--color-status-negative")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--color-button-secondary")).toBe("");
    expect(document.body.style.getPropertyValue("--color-status-negative")).toBe("");
  });

  it("does not set semantic tokens when semanticColors is absent", () => {
    applyThemeColors("#7678ed", "light", false);
    expect(document.documentElement.style.getPropertyValue("--color-theme-accent")).not.toBe("");
    expect(document.documentElement.style.getPropertyValue("--color-status-negative")).toBe("");
  });

  it("clears stale body tokens when switching from dark to light with semanticColors", () => {
    applyThemeColors("#8B8DF0", "dark", false, SEMANTIC);
    expect(document.body.style.getPropertyValue("--color-status-negative")).toBe("#F45B49");
    applyThemeColors("#6B76E3", "light", false, SEMANTIC);
    expect(document.body.style.getPropertyValue("--color-status-negative")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--color-status-negative")).toBe(
      "#F45B49",
    );
  });
});

describe("applyThemeColors button-primary-foreground contrast", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("style");
    document.body.removeAttribute("style");
  });

  it("switches to dark text when the theme color is too light for white text (O2 Signature dark, #8B8DF0 vs white = 2.93:1)", () => {
    applyThemeColors("#8B8DF0", "dark", false);
    expect(
      document.documentElement.style.getPropertyValue("--color-button-primary-foreground"),
    ).toBe("#171717");
  });

  it("keeps white text when the theme color is dark enough (O2 Pulse, #3F7994 vs white = 4.8:1)", () => {
    applyThemeColors("#3F7994", "dark", false);
    expect(
      document.documentElement.style.getPropertyValue("--color-button-primary-foreground"),
    ).toBe("#FFFFFF");
  });

  it("clears the override for the default theme so the stylesheet value applies", () => {
    applyThemeColors("#8B8DF0", "dark", false);
    applyThemeColors("#8B8DF0", "dark", true);
    expect(
      document.documentElement.style.getPropertyValue("--color-button-primary-foreground"),
    ).toBe("");
  });
});
