//  Copyright 2023 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.


export const LIGHT_MODE_COLORS = {
  key: "#B71C1C", // red color for keys 
  stringValue: "#047857", // Softer green for strings - easy on eyes
  numberValue: "#2563EB", // Royal blue for numbers - distinct from red keys
  booleanValue: "#6D28D9", // Soft purple for booleans - distinct but calm
  objectValue: "#4B5563", // Neutral gray for objects - subtle and professional
  arrayValue: "#0E7490", // Calm teal for arrays - professional and clear
  nullValue: "#6B7280", // Medium gray for null - appropriately muted
  // Semantic types for log data
  url: "#1D4ED8", // Strong blue for URLs - clearly indicates links
  ip: "#D97706", // Bold amber for IP addresses - highly visible
  email: "#9333EA", // Vivid purple for emails - distinct and readable
  timestamp: "#2563EB", // Dark red for timestamps - important and visible
  uuid: "#047857", // Dark teal for UUIDs - unique and readable
  path: "#4338CA", // Deep indigo for file paths - system-related and clear
} as const;

export const DARK_MODE_COLORS = {
  key: "#f67a7aff", // Lighter red for dark mode - same family as light mode but softer
  stringValue: "#6EE7B7", // Soft mint green - easy to read
  numberValue: "#60A5FA", // Light blue for numbers - easy to read in dark mode
  booleanValue: "#A5B4FC", // Lavender - subtle but distinct
  objectValue: "#D1D5DB", // Light gray - clear but not harsh
  arrayValue: "#67E8F9", // Soft cyan - fresh but not glaring
  nullValue: "#9CA3AF", // Medium gray - appropriately subtle
  // Semantic types for log data
  url: "#93C5FD", // Consistent with key color
  ip: "#FCD34D", // Soft gold - warm and clear
  email: "#C4B5FD", // Soft purple - gentle but readable
  timestamp: "#60A5FA", // Consistent with number color
  uuid: "#6EE7B7", // Consistent with string color
  path: "#BAE6FD", // Ice blue - system-like but gentle
} as const;

export function getThemeColors(isDark: boolean) {
  return isDark ? DARK_MODE_COLORS : LIGHT_MODE_COLORS;
}
