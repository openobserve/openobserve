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
//
// The evidence bundle for one ATTEMPT, fetched once and shared.
//
// It lives here rather than inside a component because two surfaces need the
// same bytes: the per-step "Page activity" block in the step expansion, and the
// run-level Evidence tab. Fetching in whichever mounted first would cost a
// second 256 KB round-trip for the other, and would let the two disagree.
//
// The raw `fetch` is deliberate. The bundle usually lives behind a presigned
// S3/MinIO URL; the `syntheticsService` axios wrapper attaches org auth headers,
// which a presigned URL rejects. That service therefore exposes URL builders
// only, and no body fetch exists to call.
//
// "Usually" is load-bearing. When the deployment stores artifacts on local disk
// — or when the batch presign call failed — the resolver hands back OUR proxy
// endpoint instead, and that one is cookie-authed. A cross-origin `fetch`
// omits cookies by default, so on any deployment where the API is on a
// different origin from the web app (every dev setup with `VITE_OPENOBSERVE_
// ENDPOINT` set) the proxy fetch arrived unauthenticated and the panel reported
// a bare "401 Unauthorized" that looked like the user's session had died.

import { computed, ref, watch, type Ref } from "vue";

import syntheticsService from "@/services/synthetics";
import {
  indexEvidenceByStep,
  parseEvidenceNdjson,
  type EvidenceEvent,
} from "@/composables/synthetics/syntheticResultsSchema";

export type EvidenceStatus = "idle" | "loading" | "ready" | "error";

/**
 * What went wrong, in terms the panel can write a sentence about.
 *
 * `unreachable` is the one that cannot carry an HTTP status: `fetch` rejects
 * before a response exists (DNS, TLS, offline, a CORS preflight the object
 * store refused), and reporting that as a server error sends the reader looking
 * in the wrong place.
 */
export type EvidenceErrorKind = "unauthorized" | "expired" | "missing" | "unreachable" | "server";

/**
 * HTTP status → what the reader should do about it.
 *
 * 401 and 403 are split because the fix differs and the two arrive from
 * different halves of the system: 401 is our proxy saying the session is not
 * valid, while 403 is overwhelmingly object storage rejecting a presigned
 * signature that has aged out — which Retry genuinely fixes, because the run
 * detail re-signs on reload.
 */
function classifyStatus(httpStatus: number): EvidenceErrorKind {
  if (httpStatus === 401) return "unauthorized";
  if (httpStatus === 403) return "expired";
  if (httpStatus === 404 || httpStatus === 410) return "missing";
  return "server";
}

/**
 * What to tell the reader, per kind.
 *
 * Exported because two surfaces render this same failure — the per-step "Page
 * activity" block and the run-level Evidence tab — and they must not describe
 * one error two ways.
 */
export const EVIDENCE_ERROR_MESSAGE: Record<EvidenceErrorKind, string> = {
  unauthorized: "synthetics.evidence.loadFailedUnauthorized",
  expired: "synthetics.evidence.loadFailedExpired",
  missing: "synthetics.evidence.loadFailedMissing",
  unreachable: "synthetics.evidence.loadFailedUnreachable",
  server: "synthetics.evidence.loadFailedServer",
};

/**
 * Retry re-requests the SAME url, so it only helps where that could now
 * succeed. A bundle that storage says is gone will not come back.
 */
export function evidenceErrorCanRetry(kind: EvidenceErrorKind | null): boolean {
  return kind !== "missing";
}

/**
 * An aged-out signature is re-minted by the run detail on load, and a dead
 * session can only be fixed by signing in again. Neither is reachable from a
 * Retry against the stale URL, so those two get a reload instead.
 */
export function evidenceErrorNeedsReload(kind: EvidenceErrorKind | null): boolean {
  return kind === "expired" || kind === "unauthorized";
}

export function useSyntheticEvidence(
  /** Object-storage key of the SELECTED attempt's bundle. Null when none exists. */
  evidenceKey: Ref<string | null>,
  /** Resolves a key to a fetchable URL. Already presigned for every attempt. */
  resolveUrl: (key: string) => string,
  /** step_id -> definition, from the run's own snapshot. */
  stepDefs: Ref<Map<string, { name: string; selector: string | null }>>,
  /** `evidence_truncated` from the record. */
  recordTruncated: Ref<boolean>,
) {
  const status = ref<EvidenceStatus>("idle");
  const events = ref<EvidenceEvent[]>([]);
  /** Raw technical detail — kept for support, never the headline. */
  const error = ref<string | null>(null);
  const errorKind = ref<EvidenceErrorKind | null>(null);

  /**
   * Fetch on demand, not with the record.
   *
   * Idempotent: returns immediately while a fetch is in flight and once one has
   * settled, so the two independent triggers (a step expanding, the tab opening)
   * are safe to fire in either order. `force` is the Retry path, and the only
   * way past a settled error.
   */
  async function load(force = false): Promise<void> {
    if (status.value === "loading") return;
    if (!force && (status.value === "ready" || status.value === "error")) return;
    const key = evidenceKey.value;
    if (!key) return;

    status.value = "loading";
    error.value = null;
    errorKind.value = null;
    try {
      const url = resolveUrl(key);
      // Cookies for our own proxy endpoint, never for object storage — see the
      // note at the top of this file. `omit` is explicit rather than defaulted
      // because the default differs by same- vs cross-origin, and that
      // difference is exactly what made this fail only on split-origin setups.
      const res = await fetch(url, {
        credentials: syntheticsService.isProxyArtifactUrl(url) ? "include" : "omit",
      });
      if (!res.ok) {
        errorKind.value = classifyStatus(res.status);
        throw new Error(`${res.status} ${res.statusText}`);
      }
      // Named here, once, so every consumer sees the same label. An unresolved
      // id renders as the id — never blank, and never guessed from the check's
      // current config, which would relabel history after an edit.
      events.value = parseEvidenceNdjson(await res.text()).map((e) => ({
        ...e,
        stepName: e.stepId ? stepDefs.value.get(e.stepId)?.name || e.stepId : null,
      }));
      status.value = "ready";
    } catch (e: any) {
      // Never an empty list on failure — "the fetch broke" and "the run was
      // quiet" are different findings and must not render the same.
      error.value = e?.message ?? String(e);
      // Only set when the throw came from a response above. Anything else never
      // reached a server, whatever the message happens to say.
      errorKind.value ??= "unreachable";
      events.value = [];
      status.value = "error";
    }
  }

  // Switching attempts changes the key. Reset rather than refetch: whether the
  // new bundle is wanted depends on what is on screen, which the caller knows
  // and this does not.
  watch(evidenceKey, () => {
    status.value = "idle";
    events.value = [];
    error.value = null;
    errorKind.value = null;
  });

  const index = computed(() => indexEvidenceByStep(events.value));

  return {
    status,
    events,
    eventsByStep: computed(() => index.value.byStep),
    unattributedCount: computed(() => index.value.unattributed.length),
    truncated: computed(
      () => recordTruncated.value || events.value.some((e) => e.kind === "truncation"),
    ),
    error,
    errorKind,
    load,
  };
}
