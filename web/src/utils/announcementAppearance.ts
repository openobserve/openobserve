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

export type BannerTextSize = "small" | "medium" | "large";

export type ThemeMode = "light" | "dark";

/** Banner background per theme mode, as `#RRGGBB`. */
export interface BannerColors {
  light?: string;
  dark?: string;
}

export interface BannerColorPreset {
  key: string;
  light: string;
  dark: string;
}

export const TEXT_SIZES: BannerTextSize[] = ["small", "medium", "large"];

export const DEFAULT_TEXT_SIZE: BannerTextSize = "medium";

/** Mirrors `BANNER_ICONS` on the server, which rejects anything else. */
export const BANNER_ICONS = [
  "info",
  "warning",
  "error",
  "campaign",
  "build",
  "schedule",
  "rocket-launch",
  "lightbulb",
  "security",
  "update",
] as const;

export type BannerIcon = (typeof BANNER_ICONS)[number];

export const LIGHT_TEXT = "#FFFFFF";

export const DARK_TEXT = "#171717";

export const COLOR_PRESETS: BannerColorPreset[] = [
  { key: "blue", light: "#DBEAFE", dark: "#1E3A8A" },
  { key: "indigo", light: "#E0E7FF", dark: "#312E81" },
  { key: "teal", light: "#CCFBF1", dark: "#134E4A" },
  { key: "green", light: "#DCFCE7", dark: "#14532D" },
  { key: "amber", light: "#FEF3C7", dark: "#78350F" },
  { key: "red", light: "#FEE2E2", dark: "#7F1D1D" },
  { key: "purple", light: "#F3E8FF", dark: "#581C87" },
  { key: "slate", light: "#1E293B", dark: "#E2E8F0" },
  { key: "brand", light: "#2563EB", dark: "#3B82F6" },
];

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

export function isBannerIcon(value: unknown): value is BannerIcon {
  return BANNER_ICONS.includes(value as BannerIcon);
}

/** The Material icon name Quasar's `q-icon` expects; the stored names are kebab-case. */
export function materialIconName(icon: BannerIcon): string {
  return icon.replace(/-/g, "_");
}

export function isTextSize(value: unknown): value is BannerTextSize {
  return TEXT_SIZES.includes(value as BannerTextSize);
}

/** The preset whose light/dark pair equals these hexes, ignoring case. */
export function presetFor(light: string, dark: string): BannerColorPreset | undefined {
  return COLOR_PRESETS.find(
    (preset) =>
      preset.light.toUpperCase() === light.toUpperCase() &&
      preset.dark.toUpperCase() === dark.toUpperCase(),
  );
}

function channelLuminance(channel: number): number {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a `#RRGGBB` colour. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

/** White or near-black text, whichever contrasts more with the background. */
export function textColorFor(background: string): string {
  return contrastRatio(background, LIGHT_TEXT) >= contrastRatio(background, DARK_TEXT)
    ? LIGHT_TEXT
    : DARK_TEXT;
}

/** The authored background for a mode, or undefined to fall back to the variant's fill. */
export function backgroundFor(
  colors: BannerColors | null | undefined,
  mode: ThemeMode,
): string | undefined {
  const value = colors?.[mode];
  return isHexColor(value) ? value : undefined;
}

/** CSS custom properties carrying the authored colours for a mode, or undefined for severity styling. */
export function bannerColorVars(
  colors: BannerColors | null | undefined,
  mode: ThemeMode,
): Record<string, string> | undefined {
  const background = backgroundFor(colors, mode);
  if (!background) return undefined;
  return {
    "--announcement-bg": background,
    "--announcement-fg": textColorFor(background),
  };
}
