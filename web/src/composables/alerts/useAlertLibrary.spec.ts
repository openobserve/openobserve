// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The store is the cache — not a module-level variable that happens to be
// warm. Several tests below deliberately seed the STORE while leaving the
// module cold (and vice versa) so that an implementation which memoises
// privately and only writes to Vuex cannot pass.
const CACHE_EXPIRY_MS = 10 * 60 * 1000;

function freshLibraryState() {
  return {
    manifest: null as unknown,
    lastFetched: null as number | null,
    cacheExpiry: CACHE_EXPIRY_MS,
    fileCache: {} as Record<string, unknown>,
  };
}

// Mirrors the real root-store mutations. `clearAlertLibrary` mutates IN PLACE,
// like the real one and its dashboardGallery neighbour — reassigning the object
// here would also reset cacheExpiry and quietly diverge from production.
const mockStore = {
  state: { alertLibrary: freshLibraryState() },
  commit: vi.fn((type: string, payload: unknown) => {
    const lib = mockStore.state.alertLibrary;
    if (type === "setAlertLibraryManifest") {
      lib.manifest = payload;
      lib.lastFetched = Date.now();
    } else if (type === "setAlertLibraryFile") {
      const { id, file } = payload as { id: string; file: unknown };
      lib.fileCache[id] = file;
    } else if (type === "clearAlertLibrary") {
      lib.manifest = null;
      lib.lastFetched = null;
      lib.fileCache = {};
    }
  }),
};

vi.mock("vuex", () => ({ useStore: () => mockStore }));

// Bound once at file evaluation, while the composable is re-imported per test.
// Safe only because this module is pure (string constants + a pure function);
// if it ever acquires state, import it inside beforeEach like the composable.
import {
  ALERT_LIBRARY_MANIFEST_URL,
  SUPPORTED_MANIFEST_MAJOR,
  alertFileUrl,
} from "@/constants/alertLibrary";

// The composable memoises its in-flight request at module scope (that is what
// makes concurrent callers share one GET), so each test needs a fresh module
// rather than a `resetForTests` hatch bolted onto the production API.
let useAlertLibrary: typeof import("./useAlertLibrary").useAlertLibrary;
let streamDataState: typeof import("./useAlertLibrary").streamDataState;

/** One manifest entry, shaped exactly like the live generator emits. */
function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: "k8s/pod_oom_killed",
    name: "pod_oom_killed",
    pack: "k8s",
    category: "pod",
    title: "Pod Oom Killed",
    severity: "critical",
    description: "Critical: Container was OOMKilled.",
    stream: "kube_pod_container_status_terminated_reason",
    stream_type: "metrics",
    query_type: "promql",
    required_streams: ["kube_pod_container_status_terminated_reason"],
    path: "packs/k8s/alerts/pod/pod_oom_killed.json",
    content_hash: "1c09e8f6ac33",
    ...overrides,
  };
}

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    format_version: "1.0.0",
    alert_count: 1,
    packs: [{ id: "k8s", categories: [{ id: "pod", alert_count: 1 }], alert_count: 1 }],
    alerts: [entry()],
    ...overrides,
  };
}

/**
 * Stream names the org ingests, grouped by stream type. Values are the newest
 * record's microsecond epoch; a bare name defaults to "ingesting now", since
 * most callers here only care that the stream exists.
 */
function streams(
  byType: Record<string, Array<string | [string, number]>>,
): Record<string, Map<string, number>> {
  return Object.fromEntries(
    Object.entries(byType).map(([type, names]) => [
      type,
      new Map(
        names.map((entry) => (Array.isArray(entry) ? entry : [entry, Date.now() * 1000])) as Array<
          [string, number]
        >,
      ),
    ]),
  );
}

const fetchMock = vi.fn();

function respondOnceWith(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  fetchMock.mockResolvedValueOnce({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  });
}

/** A 200 whose body is not JSON at all — S3 error documents are XML. */
function respondOnceWithUnparseableBody() {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError("Unexpected token < in JSON at position 0");
    },
  });
}

/** Names of the mutations committed so far, for "cached nothing" assertions. */
const committedTypes = () => mockStore.commit.mock.calls.map((call) => call[0]);

