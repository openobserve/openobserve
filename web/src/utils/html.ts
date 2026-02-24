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

/**
 * HTML Utility Functions
 * ======================
 *
 * Provides utilities for safe HTML rendering and manipulation.
 */

/**
 * Escapes HTML characters in text for safe rendering
 *
 * Prevents XSS attacks by converting dangerous HTML characters into safe HTML entities.
 * This ensures user content displays as literal text instead of executing as HTML markup.
 *
 * @param str - String to escape
 * @returns HTML-safe string with entities escaped
 *
 * @example
 * // Input containing malicious HTML
 * const userInput = '<script>alert("hack")</script>';
 * const safeOutput = escapeHtml(userInput);
 * // Output: '&lt;script&gt;alert("hack")&lt;/script&gt;'
 * // Displays as: <script>alert("hack")</script> (visible text, not executed)
 *
 * @example
 * // Log data with HTML tags
 * const logMessage = '<h1>Error: Database connection failed</h1>';
 * const escapedLog = escapeHtml(logMessage);
 * // Output: '&lt;h1&gt;Error: Database connection failed&lt;/h1&gt;'
 * // Displays as: <h1>Error: Database connection failed</h1> (visible text)
 *
 * @example
 * // JSON data with quotes and ampersands
 * const jsonData = '{"message": "Success & complete", "html": "<div>content</div>"}';
 * const safeJson = escapeHtml(jsonData);
 * // Output: '{&quot;message&quot;: &quot;Success &amp; complete&quot;, &quot;html&quot;: &quot;&lt;div&gt;content&lt;/div&gt;&quot;}'
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;") // Must be first: & → &amp;
    .replace(/</g, "&lt;") // Less than: < → &lt;
    .replace(/>/g, "&gt;") // Greater than: > → &gt;
    .replace(/"/g, "&quot;"); // Double quote: " → &quot;
}
