import fs from "node:fs";
import os from "node:os";
import v8 from "node:v8";

export default class Measure {
  onInit(ctx) {
    this.ctx = ctx;
  }
  onTestRunStart() {
    const c = this.ctx.config;
    this.options = {
      rootEnvironment: this.ctx.getRootProject().config.environment,
      maxWorkers: c.maxWorkers,
      pool: c.pool,
      isolate: c.isolate,
      watch: c.watch,
      shuffle: c.sequence.shuffle,
      cacheDir: this.ctx.vite.config.cacheDir,
      coverage: {
        provider: c.coverage.provider,
        reportsDirectory: c.coverage.reportsDirectory,
        include: c.coverage.include,
        exclude: c.coverage.exclude,
        thresholds: c.coverage.thresholds ?? null,
        reporters: c.coverage.reporter,
      },
      projects: this.ctx.projects.map((p) => ({
        name: p.name,
        environment: p.config.environment,
        maxWorkers: p.config.maxWorkers ?? c.maxWorkers,
        pool: p.config.pool,
        isolate: p.config.isolate,
        setupFiles: p.config.setupFiles,
        cacheDir: p.vite.config.cacheDir,
      })),
    };
  }
  onTestCaseResult(test) {
    fs.appendFileSync(
      process.env.BENCH_REPORT + ".progress.jsonl",
      JSON.stringify({ name: test.fullName, result: test.result() }) + "\n",
    );
  }
  onTestRunEnd(modules, errors, reason) {
    const runtime = {
      node: process.version,
      vitest: JSON.parse(
        fs.readFileSync(
          new URL("../node_modules/vitest/package.json", import.meta.url),
        ),
      ).version,
      platform: process.platform,
      architecture: process.arch,
      heapLimit: v8.getHeapStatistics().heap_size_limit,
      nodeOptions: process.env.NODE_OPTIONS ?? null,
      availableParallelism: os.availableParallelism(),
      cpuCount: os.cpus().length,
      cpuModels: [...new Set(os.cpus().map((c) => c.model))].sort(),
    };
    fs.writeFileSync(
      process.env.BENCH_REPORT,
      JSON.stringify(
        {
          reason,
          errors,
          runtime,
          options: this.options,
          records: modules.map((m) => ({
            file: m.relativeModuleId,
            project: m.project.name,
            pool: m.toTestSpecification().pool,
            state: m.state(),
            diagnostic: m.diagnostic(),
            tests: [...m.children.allTests()].map((t) => ({
              name: t.fullName,
              mode: t.options.mode,
              state: t.result().state,
            })),
          })),
        },
        null,
        2,
      ),
    );
  }
}
