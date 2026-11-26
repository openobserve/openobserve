import { SCORE_CONFIGS } from "./experiment-score.mjs";

const PAGE_SIZE = 100;
const REQUEST_TIMEOUT_MS = 60_000;
const BACKOFF_MS = [1_000, 4_000];

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function messageOf(json, text) {
  for (const key of ["message", "error", "error_detail"]) {
    if (json && typeof json[key] === "string" && json[key]) return json[key];
  }
  return text.slice(0, 300) || "no response body";
}

// Plain JSON over HTTP. The Authorization value is the token as given and appears nowhere but the request header.
export class OpenObserveApi {
  constructor({ url, org, token, fetchImpl = globalThis.fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    this.base = `${url.replace(/\/+$/, "")}/api/${encodeURIComponent(org)}`;
    this.token = token;
    this.fetch = fetchImpl;
    this.sleep = sleep;
  }

  // Everything the harness sends is safe to repeat: reads, a keyed create, idempotent record batches, finalize and retry.
  async request(method, path, { query, body } = {}) {
    const params = Object.entries(query ?? {}).filter(([, value]) => value !== undefined);
    const url = `${this.base}${path}${params.length ? `?${new URLSearchParams(params.map(([k, v]) => [k, String(v)]))}` : ""}`;
    for (let attempt = 0; ; attempt += 1) {
      const retryable = attempt < BACKOFF_MS.length;
      let res;
      try {
        res = await this.fetch(url, {
          method,
          headers: { Authorization: this.token, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        if (retryable) {
          await this.sleep(BACKOFF_MS[attempt]);
          continue;
        }
        throw new ApiError(0, `${method} ${path} could not reach the server: ${err.cause?.code || err.message}`);
      }
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        // A non-JSON error body is reported as text below.
      }
      if (res.ok) return json;
      if ((res.status === 429 || res.status >= 500) && retryable) {
        await this.sleep(BACKOFF_MS[attempt]);
        continue;
      }
      throw new ApiError(res.status, `${method} ${path} failed (${res.status}): ${messageOf(json, text)}`);
    }
  }

  get(path, query) {
    return this.request("GET", path, { query });
  }

  post(path, body) {
    return this.request("POST", path, { body: body ?? {} });
  }
}

// By id first, then by name; a name that two datasets share is refused rather than guessed.
export async function resolveDataset(api, nameOrId) {
  const list = (await api.get("/datasets"))?.list ?? [];
  const byId = list.find(dataset => dataset.id === nameOrId);
  if (byId) return byId;
  const byName = list.filter(dataset => dataset.name === nameOrId);
  if (byName.length === 1) return byName[0];
  throw new Error(byName.length > 1 ? `dataset name "${nameOrId}" is ambiguous; pass the dataset id` : `no dataset named or numbered "${nameOrId}"`);
}

// Pages the whole snapshot at one pinned version: the first page names it, every later page asks for it and must get it back.
export async function readDatasetRows(api, datasetId) {
  const rows = [];
  let version;
  for (let from = 0; ;) {
    const page = await api.get(`/datasets/${encodeURIComponent(datasetId)}/rows`, { from, size: PAGE_SIZE, version });
    if (version === undefined) version = page.snapshotVersion;
    else if (page.snapshotVersion !== version) throw new Error(`dataset snapshot moved from version ${version} to ${page.snapshotVersion} while paging`);
    rows.push(...(page.rows ?? []));
    from += page.rows?.length ?? 0;
    if (!page.hasMore || !page.rows?.length) return { rows, snapshotVersion: version };
  }
}

// The experiment's own filter keeps a row when it carries every listed tag, so the same rule picks the local plan.
export function rowsWithTag(rows, tag) {
  return tag ? rows.filter(row => (row.tags ?? []).includes(tag)) : rows;
}

// The experiment's filter keeps the rows whose logical id is listed, so the same rule picks the local plan (dataset order).
export function rowsWithIds(rows, ids) {
  return rows.filter(row => ids.includes(row.logicalId));
}

export async function createExperiment(api, body) {
  return (await api.post("/experiments", body)).experiment;
}

export async function pageSlots(api, experimentId) {
  const slots = [];
  for (let from = 0; ;) {
    const page = await api.get(`/experiments/${encodeURIComponent(experimentId)}/slots`, { from, size: PAGE_SIZE });
    slots.push(...(page.slots ?? []));
    from += page.slots?.length ?? 0;
    if (!page.hasMore || !page.slots?.length) return { slots, total: page.total };
  }
}

// The experiment and every result slot's status; each page carries the experiment too, so the first one is kept.
export async function pageResults(api, experimentId) {
  const slots = [];
  let experiment = null;
  for (let page = 1; ; page += 1) {
    const detail = await api.get(`/experiments/${encodeURIComponent(experimentId)}`, { resultPage: page, resultPageSize: PAGE_SIZE });
    experiment ??= detail.experiment;
    slots.push(...(detail.results?.slots ?? []));
    if (!detail.results?.pagination?.hasMore || !detail.results?.slots?.length) return { experiment, slots };
  }
}

// Every score the harness reports must already be a numeric config; the harness never creates or changes one.
export async function scoreConfigProblems(api) {
  const list = (await api.get("/score_configs"))?.list ?? [];
  return Object.values(SCORE_CONFIGS).flatMap(name => {
    const config = list.find(item => item.name === name && item.isActive !== false);
    if (!config) return [`score config ${name} does not exist`];
    return String(config.dataType).toLowerCase() === "numeric" ? [] : [`score config ${name} is ${config.dataType}, not numeric`];
  });
}

// OpenRouter's public model list prices per token; the experiment freezes them per million tokens.
export async function fetchOpenRouterPricing({ slug, baseUrl = "https://openrouter.ai", fetchImpl = globalThis.fetch }) {
  const res = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/api/v1/models`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`OpenRouter model list failed (${res.status})`);
  const model = ((await res.json())?.data ?? []).find(item => item.id === slug);
  if (!model) throw new Error(`OpenRouter lists no model ${slug}`);
  const perMillion = value => {
    const rate = Number(value);
    return value === undefined || value === null || value === "" || !Number.isFinite(rate) || rate < 0 ? null : Number((rate * 1e6).toPrecision(12));
  };
  const usd = {
    input: perMillion(model.pricing?.prompt),
    output: perMillion(model.pricing?.completion),
    cache_read: perMillion(model.pricing?.input_cache_read),
    cache_write: perMillion(model.pricing?.input_cache_write),
  };
  if (usd.input === null || usd.output === null) throw new Error(`OpenRouter lists no prompt/completion price for ${slug}`);
  return { source: "openrouter", slug, fetchedAt: new Date().toISOString(), usd_per_million: usd };
}
