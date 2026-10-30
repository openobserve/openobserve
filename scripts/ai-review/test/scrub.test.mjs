import test from "node:test";
import assert from "node:assert/strict";

import { breakMarkers, neutralizeMentions, scrubReviewBody, scrubSecrets } from "../src/scrub.mjs";

const ENV = {
  GH_TOKEN: "ghs_AppInstallationToken1234567890",
  DEEPSEEK_API_KEY: "provider-key-value-123",
  O2_TRACE_AUTH: "dXNlcjpwYXNz",
  SHORT_TOKEN: "abc",
  PR_NUMBER: "12345678",
};

test("redacts env secrets and secret-shaped values inside and outside code fences", () => {
  const input = [
    "Token ghs_AppInstallationToken1234567890 leaked in prose.",
    "```",
    "let key = \"provider-key-value-123\";",
    "auth = dXNlcjpwYXNz",
    "```",
    "A PAT ghp_abcdefghijklmnopqrstuvwxyz123456 and github_pat_11ABCDEFG0123456789_abcdefghij",
    "sk-abcdefghijklmnopqrstuvwxyz",
    "Authorization: Bearer abc.def",
    "-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----",
    "PR 12345678 and abc stay.",
  ].join("\n");
  const { text, hits } = scrubSecrets(input, ENV);
  for (const secret of ["ghs_AppInstallationToken", "provider-key-value-123", "dXNlcjpwYXNz", "ghp_abcdef", "github_pat_11", "sk-abcdef", "Bearer abc", "MIIabc"]) {
    assert.equal(text.includes(secret), false, secret);
  }
  assert.ok(text.includes("PR 12345678 and abc stay."));
  assert.ok(text.includes("Authorization: [redacted]"));
  assert.ok(hits >= 8);
});

test("breaks forged review markers everywhere", () => {
  const out = breakMarkers("a <!-- o2-review:summary --> b `<!--o2-review:finding x-->`");
  assert.equal(out.includes("<!-- o2-review"), false);
  assert.equal(out.includes("<!--o2-review"), false);
  assert.equal(breakMarkers("<!-- ai-code-review -->"), "<!-- ai-code-review -->");
});

test("neutralizes mentions in prose only", () => {
  const input = [
    "Ping @openobserve/maintainers and @alice please.",
    "Use `@click` here, email bob@example.com stays.",
    "```vue",
    "<button @click=\"go\">@alice</button>",
    "```",
    "Done @bob.",
  ].join("\n");
  const out = neutralizeMentions(input);
  assert.ok(out.includes("@⁠openobserve/maintainers"));
  assert.ok(out.includes("@⁠alice please"));
  assert.ok(out.includes("`@click`"));
  assert.ok(out.includes("bob@example.com"));
  assert.ok(out.includes("<button @click=\"go\">@alice</button>"));
  assert.ok(out.includes("Done @⁠bob."));
});

test("scrubReviewBody keeps the v1 marker intact and reports secret hits", () => {
  const { text, secretHits } = scrubReviewBody("<!-- ai-code-review -->\n## Review\nkey provider-key-value-123 @carol", ENV);
  assert.ok(text.startsWith("<!-- ai-code-review -->\n"));
  assert.ok(text.includes("[redacted]"));
  assert.ok(text.includes("@⁠carol"));
  assert.equal(secretHits, 1);
});
