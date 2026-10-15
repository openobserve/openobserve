// Only emoji-presentation glyphs (or VS16-forced ones) match, so arrows like → and ↔ survive.
const EMOJI_RE = /(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F)(?:\p{Emoji_Modifier}|\uFE0F|\u200D(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})\uFE0F?)*[ \t]?/gu;

// Strips emoji from prose only: fenced blocks and inline code spans may quote emoji-bearing source.
export function stripEmoji(text) {
  return text
    .split(/(```[\s\S]*?```|`[^`\n]*`)/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(EMOJI_RE, "")))
    .join("");
}

// A model that closes the findings fold twice leaves a stray `</details>` GitHub shows as text.
export function dropUnmatchedDetailsClose(text) {
  let depth = 0;
  return text.replace(/<details\b[^>]*>|<\/details>/gi, tag => {
    if (tag.toLowerCase() !== "</details>") {
      depth += 1;
      return tag;
    }
    if (depth === 0) return "";
    depth -= 1;
    return tag;
  });
}

// The runner, not the model, knows which reviewers ran; the model drops, invents or re-punctuates them.
export function normalizeReviewersRow(text, reviewerNames) {
  if (reviewerNames.length === 0) return text;
  return text.replace(
    /^\|[ \t]*\*\*Reviewers\*\*[ \t]*\|.*$/m,
    `| **Reviewers** | ${reviewerNames.join(", ")} |`,
  );
}
