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

import { computed, readonly, ref } from "vue";
import { useStore } from "vuex";

import {
  ALERT_LIBRARY_MANIFEST_URL,
  SUPPORTED_MANIFEST_MAJOR,
  alertFileUrl,
} from "@/constants/alertLibrary";
import type {
  AlertLibraryEntry,
  AlertLibraryFile,
  AlertLibraryManifest,
  StreamsByType,
} from "@/types/alertLibrary";

// Reads the curated alert library from S3: one GET for the manifest (which
// renders the entire gallery) and one GET per alert file, on drawer-open or
// install. No ListObjects — the manifest is the index.
//
// The STORE is the cache. The module-level state below is shared reactive state
// plus in-flight bookkeeping, following the house pattern documented in
// useHomeDashboard.ts and useFavoriteDashboards.ts: one source for all
// consumers, so the rail, strip and grid mounting in the same tick share a
// single request and a single loading flag.
//
// Everything the manifest carries is UNTRUSTED. It is a public bucket and its
// `id` / `stream_type` values end up as object keys, so every lookup here goes
// through hasOwn rather than a bare index.

/**
 * Machine-readable failure kinds, so callers can map to i18n copy.
 *
 * A union rather than a const enum object: only one of these is worth a Retry
 * button, and a `switch` over the union gets exhaustiveness checking for free.
 */
export type AlertLibraryErrorCode =
  | "network"
  | "http"
  | "unparseable"
  | "unsupported_version"
  | "malformed";

/**
 * Failure with a stable `code`.
 *
 * The message is a diagnostic, never UI copy — "version too new" and "network
 * down" need different treatment (only one of them is worth a Retry button),
 * and the component picks the i18n key off `code`.
 */
export class AlertLibraryError extends Error {
  constructor(
    readonly code: AlertLibraryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AlertLibraryError";
  }
}

/** Abandon a request that has not answered in this long. */
const REQUEST_TIMEOUT_MS = 30_000;

/** Shared reactive state — one source for all consumers. */
const isLoading = ref(false);
const error = ref<AlertLibraryError | null>(null);

/** In-flight manifest request, or null. Cleared as soon as it settles. */
let manifestInFlight: Promise<AlertLibraryManifest> | null = null;
/** Bumped per request; a superseded request must not roll the cache back. */
let manifestGeneration = 0;
/** Highest generation that has actually written to the cache. */
let manifestCommitted = 0;
/** In-flight per-alert requests, keyed like the cache. */
const fileInFlight = new Map<string, Promise<AlertLibraryFile>>();

