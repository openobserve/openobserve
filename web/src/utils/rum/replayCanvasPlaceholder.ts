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

/* eslint-disable local/no-hardcoded-px -- the rule is injected into the replayed page's own document, where rem follows that page's root font size, not ours */

const SVG_WIDTH = 220;
const SVG_HEIGHT = 28;

const escapeXml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/**
 * The replay never records canvas pixels, so a replayed canvas is a transparent box. This rule
 * paints a label on it. It stays translucent because a transparent overlay canvas must not hide
 * the replayed page beneath it, and it uses the canvas's own background because a canvas is a
 * replaced element that cannot render ::before or ::after.
 */
export const buildReplayCanvasPlaceholderRule = (label: string): string => {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_WIDTH}" height="${SVG_HEIGHT}">` +
    `<rect width="${SVG_WIDTH}" height="${SVG_HEIGHT}" rx="14" fill="rgba(255,255,255,0.85)" stroke="rgba(128,128,128,0.5)"/>` +
    `<text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" font-family="sans-serif" font-size="12" fill="rgb(80,80,80)">${escapeXml(label)}</text>` +
    `</svg>`;
  const labelImage = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  const hatch =
    "repeating-linear-gradient(45deg, rgba(128,128,128,0.12) 0, rgba(128,128,128,0.12) 1px, transparent 1px, transparent 8px)";
  return [
    "canvas {",
    "background-color: rgba(128,128,128,0.08) !important;",
    `background-image: ${labelImage}, ${hatch} !important;`,
    "background-repeat: no-repeat, repeat !important;",
    "background-position: center, 0 0 !important;",
    `background-size: ${SVG_WIDTH}px ${SVG_HEIGHT}px, auto !important;`,
    "outline: 1px dashed rgba(128,128,128,0.5) !important;",
    "outline-offset: -1px !important;",
    "}",
  ].join(" ");
};
