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

import { invalidateChartTheme } from "@/utils/chartTheme";

/**
 * Run a light↔dark mode switch inside a View Transition so the whole page
 * cross-fades as one frame. Without this, elements that carry their own CSS
 * color transitions (inputs, selects, buttons) animate to the new theme a beat
 * after everything else snaps, which reads as a flash.
 *
 * Every DOM write of the switch (the `.dark` class toggle, store dispatch,
 * applyThemeColors) must happen inside `applyChanges` so the transition
 * captures them together.
 *
 * Applies instantly (no fade) when:
 * - the requested mode is already active — callers sync each other, and a
 *   second startViewTransition would cancel the fade already running;
 * - the View Transitions API is unavailable;
 * - the user prefers reduced motion.
 */
export const switchThemeMode = (mode: "light" | "dark", applyChanges: () => void): void => {
  const root = document.documentElement;
  const alreadyApplied = root.classList.contains("dark") === (mode === "dark");
  const doc = document as Document & {
    startViewTransition?: (callback: () => void) => {
      finished: Promise<void>;
    };
  };

  if (alreadyApplied) {
    applyChanges();
    return;
  }

  // Freeze per-element CSS transitions (inputs, buttons carry their own
  // `transition-colors`) while the switch is in flight, so every element snaps
  // to its final color inside the sweep instead of animating a beat behind the
  // rest of the page. The matching CSS lives in styles/tailwind.css.
  const freeze = () => root.classList.add("theme-switching");
  const unfreeze = () => root.classList.remove("theme-switching");

  if (
    typeof doc.startViewTransition !== "function" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    freeze();
    applyChanges();
    // Two frames: let the new colors paint before transitions re-enable.
    requestAnimationFrame(() => requestAnimationFrame(unfreeze));
    return;
  }

  // The visual itself (soft top→bottom curtain sweep) is defined entirely in
  // CSS on the ::view-transition pseudos in styles/tailwind.css.
  const transition = doc.startViewTransition(() => {
    freeze();
    applyChanges();
  });
  transition.finished.then(unfreeze, unfreeze);
};

/**
 * Resolve a design-token CSS custom property to its concrete value at runtime.
 *
 * Charts (ECharts options, SVG data-URI symbols, canvas) can't use CSS `var()` —
 * they need a literal color string. This reads the token from the document root
 * so the single source of truth stays the token layer (`lib/styles/tokens/*`),
 * not a hardcoded hex. `fallback` is returned when the token is unset or the DOM
 * is unavailable (SSR / unit tests), so callers still get a sensible value.
 *
 * @param token   - Token name, with or without the leading `--` (e.g. "--color-indigo-500")
 * @param fallback - Value to use if the token can't be read
 */
export const cssToken = (token: string, fallback: string): string => {
  if (typeof document === "undefined" || !document.documentElement) {
    return fallback;
  }
  const name = token.startsWith("--") ? token : `--${token}`;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
};

/**
 * Helper function to convert hex color to rgba
 * @param hex - Hex color code (e.g., "#3F7994")
 * @param opacity - Opacity value (1-10 scale, where 10 = fully opaque)
 * @returns RGBA color string
 */
