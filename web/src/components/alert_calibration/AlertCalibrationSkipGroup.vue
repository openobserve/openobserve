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
  <OCard
    v-if="rows.length"
    variant="glass"
    class="border-s-status-neutral-text border-s-3"
    data-test="alert-calibration-skip-group"
  >
    <OCardSection role="body" class="flex flex-col gap-0.5 pt-3 pb-2">
      <div class="flex min-w-0 items-center gap-1.5">
        <OIcon name="report-problem" size="sm" class="text-status-warning-text shrink-0" />
        <OText variant="card-title" as="h2" data-test="alert-calibration-skip-group-title">{{
          t(titleKey)
        }}</OText>
        <OBadge
          variant="default-soft"
          size="sm"
          shape="rounded"
          data-test="alert-calibration-skip-group-count"
          >{{ rows.length }}</OBadge
        >
      </div>
      <OText variant="meta" as="p">{{ t(whyKey, { count: rows.length }, rows.length) }}</OText>
    </OCardSection>
    <OCardSection
      v-for="group in groups"
      :key="group.key"
      role="body"
      class="flex flex-col gap-2 py-2"
      data-test="alert-calibration-skip-group-cause"
    >
      <dl class="grid grid-cols-[4rem_1fr] gap-x-3 gap-y-1 text-xs">
        <dt class="text-text-secondary">{{ t("alertCalibration.notChecked.whyLabel") }}</dt>
        <dd class="text-text-body" data-test="alert-calibration-skip-group-cause-why">
          {{ group.why }}
        </dd>
        <dt class="text-text-secondary">{{ t("alertCalibration.notChecked.nextLabel") }}</dt>
        <dd class="text-text-body" data-test="alert-calibration-skip-group-cause-next">
          {{ nextFor(group.rows[0]) }}
        </dd>
      </dl>
      <div class="flex flex-col">
        <div
          v-for="row in shownRows(group)"
          :key="row.key"
          class="border-border-subtle flex min-w-0 items-center justify-between gap-2 border-t py-1.5"
          data-test="alert-calibration-skip-group-row"
        >
          <span class="text-text-heading min-w-0 truncate text-xs">{{ row.label }}</span>
          <OButton
            variant="outline"
            size="xs"
            :loading="ctaFor(row).pending"
            data-test="alert-calibration-skip-group-cta"
            @click="ctaFor(row).run()"
          >
            {{ ctaFor(row).label }}
          </OButton>
        </div>
        <div
          v-if="hiddenCount(group) > 0"
          class="border-border-subtle flex min-w-0 items-center gap-1 border-t pt-1.5"
          data-test="alert-calibration-skip-group-more-line"
        >
          <OText variant="meta" as="span">{{
            t("alertCalibration.notChecked.andMore", { count: hiddenCount(group) })
          }}</OText>
          {{ " " }}
          <OButton
            variant="ghost-primary"
            size="xs"
            data-test="alert-calibration-skip-group-more"
            @click="expand(group.key)"
          >
            {{ t("alertCalibration.notChecked.showAll", { count: group.rows.length }) }}
          </OButton>
        </div>
      </div>
    </OCardSection>
  </OCard>
</template>

<script lang="ts">
import type { I18nText } from "@/types/i18n";

export interface SkipGroupRow {
  key: string;
  group: string;
  label: I18nText;
  why: I18nText;
}

export interface SkipGroupCta {
  label: I18nText;
  run: () => void;
  pending?: boolean;
}
</script>

<script setup lang="ts">
import { computed, ref } from "vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { useI18nTyped, type I18nKey } from "@/types/i18n";

/** The insight rule's cap: many skipped alerts show the first five per cause (spec P2b W4). */
const FIRST_SHOWN = 5;

const props = defineProps<{
  titleKey: I18nKey;
  whyKey: I18nKey;
  rows: SkipGroupRow[];
  nextFor: (row: SkipGroupRow) => I18nText;
  ctaFor: (row: SkipGroupRow) => SkipGroupCta;
}>();

const { t } = useI18nTyped();

interface Group {
  key: string;
  why: I18nText;
  rows: SkipGroupRow[];
}

const groups = computed<Group[]>(() => {
  const byKey = new Map<string, Group>();
  for (const row of props.rows) {
    const group = byKey.get(row.group);
    if (group) group.rows.push(row);
    else byKey.set(row.group, { key: row.group, why: row.why, rows: [row] });
  }
  return [...byKey.values()];
});

const expanded = ref(new Set<string>());
const expand = (key: string) => {
  expanded.value = new Set([...expanded.value, key]);
};
const shownRows = (group: Group) =>
  expanded.value.has(group.key) ? group.rows : group.rows.slice(0, FIRST_SHOWN);
const hiddenCount = (group: Group) => group.rows.length - shownRows(group).length;
</script>
