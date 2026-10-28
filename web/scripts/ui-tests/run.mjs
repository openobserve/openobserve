import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { identity } from "./partition.mjs";
import { runIdentity, settings, timings } from "./runtime.mjs";
import { validateReports } from "./validate.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { shards } = settings(root);
const command = process.argv[2];
if (command === "matrix") {
  console.log(`ui_shards=${JSON.stringify(Array.from({ length: shards }, (_, i) => i + 1))}`);
  console.log(`ui_shard_count=${shards}`);
} else if (command === "count") {
  console.log(shards);
} else if (command === "validate") {
  process.env.NODE_ENV = "test";
  const { createVitest } = await import("vitest/node");
  const ctx = await createVitest("test", {
    root,
    config: join(root, "vitest.config.ts"),
    watch: false,
  });
  try {
    const files = (await ctx.globTestSpecifications()).map((spec) => identity(spec, root));
    const directory = join(root, ".vitest-reports");
    const entries = readdirSync(directory).filter(
      (name) => name !== "merged" && name !== "completeness.json",
    );
    const reports = entries.map((name) => {
      const metadata = JSON.parse(readFileSync(join(directory, name, "metadata.json"), "utf8"));
      if (name !== `ui-unit-shard-${metadata.index}-${shards}`)
        throw new Error(`Unexpected artifact directory: ${name}`);
      const contents = readdirSync(join(directory, name)).sort();
      if (JSON.stringify(contents) !== JSON.stringify(["blob.json", "metadata.json"]))
        throw new Error(`Unexpected artifact files: ${name}`);
      return { metadata, blob: readFileSync(join(directory, name, "blob.json")) };
    });
    const summary = validateReports(reports, {
      ...runIdentity(root),
      count: shards,
      files,
      timings: timings(root),
    });
    const merged = join(directory, "merged");
    rmSync(merged, { recursive: true, force: true });
    mkdirSync(merged);
    for (const { metadata } of reports) {
      copyFileSync(
        join(directory, `ui-unit-shard-${metadata.index}-${shards}`, "blob.json"),
        join(merged, `blob-${metadata.index}.json`),
      );
    }
    console.log(JSON.stringify(summary));
    writeFileSync(join(directory, "completeness.json"), JSON.stringify(summary, null, 2));
  } finally {
    await ctx.close();
  }
} else {
  throw new Error("Expected matrix, count or validate");
}
