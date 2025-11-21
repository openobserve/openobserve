// Copyright 2023 OpenObserve Inc.
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
 * Helper function to convert hex color to rgba
 * @param hex - Hex color code (e.g., "#3F7994")
 * @param opacity - Opacity value (1-10 scale, where 10 = fully opaque)
 * @returns RGBA color string
 */
export const hexToRgba = (hex: string, opacity: number): string => {
  hex = hex.replace('#', '');
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
  color1 = color1.replace('#', '');
  color2 = color2.replace('#', '');

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

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
};

/**
 * Apply theme colors directly to CSS variables
 * @param themeColor - Hex color code for the theme
 * @param mode - Theme mode ("light" or "dark")
 * @param isDefault - Whether this is the default theme
 */
export const applyThemeColors = (themeColor: string, mode: "light" | "dark", isDefault: boolean = false) => {
  const isDarkMode = mode === "dark";

  if (isDarkMode) {
    // Apply dark mode theme color
    const rgbaColor = hexToRgba(themeColor, 10);
    document.body.style.setProperty('--o2-dark-theme-color', rgbaColor);
    document.body.style.setProperty('--o2-theme-color', rgbaColor);

    // Apply table header background color (80% theme color mixed with 20% black for dark mode)
    const tableHeaderBg = mixColors(themeColor, '#000000', 40);
    document.body.style.setProperty('--o2-table-header-bg', tableHeaderBg);

    // Apply tab background colors for dark mode
    // --o2-tab-bg: 20% white + 80% theme color (inverted from light mode)
    const tabBg = hexToRgba(themeColor,3); // 0.8 alpha (80% theme color)
    document.body.style.setProperty('--o2-tab-bg', tabBg);

    // --o2-inactive-tab-bg: 10% theme color mixed with dark background
    const inactiveTabBg = hexToRgba(themeColor, 1); // 0.1 alpha (10% theme color)
    document.body.style.setProperty('--o2-inactive-tab-bg', inactiveTabBg);

    // // Apply header menu background color for dark mode (30% theme color)
    // const headerMenuBg = hexToRgba(themeColor, 2); // 0.3 alpha (30% theme color)
    // document.body.style.setProperty('--o2-header-menu-bg', headerMenuBg);

    // Apply menu gradient colors
    if (isDefault) {
      // Use default menu gradient colors
      document.body.style.setProperty('--o2-menu-gradient-start', 'rgba(89, 155, 174, 0.3)');
      document.body.style.setProperty('--o2-menu-gradient-end', 'rgba(48, 193, 233, 0.3)');
      // Use default menu color for dark mode
      document.body.style.setProperty('--o2-menu-color', '#FFFFFF');
    } else {
      // Calculate menu gradient from theme color
      const menuGradientStart = hexToRgba(themeColor, 3); // 0.3 alpha (30%)
      const menuGradientEnd = hexToRgba(themeColor, 3); // 0.3 alpha (30%)
      document.body.style.setProperty('--o2-menu-gradient-start', menuGradientStart);
      document.body.style.setProperty('--o2-menu-gradient-end', menuGradientEnd);
      // Use theme color as menu color for dark mode
      document.body.style.setProperty('--o2-menu-color', themeColor);
    }

    // Clear light mode variables
    document.documentElement.style.removeProperty('--o2-theme-color');
    document.documentElement.style.removeProperty('--o2-body-primary-bg');
    document.documentElement.style.removeProperty('--o2-body-secondary-bg');
    document.documentElement.style.removeProperty('--o2-table-header-bg');
    document.documentElement.style.removeProperty('--o2-tab-bg');
    document.documentElement.style.removeProperty('--o2-inactive-tab-bg');
    document.documentElement.style.removeProperty('--o2-header-menu-bg');
    document.documentElement.style.removeProperty('--o2-menu-gradient-start');
    document.documentElement.style.removeProperty('--o2-menu-gradient-end');
    document.documentElement.style.removeProperty('--o2-menu-color');
    document.body.style.removeProperty('background');
  } else {
    // Apply light mode theme color
    const rgbaColor = hexToRgba(themeColor, 10);
    document.documentElement.style.setProperty('--o2-theme-color', rgbaColor);

    // Auto-calculate and apply background colors based on theme color
    const primaryBg = hexToRgba(themeColor, 0.1); // 0.01 alpha (1%)
    const secondaryBg = hexToRgba(themeColor, 4); // 0.4 alpha (40%)

    document.documentElement.style.setProperty('--o2-body-primary-bg', primaryBg);
    document.documentElement.style.setProperty('--o2-body-secondary-bg', secondaryBg);

    // Update body gradient with auto-calculated colors
    const gradient = `linear-gradient(to bottom right, ${primaryBg}, ${secondaryBg})`;
    document.body.style.setProperty('background', gradient, 'important');

    // Apply table header background color (80% theme color mixed with 20% white)
    const tableHeaderBg = mixColors(themeColor, '#FFFFFF', 30);
    document.documentElement.style.setProperty('--o2-table-header-bg', tableHeaderBg);

    // Apply tab background colors for light mode
    // --o2-tab-bg: 20% theme color + 80% white
    const tabBg = hexToRgba(themeColor, 2); // 0.2 alpha (20% theme color)
    document.documentElement.style.setProperty('--o2-tab-bg', tabBg);

    // --o2-inactive-tab-bg: 10% theme color + 90% white
    const inactiveTabBg = hexToRgba(themeColor, 1); // 0.1 alpha (10% theme color)
    document.documentElement.style.setProperty('--o2-inactive-tab-bg', inactiveTabBg);


    // Apply menu gradient colors
    if (isDefault) {
      // Use default menu gradient colors
      document.documentElement.style.setProperty('--o2-menu-gradient-start', 'rgba(89, 175, 199, 0.3)');
      document.documentElement.style.setProperty('--o2-menu-gradient-end', 'rgba(48, 193, 233, 0.3)');
      // Use default menu color for light mode
      document.documentElement.style.setProperty('--o2-menu-color', '#3F7994');
    } else {
      // Calculate menu gradient from theme color
      const menuGradientStart = hexToRgba(themeColor, 3); // 0.3 alpha (30%)
      const menuGradientEnd = hexToRgba(themeColor, 3); // 0.3 alpha (30%)
      document.documentElement.style.setProperty('--o2-menu-gradient-start', menuGradientStart);
      document.documentElement.style.setProperty('--o2-menu-gradient-end', menuGradientEnd);
      // Use theme color as menu color for light mode
      document.documentElement.style.setProperty('--o2-menu-color', themeColor);
    }

    // Clear dark mode variables
    document.body.style.removeProperty('--o2-dark-theme-color');
    document.body.style.removeProperty('--o2-table-header-bg');
    document.body.style.removeProperty('--o2-tab-bg');
    document.body.style.removeProperty('--o2-inactive-tab-bg');
    document.body.style.removeProperty('--o2-header-menu-bg');
    document.body.style.removeProperty('--o2-menu-gradient-start');
    document.body.style.removeProperty('--o2-menu-gradient-end');
    document.body.style.removeProperty('--o2-menu-color');
  }

  // Dispatch event to notify components (like SearchResult) to re-render
  window.dispatchEvent(new CustomEvent('themeColorChanged'));
};
