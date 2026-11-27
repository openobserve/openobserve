export const ELLIPSIS = "…";

const graphemeSegmenter =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

const cutAround = (chars: string[], keep: number): string => {
  const head = Math.floor(keep / 2);
  return (
    chars.slice(0, head).join("") + ELLIPSIS + chars.slice(chars.length - (keep - head)).join("")
  );
};

/** The longest `start…tail` form of `text` whose measured width fits `maxWidth`; the tail gets the odd character. */
export function middleTruncate(
  text: string,
  maxWidth: number,
  measure: (value: string) => number,
): string {
  if (measure(text) <= maxWidth) return text;
  // Graphemes, so a cut never splits a flag, a joined emoji or a letter from its accent.
  const chars = splitGraphemes(text);
  let best = ELLIPSIS;
  let low = 0;
  let high = chars.length - 1;
  while (low <= high) {
    const keep = Math.floor((low + high) / 2);
    const candidate = cutAround(chars, keep);
    if (measure(candidate) <= maxWidth) {
      best = candidate;
      low = keep + 1;
    } else {
      high = keep - 1;
    }
  }
  return best;
}

function splitGraphemes(text: string): string[] {
  if (!graphemeSegmenter) return Array.from(text);
  return Array.from(graphemeSegmenter.segment(text), ({ segment }) => segment);
}
