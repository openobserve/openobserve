import { createHash } from "node:crypto";
import { relative } from "node:path";

export function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function integer(value, name) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${name} must be a positive integer`);
  }
  return Number(value);
}

export function shardIndex(value, count) {
  const index = integer(value, "Shard index");
  if (index > integer(count, "Shard count")) throw new Error("Shard index exceeds shard count");
  return index;
}

export function identity(spec, root) {
  const file = relative(root, spec.moduleId).replaceAll("\\", "/");
  if (!file || file.startsWith("../")) throw new Error(`Test outside root: ${spec.moduleId}`);
  return { file, project: spec.project.name, pool: spec.pool };
}

export function key(file) {
  return JSON.stringify([file.project, file.pool, file.file]);
}

export function inventory(files) {
  const paths = new Set();
  for (const file of files) {
    if (!file.file || typeof file.project !== "string" || typeof file.pool !== "string") {
      throw new Error("Invalid test identity");
    }
    if (paths.has(file.file)) throw new Error(`Duplicate test assignment: ${file.file}`);
    paths.add(file.file);
  }
  return [...files].sort((a, b) => compare(key(a), key(b)));
}

export function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function weight(file, timings) {
  const execution = timings.files[file.file] ?? timings.fallbackSeconds;
  const overhead = timings.overheadSeconds[file.project] ?? timings.overheadSeconds.default;
  if (!(execution > 0) || !(overhead >= 0) || !Number.isFinite(execution + overhead)) {
    throw new Error(`Invalid duration weight: ${file.file}`);
  }
  return execution + overhead;
}

export function partition(files, count, timings) {
  const shards = Array.from({ length: integer(count, "Shard count") }, () => ({
    files: [],
    cost: 0,
  }));
  const sorted = inventory(files).sort(
    (a, b) => weight(b, timings) - weight(a, timings) || compare(key(a), key(b)),
  );
  for (const file of sorted) {
    const target = shards.reduce((best, shard) => (shard.cost < best.cost ? shard : best));
    target.files.push(file);
    target.cost += weight(file, timings);
  }
  return shards.map((shard) => shard.files);
}

export function verifyFiles(actual, expected, label) {
  const a = inventory(actual).map(key);
  const b = inventory(expected).map(key);
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    const missing = b.filter((item) => !a.includes(item));
    const extra = a.filter((item) => !b.includes(item));
    throw new Error(
      `${label}: missing ${JSON.stringify(missing)}, unexpected ${JSON.stringify(extra)}`,
    );
  }
}
