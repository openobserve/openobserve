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
    :subtitle="t('overview.dataHealth.subtitle')"
    :link-label="pipelinesOk ? t('overview.dataHealth.viewPipelines') : undefined"
    :view="view"
    @retry="emit('retry')"
    @view-all="emit('viewAll')"
  >
    <ul class="flex flex-col" data-test="overview-data-health-rows">
      <li
        v-for="row in rows"
        :key="row.key"
        class="border-border-default flex items-center border-t"
      >
        <OverviewDataHealthRow class="min-w-0 flex-1" :row="row" @open="emit('open', $event)" />
        <span v-if="askVisible" class="flex w-9 shrink-0 justify-center">
          <OverviewAskAiButton
            kind="health"
            :item-key="row.key"
            :label="row.label"
            :show="Boolean(askTarget(row))"
            @ask="emit('askAi', askTarget(row)!)"
          />
        </span>
      </li>
    </ul>
  </OverviewSectionCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { OrgOverview, OverviewSection } from "@/ts/interfaces/overview";
import OverviewDataHealthRow, { type HealthRow } from "./OverviewDataHealthRow.vue";
import OverviewAskAiButton from "./OverviewAskAiButton.vue";
import OverviewSectionCard from "./OverviewSectionCard.vue";
import type { OverviewAskAiTarget, OverviewAskAiTopic } from "./overviewAskAi";
import { useOverviewAskAi } from "./useOverviewAskAi";
import {
  sectionView,
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

const emit = defineEmits<{
  retry: [];
  viewAll: [];
  open: [destination: OverviewDestination];
  askAi: [target: OverviewAskAiTarget];
}>();

const { t } = useI18nTyped();
const { visible: askVisible } = useOverviewAskAi();

const ASK_TOPICS: Partial<Record<string, OverviewAskAiTopic>> = {
  quiet: "quiet",
  failing: "failing",
  pipelines: "pipelines",
  delivery: "delivery",
};

// informational rows (schema, compaction) are not problems, so only error and warning rows ask
const askTarget = (row: HealthRow): OverviewAskAiTarget | undefined => {
  const topic = ASK_TOPICS[row.key];
  const problem = row.ok && !row.notSetUp && (row.tone === "error" || row.tone === "warning");
  if (!topic || !problem || !row.count) return undefined;
  return { kind: "count", topic, count: row.count };
};

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
    count: count ?? undefined,
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
        destination: "failing",
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
            : t("overview.dataHealth.pipelinesActive", { count: d.enabled }, d.enabled),
      }),
    ),
    healthRow(
      {
        key: "delivery",
        label: t("overview.dataHealth.delivery"),
        note: t("overview.dataHealth.deliveryNote"),
        destination: "delivery",
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

// the rows keep one fixed order so each check is always in the same place
const rows = computed<HealthRow[]>(() => healthRows());
</script>
