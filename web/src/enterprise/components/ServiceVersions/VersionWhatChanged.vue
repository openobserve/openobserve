<template>
  <div class="flex flex-col gap-2" data-test="svcver-what-changed">
    <template v-if="!restricted"
      ><div
        v-for="note in coarseNotes"
        :key="note"
        class="flex flex-wrap items-center gap-2"
        :data-test="`svcver-detail-insufficient-${note}`"
      >
        <span class="text-text-secondary text-xs">{{
          detailGapText(note === "traces" ? "endpoint" : "error", gapSpan, t)
        }}</span>
      </div>
      <p v-if="hourlyArm" class="text-text-secondary text-xs" data-test="svcver-arm-hourly">
        {{ t("serviceVersions.compare.armHourly") }}
      </p>
      <div v-if="early && errorRows.length" class="flex flex-wrap items-center gap-2">
        <OTag
          variant="default-soft"
          :label="raw(t('serviceVersions.compare.tooEarlyCount', { n: formatCount(sampleSoFar) }))"
          data-test="svcver-too-early"
        /><span class="text-text-secondary text-xs">{{
          t("serviceVersions.compare.newErrorsEarly", { version: result.arms.a.version })
        }}</span>
      </div>
      <template v-if="!all && errorRows.length"
        ><div class="flex flex-wrap items-center gap-2">
          <span class="text-text-secondary text-xs">{{
            t("serviceVersions.compare.errorTypes")
          }}</span
          ><span class="text-text-secondary text-xs">{{
            t("serviceVersions.compare.errorTypesLegend", {
              before: result.arms.b.version,
              after: result.arms.a.version,
            })
          }}</span
          ><OButton
            v-if="allErrors"
            class="ms-auto"
            variant="ghost-primary"
            size="xs"
            data-test="svcver-evidence-allErrors-service"
            @click="visit(allErrors)"
            >{{
              t("serviceVersions.compare.allErrorsOn", { version: result.arms.a.version })
            }}</OButton
          >
        </div>
        <OTable
          :data="errorRows"
          :columns="errorColumns"
          row-key="id"
          pagination="none"
          sorting="none"
          :show-global-filter="false"
          :fill-height="false"
          frame
          data-test="svcver-error-table"
          ><template #cell-change="{ row }"
            ><OTag
              :variant="changeVariant(row)"
              :label="raw(t(`serviceVersions.compare.changeKind.${row.kind}`))"
              :data-test="`svcver-error-${row.kind}-${row.key}`" /></template
          ><template #cell-errorType="{ row }"
            ><span class="truncate font-mono text-xs">{{ row.label }}</span></template
          ><template #cell-source="{ row }"
            ><OTag
              :variant="row.source === 'rum' ? 'cyan-soft' : 'teal-soft'"
              shape="pill"
              :icon="row.source === 'rum' ? 'devices' : 'account-tree'"
              :label="raw(t(`serviceVersions.compare.${row.source}`))" /></template
          ><template #cell-before="{ row }"
            ><span
              class="block text-end tabular-nums"
              :data-test="`svcver-error-before-${row.key}`"
              >{{ formatCount(row.before) }}</span
            ></template
          ><template #cell-after="{ row }"
            ><span
              class="block text-end tabular-nums"
              :data-test="`svcver-error-counts-${row.key}`"
              >{{ formatCount(row.after) }}</span
            ></template
          ><template #cell-link="{ row }"
            ><OButton
              v-if="row.link"
              variant="ghost-primary"
              size="xs"
              :data-test="`svcver-evidence-${row.source === 'rum' ? 'sessions' : 'allErrors'}-${row.key}`"
              @click="visit(row.link)"
              >{{
                t(
                  row.source === "rum"
                    ? "serviceVersions.evidence.sessions"
                    : "serviceVersions.evidence.traces",
                )
              }}</OButton
            ><OButton
              v-if="row.details"
              variant="ghost-primary"
              size="xs"
              :data-test="`svcver-evidence-errorDetails-${row.key}`"
              @click="visit(row.details)"
              >{{ t("serviceVersions.evidence.errorDetails") }}</OButton
            ></template
          ></OTable
        ></template
      ><template v-if="endpointRows.length"
        ><span class="text-text-secondary mt-1 text-xs" data-test="svcver-endpoints-title">{{
          hasBaseline(result)
            ? t("serviceVersions.compare.endpointsTitle")
            : t("serviceVersions.compare.endpointsIn", { version: result.arms.a.version })
        }}</span
        ><OTable
          :data="endpointRows"
          :columns="endpointColumns"
          row-key="id"
          pagination="none"
          sorting="none"
          :show-global-filter="false"
          :fill-height="false"
          frame
          data-test="svcver-endpoint-table"
          ><template #cell-endpoint="{ row }"
            ><span
              class="truncate font-mono text-xs"
              :data-test="`svcver-endpoint-${row.endpoint.source_stream}-${row.endpoint.operation}`"
              >{{ row.endpoint.operation }}</span
            ></template
          ><template #cell-p95="{ row }"
            ><span class="block text-end tabular-nums" :class="toneClass(row.p95Tone)"
              ><NotComparedMark v-if="row.p95 === null" /><template v-else>{{
                row.p95
              }}</template></span
            ></template
          ><template #cell-errors="{ row }"
            ><span
              class="flex items-center justify-end gap-1.5 tabular-nums"
              :class="toneClass(row.errorTone)"
              :data-test="`svcver-endpoint-errors-${row.endpoint.source_stream}-${row.endpoint.operation}`"
              ><OTag
                v-if="row.presence"
                :variant="row.presence.variant"
                :label="raw(t(`serviceVersions.compare.changeKind.${row.presence.kind}`))"
                :data-test="`svcver-endpoint-${row.presence.kind}-${row.endpoint.source_stream}-${row.endpoint.operation}`"
              /><NotComparedMark v-if="row.errors === null" /><span v-else-if="row.errors">{{
                row.errors
              }}</span></span
            ></template
          ><template #cell-calls="{ row }"
            ><span
              class="block text-end tabular-nums"
              :data-test="`svcver-endpoint-counts-${row.endpoint.source_stream}-${row.endpoint.operation}`"
              >{{ formatCount(row.endpoint.requests_a) }}</span
            ></template
          ><template #cell-link="{ row }"
            ><OButton
              v-if="row.slow"
              variant="ghost-primary"
              size="xs"
              :data-test="`svcver-evidence-slowTraces-${row.endpoint.source_stream}-${row.endpoint.operation}`"
              @click="visit(row.slow)"
              >{{ t("serviceVersions.evidence.slowTraces") }}</OButton
            ></template
          ></OTable
        ></template
      >
      <p
        v-if="!endpointRows.length && !errorRows.length && !coarseNotes.length"
        data-test="svcver-evidence-empty"
        class="text-text-secondary text-compact"
      >
        {{ t("serviceVersions.compare.empty") }}
      </p></template
    >
  </div>