beforeEach(async () => {
  vi.clearAllMocks();
  // clearAllMocks does NOT drain a queued mockResolvedValueOnce; a test that
  // under-consumes would leak a stale response into the next one and produce a
  // misattributed failure. Reset the queue explicitly.
  fetchMock.mockReset();
  mockStore.state.alertLibrary = freshLibraryState();
  vi.stubGlobal("fetch", fetchMock);
  vi.resetModules();
  ({ useAlertLibrary, streamDataState } = await import("./useAlertLibrary"));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useAlertLibrary — loadManifest", () => {
  it("fetches the manifest from the single shared URL", async () => {
    respondOnceWith(manifest());
    await useAlertLibrary().loadManifest();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(ALERT_LIBRARY_MANIFEST_URL);
  });

  it("returns the parsed manifest", async () => {
    respondOnceWith(manifest());
    const result = await useAlertLibrary().loadManifest();

    expect(result.alert_count).toBe(1);
    expect(result.alerts[0].id).toBe("k8s/pod_oom_killed");
  });

  it("commits the fetched manifest to the store", async () => {
    respondOnceWith(manifest());
    const result = await useAlertLibrary().loadManifest();

    // Assert the PAYLOAD, not fields the mock's own commit sets — otherwise
    // this passes for any non-nullish commit.
    expect(mockStore.commit).toHaveBeenCalledWith("setAlertLibraryManifest", result);
  });

  it("serves a manifest cached in the STORE even with a cold module", async () => {
    // The gallery, rail and strip mount on different ticks and a route re-entry
    // re-imports nothing. If the read cache is a module-level variable rather
    // than the store, this refetches — which is the whole reason the cache
    // lives in Vuex.
    mockStore.state.alertLibrary.manifest = manifest({ alert_count: 42 });
    mockStore.state.alertLibrary.lastFetched = Date.now();

    const result = await useAlertLibrary().loadManifest();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.alert_count).toBe(42);
  });

  it("serves a warm cache without a second network call", async () => {
    respondOnceWith(manifest());
    await useAlertLibrary().loadManifest();
    await useAlertLibrary().loadManifest();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refetches after the store cache is cleared externally", async () => {
    // clearAlertLibrary is the only invalidation hook. If the composable reads
    // a private cache, clearing the store silently does nothing.
    respondOnceWith(manifest());
    await useAlertLibrary().loadManifest();

    mockStore.commit("clearAlertLibrary");
    respondOnceWith(manifest({ alert_count: 7 }));
    const result = await useAlertLibrary().loadManifest();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.alert_count).toBe(7);
  });

  it("refetches once the cache has expired", async () => {
    respondOnceWith(manifest());
    await useAlertLibrary().loadManifest();

    mockStore.state.alertLibrary.lastFetched = Date.now() - (CACHE_EXPIRY_MS + 1);
    respondOnceWith(manifest({ alert_count: 2 }));
    const result = await useAlertLibrary().loadManifest();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.alert_count).toBe(2);
  });

  it("honours the cache TTL configured on the store", async () => {
    // A composable that hardcoded its own TTL would pass every other cache
    // test here while ignoring the configured value.
    respondOnceWith(manifest());
    await useAlertLibrary().loadManifest();

    mockStore.state.alertLibrary.cacheExpiry = 0;
    respondOnceWith(manifest({ alert_count: 9 }));
    const result = await useAlertLibrary().loadManifest();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.alert_count).toBe(9);
  });

  it("refetches on demand with force, ignoring a warm cache", async () => {
    respondOnceWith(manifest());
    await useAlertLibrary().loadManifest();
    respondOnceWith(manifest({ alert_count: 3 }));
    const result = await useAlertLibrary().loadManifest({ force: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.alert_count).toBe(3);
  });

  it("shares one in-flight request between concurrent callers", async () => {
    // The page mounts the rail, the strip and the grid; all three ask for the
    // manifest in the same tick. Three GETs of the same object is waste the
    // dashboard gallery already pays — do not repeat it here.
    let release: () => void = () => {};
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        release = () => resolve({ ok: true, status: 200, json: async () => manifest() });
      }),
    );

    const lib = useAlertLibrary();
    const first = lib.loadManifest();
    const second = lib.loadManifest();
    release();
    const [a, b] = await Promise.all([first, second]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Identity AND substance: `toBe` alone is satisfied by undefined === undefined.
    expect(a).toBe(b);
    expect(a.alerts).toHaveLength(1);
  });

  it("does not let force join an already in-flight request", async () => {
    // The Retry path. If force joins the in-flight promise, a request that
    // hangs (no timeout on fetch) makes Retry a permanent no-op: every retry
    // re-awaits the same stuck promise. "Force" means "get me fresh data now",
    // which a request that started before the user asked cannot satisfy.
    let releaseFirst: () => void = () => {};
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseFirst = () =>
          resolve({ ok: true, status: 200, json: async () => manifest({ alert_count: 1 }) });
      }),
    );
    const lib = useAlertLibrary();
    const stuck = lib.loadManifest();

    respondOnceWith(manifest({ alert_count: 2 }));
    const forced = await lib.loadManifest({ force: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(forced.alert_count).toBe(2);

    releaseFirst();
    await stuck;
    // The forced result must survive: a late-settling first request must not
    // clear the in-flight slot belonging to a newer one, nor overwrite it.
    expect(mockStore.state.alertLibrary.manifest).toEqual(manifest({ alert_count: 2 }));
  });

  it("rejects on an HTTP error and caches nothing", async () => {
    respondOnceWith(null, { ok: false, status: 503 });

    await expect(useAlertLibrary().loadManifest()).rejects.toThrow();
    // Assert on the mutation TYPES: `not.toHaveBeenCalledWith(type, anything())`
    // does not match a `null` payload, so it passes for an implementation that
    // commits null on failure.
    expect(committedTypes()).not.toContain("setAlertLibraryManifest");
    expect(mockStore.state.alertLibrary.manifest).toBeNull();
  });

  it("rejects when the network call itself fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));

    await expect(useAlertLibrary().loadManifest()).rejects.toThrow();
    expect(committedTypes()).not.toContain("setAlertLibraryManifest");
  });

  it("rejects when the body is not JSON", async () => {
    // S3 answers some misconfigurations with an XML error document under a 200,
    // so `.json()` rejects rather than returning a wrong-shaped object.
    respondOnceWithUnparseableBody();

    await expect(useAlertLibrary().loadManifest()).rejects.toThrow();
    expect(committedTypes()).not.toContain("setAlertLibraryManifest");
  });

  it("retries after a failure instead of caching it", async () => {
    // A failed load must not poison the cache — the user clicking Retry has to
    // produce a real request.
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await expect(useAlertLibrary().loadManifest()).rejects.toThrow();

    respondOnceWith(manifest());
    const result = await useAlertLibrary().loadManifest();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.alert_count).toBe(1);
  });

  it("rejects a manifest whose major format version it cannot read", async () => {
    // Derived from the constant, not a hardcoded "2.0.0": otherwise the
    // constant is dead and an inlined `major !== 1` passes.
    respondOnceWith(manifest({ format_version: `${SUPPORTED_MANIFEST_MAJOR + 1}.0.0` }));

    await expect(useAlertLibrary().loadManifest()).rejects.toThrow();
    expect(committedTypes()).not.toContain("setAlertLibraryManifest");
  });

  it("accepts a newer minor version of the same major", async () => {
    // Minor bumps are additive (a new optional field), so an older client must
    // keep working — otherwise every backfill breaks every deployed UI.
    respondOnceWith(manifest({ format_version: `${SUPPORTED_MANIFEST_MAJOR}.7.0` }));

    const result = await useAlertLibrary().loadManifest();
    expect(result.format_version).toBe(`${SUPPORTED_MANIFEST_MAJOR}.7.0`);
  });

  it("accepts a bare-major and major.minor version string", async () => {
    // The generator writes "1.0.0" today, but the parse must not be so strict
    // that a future "1" or "1.2" is read as unsupported.
    respondOnceWith(manifest({ format_version: "1" }));
    await expect(useAlertLibrary().loadManifest()).resolves.toBeTruthy();

    mockStore.commit("clearAlertLibrary");
    respondOnceWith(manifest({ format_version: "1.2" }));
    await expect(useAlertLibrary().loadManifest()).resolves.toBeTruthy();
  });

  it("rejects an unparseable or missing format version", async () => {
    // Unset is not "assume compatible" — the field is the compatibility gate.
    for (const bad of [undefined, "", "v1.0.0", "not-a-version"]) {
      mockStore.commit("clearAlertLibrary");
      fetchMock.mockReset();
      respondOnceWith(manifest({ format_version: bad }));
      await expect(useAlertLibrary().loadManifest()).rejects.toThrow();
    }
  });

  it("rejects a response that is not a manifest at all", async () => {
    respondOnceWith({ nope: true });

    await expect(useAlertLibrary().loadManifest()).rejects.toThrow();
  });

  it("rejects a well-versioned document with no alerts array", async () => {
    // Distinct from the case above: format_version alone must not be enough to
    // pass validation, or a truncated upload renders as an empty gallery that
    // looks like "you have no alerts" rather than an error.
    respondOnceWith({ format_version: "1.0.0", packs: [] });

    await expect(useAlertLibrary().loadManifest()).rejects.toThrow();
  });

  it("rejects when alerts is present but not an array", async () => {
    respondOnceWith({ format_version: "1.0.0", alerts: { nope: true } });

    await expect(useAlertLibrary().loadManifest()).rejects.toThrow();
  });
});

