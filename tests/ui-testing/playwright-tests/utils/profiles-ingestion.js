// Profiles OTLP/JSON ingestion, readiness gates and the hand-computable reference dataset (profiles-feature.md §7).

const crypto = require('crypto');
const { expect } = require('@playwright/test');
const testLogger = require('./test-logger.js');
const { getAuthHeaders, getOrgIdentifier } = require('./cloud-auth.js');
const { ingestBase } = require('./ingest-url.js');

const SECOND_NS = 1_000_000_000;
const MINUTE_MS = 60_000;
const READY_TIMEOUT_MS = 60_000;
const READY_INTERVALS = [500, 1_000, 2_000];

const XSS_FUNCTION = '<img src=x onerror=window.__xss=1>';

function baseUrl() {
  return (process.env.ZO_BASE_URL || '').replace(/\/+$/, '');
}

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

/** Unique per-run stream name, e.g. `e2e_prof_views_1a2b3c4d`. */
function uniqueProfilesStream(spec) {
  return `e2e_prof_${spec}_${randomHex(4)}`;
}

/** Start of the current minute − 10 min + 5 s, in ms: every profile sits alone in a one-minute bucket. */
function referenceT0Ms(now = Date.now()) {
  return Math.floor(now / MINUTE_MS) * MINUTE_MS - 10 * MINUTE_MS + 5_000;
}

/** Absolute window around the reference data in microseconds (T0 − 1 min … T0 + 9 min). */
function referenceWindowUs(t0Ms) {
  return { from: (t0Ms - MINUTE_MS) * 1000, to: (t0Ms + 9 * MINUTE_MS) * 1000 };
}

function resourceAttrs({ service, version, env, instance, host, exe, extra = {} }) {
  const attrs = [];
  const add = (key, value) => {
    if (value !== undefined && value !== null) attrs.push({ key, value: { stringValue: String(value) } });
  };
  add('service.name', service);
  add('service.version', version);
  add('deployment.environment', env);
  add('service.instance.id', instance);
  add('host.name', host);
  add('process.executable.name', exe);
  for (const [key, value] of Object.entries(extra)) add(key, value);
  return attrs;
}

/** One OTLP/JSON export with a shared dictionary; a sample is { stack: [leaf … root], value, link? }. */
function buildProfilesRequest(resources) {
  const strings = [''];
  const stringIndex = new Map([['', 0]]);
  const functions = [{}];
  const functionIndex = new Map();
  const locations = [{}];
  const stacks = [{}];
  const stackIndex = new Map();
  const links = [{}];
  const linkIndex = new Map();

  const str = (value) => {
    if (!stringIndex.has(value)) {
      stringIndex.set(value, strings.length);
      strings.push(value);
    }
    return stringIndex.get(value);
  };
  const fn = (name) => {
    if (!functionIndex.has(name)) {
      functionIndex.set(name, functions.length);
      functions.push({ nameStrindex: str(name) });
      locations.push({ lines: [{ functionIndex: functions.length - 1 }] });
    }
    return functionIndex.get(name);
  };
  const stack = (frames) => {
    const key = frames.join('\u0000');
    if (!stackIndex.has(key)) {
      stackIndex.set(key, stacks.length);
      stacks.push({ locationIndices: frames.map((frame) => fn(frame)) });
    }
    return stackIndex.get(key);
  };
  const link = ({ traceId, spanId }) => {
    const key = `${traceId}/${spanId}`;
    if (!linkIndex.has(key)) {
      linkIndex.set(key, links.length);
      links.push({ traceId, spanId });
    }
    return linkIndex.get(key);
  };

  const resourceProfiles = resources.map((resource) => ({
    resource: { attributes: resourceAttrs(resource.attrs) },
    scopeProfiles: [
      {
        scope: { name: 'e2e-profiles', version: '1.0.0' },
        profiles: resource.profiles.map((profile) => ({
          sampleType: { typeStrindex: str(profile.type), unitStrindex: str(profile.unit) },
          timeUnixNano: String(BigInt(resource.timeMs) * 1_000_000n),
          durationNano: String(10 * SECOND_NS),
          samples: profile.samples.map((sample) => ({
            stackIndex: stack(sample.stack),
            values: [String(sample.value)],
            ...(sample.link ? { linkIndex: link(sample.link) } : {}),
          })),
        })),
      },
    ],
  }));

  return {
    dictionary: {
      stringTable: strings,
      functionTable: functions,
      locationTable: locations,
      stackTable: stacks,
      linkTable: links,
    },
    resourceProfiles,
  };
}

