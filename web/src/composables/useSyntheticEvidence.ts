// Copyright 2026 OpenObserve Inc.
//
// The evidence bundle for one ATTEMPT, fetched once and shared.
//
// It lives here rather than inside a component because two surfaces need the
// same bytes: the per-step "Page activity" block in the step expansion, and the
// run-level Evidence tab. Fetching in whichever mounted first would cost a
// second 256 KB round-trip for the other, and would let the two disagree.
//
// The raw `fetch` is deliberate. These are presigned S3/MinIO URLs; the
// `syntheticsService` axios wrapper attaches org auth headers, which a presigned
// URL rejects. That service therefore exposes URL builders only, and no body
// fetch exists to call.

import { computed, ref, watch, type Ref } from "vue";

import {
  indexEvidenceByStep,
  parseEvidenceNdjson,
  type EvidenceEvent,
} from "@/composables/synthetics/syntheticResultsSchema";

export type EvidenceStatus = "idle" | "loading" | "ready" | "error";

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
  const error = ref<string | null>(null);

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
    try {
      const res = await fetch(resolveUrl(key));
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
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
    load,
  };
}
