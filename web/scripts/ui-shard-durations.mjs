// Regenerate ui-shard-durations.json: download the ui-unit-blob-* artifacts of a green CI run (they expire after 1 day), then `node scripts/ui-shard-durations.mjs <dir-with-blob-json-files>`.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'flatted'

const dir = process.argv[2] ?? '.vitest-reports'
const out = {}
for (const f of readdirSync(dir, { recursive: true }).filter((n) => n.endsWith('.json'))) {
  for (const t of parse(readFileSync(join(dir, f), 'utf8'))[1]) {
    const ms = (t.result?.duration ?? 0) + (t.collectDuration ?? 0) + (t.setupDuration ?? 0) + (t.environmentLoad ?? 0) + (t.prepareDuration ?? 0)
    out[t.filepath.slice(t.filepath.indexOf('/web/') + 5)] = Math.round(ms / 100) / 10
  }
}
const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)))
writeFileSync(new URL('./ui-shard-durations.json', import.meta.url), JSON.stringify(sorted, null, 0).replace(/,"/g, ',\n"') + '\n')
console.log(Object.keys(sorted).length, 'files')