const cpu = (samples) => ({ type: 'cpu', unit: 'nanoseconds', samples });
const s = (frames, value, link) => ({ stack: frames.split('<-'), value, ...(link ? { link } : {}) });

/** The reference dataset of feature §7; `link` is the trace/span C2's process_payment sample carries. */
function referenceResources(t0Ms, link) {
  const at = (minutes) => t0Ms + minutes * MINUTE_MS;
  const wide = Array.from({ length: 300 }, (_, i) =>
    s(`wide_fn_${String(i).padStart(3, '0')}<-wide_root<-catalog_main`, (i + 1) * 100_000),
  );
  const deep = {
    stack: Array.from({ length: 1100 }, (_, i) => `deep_${String(i).padStart(4, '0')}`),
    value: SECOND_NS,
  };
  return [
    {
      attrs: { service: 'checkout', version: 'v1.4.0', env: 'prod', instance: 'checkout-1', host: 'host-a' },
      timeMs: at(0),
      profiles: [
        cpu([
          s('db_query<-handle_order<-main', 2 * SECOND_NS),
          s('json_encode<-handle_order<-main', SECOND_NS),
          s('handle_order<-main', SECOND_NS),
        ]),
      ],
    },
    {
      attrs: { service: 'payments', version: 'v1.4.0', env: 'prod', instance: 'payments-1', host: 'host-d' },
      timeMs: at(2),
      profiles: [
        cpu([s('charge_card<-process<-main', 1_200_000_000), s('validate<-process<-main', 800_000_000)]),
        {
          type: 'alloc_space',
          unit: 'bytes',
          samples: [s('alloc_buffer<-process<-main', 1_048_576), s('alloc_json<-process<-main', 524_288)],
        },
        { type: 'inuse_space', unit: 'bytes', samples: [s('cache_put<-process<-main', 2_097_152)] },
      ],
    },
    {
      attrs: { service: 'checkout', version: 'v1.5.0', env: 'prod', instance: 'checkout-2', host: 'host-b' },
      timeMs: at(4),
      profiles: [
        cpu([
          s('db_query<-handle_order<-main', 4 * SECOND_NS),
          s('json_encode<-handle_order<-main', 3 * SECOND_NS),
          s('handle_order<-main', 500_000_000),
          s(`${XSS_FUNCTION}<-handle_order<-main`, 100_000_000),
          s('process_payment<-handle_order<-main', 250_000_000, link),
        ]),
      ],
    },
    {
      attrs: { service: 'payments', version: 'v1.5.0', env: 'prod', instance: 'payments-2', host: 'host-e' },
      timeMs: at(5),
      profiles: [
        cpu([s('charge_card<-process<-main', 1_500_000_000)]),
        { type: 'inuse_space', unit: 'bytes', samples: [s('cache_put<-process<-main', 4_194_304)] },
      ],
    },
    {
      attrs: { service: 'checkout', version: 'v1.5.0', env: 'stage', instance: 'checkout-3', host: 'host-c' },
      timeMs: at(6),
      profiles: [cpu([s('gc_sweep<-runtime_main', 150_000_000)])],
    },
    {
      attrs: { service: 'catalog', version: 'v1.5.0', env: 'stage', instance: 'catalog-1', host: 'host-f' },
      timeMs: at(7),
      profiles: [cpu([...wide, deep])],
    },
  ];
}

/** Twelve checkout versions (v1.1.0 … v1.12.0), one cpu profile each, for Breakdown "Others". */
function manyVersionsResources(t0Ms) {
  return Array.from({ length: 12 }, (_, i) => ({
    attrs: { service: 'checkout', version: `v1.${i + 1}.0`, env: 'prod', instance: `mv-${i}`, host: 'host-mv' },
    timeMs: t0Ms + (i % 9) * MINUTE_MS,
    profiles: [cpu([s('work<-main', (i + 1) * 100_000_000)])],
  }));
}

