import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cpus, platform, arch } from "node:os";
import { ReportersMap, type Reporter, type TestModule, type TestRunEndReason } from "vitest/node";
import type { TestCase, Vitest } from "vitest/node";
import type { SerializedError } from "@vitest/utils";
import { digest, identity, inventory, partition, verifyFiles } from "./partition.mjs";
import { runIdentity, timings } from "./runtime.mjs";

export default class ShardReporter implements Reporter {
  private ctx!: Vitest;
  private blob!: InstanceType<typeof ReportersMap.blob>;
  private directory!: string;
  private manifest: ReturnType<typeof identity>[] = [];
  private hasCoverage = false;
  private collected = new Map<string, { id: string; name: string; mode: string }[]>();

  onInit(ctx: Vitest) {
    this.ctx = ctx;
    const shard = ctx.config.shard;
    if (!shard) throw new Error("Shard reporter requires --shard");
    this.directory = join(
      process.env.UI_TEST_REPORTS_DIRECTORY || join(ctx.config.root, ".vitest-reports"),
      `ui-unit-shard-${shard.index}-${shard.count}`,
    );
    this.blob = new ReportersMap.blob({ outputFile: join(this.directory, "blob.json") });
    this.blob.onInit(ctx);
  }

  async onTestRunStart() {
    this.manifest = inventory(
      (await this.ctx.globTestSpecifications()).map((spec) => identity(spec, this.ctx.config.root)),
    );
  }

  onTestModuleCollected(module: TestModule) {
    this.collected.set(
      module.id,
      [...module.children.allTests()].map((test) => {
        const { id, name, mode } = reportedTest(test);
        return { id, name, mode };
      }),
    );
  }

  onCoverage(coverage: unknown) {
    this.hasCoverage = coverage !== undefined;
    this.blob.onCoverage(coverage);
  }

  async onTestRunEnd(
    modules: ReadonlyArray<TestModule>,
    errors: ReadonlyArray<SerializedError>,
    reason: TestRunEndReason,
  ) {
    const shard = this.ctx.config.shard!;
    const files = modules.map((module) => ({
      ...identity(module.toTestSpecification(), this.ctx.config.root),
      state: module.state(),
      collected: this.collected.get(module.id),
      diagnostic: module.diagnostic(),
      tests: [...module.children.allTests()].map(reportedTest),
    }));
    if (reason === "passed") {
      verifyFiles(
        files,
        partition(this.manifest, shard.count, timings(this.ctx.config.root))[shard.index - 1],
        "Shard execution",
      );
    }
    await this.blob.onTestRunEnd(modules, errors);
    const metadata = {
      schema: 1,
      ...runIdentity(this.ctx.config.root),
      index: shard.index,
      count: shard.count,
      reason,
      hasCoverage: this.hasCoverage,
      unhandledErrors: errors,
      coordinatorResources: process.resourceUsage(),
      cpu: cpus()[0]?.model,
      platform: platform(),
      architecture: arch(),
      manifest: this.manifest,
      manifestDigest: digest(JSON.stringify(this.manifest)),
      blobDigest: digest(await readFile(join(this.directory, "blob.json"))),
      files,
    };
    await mkdir(this.directory, { recursive: true });
    await writeFile(join(this.directory, "metadata.json"), JSON.stringify(metadata));
  }
}

export function reportedTest(test: TestCase) {
  let mode = test.options.mode;
  for (let parent = test.parent; parent.type === "suite"; parent = parent.parent) {
    if (parent.options.mode === "skip" || parent.options.mode === "todo") {
      mode = parent.options.mode;
    }
  }
  const state = test.result().state;
  return {
    id: test.id,
    name: test.fullName,
    mode,
    // Vitest can leave descendants pending when a skipped ancestor stops traversal.
    state: state === "pending" && (mode === "skip" || mode === "todo") ? "skipped" : state,
  };
}
