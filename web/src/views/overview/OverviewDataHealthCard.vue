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
  <OverviewSectionCard
    section="data-health"
    :title="t('overview.sections.dataHealth')"
    :link-label="pipelinesOk ? t('overview.dataHealth.viewPipelines') : undefined"
    :view="view"
    @retry="emit('retry')"
    @view-all="emit('open', 'pipelines')"
  >
    <div class="flex flex-col gap-3">
      <p class="flex flex-wrap items-baseline gap-x-2" data-test="overview-data-health-hero">
        <span
          :class="['text-3xl font-semibold tabular-nums', hero.tone]"
          data-test="overview-data-health-attention-count"
          >{{ hero.count }}</span
        >
        <span class="text-text-secondary text-sm">{{
          t("overview.dataHealth.attentionLabel", { count: hero.count }, hero.count)
        }}</span>
        <span
          v-if="hero.unknown > 0"
          class="text-text-secondary text-sm"
          data-test="overview-data-health-unknown"
          >{{ t("overview.dataHealth.unknownNote", { count: hero.unknown }) }}</span
        >
      </p>
      <div class="divide-border-default -mx-2 flex flex-col divide-y">
        <ul
          v-if="groups.problems.length > 0"
          class="divide-border-default flex flex-col divide-y"
          data-test="overview-data-health-rows"
        >
          <li v-for="row in groups.problems" :key="row.key">
            <OverviewDataHealthRow :row="row" @open="emit('open', $event)" />
          </li>
        </ul>
        <OCollapsible
          v-for="group in collapsedGroups"
          :key="group.key"
          :data-test="`overview-data-health-${group.key}`"
        >
          <template #trigger="{ open }">
            <OIcon
              v-if="group.key === 'healthy'"
              name="check-circle-outline"
              size="sm"
              class="text-status-positive shrink-0"
            />
            <span
              :class="[
                'min-w-0 flex-1 text-sm',
                group.key === 'healthy' ? 'text-text-body' : 'text-text-secondary',
              ]"
              :data-test="`overview-data-health-${group.key}-summary`"
              >{{ group.summary }}</span
            >
            <OIcon
              name="expand-more"
              size="sm"
              :class="[
                'text-text-secondary shrink-0 transition-transform duration-200',
                open ? 'rotate-180' : '',
              ]"
            />
          </template>
          <ul class="divide-border-default border-border-default flex flex-col divide-y border-t">
            <li v-for="row in group.rows" :key="row.key">
              <OverviewDataHealthRow :row="row" @open="emit('open', $event)" />
            </li>
          </ul>
        </OCollapsible>
      </div>
    </div>
  </OverviewSectionCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { OrgOverview, OverviewSection } from "@/ts/interfaces/overview";
import OverviewDataHealthRow, { type HealthRow } from "./OverviewDataHealthRow.vue";
import OverviewSectionCard from "./OverviewSectionCard.vue";
import {
  attentionCount,
  groupHealthRows,
  nameList,
  sectionView,
  unknownCount,
  type HealthTone,
  type OverviewDestination,
  type OverviewView,
} from "./overviewFormat";

const props = defineProps<{
  overview: OrgOverview | null;
  pending: boolean;
  failed: boolean;
  forbidden?: boolean;
}>();

const emit = defineEmits<{ retry: []; open: [destination: OverviewDestination] }>();

const { t, locale } = useI18nTyped();

const view = computed<OverviewView>(() => {
  if (props.pending) return "loading";
  if (props.overview) return "ok";
  return props.forbidden ? "forbidden" : "error";
});

const pipelinesOk = computed(
  () =>
    sectionView(props.overview?.pipelines, {
      pending: false,
      failed: props.failed,
      forbidden: props.forbidden,
    }) === "ok",
);

const stateWord = (state: OverviewView): I18nText => {
  if (state === "forbidden") return t("overview.state.tileForbidden");
  if (state === "locked") return t("overview.state.tileLocked");
  return t("overview.state.tileError");
};

const statusWord = (tone: HealthTone): I18nText => {
  if (tone === "error") return t("overview.dataHealth.status.needsAction");
  if (tone === "warning") return t("overview.dataHealth.status.warning");
  if (tone === "info") return t("overview.dataHealth.status.info");
  return t("overview.dataHealth.status.healthy");
};