/** One profile with no service.name (falls back to unknown_service:mybin). */
function unknownServiceResources(t0Ms) {
  return [{ attrs: { exe: 'mybin' }, timeMs: t0Ms, profiles: [cpu([s('bin_work<-bin_main', SECOND_NS)])] }];
}

/** Rows whose every value is 0: the stream has a service but no samples to draw. */
function zeroValueResources(t0Ms) {
  return [{ attrs: { service: 'zero-svc' }, timeMs: t0Ms, profiles: [cpu([s('idle<-main', 0)])] }];
}

/** Rows with only service.name, so the stream has no label to compare by. */
function noLabelResources(t0Ms) {
  return [{ attrs: { service: 'bare-svc' }, timeMs: t0Ms, profiles: [cpu([s('bare_work<-main', SECOND_NS)])] }];
}

async function postProfiles(request, stream, body) {
  const org = getOrgIdentifier();
  const url = `${ingestBase(baseUrl())}/api/${org}/v1/profiles`;
  const response = await request.post(url, {
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json', 'stream-name': stream },
    data: body,
  });
  const text = await response.text();
  if (response.status() !== 200) {
    throw new Error(`Profiles ingest to ${stream} failed: ${response.status()} ${text}`);
  }
  if (text.includes('partialSuccess')) {
    throw new Error(`Profiles ingest to ${stream} rejected some profiles: ${text}`);
  }
  testLogger.info('Ingested profiles', { stream, resources: body.resourceProfiles.length });
}

async function ingestProfiles(request, stream, resources) {
  await postProfiles(request, stream, buildProfilesRequest(resources));
}

/** Ingests the reference dataset into a fresh stream, gates on its exact totals, returns { stream, t0Ms, window, link }. */
async function seedReferenceStream(request, spec) {
  const stream = uniqueProfilesStream(spec);
  const t0Ms = referenceT0Ms();
  const link = { traceId: randomHex(16), spanId: randomHex(8) };
  await ingestProfiles(request, stream, referenceResources(t0Ms, link));
  const window = referenceWindowUs(t0Ms);
  await waitForProfilesTotal(request, stream, {
    window,
    service: 'checkout',
    type: 'cpu',
    unit: 'nanoseconds',
    total: 12_000_000_000,
  });
  await waitForProfilesTotal(request, stream, {
    window,
    service: 'catalog',
    type: 'cpu',
    unit: 'nanoseconds',
    total: 5_515_000_000,
  });
  await waitForProfilesTotal(request, stream, {
    window,
    service: 'payments',
    type: 'inuse_space',
    unit: 'bytes',
    total: 6_291_456,
  });
  return { stream, t0Ms, window, link };
}

/** Ingests `build(t0Ms)` into a fresh stream and gates on `service` (and its exact cpu `total` when given). */
async function seedProfilesStream(request, spec, build, { service, total }) {
  const stream = uniqueProfilesStream(spec);
  const t0Ms = referenceT0Ms();
  await ingestProfiles(request, stream, build(t0Ms));
  const window = referenceWindowUs(t0Ms);
  await waitForProfilesService(request, stream, { window, service });
  if (total !== undefined) {
    await waitForProfilesTotal(request, stream, { window, service, type: 'cpu', unit: 'nanoseconds', total });
  }
  return { stream, t0Ms, window };
}

async function profilesApi(request, method, stream, path, body) {
  const org = getOrgIdentifier();
  const url = `${baseUrl()}/api/${org}/${stream}/profiles/${path}`;
  const options = { headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } };
  const response =
    method === 'post' ? await request.post(url, { ...options, data: body }) : await request.get(url, options);
  const text = await response.text();
  return { status: response.status(), body: text ? JSON.parse(text) : null, text };
}

/** Polls /profiles/merge until `total` matches exactly; fails loudly with the last response. */
async function waitForProfilesTotal(request, stream, { window, service, type, unit, filters = [], total }) {
  const body = {
    start_time: window.from,
    end_time: window.to,
    ...(service ? { service_name: service } : {}),
    profile_type: type,
    profile_unit: unit,
    filters,
  };
  let last = null;
  await expect
    .poll(
      async () => {
        last = await profilesApi(request, 'post', stream, 'merge', body);
        return last.status === 200 ? last.body?.total : `HTTP ${last.status} ${last.text.slice(0, 300)}`;
      },
      { timeout: READY_TIMEOUT_MS, intervals: READY_INTERVALS, message: `profiles merge total on ${stream}` },
    )
    .toBe(total);
  return last.body;
}

