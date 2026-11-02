// Posts the "AI review verdict" commit status for one head SHA; ai-code-review.yml runs it after the review step.
import { currentGateStatus, postGateStatus } from "./src/gh-api.mjs";
import { gateStatus } from "./src/verdict.mjs";

const repo = process.env.GITHUB_REPOSITORY;
const sha = process.env.HEAD_SHA;
if (!repo || !/^[0-9a-f]{40}$/.test(sha || "")) {
  console.error("GITHUB_REPOSITORY and a 40-character HEAD_SHA are required");
  process.exit(1);
}

const current = currentGateStatus(repo, sha);
const next = gateStatus({
  skip: process.env.SKIP || "",
  pairedRef: process.env.PAIRED_REF || "",
  basis: process.env.BASIS || "",
  verdict: process.env.VERDICT || "",
  current,
});
if (!next) {
  console.log(`${sha}: kept "${current.description}"; a dispute on this commit outranks a re-review`);
} else {
  postGateStatus(repo, sha, { ...next, targetUrl: process.env.TARGET_URL });
  console.log(`${sha}: ${next.state} - ${next.description}`);
}
