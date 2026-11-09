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

const ELLIPSIS = "…";

/** `text` cut after the last whole word that fits `width` with an ellipsis; a first word too long for it is cut by character. */
export function wordFit(text: string, width: number, measure: (s: string) => number): string {
  if (measure(text) <= width) return text;
  const words = text.split(/\s+/).filter(Boolean);
  let fitted = "";
  for (const word of words) {
    const next = fitted ? `${fitted} ${word}` : word;
    if (measure(next + ELLIPSIS) > width) break;
    fitted = next;
  }
  if (fitted) return fitted + ELLIPSIS;
  let chars = words[0] ?? "";
  while (chars && measure(chars + ELLIPSIS) > width) chars = chars.slice(0, -1);
  return chars ? chars + ELLIPSIS : "";
}

let canvas: HTMLCanvasElement | null = null;

/** A width measure in `el`'s font, or null where the browser cannot measure text (tests). */
export function textMeasure(el: HTMLElement): ((s: string) => number) | null {
  canvas ??= document.createElement("canvas");
  let context: CanvasRenderingContext2D | null = null;
  try {
    context = canvas.getContext("2d");
  } catch {
    return null;
  }
  if (!context) return null;
  const ctx = context;
  ctx.font = getComputedStyle(el).font;
  return (s) => ctx.measureText(s).width;
}
