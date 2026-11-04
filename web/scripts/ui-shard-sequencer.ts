// Balances --shard=i/N by recorded per-file seconds (greedy longest-first); refresh with scripts/ui-shard-durations.mjs.
import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { BaseSequencer } from 'vitest/node'
import type { TestSpecification } from 'vitest/node'

const durations: Record<string, number> = JSON.parse(
  readFileSync(new URL('./ui-shard-durations.json', import.meta.url), 'utf8'),
)

export function partition(paths: string[], count: number): string[][] {
  const known = Object.values(durations).sort((a, b) => a - b)
  const median = known[Math.floor(known.length / 2)] ?? 1
  const secs = (p: string) => durations[p] ?? median
  const bins: string[][] = Array.from({ length: count }, () => [])
  const load = new Array(count).fill(0)
  for (const p of [...paths].sort((a, b) => secs(b) - secs(a) || (a < b ? -1 : 1))) {
    const i = load.indexOf(Math.min(...load))
    bins[i].push(p)
    load[i] += secs(p)
  }
  return bins
}

export default class UiShardSequencer extends BaseSequencer {
  async shard(files: TestSpecification[]) {
    const { root, shard } = this.ctx.config
    if (!shard) return files
    const rel = (f: TestSpecification) => relative(root, f.moduleId)
    const bins = partition(files.map(rel), shard.count)
    const mine = new Set(bins[shard.index - 1])
    return files.filter((f) => mine.has(rel(f)))
  }
}
