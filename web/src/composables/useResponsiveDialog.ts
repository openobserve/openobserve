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

import { computed } from "vue";
import { useScreen } from "./useScreen";

/**
 * Composable for making q-dialog/q-card pairs responsive on mobile.
 *
 * Usage:
 *   const { dialogProps, cardStyle } = useResponsiveDialog({ desktopWidth: 600 });
 *   <q-dialog v-bind="dialogProps"> <q-card :style="cardStyle"> ... </q-card> </q-dialog>
 *
 * Modes:
 *   'constrained' (default) — card gets max-width: 95vw, dialog unchanged
 *   'maximized' — dialog gets maximized prop on mobile
 *   'bottom-sheet' — dialog gets position="bottom" on mobile
 *   'slide-left' — dialog enters from the left edge (side sheet)
 */
export function useResponsiveDialog(options?: {
  desktopWidth?: number;
  mobileMode?: "maximized" | "bottom-sheet" | "constrained" | "slide-left";
}) {
  const { isMobile } = useScreen();
  const mode = options?.mobileMode ?? "constrained";

  const dialogProps = computed(() => {
    if (!isMobile.value) return {};
    switch (mode) {
      case "maximized":
        return { maximized: true };
      case "bottom-sheet":
        return { position: "bottom" as const, fullWidth: true };
      case "slide-left":
        return {
          position: "left" as const,
          transitionShow: "slide-right",
          transitionHide: "slide-left",
        };
      case "constrained":
      default:
        return {};
    }
  });

  const cardStyle = computed(() => {
    const w = options?.desktopWidth;
    const base = w ? `width: ${w}px; max-width: 95vw` : "max-width: 95vw";
    // On mobile, respect iPhone home-indicator / notched-edge safe areas so
    // the last row of a sheet or side-drawer isn't hidden under the OS UI.
    if (!isMobile.value) return base;
    switch (mode) {
      case "bottom-sheet":
      case "maximized":
        return `${base}; padding-bottom: env(safe-area-inset-bottom)`;
      case "slide-left":
        return `${base}; padding-bottom: env(safe-area-inset-bottom); padding-left: env(safe-area-inset-left)`;
      default:
        return base;
    }
  });

  return { dialogProps, cardStyle, isMobile };
}