const healthRow = <T,>(
  base: Pick<HealthRow, "key" | "label" | "note" | "destination">,
  section: OverviewSection<T> | undefined,
  pick: (data: T) => {
    count: number | null;
    tone: (count: number) => HealthTone;
    note?: I18nText;
    notSetUp?: boolean;
  },
): HealthRow => {
  const state = sectionView(section, {
    pending: false,
    failed: props.failed,
    forbidden: props.forbidden,
  });
  if (state !== "ok" || !section?.data) {
    return {
      ...base,
      tone: "neutral",
      word: stateWord(state),
      value: raw("—"),
      ok: false,
      notSetUp: false,
    };
  }
  const { count, tone, note, notSetUp } = pick(section.data);
  if (notSetUp) {
    return {
      ...base,
      note: note ?? base.note,
      tone: "neutral",
      word: t("overview.dataHealth.status.notSetUp"),
      value: raw("—"),
      ok: true,
      notSetUp: true,
    };
  }
  const level = tone(count ?? 0);
  return {
    ...base,
    note: note ?? base.note,
    tone: level,
    word: statusWord(level),
    value: count === null ? raw("—") : raw(count),
    ok: true,
    notSetUp: false,
  };
};

const healthRows = (): HealthRow[] => {
  const o = props.overview;
  const byCount = (bad: HealthTone) => (count: number) => (count > 0 ? bad : "success");
  return [
    healthRow(
      {
        key: "quiet",
        label: t("overview.dataHealth.quiet"),
        note: t("overview.dataHealth.quietNote"),
        destination: "streams",
      },
      o?.streams,
      (d) => ({
        count: d.quiet_count,
        tone: byCount("warning"),
        notSetUp: d.total_streams === 0,
      }),
    ),
    healthRow(
      {
        key: "failing",
        label: t("overview.dataHealth.failing"),
        note: t("overview.dataHealth.failingNote"),
        destination: "alerts",
      },
      o?.alerts,
      (d) => ({ count: d.failed_evaluation, tone: byCount("error"), notSetUp: d.enabled === 0 }),
    ),
    healthRow(
      {
        key: "pipelines",
        label: t("overview.dataHealth.pipelinesErrored"),
        note: t("overview.dataHealth.pipelinesNote"),
        destination: "pipelines",
      },
      o?.pipelines,
      (d) => ({
        count: d.errored,
        tone: byCount("error"),
        notSetUp: d.total === 0,
        note:
          d.total === 0
            ? t("overview.dataHealth.noPipelines")
            : t("overview.cards.pipelinesOf", { enabled: d.enabled }),
      }),
    ),
    healthRow(
      {
        key: "delivery",
        label: t("overview.dataHealth.delivery"),
        note: t("overview.dataHealth.deliveryNote"),
        destination: "alerts",
      },
      o?.alerts,
      (d) => ({
        count: d.by_state.notify_failed ?? 0,
        tone: byCount("error"),
        notSetUp: d.enabled === 0,
      }),
    ),
    healthRow(
      {
        key: "schema",
        label: t("overview.dataHealth.schema"),
        note: t("overview.dataHealth.schemaNote"),
        destination: "streams",
      },
      o?.streams,
      (d) => ({
        count: d.schema_changes_24h,
        tone: () => "info",
        notSetUp: d.total_streams === 0,
      }),
    ),
    healthRow(
      {
        key: "compaction",
        label: t("overview.dataHealth.compaction"),
        note: t("overview.dataHealth.compactionNote"),
        destination: "streams",
      },
      o?.streams,
      (d) => ({
        count: d.compaction_pending,
        tone: () => "info",
        notSetUp: d.total_streams === 0,
      }),
    ),
  ];
};

const rows = computed<HealthRow[]>(() => healthRows());

// Array.prototype.sort is stable, so problem rows in one tier keep the order written above
const groups = computed(() => groupHealthRows(rows.value));

// zero problems is only good news when every source answered
const hero = computed(() => {
  const count = attentionCount(rows.value);
  const unknown = count === 0 ? unknownCount(rows.value) : 0;
  let tone = "text-text-heading";
  if (count === 0) tone = unknown > 0 ? "text-text-secondary" : "text-status-positive";
  return { count, unknown, tone };
});

const collapsedGroups = computed(() => {
  const names = (list: HealthRow[]) =>
    raw(
      nameList(
        list.map((row) => row.label),
        String(locale.value),
      ),
    );
  const { healthy, notSetUp } = groups.value;
  return [
    {
      key: "healthy",
      rows: healthy,
      summary: t(
        "overview.dataHealth.healthySummary",
        { count: healthy.length, names: names(healthy) },
        healthy.length,
      ),
    },
    {
      key: "not-set-up",
      rows: notSetUp,
      summary: t(
        "overview.dataHealth.notSetUpSummary",
        { count: notSetUp.length, names: names(notSetUp) },
        notSetUp.length,
      ),
    },
  ].filter((group) => group.rows.length > 0);
});
</script>
