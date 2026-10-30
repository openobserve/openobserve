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
    :link-label="t('overview.dataHealth.viewPipelines')"
    :view="view"
    @retry="emit('retry')"
    @view-all="emit('open', 'pipelines')"
  >
    <ul class="flex flex-col" data-test="overview-data-health-rows">
      <li v-for="row in rows" :key="row.key">
        <OverviewRowButton
          :data-test="`overview-data-health-row-${row.key}`"
          @click="emit('open', row.destination)"
        >
          <span
            class="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 whitespace-normal"
          >
            <span class="flex min-w-0 flex-1 basis-40 flex-col text-start">
              <span class="text-text-body text-sm">{{ row.label }}</span>
              <span class="text-text-secondary text-xs">{{ row.note }}</span>
            </span>
            <span class="flex shrink-0 items-center gap-3">
              <OTag
                type="countChip"
                :value="row.tone"
                :data-test="`overview-data-health-status-${row.key}`"
                >{{ row.word }}</OTag
              >
              <span
                class="text-text-heading min-w-8 text-end text-sm font-medium tabular-nums"
                :data-test="`overview-data-health-value-${row.key}`"
                >{{ row.value }}</span
              >
            </span>
          </span>
        </OverviewRowButton>
      </li>
    </ul>
  </OverviewSectionCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { OrgOverview, OverviewSection } from "@/ts/interfaces/overview";
import OverviewRowButton from "./OverviewRowButton.vue";
import OverviewSectionCard from "./OverviewSectionCard.vue";
import { sectionView, type OverviewDestination, type OverviewView } from "./overviewFormat";

type HealthTone = "error" | "warning" | "success" | "info" | "neutral";

interface HealthRow {
  key: string;
  label: I18nText;
  note: I18nText;
  destination: OverviewDestination;
  tone: HealthTone;
  word: I18nText;
  value: I18nText;
}

const props = defineProps<{
  overview: OrgOverview | null;
  pending: boolean;
  failed: boolean;
  forbidden?: boolean;
}>();

const emit = defineEmits<{ retry: []; open: [destination: OverviewDestination] }>();

const { t } = useI18nTyped();

const view = computed<OverviewView>(() => {
  if (props.pending) return "loading";
  if (props.overview) return "ok";
  return props.forbidden ? "forbidden" : "error";
});

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
  pick: (data: T) => { count: number; tone: (count: number) => HealthTone; note?: I18nText },
): HealthRow => {
  const state = sectionView(section, {
    pending: false,
    failed: props.failed,
    forbidden: props.forbidden,
  });
  if (state !== "ok" || !section?.data) {
    return { ...base, tone: "neutral", word: stateWord(state), value: raw("—") };
  }
  const { count, tone, note } = pick(section.data);
  const level = tone(count);
  return {
    ...base,
    note: note ?? base.note,
    tone: level,
    word: statusWord(level),
    value: raw(count),
  };
};

const rows = computed<HealthRow[]>(() => {
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
      (d) => ({ count: d.quiet_count, tone: byCount("warning") }),
    ),
    healthRow(
      {
        key: "failing",
        label: t("overview.dataHealth.failing"),
        note: t("overview.dataHealth.failingNote"),
        destination: "alerts",
      },
      o?.alerts,
      (d) => ({ count: d.failed_evaluation, tone: byCount("error") }),
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
      (d) => ({ count: d.by_state.notify_failed ?? 0, tone: byCount("error") }),
    ),
    healthRow(
      {
        key: "schema",
        label: t("overview.dataHealth.schema"),
        note: t("overview.dataHealth.schemaNote"),
        destination: "streams",
      },
      o?.streams,
      (d) => ({ count: d.schema_changes_24h, tone: () => "info" }),
    ),
  ];
});
</script>
