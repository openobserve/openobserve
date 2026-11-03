// Runs before npm ci and opencode are installed, so it may import node built-ins and src/ modules that import only built-ins.
import { readFileSync } from "node:fs";

import { listingComplete, nothingToReviewReason } from "./src/selection.mjs";

const TSV_ESCAPES = { "\\t": "\t", "\\n": "\n", "\\r": "\r", "\\\\": "\\" };
const lines = file => {
  const out = file ? readFileSync(file, "utf-8").split("\n").map(line => line.replace(/\r$/, "")) : [];
  if (out.at(-1) === "") out.pop();
  return out;
};
const unescapeTsv = field => field.replace(/\\[tnr\\]/g, seq => TSV_ESCAPES[seq]);
const [listFile, commitsFile] = process.argv.slice(2);
const fileLines = lines(listFile).filter(line => line.trim());
const paths = fileLines.flatMap(line => line.split("\t").map(unescapeTsv).filter(Boolean));
const commits = lines(commitsFile).map(line => {
  const [author = "", committer = "", verified = ""] = line.split("\t");
  return { author, committer, verified: verified === "true" };
});
const complete = listingComplete({ files: fileLines.length, commits: commits.length, expectedFiles: process.env.EXPECTED_FILES, expectedCommits: process.env.EXPECTED_COMMITS });
process.stdout.write(complete ? nothingToReviewReason({ author: process.env.PR_AUTHOR || "", commits, paths }) : "");
