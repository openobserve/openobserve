/**
 * Deterministic Alert Library fixtures.
 *
 * The gallery reads a public S3 manifest whose entries/streams drift upstream.
 * For CI-stable e2e we intercept the manifest (and the per-alert files) with a
 * fixture we fully control, so readiness states, the >50 large-batch boundary
 * and error states are all reachable on demand. Install still hits the real
 * alert API — the served file body is a real, backend-valid alert (pass one
 * captured at setup via `fileTemplate`).
 */

const MANIFEST_GLOB = '**/alerts/manifest.json';
const FILE_GLOB = '**/alerts/packs/**';

/** One manifest entry with sensible defaults; override any field. */
function makeEntry(i, o = {}) {
  const pack = o.pack || 'observability';
  const category = o.category || 'test-signals';
  const name = o.name || `pw_lib_${i}`;
  const stream = o.stream || 'default';
  return {
    id: `${pack}/${name}`,
    name,
    pack,
    category,
    title: o.title || `PW Library Alert ${i}`,
    severity: o.severity || 'critical',
    description: o.description || `Synthetic library alert ${i} for e2e.`,
    stream,
    stream_type: o.stream_type || 'logs',
    query_type: o.query_type || 'sql',
    required_streams: o.required_streams || [stream],
    path: `packs/${pack}/alerts/${category}/${name}.json`,
    content_hash: o.content_hash || `pwhash${i}`,
  };
}

/** N entries sharing options — for the bulk / large-batch flows. */
function makeEntries(n, o = {}) {
  const prefix = o.namePrefix || 'pw_bulk';
  return Array.from({ length: n }, (_, i) =>
    makeEntry(i, { ...o, name: `${prefix}_${i}`, title: `${o.titlePrefix || 'Bulk Alert'} ${i}` }),
  );
}

/** A well-formed manifest around a set of entries. `packs` is derived. */
function buildManifest(entries, o = {}) {
  const byPack = new Map();
  for (const e of entries) {
    const p = byPack.get(e.pack) || { id: e.pack, alert_count: 0, categories: new Map() };
    p.alert_count += 1;
    p.categories.set(e.category, (p.categories.get(e.category) || 0) + 1);
    byPack.set(e.pack, p);
  }
  const packs = [...byPack.values()].map((p) => ({
    id: p.id,
    alert_count: p.alert_count,
    categories: [...p.categories.entries()].map(([id, alert_count]) => ({ id, alert_count })),
  }));
  return {
    format_version: o.format_version || '1.0',
    alert_count: entries.length,
    packs,
    alerts: entries,
  };
}

/**
 * A minimal, backend-valid scheduled SQL alert file for one entry.
 *
 * Prefer passing a `fileTemplate` captured from a real alert at setup — this
 * fallback is only for specs that never install (browse / filter / readiness),
 * where the body only has to render in the drawer.
 */
function buildAlertFile(entry, o = {}) {
  if (o.fileTemplate) {
    const clone = JSON.parse(JSON.stringify(o.fileTemplate));
    clone.name = entry.name;
    clone.stream_name = entry.stream;
    clone.stream_type = entry.stream_type;
    delete clone.id;
    return clone;
  }
  return {
    name: entry.name,
    org_id: o.orgId || 'default',
    stream_type: entry.stream_type,
    stream_name: entry.stream,
    is_real_time: false,
    enabled: true,
    description: entry.description,
    query_condition: {
      type: 'custom',
      conditions: { or: [{ column: 'level', operator: '=', value: 'error', ignore_case: false }] },
      sql: '',
      promql: null,
      promql_condition: null,
      aggregation: null,
      vrl_function: null,
    },
    trigger_condition: {
      period: 10,
      operator: '>=',
      threshold: 3,
      frequency: 10,
      silence: 10,
      timezone: 'UTC',
    },
    destinations: ['pw_placeholder_destination'],
    context_attributes: {},
    tags: [],
  };
}

/**
 * Intercept the manifest + alert files. `fileFor(entry)` yields the body served
 * for that entry's path; defaults to `buildAlertFile`. Pass `manifestBody` /
 * `status` to force an error state (malformed body, 500, bad version, …).
 */
async function routeLibrary(page, { manifest, entries = [], fileFor, manifestBody, status = 200 } = {}) {
  await page.route(MANIFEST_GLOB, (route) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: manifestBody !== undefined ? manifestBody : JSON.stringify(manifest),
    }),
  );
  const byPath = new Map(entries.map((e) => [e.path, e]));
  await page.route(FILE_GLOB, (route) => {
    const url = new URL(route.request().url());
    const key = url.pathname.replace(/^\/alerts\//, '');
    const entry = byPath.get(key) || entries.find((e) => url.pathname.endsWith(e.path));
    if (!entry) return route.fulfill({ status: 404, body: 'not found' });
    const body = fileFor ? fileFor(entry) : buildAlertFile(entry);
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

module.exports = {
  MANIFEST_GLOB,
  FILE_GLOB,
  makeEntry,
  makeEntries,
  buildManifest,
  buildAlertFile,
  routeLibrary,
};