const hasOwn = (object: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(object, key);

/**
 * Cache key for an alert file.
 *
 * Includes `content_hash` so a republished alert misses the cache naturally.
 * Keying on `id` alone defeated the very field it cited: the manifest refreshes
 * on a TTL, so a mid-session update showed "update available" from the new
 * manifest while install POSTed the stale cached body.
 *
 * It also defuses a prototype hazard for free — `id` is untrusted, and
 * "__proto__" as a bare key retargets the cache's prototype, whereas
 * "__proto__@<hash>" is an ordinary own key.
 */
const fileCacheKey = (entry: AlertLibraryEntry): string =>
  `${entry.id}@${entry.content_hash}`;

/** GET + parse, failing loudly and identifiably on every error path. */
async function fetchJson(url: string, options: { force?: boolean } = {}): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      // A forced reload must reach the network: `force` bypasses our Vuex cache
      // and in-flight slot, but without this the browser's own HTTP cache can
      // still re-serve a stale body for an object with a max-age.
      ...(options.force ? { cache: "reload" as RequestCache } : {}),
    });
  } catch (cause) {
    throw new AlertLibraryError(
      "network",
      `Alert library request failed for ${url}: ${(cause as Error).message}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new AlertLibraryError(
      "http",
      `Alert library request failed: ${response.status} for ${url}`,
    );
  }

  try {
    // Rejects on an XML error document served under a 200, which S3 does in
    // some misconfigurations. The URL is included — without it this surfaces as
    // a bare "Unexpected token <" with no clue which alert failed.
    return await response.json();
  } catch (cause) {
    throw new AlertLibraryError(
      "unparseable",
      `Alert library response was not JSON for ${url}: ${(cause as Error).message}`,
    );
  }
}

/**
 * Compatibility gate. Accepts "1", "1.2" and "1.2.3"; rejects a missing,
 * empty, non-numeric or differently-majored version.
 *
 * A minor bump is additive, so an older client must keep working — otherwise
 * every metadata backfill breaks every deployed UI.
 */
function assertSupportedVersion(formatVersion: unknown): void {
  if (typeof formatVersion !== "string" || !/^\d+(\.\d+){0,2}$/.test(formatVersion)) {
    throw new AlertLibraryError(
      "malformed",
      `Alert library manifest has an unreadable format_version: ${formatVersion}`,
    );
  }
  if (Number(formatVersion.split(".")[0]) !== SUPPORTED_MANIFEST_MAJOR) {
    throw new AlertLibraryError(
      "unsupported_version",
      `Alert library manifest format ${formatVersion} is not supported by this version of ` +
        `OpenObserve (expected major ${SUPPORTED_MANIFEST_MAJOR})`,
    );
  }
}

/**
 * Narrow a fetched document to a manifest.
 *
 * Validates the fields the UI actually dereferences, not just the envelope: an
 * `asserts` signature hands every caller a fully-typed manifest, so anything
 * left unchecked here becomes a TypeError deep in a render instead of a clean
 * failure at the boundary.
 */
function assertManifest(value: unknown): asserts value is AlertLibraryManifest {
  const fail = (why: string): never => {
    throw new AlertLibraryError("malformed", `Alert library manifest ${why}`);
  };

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("is not an object");
  }
  const candidate = value as Partial<AlertLibraryManifest>;
  assertSupportedVersion(candidate.format_version);

  // A truncated upload must read as an error, not as an empty gallery that
  // looks like "there are no alerts".
  if (!Array.isArray(candidate.alerts)) fail("has no alerts array");
  if (!Array.isArray(candidate.packs)) fail("has no packs array");

  for (const entry of candidate.alerts as AlertLibraryEntry[]) {
    if (typeof entry !== "object" || entry === null) fail("contains a non-object alert entry");
    // The four fields every consumer dereferences: the cache key, the URL, the
    // readiness check and the type-scoped lookup.
    if (typeof entry.id !== "string" || entry.id === "") fail("contains an alert with no id");
    if (typeof entry.content_hash !== "string") fail(`entry ${entry.id} has no content_hash`);
    if (typeof entry.path !== "string" || entry.path === "") fail(`entry ${entry.id} has no path`);
    if (typeof entry.stream_type !== "string") fail(`entry ${entry.id} has no stream_type`);
    if (!Array.isArray(entry.required_streams)) {
      fail(`entry ${entry.id} has no required_streams array`);
    }
  }
}

function assertAlertFile(value: unknown): asserts value is AlertLibraryFile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AlertLibraryError(
      "malformed",
      "Alert library file is not an alert object",
    );
  }
}

/**
 * Group stream names by stream type, for `isReady`.
 *
 * `useStreams().getStreams("all", false)` resolves to a flat list whose members
 * each carry their own `stream_type`; this is the adapter between that and the
 * readiness check, so the three Phase-2 surfaces do not each write their own.
 */
export function toStreamsByType(
  list: Array<{ name?: string; stream_type?: string }> | null | undefined,
): StreamsByType {
  const grouped: StreamsByType = {};
  for (const stream of list ?? []) {
    if (!stream || typeof stream.name !== "string" || typeof stream.stream_type !== "string") {
      continue;
    }
    (grouped[stream.stream_type] ??= new Set<string>()).add(stream.name);
  }
  return grouped;
}

export function useAlertLibrary() {
  const store = useStore();

  /** The cache block, read fresh each time — never captured in a closure. */
  const cache = () => store.state.alertLibrary;

  const manifest = computed<AlertLibraryManifest | null>(
    () => (cache().manifest as AlertLibraryManifest | null) ?? null,
  );

  const isManifestFresh = (): boolean => {
    const { manifest: cached, lastFetched, cacheExpiry } = cache();
    return cached !== null && lastFetched !== null && Date.now() - lastFetched < cacheExpiry;
  };

  /**
   * Load the manifest, preferring the store cache.
   *
   * @param options.force refetch even when the cached copy is fresh, bypassing
   * the in-flight slot and the browser HTTP cache too. Joining an in-flight
   * request here would make Retry a permanent no-op against a stalled server.
   */
  const loadManifest = async (
    options: { force?: boolean } = {},
  ): Promise<AlertLibraryManifest> => {
    if (!options.force) {
      if (isManifestFresh()) return cache().manifest as AlertLibraryManifest;
      if (manifestInFlight) return manifestInFlight;
    }

    const generation = ++manifestGeneration;
    isLoading.value = true;

    const request = (async () => {
      const body = await fetchJson(ALERT_LIBRARY_MANIFEST_URL, { force: options.force });
      assertManifest(body);
      // Committed only after validation, and only if no NEWER response has
      // already landed — a slow earlier request must not roll the cache back.
      // Compared against what was committed rather than what was merely
      // started, so a superseded-but-successful response still populates an
      // otherwise-empty cache when the newer request fails.
      if (generation > manifestCommitted) {
        manifestCommitted = generation;
        store.commit("setAlertLibraryManifest", body);
      }
      return body;
    })();
    manifestInFlight = request;

    try {
      const result = await request;
      error.value = null;
      return result;
    } catch (cause) {
      error.value = cause as AlertLibraryError;
      throw cause;
    } finally {
      // Only clear the slot if it is still OURS: a forced request may have
      // replaced it, and a late-settling earlier request must not evict the
      // newer one. Cleared on failure too, so Retry issues a real request.
      if (manifestInFlight === request) {
        manifestInFlight = null;
        isLoading.value = false;
      }
    }
  };

  /**
   * Load one alert file, preferring the store cache.
   *
   * Cached for the session keyed by content hash, so a republished alert is
   * refetched while an unchanged one is free. There are ~87 files (~138 KB).
   *
   * Returns a CLONE. The cached value is a reactive Vuex proxy, and the install
   * path mutates the file it is handed (dropping `id`, setting folder/owner,
   * replacing destinations) — handing out the cached object would write those
   * edits into the session cache for every later reader.
   */
  const loadAlertFile = async (entry: AlertLibraryEntry): Promise<AlertLibraryFile> => {
    const key = fileCacheKey(entry);
    const files = cache().fileCache;
    if (hasOwn(files, key)) {
      return structuredClone(toRawFile(files[key]));
    }

    const pending = fileInFlight.get(key);
    if (pending) return pending.then((file) => structuredClone(file));

    const request = (async () => {
      const body = await fetchJson(alertFileUrl(entry.path));
      assertAlertFile(body);
      store.commit("setAlertLibraryFile", { id: key, file: body });
      return body;
    })();

    fileInFlight.set(key, request);
    try {
      return structuredClone(await request);
    } finally {
      // Identity-guarded so a late-settling request cannot evict a newer one.
      if (fileInFlight.get(key) === request) fileInFlight.delete(key);
    }
  };

  /**
   * Drop everything cached, including work already in flight.
   *
   * Clearing the store alone is not enough: a request that started before the
   * clear would settle afterwards and silently repopulate the cache it was
   * supposed to have invalidated.
   */
  const clearLibrary = (): void => {
    manifestGeneration += 1;
    manifestCommitted = manifestGeneration;
    manifestInFlight = null;
    fileInFlight.clear();
    isLoading.value = false;
    error.value = null;
    store.commit("clearAlertLibrary");
  };

  /**
   * Whether every stream this alert queries exists in the org, of the right type.
   *
   * Applicability detection — the reason the gallery can grey out an alert that
   * would never fire. Note what it does NOT claim: that the signal is present.
   * An alert on the `default` log stream reads ready in almost any org;
   * tightening that needs `required_fields`, which the backfill adds.
   *
   * Type-aware because stream names are only unique within a type: a logs
   * stream sharing a metrics stream's name must not read as ready.
   *
   * Never throws. It runs once per card across 87 cards, so a malformed entry
   * degrades to "not ready" rather than blanking the gallery — which is also
   * why `stream_type` is looked up through hasOwn and the result is type-checked
   * before use: a `stream_type` of "constructor" would otherwise return a
   * truthy non-Set and throw on `.has`.
   */
  const isReady = (entry: AlertLibraryEntry, streamsByType: StreamsByType): boolean => {
    const required = entry?.required_streams;
    if (!Array.isArray(required)) return false;
    // Vacuous truth: an alert declaring no data prerequisite has nothing to be
    // blocked on.
    if (required.length === 0) return true;

    const streamType = entry?.stream_type;
    if (typeof streamType !== "string" || !streamsByType || !hasOwn(streamsByType, streamType)) {
      return false;
    }
    const available = streamsByType[streamType];
    if (!(available instanceof Set)) return false;

    return required.every((streamName) => available.has(streamName));
  };

  return {
    // Shared reactive state, read-only to consumers.
    manifest,
    isLoading: readonly(isLoading),
    error: readonly(error),
    // Actions.
    loadManifest,
    loadAlertFile,
    clearLibrary,
    isReady,
  };
}

/** Unwrap a Vuex reactive proxy so structuredClone sees a plain object. */
function toRawFile(value: unknown): AlertLibraryFile {
  return JSON.parse(JSON.stringify(value)) as AlertLibraryFile;
}