describe("useAlertLibrary — loadAlertFile", () => {
  it("fetches the file at the entry's path", async () => {
    respondOnceWith({ name: "pod_oom_killed" });
    await useAlertLibrary().loadAlertFile(entry());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      alertFileUrl("packs/k8s/alerts/pod/pod_oom_killed.json"),
    );
  });

  it("returns the parsed alert file", async () => {
    respondOnceWith({ name: "pod_oom_killed", trigger_condition: { threshold: 1 } });
    const file = await useAlertLibrary().loadAlertFile(entry());

    expect(file.trigger_condition.threshold).toBe(1);
  });

  it("caches the file under its id AND content hash", async () => {
    // `id` is <pack>/<name>; bare `name` would collide across packs.
    //
    // The hash is in the key because the file cache has no TTL while the
    // MANIFEST refreshes every 10 minutes. Keyed on id alone, a mid-session
    // republish showed "update available" from the new manifest while install
    // POSTed the stale cached body — defeating the very field it cited.
    respondOnceWith({ name: "pod_oom_killed" });
    await useAlertLibrary().loadAlertFile(entry());

    expect(mockStore.state.alertLibrary.fileCache["k8s/pod_oom_killed@1c09e8f6ac33"]).toBeDefined();
  });

  it("refetches when the same alert is republished with a new hash", async () => {
    respondOnceWith({ name: "old-body" });
    const lib = useAlertLibrary();
    await lib.loadAlertFile(entry());

    respondOnceWith({ name: "new-body" });
    const updated = await lib.loadAlertFile(entry({ content_hash: "deadbeef9999" }));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(updated.name).toBe("new-body");
  });

  it("returns a clone, so a caller cannot mutate the cache", async () => {
    // The install path mutates the file it is handed (drops `id`, sets
    // folder/owner, replaces destinations). Handing out the cached Vuex proxy
    // would write those edits into the session cache for every later reader.
    respondOnceWith({ name: "pod_oom_killed", destinations: ["k8s_alert"] });
    const lib = useAlertLibrary();
    const first = await lib.loadAlertFile(entry());
    (first as Record<string, unknown>).destinations = ["mutated"];

    const second = await lib.loadAlertFile(entry());
    expect(second.destinations).toEqual(["k8s_alert"]);
  });

  it("serves a file cached in the STORE even with a cold module", async () => {
    // Same requirement as the manifest: the store is the cache. A module-scope
    // Map that is written through to Vuex but never read back passes every
    // other test in this block.
    mockStore.state.alertLibrary.fileCache["k8s/pod_oom_killed@1c09e8f6ac33"] = {
      name: "from-store",
    };

    const file = await useAlertLibrary().loadAlertFile(entry());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(file.name).toBe("from-store");
  });

  it("serves a cached file without a second network call", async () => {
    respondOnceWith({ name: "pod_oom_killed" });
    // Two separate composable calls, as two components would do.
    await useAlertLibrary().loadAlertFile(entry());
    await useAlertLibrary().loadAlertFile(entry());

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refetches a file after the store cache is cleared", async () => {
    respondOnceWith({ name: "pod_oom_killed" });
    await useAlertLibrary().loadAlertFile(entry());

    mockStore.commit("clearAlertLibrary");
    respondOnceWith({ name: "refetched" });
    const file = await useAlertLibrary().loadAlertFile(entry());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(file.name).toBe("refetched");
  });

  it("fetches each distinct alert separately", async () => {
    respondOnceWith({ name: "pod_oom_killed" });
    respondOnceWith({ name: "pod_evicted" });
    const lib = useAlertLibrary();

    await lib.loadAlertFile(entry());
    await lib.loadAlertFile(
      entry({
        id: "k8s/pod_evicted",
        name: "pod_evicted",
        path: "packs/k8s/alerts/pod/pod_evicted.json",
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight request for the same alert", async () => {
    // Bulk install requests N files at once, and a drawer reopened quickly asks
    // again before the first GET settles.
    let release: () => void = () => {};
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        release = () => resolve({ ok: true, status: 200, json: async () => ({ name: "once" }) });
      }),
    );

    const lib = useAlertLibrary();
    const first = lib.loadAlertFile(entry());
    const second = lib.loadAlertFile(entry());
    release();
    const [a, b] = await Promise.all([first, second]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Deep equality, NOT identity: both callers share the one request, but each
    // receives its own clone so that an installer mutating its copy cannot
    // corrupt the other caller's — or the session cache.
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a.name).toBe("once");
  });

  it("rejects on an HTTP error and caches nothing", async () => {
    respondOnceWith(null, { ok: false, status: 404 });

    await expect(useAlertLibrary().loadAlertFile(entry())).rejects.toThrow();
    expect(committedTypes()).not.toContain("setAlertLibraryFile");
    expect(
      mockStore.state.alertLibrary.fileCache["k8s/pod_oom_killed@1c09e8f6ac33"],
    ).toBeUndefined();
  });

  it("rejects when the network call itself fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));

    await expect(useAlertLibrary().loadAlertFile(entry())).rejects.toThrow();
    expect(committedTypes()).not.toContain("setAlertLibraryFile");
  });

  it("retries a failed file instead of caching the failure", async () => {
    // The drawer has a Retry button too.
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await expect(useAlertLibrary().loadAlertFile(entry())).rejects.toThrow();

    respondOnceWith({ name: "pod_oom_killed" });
    const file = await useAlertLibrary().loadAlertFile(entry());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(file.name).toBe("pod_oom_killed");
  });

  it("does not treat a prototype-named id as a cache hit", async () => {
    // `id` is untrusted and lands in an object key. A bare
    // `fileCache[entry.id]` returns Object.prototype.constructor for this —
    // truthy, so the fetch is skipped and a FUNCTION is handed back as the
    // alert file, which JSON.stringify turns into `undefined` at install time.
    //
    // NOTE: jsdom masks the sibling `__proto__` write hazard, so a test that
    // merely asserted "__proto__ is harmless" would pass and be wrong. The
    // real defence is the composite `id@hash` key, which cannot collide with
    // an Object.prototype member at all.
    respondOnceWith({ name: "genuinely-fetched" });
    const file = await useAlertLibrary().loadAlertFile(entry({ id: "constructor" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(file.name).toBe("genuinely-fetched");
    expect(typeof file).toBe("object");
  });

  it("rejects a file body that is not an alert object", async () => {
    // This payload becomes an alert-create POST. A null, an array or a string
    // must not reach that call.
    for (const bad of [null, [], "nope", 42]) {
      mockStore.commit("clearAlertLibrary");
      fetchMock.mockReset();
      respondOnceWith(bad);
      await expect(useAlertLibrary().loadAlertFile(entry())).rejects.toThrow();
    }
  });
});

describe("useAlertLibrary — isReady", () => {
  // Applicability detection: the differentiating feature. "Ready" means every
  // stream the alert queries exists in this org, of the RIGHT type. It does NOT
  // claim the signal itself is present (an alert on the `default` log stream
  // reads Ready almost everywhere); tightening that needs required_fields,
  // which the metadata backfill adds later.

  it("is ready when the required stream exists under the entry's stream type", () => {
    const available = streams({ metrics: ["kube_pod_container_status_terminated_reason"] });
    expect(useAlertLibrary().isReady(entry(), available)).toBe(true);
  });

  it("is not ready when the required stream is absent", () => {
    expect(useAlertLibrary().isReady(entry(), streams({ metrics: ["something_else"] }))).toBe(
      false,
    );
  });

  it("does not match a stream of the wrong type", () => {
    // Stream names are only unique within a type: a LOGS stream sharing the
    // name of the metrics stream this alert queries must not read as Ready, or
    // the install produces an alert that can never fire.
    const wrongType = streams({ logs: ["kube_pod_container_status_terminated_reason"] });
    expect(useAlertLibrary().isReady(entry(), wrongType)).toBe(false);
  });

  it("is not ready when the org has no streams of that type at all", () => {
    expect(useAlertLibrary().isReady(entry(), streams({ logs: ["anything"] }))).toBe(false);
    expect(useAlertLibrary().isReady(entry(), streams({}))).toBe(false);
  });

  it("reads required_streams, not the entry's display `stream` field", () => {
    // Both fields exist on an entry and today they agree, so an implementation
    // that checks `stream` passes almost every other case here. It is also the
    // exact shortcut the HTML mock took (`streams.has(a.stream)`), which makes
    // it the likeliest thing to get carried across during the port.
    const divergent = entry({ stream: "present_stream", required_streams: ["absent_stream"] });
    expect(useAlertLibrary().isReady(divergent, streams({ metrics: ["present_stream"] }))).toBe(
      false,
    );

    const inverse = entry({ stream: "absent_stream", required_streams: ["present_stream"] });
    expect(useAlertLibrary().isReady(inverse, streams({ metrics: ["present_stream"] }))).toBe(true);
  });

  it("requires every stream, not just one", () => {
    const multi = entry({ required_streams: ["stream_a", "stream_b"] });
    expect(useAlertLibrary().isReady(multi, streams({ metrics: ["stream_a"] }))).toBe(false);
    expect(useAlertLibrary().isReady(multi, streams({ metrics: ["stream_a", "stream_b"] }))).toBe(
      true,
    );
  });

  it("treats an alert with no required streams as ready", () => {
    // Vacuous truth, chosen deliberately: an alert that declares no data
    // prerequisite has nothing to be blocked on.
    expect(useAlertLibrary().isReady(entry({ required_streams: [] }), streams({}))).toBe(true);
  });

  it("returns false rather than throwing when required_streams is malformed", () => {
    // The manifest is a fetched document and the format promises forward
    // compatibility within a major, so a field can go missing or change shape.
    // isReady runs once per card across 87 cards — a throw here blanks the
    // whole gallery, so it must degrade to "not ready" instead.
    const available = streams({ metrics: ["kube_pod_container_status_terminated_reason"] });
    expect(() =>
      useAlertLibrary().isReady(entry({ required_streams: undefined }), available),
    ).not.toThrow();
    expect(useAlertLibrary().isReady(entry({ required_streams: undefined }), available)).toBe(
      false,
    );
    expect(useAlertLibrary().isReady(entry({ required_streams: "a_string" }), available)).toBe(
      false,
    );
  });

  it("does not throw on a prototype-named stream_type", () => {
    // `stream_type` comes from a fetched document, and a bare
    // `streamsByType[type]` returns a truthy FUNCTION for these — which then
    // throws on `.has(...)`. isReady runs once per card across 87 cards, so a
    // single poisoned entry would blank the entire gallery.
    const available = streams({ metrics: ["kube_pod_container_status_terminated_reason"] });
    for (const poisoned of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
      const bad = entry({ stream_type: poisoned });
      expect(() => useAlertLibrary().isReady(bad, available)).not.toThrow();
      expect(useAlertLibrary().isReady(bad, available)).toBe(false);
    }
  });

  it("matches stream names exactly, without case folding", () => {
    // O2 stream names are case-sensitive; a near-miss must read as missing
    // rather than quietly installing an alert that never fires.
    const shouty = streams({ metrics: ["KUBE_POD_CONTAINER_STATUS_TERMINATED_REASON"] });
    expect(useAlertLibrary().isReady(entry(), shouty)).toBe(false);
  });

  it("does not mutate the caller's stream map", () => {
    // Called once per card per render across 87 entries against a shared map;
    // compare contents, since a size check cannot catch delete-then-add.
    const available = streams({ metrics: ["kube_pod_container_status_terminated_reason"] });
    useAlertLibrary().isReady(entry(), available);

    expect([...available.metrics.keys()]).toEqual(["kube_pod_container_status_terminated_reason"]);
  });

  describe("streamDataState", () => {
    const DAY_US = 24 * 60 * 60 * 1000 * 1000;
    const nowUs = () => Date.now() * 1000;

    it("reports a stream that exists but has never ingested", () => {
      const available = streams({ metrics: [["kube_pod_container_status_terminated_reason", 0]] });

      expect(streamDataState(entry(), available).state).toBe("never");
    });

    it("reports a stream that has gone quiet, with when it last spoke", () => {
      const lastIngested = nowUs() - 3 * DAY_US;
      const available = streams({
        metrics: [["kube_pod_container_status_terminated_reason", lastIngested]],
      });

      const result = streamDataState(entry(), available);
      expect(result.state).toBe("stale");
      expect(result.lastIngestedMicros).toBe(lastIngested);
    });

    it("reports a stream taking data now as fresh", () => {
      const available = streams({ metrics: ["kube_pod_container_status_terminated_reason"] });

      expect(streamDataState(entry(), available).state).toBe("fresh");
    });

    it("reports a stream the org does not have as missing", () => {
      expect(streamDataState(entry(), streams({ metrics: ["something_else"] })).state).toBe(
        "missing",
      );
    });

    // One silent stream is enough to keep the alert quiet, so the worst state wins.
    it("takes the worst state and the oldest time across every required stream", () => {
      const fresh = nowUs();
      const stale = nowUs() - 5 * DAY_US;
      const available = streams({
        metrics: [
          ["a", fresh],
          ["b", stale],
        ],
      });

      const result = streamDataState(
        entry({ required_streams: ["a", "b"], stream_type: "metrics" }),
        available,
      );
      expect(result.state).toBe("stale");
      expect(result.lastIngestedMicros).toBe(stale);
    });

    // "Never ingested, as of a second ago" is a contradiction — that timestamp
    // belongs to the sibling stream, not to the verdict.
    it("reports no time when the verdict is not about a time", () => {
      const available = streams({
        metrics: [
          ["a", 0],
          ["b", Date.now() * 1000],
        ],
      });

      const result = streamDataState(
        entry({ required_streams: ["a", "b"], stream_type: "metrics" }),
        available,
      );
      expect(result.state).toBe("never");
      expect(result.lastIngestedMicros).toBeNull();
    });

    it("has nothing to block on when the alert declares no streams", () => {
      expect(streamDataState(entry({ required_streams: [] }), streams({})).state).toBe("fresh");
    });
  });

  describe("hardening found in review", () => {
    it("keeps the timeout armed while the BODY is read, not just the headers", async () => {
      // fetch settles on headers, so clearing the timer after it disarmed the
      // abort before .json() had read a byte. A 200 that then stalled left this
      // promise pending forever: isLoading stuck true, the in-flight slot
      // occupied, and the gallery on its skeleton with no error and no retry.
      vi.useFakeTimers();
      fetchMock.mockImplementationOnce((_url: string, init: { signal: AbortSignal }) =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            new Promise((_resolve, reject) => {
              init.signal.addEventListener("abort", () =>
                reject(new DOMException("Aborted", "AbortError")),
              );
            }),
        }),
      );

      const library = useAlertLibrary();
      const pending = library.loadManifest();
      const settled = pending.catch((error) => error);
      await vi.advanceTimersByTimeAsync(30_000);

      const error = await settled;
      expect(error).toBeInstanceOf(Error);
      // A timeout is a transport failure, not malformed JSON.
      expect((error as { code?: string }).code).toBe("network");
      expect(library.isLoading.value).toBe(false);
      vi.useRealTimers();
    });

    it("classifies a rejected path as a coded error, not a bare Error", async () => {
      // Every failure out of this module carries a code; callers switch on it.
      const library = useAlertLibrary();
      const error = await library
        .loadAlertFile(entry({ path: "../../../etc/passwd" }) as never)
        .catch((cause) => cause);

      expect((error as { code?: string }).code).toBe("malformed");
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
