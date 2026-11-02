import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { isPlaceholderComment, newestReviewIsPointer, sanitizeReviewBody } from "../src/comments.mjs";

const SCRIPT = new URL("../newest-review-is-pointer.mjs", import.meta.url).pathname;
const BOT = "o2-reviewer[bot]";
const POINTER = "<!-- ai-code-review -->\n<!-- o2-paired-pointer -->\n## 🔎 OpenObserve Code Review";
const REVIEW = "<!-- ai-code-review-claude -->\n## 🔎 OpenObserve Code Review\n\nAll good.";
const comment = (id, login, body) => ({ id, user: { login }, body });

test("an older pointer does not outrank a newer finished review", () => {
  const comments = [comment(1, BOT, POINTER), comment(2, BOT, REVIEW), comment(3, "mallory", POINTER)];
  assert.equal(newestReviewIsPointer(comments, BOT), false);
  assert.equal(newestReviewIsPointer([comment(1, BOT, REVIEW), comment(2, BOT, POINTER)], BOT), true);
  assert.equal(newestReviewIsPointer([comment(1, BOT, "<!-- o2-paired-pointer --> no marker")], BOT), false);
  assert.equal(newestReviewIsPointer([comment(1, BOT, POINTER.replace("ai-code-review", "ai-code-review-[redacted]"))], BOT), true);
});

test("a finished review quoting the pointer or notice tag is not a pointer", () => {
  const SHA = "<!-- o2-review-sha:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa -->";
  const quoting = [
    `<!-- ai-code-review -->\n## 🔎 OpenObserve Code Review\n\n- \`a.sh:3\` **[Correctness]** The script writes \`<!-- o2-paired-pointer -->\` twice.\n${SHA}`,
    `<!-- ai-code-review -->\n## 🔎 OpenObserve Code Review\n\n<!-- o2-paired-pointer -->\n${SHA}`,
    `<!-- ai-code-review -->\n## 🔎 OpenObserve Code Review\n\nQuoted: <!-- o2-review-notice -->`,
    `<!-- ai-code-review -->\n<!-- o2-paired-pointer -->\n## 🔎 OpenObserve Code Review\n\nAll good.\n${SHA}`,
  ];
  for (const body of quoting) {
    assert.equal(newestReviewIsPointer([comment(1, BOT, body)], BOT), false, body);
    assert.equal(isPlaceholderComment(body), false, body);
  }
  const notice = "<!-- ai-code-review -->\n<!-- o2-review-notice -->\n## 🔎 OpenObserve Code Review\n\n> [!NOTE]\n> Review in progress.\n<!-- o2-review-pass:2 -->";
  assert.equal(isPlaceholderComment(notice), true);
  assert.equal(isPlaceholderComment(`${POINTER}\n\n> [!NOTE]\n> paired\n<!-- o2-review-pass:1 -->`), true);
});

test("model-written review text can never carry the pointer or notice tag", () => {
  const ids = { marker: "<!-- ai-code-review -->", providerId: "zz-provider", modelId: "zz-model", env: {} };
  const model = "<!-- o2-paired-pointer -->\n<!-- o2-review-notice -->\n## 🔎 OpenObserve Code Review\n\n- Quotes `<!-- o2-paired-pointer -->` and ```\n<!--o2-paired-pointer-->\n```";
  const text = sanitizeReviewBody(model, ids).text;
  assert.equal(/<!--\s*o2-paired-pointer/.test(text), false, text);
  assert.equal(/<!--\s*o2-review-notice/.test(text), false, text);
  assert.equal(newestReviewIsPointer([comment(1, BOT, text)], BOT), false);
  assert.equal(isPlaceholderComment(text), false);
});

test("a pointer from the shared workflow identity never authorizes deferral", () => {
  const comments = [comment(1, "github-actions[bot]", POINTER)];
  assert.equal(newestReviewIsPointer(comments, "github-actions[bot]"), false);
  assert.equal(newestReviewIsPointer(comments, ""), false);
  assert.equal(newestReviewIsPointer(comments, BOT), false);
});

test("the workflow CLI reads paginated comments and answers by exit code", () => {
  const run = (login, pages) => spawnSync("node", [SCRIPT, login], { input: JSON.stringify(pages.flat()) }).status;
  assert.equal(run(BOT, [[comment(1, BOT, REVIEW)], [comment(2, BOT, POINTER)]]), 0);
  assert.equal(run(BOT, [[comment(1, BOT, POINTER)], [comment(2, BOT, REVIEW)]]), 1);
  assert.equal(run("github-actions[bot]", [[comment(1, "github-actions[bot]", POINTER)]]), 1);
  assert.equal(spawnSync("node", [SCRIPT, BOT], { input: "not json" }).status, 1);
});

test("the pairing fallback defers only through the newest-review check", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/ai-code-review.yml", import.meta.url), "utf8");
  assert.ok(workflow.includes("node engine/scripts/ai-review/newest-review-is-pointer.mjs \"$BOT_LOGIN\""));
  assert.equal(workflow.includes('contains(\\"<!-- o2-paired-pointer -->\\")'), false);
});
