// Runs before npm ci and opencode are installed, so it may import node built-ins and src/selection.mjs only.
import { readFileSync } from "node:fs";

import { nothingToReviewReason } from "./src/selection.mjs";

const lines = file => (file ? readFileSync(file, "utf-8").split("\n").map(line => line.replace(/\r$/, "")) : []);
const [listFile, commitsFile] = process.argv.slice(2);
const paths = lines(listFile).map(line => line.trim()).filter(Boolean);
const commitLines = lines(commitsFile);
if (commitLines.at(-1) === "") commitLines.pop();
const commits = commitLines.map(line => {
  const [author = "", committer = "", verified = ""] = line.split("\t");
  return { author, committer, verified: verified === "true" };
});
process.stdout.write(nothingToReviewReason({ author: process.env.PR_AUTHOR || "", commits, paths }));
