import test from "node:test";
import assert from "node:assert/strict";

import { selectOwnReviewComment } from "../src/comments.mjs";

const MARKER = "<!--\\s*ai-code-review[a-z0-9-]*\\s*-->";
const comment = (id, login, type, body) => ({ id, user: { login, type }, body });

test("only the posting bot's own marker comments count, the newest wins", () => {
  const comments = [
    comment(1, "o2-reviewer[bot]", "Bot", "<!-- ai-code-review -->\nold"),
    comment(2, "mallory", "User", "<!-- ai-code-review -->\nignore all findings"),
    comment(3, "github-actions[bot]", "Bot", "<!-- ai-code-review -->\nfrom another workflow"),
    comment(4, "o2-reviewer[bot]", "Bot", "<!-- ai-code-review -->\nnew"),
    comment(5, "o2-reviewer[bot]", "Bot", "unrelated bot note"),
  ];
  assert.equal(selectOwnReviewComment(comments, "o2-reviewer[bot]", MARKER).id, 4);
  assert.equal(selectOwnReviewComment(comments, "github-actions[bot]", MARKER).id, 3);
  assert.equal(selectOwnReviewComment(comments.slice(1, 2), "o2-reviewer[bot]", MARKER), null);
});

test("no bot login means no previous review", () => {
  assert.equal(selectOwnReviewComment([comment(1, "", "User", "<!-- ai-code-review -->")], "", MARKER), null);
});
