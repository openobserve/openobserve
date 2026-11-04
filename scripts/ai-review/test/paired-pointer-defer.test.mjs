import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { isPlaceholderComment, sanitizeReviewBody } from "../src/comments.mjs";

const POINTER = "<!-- ai-code-review -->\n<!-- o2-paired-pointer -->\n## 🔎 OpenObserve Code Review";

test("a finished review quoting the pointer or notice tag is not a pointer", () => {
  const SHA = "<!-- o2-review-sha:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa -->";
  const quoting = [
    `<!-- ai-code-review -->\n## 🔎 OpenObserve Code Review\n\n- \`a.sh:3\` **[Correctness]** The script writes \`<!-- o2-paired-pointer -->\` twice.\n${SHA}`,
    `<!-- ai-code-review -->\n## 🔎 OpenObserve Code Review\n\n<!-- o2-paired-pointer -->\n${SHA}`,
    `<!-- ai-code-review -->\n## 🔎 OpenObserve Code Review\n\nQuoted: <!-- o2-review-notice -->`,
    `<!-- ai-code-review -->\n<!-- o2-paired-pointer -->\n## 🔎 OpenObserve Code Review\n\nAll good.\n${SHA}`,
  ];
  for (const body of quoting) {
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
  assert.equal(isPlaceholderComment(text), false);
});

test("a failed or skipped paired lookup always reviews here, whatever pointer the PR carries", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/ai-code-review.yml", import.meta.url), "utf8");
  const step = workflow.slice(workflow.indexOf("- name: Defer to a paired o2-enterprise PR"), workflow.indexOf("- name: Check out PR head"));
  assert.equal(step.includes("o2-paired-pointer"), false);
  assert.equal(step.includes("newest-review-is-pointer"), false);
  assert.match(step, /if \[ -z "\$ENT_TOKEN" \]; then\n\s*review_here "/);
  assert.match(step, /--jq [^\n]*\)"; then\n\s*review_here "/);
  assert.match(step, /-f state=open/);
  const fn = step.slice(step.indexOf("review_here() {"), step.indexOf("}", step.indexOf("review_here() {")));
  assert.equal(fn.includes("REVIEW_RUN=false"), false);
});
