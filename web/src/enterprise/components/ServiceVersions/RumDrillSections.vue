<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div v-if="pages" class="flex flex-col gap-1" :data-test="sectionTest('pages', result.pages)">
    <span class="text-text-secondary text-xs">{{
      t("serviceVersions.compare.drill.pages.title")
    }}</span>
    <p
      v-if="reasonOf(result.pages)"
      class="text-text-secondary text-xs"
      data-test="svcver-section-pages-reason"
    >
      {{ reasonOf(result.pages) }}
    </p>
    <OTable
      v-else
      :data="pageRows"
      :columns="pageColumns"
      row-key="page"
      pagination="none"
      sorting="none"
      :show-global-filter="false"
      :fill-height="false"
      frame
      data-test="svcver-pages-table"
      ><template #cell-page="{ row }"
        ><span class="truncate font-mono text-xs" :data-test="`svcver-page-${slug(row.page)}`">{{
          row.page
        }}</span></template
      ><template #cell-change="{ row }"
        ><span class="tabular-nums" :class="toneClass[row.change.tone]">{{
          row.change.text
        }}</span></template
      ><template #cell-newErrors="{ row }"
        ><span
          class="tabular-nums"
          :class="row.new_error_types ? 'text-error-600 font-semibold' : ''"
          >{{
            row.new_error_types
              ? t("serviceVersions.compare.drill.pages.newCount", { count: row.new_error_types })
              : 0
          }}</span
        ></template
      ><template #cell-views="{ row }"
        ><span class="tabular-nums">{{ formatCount(row.views.a) }}</span></template
      ><template #cell-link="{ row }"
        ><OButton
          v-if="row.sessions"
          variant="ghost-primary"
          size="xs"
          :data-test="`svcver-page-replays-${slug(row.page)}`"
          @click="visit(row.sessions)"
          >{{ t("serviceVersions.compare.drill.pages.sessions") }}</OButton
        ></template
      ></OTable
    >
  </div>
  <div v-else class="flex gap-3 max-md:flex-col">
    <div
      class="flex min-w-0 flex-[1.7] flex-col gap-1"
      :data-test="sectionTest('inp-targets', result.inp_targets)"
    >
      <span class="text-text-secondary text-xs">{{
        t("serviceVersions.compare.drill.inp.title", { version: arms.a.version })
      }}</span>
      <p
        v-if="reasonOf(result.inp_targets)"
        class="text-text-secondary text-xs"
        data-test="svcver-section-inp-targets-reason"
      >
        {{ reasonOf(result.inp_targets) }}
      </p>
      <OTable
        v-else
        :data="inpRows"
        :columns="inpColumns"
        row-key="key"
        pagination="none"
        sorting="none"
        :show-global-filter="false"
        :fill-height="false"
        frame
        data-test="svcver-inp-targets-table"
        ><template #cell-target="{ row }"
          ><span class="flex min-w-0 flex-col" :data-test="`svcver-inp-target-${row.rank}`"
            ><span class="truncate font-mono text-xs">{{ row.target }}</span
            ><span class="text-text-secondary truncate font-mono text-xs">{{
              t(
                "serviceVersions.compare.drill.inp.pageCount",
                { page: row.page, count: formatCount(row.a.n) },
                row.a.n,
              )
            }}</span></span
          ></template
        ><template #cell-p75="{ row }"
          ><span class="tabular-nums" :class="row.a.p75_ms > INP_GOOD_MS ? toneClass.warn : ''">{{
            formatMillis(row.a.p75_ms, t)
          }}</span></template
        ><template #cell-link="{ row }"
          ><OButton
            v-if="row.sessions"
            variant="ghost-primary"
            size="xs"
            :data-test="`svcver-inp-target-replay-${row.rank}`"
            @click="visit(row.sessions)"
            >{{ t("serviceVersions.compare.drill.inp.replay") }}</OButton
          ></template
        ></OTable
      >
      <span v-if="result.inp_targets?.truncated" class="text-text-secondary text-2xs">{{
        t("serviceVersions.compare.drill.truncated")
      }}</span>
    </div>
    <div
      class="flex min-w-0 flex-1 flex-col gap-1"
      :data-test="sectionTest('breakdown', result.rum_breakdown)"
    >
      <span class="text-text-secondary text-xs">{{
        t("serviceVersions.compare.drill.breakdown.title")
      }}</span>
      <p
        v-if="reasonOf(result.rum_breakdown)"
        class="text-text-secondary text-xs"
        data-test="svcver-section-breakdown-reason"
      >
        {{ reasonOf(result.rum_breakdown) }}
      </p>
      <OTable
        v-else
        :data="breakdownRows"
        :columns="breakdownColumns"
        row-key="key"
        pagination="none"
        sorting="none"
        :show-global-filter="false"
        :fill-height="false"
        frame
        wrap
        data-test="svcver-breakdown-table"
        ><template #cell-value="{ row }"
          ><span
            :class="row.note ? 'text-text-secondary' : ''"
            :data-test="
              row.note
                ? `svcver-breakdown-${row.dim}-reason`
                : `svcver-breakdown-${row.dim}-${slug(row.value)}`
            "
            >{{ row.value }}</span
          ></template
        ><template #cell-change="{ row }"
          ><span class="tabular-nums" :class="toneClass[row.change.tone]">{{
            row.change.text
          }}</span></template
        ></OTable
      >
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type {
  BreakdownDimName,
  CompareResponse,
  DrillSection,
  MetricDelta,
} from "@/services/service_versions";
import { change, formatCount, formatMillis, hasBaseline } from "./VersionSummaryTiles.format";
import { worseTone } from "./verdictText";
import { rumPageSessions } from "./deepLinks";
import { detailGapText } from "@/utils/serviceVersionsCopy";
const props = withDefaults(
  defineProps<{
    org: string;
    result: CompareResponse;
    metric?: string;
    pages?: boolean;
    all?: boolean;
    loading?: boolean;
  }>(),
  { metric: "inp_p75", pages: false, all: false, loading: false },
);
const { t } = useI18nTyped();
const router = useRouter();
const INP_GOOD_MS = 200;
const WHAT_CHANGED_PAGES = 5;
const VITALS = ["lcp_p75", "inp_p75", "cls_p75"] as const;
type Vital = (typeof VITALS)[number];
type Tone = "crit" | "warn" | "good" | "neutral";
const DIMS: BreakdownDimName[] = ["browser", "device", "country"];
const REASONS: Record<string, I18nKey> = {
  sdk_no_inp_target: "serviceVersions.compare.drill.reasons.sdkNoInpTarget",
  raw_aged_out: "serviceVersions.compare.drill.reasons.rawAgedOut",
  field_absent: "serviceVersions.compare.drill.reasons.fieldAbsent",
};
const toneClass: Record<Tone, string> = {
  crit: "text-error-600 font-semibold",
  warn: "text-warning-600 font-semibold",
  good: "text-success-600 font-semibold",
  neutral: "text-text-secondary",
};
const arms = computed(() => props.result.arms);
const vital = computed<Vital>(() =>
  (VITALS as readonly string[]).includes(props.metric) ? (props.metric as Vital) : "inp_p75",
);
const metricLabel = computed(() => t(`serviceVersions.compare.drill.metric.${vital.value}`));
function sectionTest(name: string, section: DrillSection | undefined) {
  return `svcver-section-${name}-${props.loading ? "loading" : section?.status || "loading"}`;
}
// Timeouts and errors keep their own copy; an unknown insufficient reason reads as too early.
function reasonText(status: string, reason: string | null | undefined) {
  if (status === "timeout") return t("serviceVersions.compare.drill.reasons.timeout");
  if (status === "error") return t("serviceVersions.compare.drill.reasons.error");
  if (status === "ok") return "";
  if (reason === "detail_coarse")
    return detailGapText("page", hasBaseline(props.result) ? "both" : "this", t);
  const key = reason ? REASONS[reason] : undefined;
  return key ? t(key) : t("serviceVersions.compare.tooEarly");
}
function reasonOf(section: DrillSection | undefined) {
  if (!section || props.loading) return "";
  return reasonText(section.status, section.reason);
}
// The tiles' interval rule decides noise; no threshold of its own.
function deltaChange(metric: Vital, value: MetricDelta | undefined): { text: string; tone: Tone } {
  const noise =
    !value ||
    value.insufficient ||
    value.straddles_zero ||
    value.lo == null ||
    value.hi == null ||
    value.delta == null ||
    (value.lo <= 0 && value.hi >= 0);
  if (noise || !value?.delta)
    return { text: t("serviceVersions.compare.drill.noise"), tone: "neutral" };
  return {
    text: change(metric, value.delta, value.b, t),
    tone: value.delta > 0 ? worseTone(props.result) : "good",
  };
}
function slug(value: string) {
  const text = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return text || "root";
}
const inpRows = computed(() =>
  (props.result.inp_targets?.rows || []).map((row, index) => ({
    ...row,
    rank: index + 1,
    key: `${row.target}|${row.page}`,
    sessions: rumPageSessions(props.org, props.result.service, arms.value.a, row.page),
  })),
);
// A dim the SDK never sent keeps one row naming why, so an absent breakdown is not read as no change.
const breakdownRows = computed(() =>
  DIMS.flatMap((dim) => {
    const section = props.result.rum_breakdown?.dims?.[dim];
    if (!section) return [];
    if (section.status !== "ok")
      return [
        {
          key: `${dim}|`,
          dim,
          note: true,
          value: t("serviceVersions.compare.drill.breakdown.dimReason", {
            dim: t(`serviceVersions.compare.drill.breakdown.dims.${dim}`),
            reason: reasonText(section.status, section.reason),
          }),
          change: { text: "", tone: "neutral" as Tone },
        },
      ];
    return (section.values || []).map((row) => ({
      key: `${dim}|${row.value}`,
      dim,
      note: false,
      value: row.value,
      change: deltaChange(vital.value, row[vital.value]),
    }));
  }),
);
const pageRows = computed(() => {
  const rows = props.result.pages?.rows || [];
  return (props.all ? rows : rows.slice(0, WHAT_CHANGED_PAGES)).map((row) => {
    const worst = (VITALS as readonly string[]).includes(row.worst?.metric || "")
      ? (row.worst?.metric as Vital)
      : undefined;
    const measured = worst ? deltaChange(worst, row[worst]) : undefined;
    return {
      ...row,
      change:
        worst && measured && measured.tone !== "neutral"
          ? {
              text: t("serviceVersions.compare.drill.pages.worst", {
                metric: t(`serviceVersions.compare.drill.metric.${worst}`),
                change: measured.text,
              }),
              tone: measured.tone,
            }
          : { text: t("serviceVersions.compare.drill.noise"), tone: "neutral" as Tone },
      sessions: rumPageSessions(props.org, props.result.service, arms.value.a, row.page),
    };
  });
});
const inpColumns = computed<OTableColumnDef<(typeof inpRows.value)[number]>[]>(() => [
  { id: "target", header: t("serviceVersions.compare.drill.inp.target"), size: 260 },
  {
    id: "p75",
    header: t("serviceVersions.compare.drill.inp.p75", { version: arms.value.a.version }),
    size: 100,
    meta: { align: "right" },
  },
  { id: "link", header: raw(""), size: 90, isAction: true },
]);
const breakdownColumns = computed<OTableColumnDef<(typeof breakdownRows.value)[number]>[]>(() => [
  { id: "value", header: t("serviceVersions.compare.drill.breakdown.column"), size: 180 },
  {
    id: "change",
    header: t("serviceVersions.compare.drill.breakdown.change", { metric: metricLabel.value }),
    size: 100,
    meta: { align: "right" },
  },
]);
const pageColumns = computed<OTableColumnDef<(typeof pageRows.value)[number]>[]>(() => [
  { id: "page", header: t("serviceVersions.compare.drill.pages.page"), size: 220 },
  {
    id: "change",
    header: t("serviceVersions.compare.drill.pages.vitalChange"),
    size: 110,
    meta: { align: "right" },
  },
  {
    id: "newErrors",
    header: t("serviceVersions.compare.drill.pages.newErrors"),
    size: 90,
    meta: { align: "right" },
  },
  {
    id: "views",
    header: t("serviceVersions.compare.drill.pages.views", { version: arms.value.a.version }),
    size: 110,
    meta: { align: "right" },
  },
  { id: "link", header: raw(""), size: 150, isAction: true },
]);
function visit(url: string | undefined) {
  if (url) void router.push(url);
}
</script>
