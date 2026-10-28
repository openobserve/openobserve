import { BaseSequencer, type TestSpecification } from "vitest/node";
import { compare, identity, key, partition, shardIndex, weight } from "./partition.mjs";
import { settings, timings } from "./runtime.mjs";

export default class DurationSequencer extends BaseSequencer {
  async shard(specs: TestSpecification[]) {
    const { shards } = settings(this.ctx.config.root);
    const shard = this.ctx.config.shard;
    if (!shard || shard.count !== shards) throw new Error("Unexpected shard count");
    const selected = partition(
      specs.map((spec) => identity(spec, this.ctx.config.root)),
      shards,
      timings(this.ctx.config.root),
    )[shardIndex(shard.index, shards) - 1];
    const keys = new Set(selected.map(key));
    return specs.filter((spec) => keys.has(key(identity(spec, this.ctx.config.root))));
  }

  async sort(specs: TestSpecification[]) {
    const durations = timings(this.ctx.config.root);
    return [...specs].sort((a, b) => {
      const aFile = identity(a, this.ctx.config.root);
      const bFile = identity(b, this.ctx.config.root);
      return (
        a.project.config.sequence.groupOrder - b.project.config.sequence.groupOrder ||
        compare(a.project.name, b.project.name) ||
        Number(b.project.config.isolate) - Number(a.project.config.isolate) ||
        weight(bFile, durations) - weight(aFile, durations) ||
        compare(key(aFile), key(bFile))
      );
    });
  }
}
