// Copyright 2026 OpenObserve Inc.
//
// useEventsDetection.ts — what the selected stream was identified as, the OCSF
// classes it carries, and the evidence, for the Events page's source bar.

import { computed, ref, type Ref } from "vue";
import { useI18nTyped } from "@/types/i18n";
import { sigmaLogsourceLabel, type Classification } from "@/services/securitySources";
import { ocsfCategoryOf, ocsfClass } from "@/utils/security/ocsf";
import { FieldIndex, readPath } from "@/utils/security/fields";
import { ocsfClassCounts } from "@/composables/security/streamActivity";
import type { DetectedSummary } from "@/components/security/events/SecurityEventsDetected.vue";

/** OCSF's own name for class 0, which the entity pack writes; a spec identifier, never translated. */
const BASE_EVENT = "Base Event";

export function useEventsDetection({
  orgId,
  detected,
  fieldNames,
  events,
  selectedStream,
}: {
  orgId: Ref<string>;
  detected: Ref<Classification | null>;
  fieldNames: Ref<string[]>;
  events: Ref<Record<string, any>[]>;
  selectedStream: Ref<string | null>;
}) {
  const { t } = useI18nTyped();

  const OCSF_OBJECTS = [
    "actor",
    "src_endpoint",
    "dst_endpoint",
    "connection_info",
    "traffic",
    "http_request",
    "http_response",
    "process",
    "file",
    "device",
    "cloud",
    "api",
    "finding_info",
    "metadata",
  ];

  /** Row counts per class over the last hour, for streams that carry `class_uid`. */
  const classMix = ref<{ uid: number; n: number }[]>([]);
  async function loadClassMix(streamName: string) {
    classMix.value = [];
    if (!fieldNames.value.includes("class_uid")) return;
    const endUs = Date.now() * 1000;
    try {
      const counts = await ocsfClassCounts(
        orgId.value,
        streamName,
        "class_uid",
        endUs - 3_600_000_000,
        endUs,
      );
      if (selectedStream.value === streamName) classMix.value = counts;
    } catch {
      // The card falls back to the classes seen in the loaded rows.
    }
  }

  /** Most common `class_uid` in the loaded rows; OCSF-native types carry no fixed class. */
  const dominantClassUid = computed<number | null>(() => {
    if (classMix.value.length) return classMix.value[0].uid;
    const counts = new Map<number, number>();
    for (const row of events.value) {
      const uid = Number((row as Record<string, unknown>).class_uid);
      if (Number.isFinite(uid) && uid > 0) counts.set(uid, (counts.get(uid) ?? 0) + 1);
    }
    let best: number | null = null;
    for (const [uid, n] of counts) if (best == null || n > (counts.get(best) ?? 0)) best = uid;
    return best;
  });

  /** The class the rows carry when the stream has `class_uid`; 0 when every row is a Base Event. */
  const dataClassUid = computed<number | null>(() => {
    if (!fieldNames.value.includes("class_uid")) return null;
    if (dominantClassUid.value != null) return dominantClassUid.value;
    return events.value.some((row) => (row as Record<string, unknown>).class_uid != null)
      ? 0
      : null;
  });

  const detectedSummary = computed<DetectedSummary | null>(() => {
    const match = detected.value;
    if (!match) return null;
    // The data's own class wins: a generic pack writes Base Event whatever the catalog expects.
    const classUid = dataClassUid.value ?? (match.source.ocsfClass || dominantClassUid.value);
    const index = new FieldIndex(fieldNames.value);
    const mixTotal = classMix.value.reduce((sum, c) => sum + c.n, 0);
    const product = String(readPath(events.value[0] ?? null, "metadata.product.name") ?? "");
    return {
      label: match.source.label,
      product: product && product !== match.source.label ? product : "",
      classMix:
        classMix.value.length > 1 && mixTotal
          ? classMix.value
              .slice(0, 4)
              .map((c) =>
                t("siem.events.classShare", {
                  uid: c.uid,
                  pct: Math.round((c.n / mixTotal) * 100),
                }),
              )
              .join(", ")
          : "",
      objects: OCSF_OBJECTS.filter((o) => fieldNames.value.some((f) => f.startsWith(`${o}_`))),
      missing: (match.source.signals ?? [])
        .filter((spec) => !spec.split("|").some((option) => index.resolve(option)))
        .map((spec) => spec.split("|")[0])
        .join(", "),
      confidence: Math.round(match.confidence * 100),
      category: ocsfCategoryOf(classUid)?.name ?? "",
      classUid,
      className: classUid === 0 ? BASE_EVENT : (ocsfClass(classUid)?.name ?? ""),
      sigma: sigmaLogsourceLabel(match.source.sigma),
      evidence: [...match.matchedRequired, ...match.matchedSignals].join(", "),
      isSecurity: match.isSecurity,
    };
  });

  return { classMix, loadClassMix, detectedSummary };
}
