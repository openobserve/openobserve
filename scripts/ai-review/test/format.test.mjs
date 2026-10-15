import test from "node:test";
import assert from "node:assert/strict";

import {
  dropUnmatchedDetailsClose,
  normalizeReviewersRow,
  stripEmoji,
} from "../format.mjs";

test("stripEmoji removes emoji and the space after it from headings and counts", () => {
  const input = [
    "## 🔎 OpenObserve Code Review",
    "> ### ⚠️ Minor issues",
    "**🔴 1 blocker · 🟡 0 warnings · 🔵 2 suggestions**",
    "- 👩‍💻 `a.rs:1` **[QA]** text 👍🏽 done",
  ].join("\n");

  assert.equal(stripEmoji(input), [
    "## OpenObserve Code Review",
    "> ### Minor issues",
    "**1 blocker · 0 warnings · 2 suggestions**",
    "- `a.rs:1` **[QA]** text done",
  ].join("\n"));
});

test("stripEmoji keeps arrows, symbols and code spans intact", () => {
  const input = "route ↔ nav → fix © `const s = \"✅\";`\n```\nlet x = \"🔒\";\n```";

  assert.equal(stripEmoji(input), input);
});

test("dropUnmatchedDetailsClose removes only the stray closer", () => {
  const input = "<details open>\n<summary>Findings (1)</summary>\nx\n</details>\n\n| t |\n\n</details>";

  assert.equal(
    dropUnmatchedDetailsClose(input),
    "<details open>\n<summary>Findings (1)</summary>\nx\n</details>\n\n| t |\n\n",
  );
});

test("dropUnmatchedDetailsClose leaves balanced folds alone", () => {
  const input = "<details>\n<details>a</details>\n</details>";

  assert.equal(dropUnmatchedDetailsClose(input), input);
});

test("normalizeReviewersRow rewrites the row from the reviewers that ran", () => {
  const input = "| **Risk tier** | lite |\n| **Reviewers** | 🧩 Code Quality · Made Up Reviewer |\n";

  assert.equal(
    normalizeReviewersRow(input, ["Code Quality Reviewer", "QA / Test Reviewer"]),
    "| **Risk tier** | lite |\n| **Reviewers** | Code Quality Reviewer, QA / Test Reviewer |\n",
  );
  assert.equal(normalizeReviewersRow(input, []), input);
});
