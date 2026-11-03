// Usage: gh api .../comments --paginate | jq -cs '[.[][]]' | node select-review-comment.mjs <bot login>; prints the comment the runner would replace, or {}.
import { readFileSync } from "node:fs";

import { ANY_REVIEW_MARKER, selectOwnReviewComment } from "./src/comments.mjs";

const comments = JSON.parse(readFileSync(0, "utf-8"));
if (!Array.isArray(comments)) throw new Error("expected a JSON array of comments");
process.stdout.write(JSON.stringify(selectOwnReviewComment(comments, process.argv[2] ?? "", ANY_REVIEW_MARKER) ?? {}));