/** Polls /profiles/meta until `service` is listed in the window. */
async function waitForProfilesService(request, stream, { window, service }) {
  let last = null;
  await expect
    .poll(
      async () => {
        last = await profilesApi(request, 'get', stream, `meta?start_time=${window.from}&end_time=${window.to}`);
        return last.status === 200 ? last.body?.services ?? [] : [`HTTP ${last.status}`];
      },
      { timeout: READY_TIMEOUT_MS, intervals: READY_INTERVALS, message: `profiles meta services on ${stream}` },
    )
    .toContain(service);
  return last.body;
}

/** Deletes a profiles stream; logs instead of throwing so teardown never masks a test failure. */
async function deleteProfilesStream(request, stream) {
  const org = getOrgIdentifier();
  try {
    const response = await request.delete(
      `${baseUrl()}/api/${org}/streams/${stream}?type=profiles&delete_all=true`,
      { headers: getAuthHeaders() },
    );
    testLogger.info('Deleted profiles stream', { stream, status: response.status() });
  } catch (error) {
    testLogger.warn('Profiles stream delete failed', { stream, error: error.message });
  }
}

/** Ingests one trace whose single span carries `traceId`/`spanId`, into its own traces stream. */
async function ingestLinkedTrace(request, stream, { traceId, spanId, startMs, durationMs = 1_000, service = 'checkout' }) {
  const org = getOrgIdentifier();
  const start = BigInt(startMs) * 1_000_000n;
  const end = start + BigInt(durationMs) * 1_000_000n;
  const body = {
    resourceSpans: [
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: service } }] },
        scopeSpans: [
          {
            scope: { name: 'e2e-profiles', version: '1.0.0' },
            spans: [
              {
                traceId,
                spanId,
                name: 'process_payment',
                kind: 2,
                startTimeUnixNano: String(start),
                endTimeUnixNano: String(end),
                attributes: [],
                status: { code: 1 },
              },
            ],
          },
        ],
      },
    ],
  };
  const response = await request.post(`${ingestBase(baseUrl())}/api/${org}/v1/traces`, {
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json', 'stream-name': stream },
    data: body,
  });
  if (response.status() !== 200) {
    throw new Error(`Trace ingest to ${stream} failed: ${response.status()} ${await response.text()}`);
  }
  await waitForTraceSearchable(request, stream, { traceId, startMs, endMs: startMs + durationMs });
}

async function waitForTraceSearchable(request, stream, { traceId, startMs, endMs }) {
  const org = getOrgIdentifier();
  await expect
    .poll(
      async () => {
        const response = await request.post(`${baseUrl()}/api/${org}/_search?type=traces`, {
          headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
          data: {
            query: {
              sql: `SELECT trace_id FROM "${stream}" WHERE trace_id = '${traceId}'`,
              start_time: (startMs - MINUTE_MS) * 1000,
              end_time: (endMs + MINUTE_MS) * 1000,
              from: 0,
              size: 10,
            },
          },
        });
        if (response.status() !== 200) return -response.status();
        return ((await response.json()).hits ?? []).length;
      },
      { timeout: READY_TIMEOUT_MS, intervals: READY_INTERVALS, message: `trace ${traceId} searchable in ${stream}` },
    )
    .toBeGreaterThan(0);
}

async function deleteTracesStream(request, stream) {
  const org = getOrgIdentifier();
  try {
    await request.delete(`${baseUrl()}/api/${org}/streams/${stream}?type=traces&delete_all=true`, {
      headers: getAuthHeaders(),
    });
  } catch (error) {
    testLogger.warn('Traces stream delete failed', { stream, error: error.message });
  }
}

module.exports = {
  XSS_FUNCTION,
  MINUTE_MS,
  randomHex,
  uniqueProfilesStream,
  referenceT0Ms,
  referenceWindowUs,
  buildProfilesRequest,
  referenceResources,
  manyVersionsResources,
  unknownServiceResources,
  zeroValueResources,
  noLabelResources,
  ingestProfiles,
  seedReferenceStream,
  seedProfilesStream,
  waitForProfilesTotal,
  waitForProfilesService,
  deleteProfilesStream,
  ingestLinkedTrace,
  deleteTracesStream,
};