export const hexToRgba = (hex: string, opacity: number): string => {
  hex = hex.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const alpha = opacity / 10; // Convert 1-10 scale to 0.1-1.0
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

/**
 * Mix two colors together (similar to CSS color-mix)
 * @param color1 - First hex color code (e.g., "#3F7994")
 * @param color2 - Second hex color code (e.g., "#FFFFFF")
 * @param percentage - Percentage of color1 (0-100, where 100 = fully color1)
 * @returns Hex color string of the mixed result
 */
export const mixColors = (color1: string, color2: string, percentage: number): string => {
  color1 = color1.replace("#", "");
  color2 = color2.replace("#", "");

  const r1 = parseInt(color1.substring(0, 2), 16);
  const g1 = parseInt(color1.substring(2, 4), 16);
  const b1 = parseInt(color1.substring(4, 6), 16);

  const r2 = parseInt(color2.substring(0, 2), 16);
  const g2 = parseInt(color2.substring(2, 4), 16);
  const b2 = parseInt(color2.substring(4, 6), 16);

  const ratio = percentage / 100;
  const r = Math.round(r1 * ratio + r2 * (1 - ratio));
  const g = Math.round(g1 * ratio + g2 * (1 - ratio));
  const b = Math.round(b1 * ratio + b2 * (1 - ratio));

  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
};

export interface SemanticColors {
  error: string; // coral hex, e.g. "#F45B49"
  errorBg: string; // coral tint bg, e.g. "#FEF0EE"
  errorText: string; // dark coral for text, e.g. "#C0392B"
  success: string; // emerald hex, e.g. "#5ACA7A"
  successBg: string; // emerald tint bg, e.g. "#EAF9EF"
  successText: string; // dark emerald for text, e.g. "#208A3C"
  secondaryBtnBg: string;
  secondaryBtnText: string;
  secondaryBtnBorder: string;
  // Outline + ghost button tinting — makes Cancel, Builder/SQL, icon buttons use primary color
  outlineText?: string;
  outlineBorder?: string;
  ghostText?: string;
}

/**
 * Generate a full primary color palette from a single base hex color.
 * The base color is treated as the 600 shade; lighter shades are mixed
 * towards white, darker shades towards black.
 */
const generatePrimaryPalette = (baseHex: string): Record<string, string> => {
  return {
    "50": mixColors(baseHex, "#ffffff", 5),
    "100": mixColors(baseHex, "#ffffff", 15),
    "200": mixColors(baseHex, "#ffffff", 30),
    "300": mixColors(baseHex, "#ffffff", 50),
    "400": mixColors(baseHex, "#ffffff", 70),
    "500": mixColors(baseHex, "#ffffff", 85),
    "600": baseHex,
    "700": mixColors(baseHex, "#000000", 80),
    "800": mixColors(baseHex, "#000000", 60),
    "900": mixColors(baseHex, "#000000", 40),
    // 950 continues the linear −20 step (700:80 → 800:60 → 900:40 → 950:20).
    // dark.css consumes --color-primary-950 for two surfaces. For the default
    // #3F7994 base, 20% reproduces the stock teal #0d181e (13/63 ≈ 0.20).
    "950": mixColors(baseHex, "#000000", 20),
  };
};

/**
 * Sync the O2 component-library design tokens (--color-primary-*)
 * with the current custom theme color so all O2 components pick it up.
 */
const syncO2LibraryTokens = (themeColor: string): void => {
  const palette = generatePrimaryPalette(themeColor);
  const root = document.documentElement;
  for (const [shade, hex] of Object.entries(palette)) {
    root.style.setProperty(`--color-primary-${shade}`, hex);
  }
};

/**
 * Apply theme colors directly to CSS variables
 * @param themeColor - Hex color code for the theme
 * @param mode - Theme mode ("light" or "dark")
 * @param isDefault - Whether this is the default theme
 */
export const applyThemeColors = (
  themeColor: string,
  mode: "light" | "dark",
  isDefault: boolean = false,
  semanticColors?: SemanticColors,
) => {
  const darkModeActive = mode === "dark";

  // Toggle .dark class on <html> for the O2 component library (Tailwind dark
  // variant). `.dark` on <html> is the single dark-mode signal.
  document.documentElement.classList.toggle("dark", darkModeActive);

  // Sync O2 library tokens with the custom theme color.
  // When using the default theme, clear any previously-set inline primary palette so
  // the CSS token values in base.css take effect (inline styles beat stylesheets).
  if (isDefault) {
    const root = document.documentElement;
    ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"].forEach(
      (shade) => {
        root.style.removeProperty(`--color-primary-${shade}`);
      },
    );
  } else {
    syncO2LibraryTokens(themeColor);
  }

  if (darkModeActive) {
    // Apply dark mode theme color
    const rgbaColor = hexToRgba(themeColor, 10);
    document.body.style.setProperty("--color-theme-accent", rgbaColor);

    // Apply table header background color (80% theme color mixed with 20% black for dark mode)
    const tableHeaderBg = mixColors(themeColor, "#000000", 40);
    document.body.style.setProperty("--color-theme-table-header-bg", tableHeaderBg);

    // Apply tab background colors for dark mode
    // --color-theme-tab-bg: 20% white + 80% theme color (inverted from light mode)
    const tabBg = hexToRgba(themeColor, 3); // 0.8 alpha (80% theme color)
    document.body.style.setProperty("--color-theme-tab-bg", tabBg);

    // --color-theme-tab-bg-inactive: 10% theme color mixed with dark background
    const inactiveTabBg = hexToRgba(themeColor, 1); // 0.1 alpha (10% theme color)
    document.body.style.setProperty("--color-theme-tab-bg-inactive", inactiveTabBg);

    // // Apply header menu background color for dark mode (30% theme color)
    // const headerMenuBg = hexToRgba(themeColor, 2); // 0.3 alpha (30% theme color)
    // document.body.style.setProperty('--color-theme-header-menu-bg', headerMenuBg);

    // Apply menu gradient colors
    if (isDefault) {
      // Use default menu gradient colors
      document.body.style.setProperty(
        "--color-theme-menu-gradient-start",
        "rgba(89, 155, 174, 0.3)",
      );
      document.body.style.setProperty("--color-theme-menu-gradient-end", "rgba(48, 193, 233, 0.3)");
      // Use default menu color for dark mode
      document.body.style.setProperty("--color-theme-menu-color", "#FFFFFF");
    } else {
      // Calculate menu gradient from theme color
      const menuGradientStart = hexToRgba(themeColor, 3); // 0.3 alpha (30%)
      const menuGradientEnd = hexToRgba(themeColor, 3); // 0.3 alpha (30%)
      document.body.style.setProperty("--color-theme-menu-gradient-start", menuGradientStart);
      document.body.style.setProperty("--color-theme-menu-gradient-end", menuGradientEnd);
      // Use theme color as menu color for dark mode
      document.body.style.setProperty("--color-theme-menu-color", themeColor);
    }

    // Clear light mode variables
    document.documentElement.style.removeProperty("--color-theme-accent");
    document.documentElement.style.removeProperty("--color-theme-body-bg-primary");
    document.documentElement.style.removeProperty("--color-theme-body-bg-secondary");
    document.documentElement.style.removeProperty("--color-theme-table-header-bg");
    document.documentElement.style.removeProperty("--color-theme-tab-bg");
    document.documentElement.style.removeProperty("--color-theme-tab-bg-inactive");
    document.documentElement.style.removeProperty("--color-theme-header-menu-bg");
    document.documentElement.style.removeProperty("--color-theme-menu-gradient-start");
    document.documentElement.style.removeProperty("--color-theme-menu-gradient-end");
    document.documentElement.style.removeProperty("--color-theme-menu-color");
    // Page background = a single near-black color with a subtle theme tint (no
    // gradient), mirroring the light-mode single-tint treatment.
    const darkBodyBg = mixColors(themeColor, "#000000", 8); // 8% theme + 92% black
    document.body.style.setProperty("background", darkBodyBg, "important");
  } else {
    // Apply light mode theme color
    const rgbaColor = hexToRgba(themeColor, 10);
    document.documentElement.style.setProperty("--color-theme-accent", rgbaColor);

    // Auto-calculate and apply background colors based on theme color.
    // primaryBg (1%) is reused as a subtle surface tint by other components
    // (QueryInspector, .bg-white) — keep it. secondaryBg is the far stop of the
    // page-background gradient on alerts/AddDestination.vue + alerts/AddTemplate.vue.
    const primaryBg = hexToRgba(themeColor, 0.1); // 0.01 alpha (1%)
    const secondaryBg = hexToRgba(themeColor, 4); // 0.4 alpha (40%)

    document.documentElement.style.setProperty("--color-theme-body-bg-primary", primaryBg);
    document.documentElement.style.setProperty("--color-theme-body-bg-secondary", secondaryBg);

    // Page background = a single, subtle primary tint (no gradient) so the muted
    // area around the white content card reads as one calm color — matching the
    // page chrome (surface-chrome = primary-100).
    const bodyBg = hexToRgba(themeColor, 0.5); // ~0.05 alpha — a calm, barely-tinted backdrop
    document.body.style.setProperty("background", bodyBg, "important");

    // Apply table header background color (80% theme color mixed with 20% white)
    const tableHeaderBg = mixColors(themeColor, "#FFFFFF", 30);
    document.documentElement.style.setProperty("--color-theme-table-header-bg", tableHeaderBg);

    // Apply tab background colors for light mode
    // --color-theme-tab-bg: 20% theme color + 80% white
    const tabBg = hexToRgba(themeColor, 2); // 0.2 alpha (20% theme color)
    document.documentElement.style.setProperty("--color-theme-tab-bg", tabBg);

    // --color-theme-tab-bg-inactive: 10% theme color + 90% white
    const inactiveTabBg = hexToRgba(themeColor, 1); // 0.1 alpha (10% theme color)
    document.documentElement.style.setProperty("--color-theme-tab-bg-inactive", inactiveTabBg);

    // Apply menu gradient colors
    if (isDefault) {
      // Use default menu gradient colors
      document.documentElement.style.setProperty(
        "--color-theme-menu-gradient-start",
        "rgba(89, 175, 199, 0.3)",
      );
      document.documentElement.style.setProperty(
        "--color-theme-menu-gradient-end",
        "rgba(48, 193, 233, 0.3)",
      );
      // Use default menu color for light mode
      document.documentElement.style.setProperty("--color-theme-menu-color", "#3F7994");
    } else {
      // Calculate menu gradient from theme color
      const menuGradientStart = hexToRgba(themeColor, 3); // 0.3 alpha (30%)
      const menuGradientEnd = hexToRgba(themeColor, 3); // 0.3 alpha (30%)
      document.documentElement.style.setProperty(
        "--color-theme-menu-gradient-start",
        menuGradientStart,
      );
      document.documentElement.style.setProperty(
        "--color-theme-menu-gradient-end",
        menuGradientEnd,
      );
      // Use theme color as menu color for light mode
      document.documentElement.style.setProperty("--color-theme-menu-color", themeColor);
    }

    // Clear dark mode variables
    document.body.style.removeProperty("--color-theme-accent");
    document.body.style.removeProperty("--color-theme-table-header-bg");
    document.body.style.removeProperty("--color-theme-tab-bg");
    document.body.style.removeProperty("--color-theme-tab-bg-inactive");
    document.body.style.removeProperty("--color-theme-header-menu-bg");
    document.body.style.removeProperty("--color-theme-menu-gradient-start");
    document.body.style.removeProperty("--color-theme-menu-gradient-end");
    document.body.style.removeProperty("--color-theme-menu-color");
  }

  // Apply semantic colors (O2 Signature triadic theme and any future multi-color themes)
  const semanticTokenNames = [
    "--color-status-negative",
    "--color-status-error-text",
    "--color-status-error-bg",
    "--color-status-positive",
    "--color-status-success-text",
    "--color-status-success-bg",
    "--color-button-secondary",
    "--color-button-secondary-foreground",
    "--color-button-secondary-border",
    "--color-button-outline-text",
    "--color-button-outline-border",
    "--color-button-ghost-text",
  ];
  if (semanticColors) {
    // Clear both targets first to avoid stale values from a prior mode switch
    semanticTokenNames.forEach((t) => {
      document.body.style.removeProperty(t);
      document.documentElement.style.removeProperty(t);
    });
    const target = darkModeActive ? document.body : document.documentElement;
    target.style.setProperty("--color-status-negative", semanticColors.error);
    target.style.setProperty("--color-status-error-text", semanticColors.errorText);
    target.style.setProperty("--color-status-error-bg", semanticColors.errorBg);
    target.style.setProperty("--color-status-positive", semanticColors.success);
    target.style.setProperty("--color-status-success-text", semanticColors.successText);
    target.style.setProperty("--color-status-success-bg", semanticColors.successBg);
    target.style.setProperty("--color-button-secondary", semanticColors.secondaryBtnBg);
    target.style.setProperty(
      "--color-button-secondary-foreground",
      semanticColors.secondaryBtnText,
    );
    target.style.setProperty("--color-button-secondary-border", semanticColors.secondaryBtnBorder);
    if (semanticColors.outlineText)
      target.style.setProperty("--color-button-outline-text", semanticColors.outlineText);
    if (semanticColors.outlineBorder)
      target.style.setProperty("--color-button-outline-border", semanticColors.outlineBorder);
    if (semanticColors.ghostText)
      target.style.setProperty("--color-button-ghost-text", semanticColors.ghostText);
  } else {
    semanticTokenNames.forEach((t) => {
      document.documentElement.style.removeProperty(t);
      document.body.style.removeProperty(t);
    });
  }

  // Invalidate the resolved-token cache so charts read fresh values on theme change.
  invalidateChartTheme();

  // Dispatch event to notify components (like SearchResult) to re-render
  window.dispatchEvent(new CustomEvent("themeColorChanged"));
};
