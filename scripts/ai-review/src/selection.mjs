import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";

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