</template>
<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { raw, useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import NotComparedMark from "./NotComparedMark.vue";
import { detailGapText } from "@/utils/serviceVersionsCopy";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import type { CompareResponse, Endpoint, MetricDelta } from "@/services/service_versions";
import { armWhere, traceEvidence, rumEvidence, serviceErrors, errorDetails } from "./deepLinks";
import { errorCounts, rumEarly, type ErrorKind as ChangeKind } from "./errorTypes";
import { leadingVerdict, verdictCode } from "./verdictText";
import {
  hasBaseline,
  formatCount,
  formatMetric,
  formatPoints,
  percentChange,
  meetsFloor,
  type TileMetric,
  type TileTone,
} from "./VersionSummaryTiles.format";
const ERROR_CHANGE_WIDTH = 160;
interface ErrorRow {
  id: string;
  key: string;
  kind: ChangeKind;
  label: string;
  source: "rum" | "traces";
  before: number;
  after: number;
  early: boolean;
  link?: string;
  details?: string;
}
const props = defineProps<{ org: string; result: CompareResponse; all?: boolean }>();
const { t } = useI18nTyped();
const router = useRouter();
const restricted = computed(
  () => props.result.live_verdict?.restricted || props.result.stored_verdict?.restricted,
);
// A section whose detail rows miss part of an arm cannot say what is new or gone.
const endpointCoarse = computed(
  () => props.result.traces?.endpoint_detail?.status === "insufficient",
);
const errorCoarse = computed(() => props.result.rum?.error_detail?.status === "insufficient");
// A one-window compare (no baseline) has only its own window to miss.
const gapSpan = computed(() => (hasBaseline(props.result) ? "both" : "this"));
const coarseNotes = computed(() =>
  ([endpointCoarse.value && "traces", !props.all && errorCoarse.value && "rum"] as const).filter(
    (note): note is "traces" | "rum" => Boolean(note),
  ),
);
// Downsampled history only keeps whole hours, so an old arm's counts are hour-aligned (D240).
const hourlyArm = computed(() =>
  [props.result.arms.a, props.result.arms.b].some((arm) => arm?.basis === "hourly"),
);
// Too early only describes a compare with no verdict yet; a judged one shows its New rows plainly.
const judged = computed(() => {
  const leading = leadingVerdict(props.result);
  const code = leading && verdictCode(leading);
  return Boolean(code && !["insufficient", "first_version"].includes(code));
});
const early = computed(() => errorRows.value.some((row) => row.early));
const sampleSoFar = computed(() =>
  Math.min(props.result.traces?.requests?.a ?? 0, props.result.traces?.requests?.b ?? Infinity),
);
const traceErrorRows = computed<ErrorRow[]>(() =>
  (props.result.traces?.endpoints || []).flatMap((row) => {
    const before = row.errors_b ?? 0;
    const after = row.errors_a ?? 0;
    if (!before && !after) return [];
    if (endpointCoarse.value && (!before || !after)) return [];
    const kind: ChangeKind = endpointCoarse.value
      ? "shared"
      : row.introduced || !before
        ? "introduced"
        : !after
          ? "fixed"
          : "shared";
    const side = kind === "fixed" ? "b" : "a";
    return [
      {
        id: `traces:${row.source_stream}:${row.operation}`,
        key: `${row.source_stream}-${row.operation}`,
        kind,
        label: row.operation,
        source: "traces" as const,
        before,
        after,
        early:
          !judged.value &&
          Boolean(row.early || props.result.traces?.insufficient || !floorMet(row, "error_rate")),
        link: traceEvidence(
          props.org,
          props.result.service,
          side === "b" ? props.result.arms.b : props.result.arms.a,
          armWhere(props.result, side),
          row,
        ),
      },
    ];
  }),
);
const rumErrorRows = computed<ErrorRow[]>(() =>
  (errorCoarse.value
    ? (["shared"] as const)
    : (["introduced", "fixed", "shared"] as const)
  ).flatMap((kind) =>
    (props.result.rum?.error_types?.[kind] || []).map((row) => {
      const key = row.fingerprint || row.error_type || row.error_message || "";
      return {
        id: `rum:${kind}:${key}`,
        key,
        kind,
        label: row.error_message || row.error_type || key,
        source: "rum" as const,
        ...errorCounts(kind, row),
        early: !judged.value && rumEarly(props.result),
        details: errorDetails(props.org, row),
        link: rumEvidence(
          props.org,
          props.result.service,
          kind === "fixed" ? props.result.arms.b : props.result.arms.a,
          row,
        ),
      };
    }),
  ),
);
const errorRows = computed(() =>
  restricted.value
    ? []
    : [...rumErrorRows.value, ...traceErrorRows.value].toSorted(
        (left, right) =>
          ["introduced", "shared", "fixed"].indexOf(left.kind) -
          ["introduced", "shared", "fixed"].indexOf(right.kind),
      ),
);
const allErrors = computed(() => {
  const stream = props.result.traces?.endpoints?.[0]?.source_stream;
  return stream
    ? serviceErrors(
        props.org,
        props.result.service,
        props.result.arms.a,
        armWhere(props.result, "a"),
        stream,
      )
    : undefined;
});
// An endpoint seen on one side only is judged on the side that exists; the other side's zero is not a sample.
function oneSided(row: Endpoint) {
  return row.status === "a_only" || row.status === "b_only" || !row.requests_a || !row.requests_b;
}
function floorMet(row: Endpoint, metric: TileMetric) {
  return meetsFloor(
    metric,
    oneSided(row)
      ? Math.max(row.requests_a, row.requests_b)
      : Math.min(row.requests_a, row.requests_b),
  );
}
function ownErrorRate(row: Endpoint) {
  return row.requests_a ? (row.errors_a ?? 0) / row.requests_a : 0;
}
function deltaTone(row: Endpoint, metric: "p95" | "error_rate"): TileTone {
  const value = row[metric];
  if (
    !value ||
    value.insufficient ||
    !floorMet(row, metric) ||
    value.straddles_zero ||
    !value.delta
  )
    return "neutral";
  return value.delta > 0 ? "crit" : "good";
}
// Below a floor the change is factual but uncoloured; only a judged neutral is noise.
function noise(row: Endpoint, metric: "p95" | "error_rate", value: MetricDelta) {
  return deltaTone(row, metric) === "neutral" && !value.insufficient && floorMet(row, metric);
}
// A new endpoint's errors count as new errors once its floor is met.
function newErrorTone(row: Endpoint): TileTone | undefined {
  if (!oneSided(row) || !row.requests_a || endpointCoarse.value) return undefined;
  return row.errors_a && floorMet(row, "error_rate") ? "crit" : "neutral";
}
// Null renders the one not-compared marker.
function p95Change(row: Endpoint): string | null {
  const value = row.p95;
  if (!value || value.insufficient || value.a == null || !value.b) return null;
  if (noise(row, "p95", value)) return t("serviceVersions.compare.tile.noise");
  return percentChange(value.a - value.b, value.b);
}
// Coarse detail cannot tell a new or gone endpoint from one the other arm's rows missed.
function presence(row: Endpoint): { kind: ChangeKind; variant: BadgeVariant } | undefined {
  if (!oneSided(row) || endpointCoarse.value || !hasBaseline(props.result)) return undefined;
  if (row.requests_a) {
    const early = !judged.value && !floorMet(row, "error_rate");
    return { kind: "introduced", variant: early ? "default-outline" : "error-soft" };
  }
  return row.requests_b ? { kind: "fixed", variant: "success-soft" } : undefined;
}
function errorChange(row: Endpoint): string | null {
  const value = row.error_rate;
  const seen = presence(row);
  if (!hasBaseline(props.result) && row.requests_a)
    return formatMetric("error_rate", ownErrorRate(row), t);
  // A new endpoint's change is its whole rate, in points like every other row.
  if (seen?.kind === "introduced") return formatPoints(ownErrorRate(row), t);
  if (seen?.kind === "fixed") return "";
  if (!value || value.insufficient || value.a == null || value.b == null) return null;
  if (noise(row, "error_rate", value)) return t("serviceVersions.compare.tile.noise");
  return formatPoints(value.a - value.b, t);
}
const endpointRows = computed(() => {
  if (restricted.value) return [];
  const rows = (props.result.traces?.endpoints || [])
    .map((endpoint) => ({
      id: `${endpoint.source_stream}:${endpoint.operation}`,
      endpoint,
      score: Math.max(
        endpoint.p95?.a != null && endpoint.p95?.b && !endpoint.p95.insufficient
          ? endpoint.p95.a / endpoint.p95.b - 1
          : 0,
        oneSided(endpoint)
          ? ownErrorRate(endpoint)
          : endpoint.error_rate?.insufficient
            ? 0
            : (endpoint.error_rate?.a ?? 0) - (endpoint.error_rate?.b ?? 0),
      ),
      p95: p95Change(endpoint),
      p95Tone: deltaTone(endpoint, "p95"),
      errors: errorChange(endpoint),
      presence: presence(endpoint),
      errorTone: newErrorTone(endpoint) ?? deltaTone(endpoint, "error_rate"),
      slow: slowTraces(endpoint),
    }))
    .toSorted((left, right) => right.score - left.score);
  return props.all ? rows : rows.slice(0, 5);
});
// Slow means slower than the endpoint's baseline p95; a new endpoint has none, so the service's p95 stands in.
function slowTraces(endpoint: Endpoint) {
  if (!endpoint.requests_a) return undefined;
  const service = props.result.traces?.p95;
  const fallback = service?.b || service?.a;
  const threshold =
    endpoint.baseline_p95_us ?? (oneSided(endpoint) && fallback ? Math.round(fallback) : undefined);
  return traceEvidence(
    props.org,
    props.result.service,
    props.result.arms.a,
    armWhere(props.result, "a"),
    { ...endpoint, baseline_p95_us: threshold },
    true,
  );
}
// Every row of a RUM-only service is RUM, so a Source column would say nothing.
const rumOnly = computed(() => !props.result.traces && Boolean(props.result.rum));
const errorColumns = computed<OTableColumnDef<ErrorRow>[]>(() => [
  { id: "change", header: t("serviceVersions.compare.column.change"), size: 80 },
  { id: "errorType", header: t("serviceVersions.compare.column.errorType"), size: 240 },
  ...(rumOnly.value
    ? []
    : [{ id: "source", header: t("serviceVersions.compare.column.source"), size: 100 }]),
  { id: "before", header: raw(props.result.arms.b.version), size: 70, meta: { align: "right" } },
  { id: "after", header: raw(props.result.arms.a.version), size: 70, meta: { align: "right" } },
  { id: "link", header: raw(""), size: 180, isAction: true },
]);
const endpointColumns = computed<OTableColumnDef<(typeof endpointRows.value)[number]>[]>(() => [
  { id: "endpoint", header: t("serviceVersions.compare.column.endpoint"), size: 260 },
  {
    id: "p95",
    header: t("serviceVersions.compare.column.p95Change"),
    size: 90,
    meta: { align: "right" },
  },
  {
    id: "errors",
    header: hasBaseline(props.result)
      ? t("serviceVersions.compare.column.errorChange")
      : t("serviceVersions.compare.tile.error_rate"),
    size: ERROR_CHANGE_WIDTH,
    minSize: ERROR_CHANGE_WIDTH,
    meta: { align: "right" },
  },
  {
    id: "calls",
    header: t("serviceVersions.compare.column.callsOn", { version: props.result.arms.a.version }),
    size: 110,
    meta: { align: "right" },
  },
  { id: "link", header: raw(""), size: 100, isAction: true },
]);
function changeVariant(row: ErrorRow): BadgeVariant {
  if (row.early || row.kind === "shared") return "default-outline";
  return row.kind === "fixed" ? "success-soft" : "error-soft";
}
function toneClass(tone: TileTone) {
  return tone === "crit"
    ? "text-error-600"
    : tone === "good"
      ? "text-success-600"
      : "text-text-secondary";
}
function visit(url: string | undefined) {
  if (url) void router.push(url);
}
</script>
