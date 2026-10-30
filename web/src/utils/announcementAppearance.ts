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

// Shared by the live bar, the settings preview and the editor so all three paint a banner alike.

import { BANNER_COLOR_PRESETS } from "@/constants/themes";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { Props as OBannerProps } from "@/lib/feedback/Banner/OBanner.vue";
import type { BannerVariantName } from "@/utils/announcementOrder";
import { pickReadableForeground } from "@/utils/theme";

export type BannerTextSize = "small" | "medium" | "large";

export type BannerThemeMode = "light" | "dark";

/** Background per theme mode; a missing mode keeps the severity's own colours. */
export interface BannerColors {
  light?: string;
  dark?: string;
}

export interface ResolvedBannerColors {
  background: string;
  text: string;
}

export const TEXT_SIZES: BannerTextSize[] = ["small", "medium", "large"];

/** Mirrors `BANNER_ICONS` on the server, which rejects anything else. */
export const BANNER_ICONS: IconName[] = [
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
];

export const DEFAULT_TEXT_SIZE: BannerTextSize = "medium";

/** Colour choices in the editor besides a preset key. */
export const DEFAULT_CHOICE = "default";
export const CUSTOM_CHOICE = "custom";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

export function isBannerIcon(value: unknown): value is IconName {
  return BANNER_ICONS.includes(value as IconName);
}

export function isTextSize(value: unknown): value is BannerTextSize {
  return TEXT_SIZES.includes(value as BannerTextSize);
}

/** The colours to paint for `mode`, or undefined to fall back to the severity's tokens. */
export function bannerColorsFor(
  colors: BannerColors | null | undefined,
  mode: BannerThemeMode,
): ResolvedBannerColors | undefined {
  const background = colors?.[mode];
  if (!isHexColor(background)) return undefined;

  return { background, text: pickReadableForeground(background) };
}

/** The preset a light/dark pair came from, so a saved banner re-opens on its swatch. */
export function presetKeyFor(light: string, dark: string): string | undefined {
  return BANNER_COLOR_PRESETS.find(
    (preset) =>
      preset.light.toLowerCase() === light.toLowerCase() &&
      preset.dark.toLowerCase() === dark.toLowerCase(),
  )?.key;
}

/** Which swatch an authored light/dark pair re-opens on. */
export function colorChoiceFor(light: string, dark: string): string {
  if (!light && !dark) return DEFAULT_CHOICE;
  return presetKeyFor(light, dark) ?? CUSTOM_CHOICE;
}

/** Our severities are operator-facing; OBanner's variants are visual. */
export function bannerVariant(variant?: BannerVariantName | string): OBannerProps["variant"] {
  switch (variant) {
    case "critical":
      return "error";
    case "warning":
      return "warning";
    case "info":
      return "info";
    default:
      return "default";
  }
}

/** The authored icon when it is one we can draw, else the severity's own. */
export function bannerIcon(variant?: BannerVariantName | string, icon?: string | null): IconName {
  if (isBannerIcon(icon)) return icon;
  switch (variant) {
    case "critical":
      return "error";
    case "warning":
      return "warning";
    case "promo":
      return "campaign";
    default:
      return "info";
  }
}
