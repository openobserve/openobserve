// Usage: gh api .../comments --paginate | jq -cs '[.[][]]' | node newest-review-is-pointer.mjs <bot login>; exits 0 only when the bot's newest review comment is a paired pointer.
import { readFileSync } from "node:fs";

import { newestReviewIsPointer } from "./src/comments.mjs";

let comments = [];
try {
  comments = JSON.parse(readFileSync(0, "utf-8"));
} catch {
  process.exit(1);
}
process.exit(Array.isArray(comments) && newestReviewIsPointer(comments, process.argv[2] ?? "") ? 0 : 1);
