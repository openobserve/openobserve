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
 * Strips HTML tags and script-like content from a string to prevent XSS.
 */
const stripHtml = (value: string): string => {
  return value
    .replace(/<[^>]*>?/gm, "") // Remove HTML tags (including malformed/partial tags)
    .replace(/\b(javascript|vbscript|data)\s*:/gi, "") // Remove dangerous URL schemes
    .replace(/\bon\w+\s*=/gi, ""); // Remove inline event handlers (e.g. onclick=, onerror=)
};

/**
 * Recursively sanitizes all string values in an object to prevent XSS.
 */
const sanitizeStrings = (obj: unknown): unknown => {
  if (typeof obj === "string") {
    return stripHtml(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeStrings);
  }
  if (obj !== null && typeof obj === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      sanitized[key] = sanitizeStrings(value);
    }
    return sanitized;
  }
  return obj;
};

/**
 * Validates and sanitizes a dashboard JSON payload fetched from an external
 * source (e.g., GitHub) before passing it to `dashboardsService.create()`.
 *
 * - Ensures the payload is a plain object (not an array or primitive).
 * - Strips HTML tags and script content from all string values.
 * - Returns a sanitized copy; never mutates the input.
 *
 * Throws if the payload is structurally invalid.
 */
export const sanitizeDashboardJson = (json: unknown): Record<string, unknown> => {
  if (json === null || json === undefined) {
    throw new Error("Dashboard JSON is empty");
  }

  if (typeof json !== "object" || Array.isArray(json)) {
    throw new Error("Dashboard JSON must be a plain object");
  }

  return sanitizeStrings(json) as Record<string, unknown>;
};
