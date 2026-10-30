import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { digest, integer } from "./partition.mjs";

export function settings(root) {
  const config = JSON.parse(readFileSync(join(root, "scripts/ui-tests/config.json"), "utf8"));
  return { shards: integer(config.shards, "Shard count") };
}

export function timings(root) {
  try {
    return JSON.parse(readFileSync(join(root, "scripts/ui-tests/durations.json"), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { files: {}, fallbackSeconds: 1, overheadSeconds: { default: 0 } };
  }
}

export function configurationDigest(root) {
  const files = [
    "package.json",
    "package-lock.json",
    "vite.config.ts",
    "vitest.config.ts",
    "vitest.shard.config.ts",
    "vitest.ci.config.ts",
    "coverage.sh",
    ".env",
    ".env.local",
    ".env.test",
    ".env.test.local",
    "src/test/unit/helpers/setupTests.ts",
    "src/test/unit/helpers/setupNodeTests.ts",
    ...readdirSync(join(root, "scripts/ui-tests")).map((file) => `scripts/ui-tests/${file}`),
  ].sort();
  return digest(
    JSON.stringify(
      files.map((file) => {
        try {
          return [file, digest(readFileSync(join(root, file)))];
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          return [file, null];
        }
      }),
    ),
  );
}

export function environmentDigest(env = process.env) {
  const values = Object.entries(env)
    .filter(
      ([name]) => /^(VITE_|ZO_)/.test(name) || ["NODE_ENV", "NODE_OPTIONS", "TZ"].includes(name),
    )
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return digest(JSON.stringify(values));
}

export function runIdentity(root) {
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  if (process.env.GITHUB_SHA && process.env.GITHUB_SHA !== sha) {
    throw new Error("Checkout SHA does not match this workflow run");
  }
  return {
    sha,
    runId: process.env.GITHUB_RUN_ID || "local",
    attempt: integer(process.env.GITHUB_RUN_ATTEMPT || 1, "Run attempt"),
    configDigest: configurationDigest(root),
    environmentDigest: environmentDigest(),
    node: process.version,
    vitest: JSON.parse(readFileSync(join(root, "node_modules/vitest/package.json"), "utf8"))
      .version,
  };
}
