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
  <div class="flex flex-col gap-3.5" data-test="query-plan-summary">
    <h3 class="text-text-heading m-0 text-sm font-semibold">
      {{ t("search.queryProfile.planTitle") }}
    </h3>

    <div class="grid grid-cols-2 gap-1.5">
      <ProfileStatTile
        :label="t('search.queryProfile.streamTile', { count: streamCount }, streamCount)"
        :value="streamValue"
        :sub="streamCount > 1 ? raw(summary.streams.join(', ')) : undefined"
        data-test="query-plan-tile-stream"
      />
      <ProfileStatTile
        :label="t('search.queryProfile.operators')"
        :value="summary.leaderOps + summary.remoteOps"
        :sub="
          model.stages.length
            ? t('search.queryProfile.operatorsSplit', {
                leader: summary.leaderOps,
                remote: summary.remoteOps,
              })
            : undefined
        "
        data-test="query-plan-tile-operators"
      />
      <ProfileStatTile
        :label="t('search.queryProfile.stages')"
        :value="model.stages.length + 1"
        :sub="
          model.stages.length
            ? t(
                'search.queryProfile.stagesSplit',
                { count: model.stages.length },
                model.stages.length,
              )
            : undefined
        "
        data-test="query-plan-tile-stages"
      />
      <ProfileStatTile
        :label="t('search.queryProfile.resultLimit')"
        :value="
          summary.fetch === null
            ? '—'
            : t('search.queryProfile.rowsCount', { count: summary.fetch }, summary.fetch)
        "
        data-test="query-plan-tile-limit"
      />
    </div>

    <section v-if="summary.scans.length">
      <h4 class="text-text-secondary m-0 mb-2 text-xs font-semibold">
        {{ t("search.queryProfile.pushedDown") }}
      </h4>
      <div class="flex flex-col gap-2.5">
        <div
          v-for="scan in scanRows"
          :key="scan.opId"
          class="flex flex-col gap-1.5"
          :data-test="`query-plan-pushdown-${scan.opId}`"
        >
          <OTruncatedText
            v-if="summary.scans.length > 1"
            as="div"
            class="text-text-heading text-xs font-semibold"
            >{{ scan.stream }}</OTruncatedText
          >
          <div
            v-for="row in scan.rows"
            :key="row.key"
            class="flex min-w-0 items-start gap-2 text-xs"
          >
            <OIcon :name="row.icon" size="xs" class="text-text-secondary mt-0.5 shrink-0" />
            <span class="text-text-secondary shrink-0">{{ row.label }}</span>
            <code
              class="bg-surface-subtle text-text-body rounded-default text-2xs min-w-0 px-1.5 py-px font-mono wrap-anywhere"
              >{{ row.value }}</code
            >
          </div>
          <div v-if="!scan.rows.length" class="text-text-secondary text-xs">
            {{ t("search.queryProfile.nothingPushed") }}
          </div>
        </div>
      </div>
    </section>

    <section>
      <h4 class="text-text-secondary m-0 mb-2 text-xs font-semibold">
        {{ t("search.queryProfile.whereItRuns") }}
      </h4>
      <div class="flex flex-col gap-1.5 text-xs">
        <div class="flex min-w-0 items-start gap-2" data-test="query-plan-where-leader">
          <OBadge size="xs" shape="rounded" variant="default-soft" class="shrink-0">{{
            t("search.queryProfile.leader")
          }}</OBadge>
          <span class="text-text-body min-w-0">{{ leaderText }}</span>
        </div>
        <div
          v-for="s in model.stages"
          :key="s.id"
          class="flex min-w-0 items-start gap-2"
          :data-test="`query-plan-where-${s.id}`"
        >
          <OBadge size="xs" shape="rounded" variant="default-soft" class="shrink-0">
            <span class="size-1.5 shrink-0 rounded-full" :class="stageSwatch(s.index)" />
            {{ t("search.queryProfile.stage", { index: s.index }) }}
          </OBadge>
          <span class="text-text-body min-w-0">{{ t("search.queryProfile.everyNode") }}</span>
        </div>
        <div v-if="model.stages.length" class="text-text-secondary">
          {{ t("search.queryProfile.decidedAtRunTime") }}
        </div>
      </div>
    </section>

    <div
      class="bg-surface-subtle rounded-default flex flex-col gap-2 p-2.5"
      data-test="query-plan-run-cta"
    >
      <p class="text-text-body m-0 text-xs leading-normal">
        {{ t("search.queryProfile.planOnlyNote") }}
      </p>
      <OButton
        variant="outline"
        size="sm"
        block
        icon-left="speed"
        icon-right="arrow-forward"
        data-test="query-plan-go-analyze"
        @click="emit('analyze')"
        >{{ t("search.queryProfile.measureWithAnalyze") }}</OButton
      >
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { PlanScanInfo, PlanSummary, ProfileModel } from "@/utils/queryProfile";
import ProfileStatTile from "./ProfileStatTile.vue";
import { CATEGORY_STYLE, stageSwatch } from "./profileStyles";

interface PushdownRow {
  key: string;
  icon: IconName;
  label: I18nText;
  value: string;
}

const props = defineProps<{
  model: ProfileModel;
  summary: PlanSummary;
}>();

const emit = defineEmits<{ analyze: [] }>();

const { t } = useI18nTyped();

const streamCount = computed(() => Math.max(1, props.summary.streams.length));
const streamValue = computed(() =>
  streamCount.value > 1 ? streamCount.value : (props.summary.streams[0] ?? "—"),
);

const leaderText = computed(() =>
  raw(props.summary.leaderCategories.map((c) => t(CATEGORY_STYLE[c].labelKey)).join(", ")),
);

const scanRows = computed(() =>
  props.summary.scans.map((scan) => ({
    opId: scan.opId,
    stream: raw(scan.stream),
    rows: pushdownRows(scan),
  })),
);

function pushdownRows(scan: PlanScanInfo): PushdownRow[] {
  const rows: PushdownRow[] = scan.filters.map((f, i) => ({
    key: `filter-${i}`,
    icon: "filter-alt",
    label: t("search.queryProfile.pushedFilter"),
    value: f,
  }));
  if (scan.columns.length) {
    rows.push({
      key: "columns",
      icon: "view-column",
      label: t("search.queryProfile.pushedColumns"),
      value: scan.columns.join(", "),
    });
  }
  if (scan.sortOrder) {
    rows.push({
      key: "sort",
      icon: "swap-vert",
      label: t("search.queryProfile.pushedSortOrder"),
      value: scan.sortOrder,
    });
  }
  return rows;
}
</script>
