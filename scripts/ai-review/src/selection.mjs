import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { isLoaderPath } from "./sanitize.mjs";

// Dependency bots whose PRs only bump versions; any other bot or App can write code and is reviewed.
const DEPENDENCY_BOTS = new Set(["dependabot[bot]", "renovate[bot]"]);
// GitHub's files and commits endpoints stop at these counts however far they are paged.
const MAX_LISTED_FILES = 3000;
const MAX_LISTED_COMMITS = 250;

// Diffs that can affect a release: migrations, dependency manifests, server config, CI and deployment files.
export function isReleaseFile(filePath) {
  if (/(^|\/)migrations?\//i.test(filePath) || /\.sql$/i.test(filePath)) return true;
  if (/(^|\/)(Cargo\.(toml|lock)|package\.json|rust-toolchain(\.toml)?)$/.test(filePath)) return true;
  if (/^src\/config\/src\/config\.rs$/.test(filePath) || /(^|\/)\.env[^/]*$/.test(filePath)) return true;
  if (/^\.github\//.test(filePath) || /^deploy\//.test(filePath)) return true;
  return /(^|\/)Dockerfile[^/]*$/.test(filePath) || /^docker\//.test(filePath);
}

// A rules path that names AGENTS.md falls back to CLAUDE.md in the same directory when AGENTS.md is absent.
export function resolveRulesFiles(files, exists = existsSync) {
  const out = [];
  for (const file of files) {
    if (exists(file)) out.push(file);
    else if (basename(file) === "AGENTS.md") {
      const alt = join(dirname(file), "CLAUDE.md");
      if (exists(alt)) out.push(alt);
    }
  }
  return out;
}

// Test code only: test trees, spec/test files and fixtures, in any language.
export function isTestOnlyPath(filePath) {
  if (isCiOnlyPath(filePath)) return false;
  if (/(^|\/)(tests?|__tests__|e2e|fixtures?|testdata)\//.test(filePath)) return true;
  if (/\.(spec|test)\.[cm]?[jt]sx?$/.test(filePath)) return true;
  return /(^|\/)[^/]+_test\.(rs|go|py)$/.test(filePath) || /(^|\/)test_[^/]+\.py$/.test(filePath);
}

// Workflows, actions and .github config only; scripts, the review engine and its opencode configs are code and take the normal tiers.
export function isCiOnlyPath(filePath) {
  return /^\.github\/((workflows|actions)\/|[^/]+\.ya?ml$)/.test(filePath);
}

export function narrowTier(paths) {
  if (paths.length === 0) return "";
  if (paths.every(isTestOnlyPath)) return "test-only";
  if (paths.every(isCiOnlyPath)) return "ci-only";
  return "";
}

// Prompt, agent-rule and workflow markdown steers the AI or CI, so it is reviewed like code.
export function isDocsPath(filePath) {
  if (/^(scripts\/ai-review\/|\.github\/)/.test(filePath) || isLoaderPath(filePath)) return false;
  return /\.md$/i.test(filePath) || /^docs\//.test(filePath);
}

// What update-translations.yml commits; en-US.json is the English source a person writes, so it is still reviewed.
export function isTranslationPath(filePath) {
  if (filePath === "scripts/translations/.translation_state.json") return true;
  return /^web\/src\/locales\/languages\/[^/]+\.json$/.test(filePath) && !filePath.endsWith("/en-US.json");
}

// A listing is whole only when it matches the PR's own counts below each endpoint's cap; anything else may hide a file or commit.
export function listingComplete({ files, commits, expectedFiles, expectedCommits }) {
  const count = value => (/^\d+$/.test(String(value ?? "").trim()) ? Number(value) : Number.NaN);
  const wantFiles = count(expectedFiles);
  const wantCommits = count(expectedCommits);
  return files === wantFiles && commits === wantCommits && wantFiles < MAX_LISTED_FILES && wantCommits < MAX_LISTED_COMMITS;
}

// GitHub commits a bot's API-made commits as web-flow, so the committer is either the bot or web-flow, and GitHub must have verified the signature.
export function botCommit(commit, bot) {
  return commit?.author === bot && (commit.committer === bot || commit.committer === "web-flow") && commit.verified === true;
}

// Why a PR needs no review at all, or "" when it does; a PR with no listed files is reviewed so a failed listing never skips one.
export function nothingToReviewReason({ author = "", commits = [], paths = [] }) {
  if (DEPENDENCY_BOTS.has(author) && commits.length > 0 && commits.every(c => botCommit(c, author))) return "bot_author";
  if (paths.length === 0) return "";
  if (paths.every(isDocsPath)) return "docs_only";
  if (paths.every(isTranslationPath)) return "translation_only";
  return "";
}
