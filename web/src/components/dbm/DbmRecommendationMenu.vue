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

<!--
  DbmRecommendationMenu — the recommendations as one filter-row button + popover list.
  Same shell as DbmInsightMenu, but its rows are read-only findings with no table filter to apply.
-->
<template>
  <!-- Always shown, so the filter row never jumps; an empty list says so. -->
  <OPopover align="end">
    <template #trigger>
      <OButton variant="outline" size="sm" class="shrink-0" data-test="dbm-insights">
        {{ t("dbm.insights.title") }}
        <OTag
          :label="raw(String(items.length))"
          size="xs"
          class="ms-1"
          data-test="dbm-insights-count"
        />
      </OButton>
    </template>
    <div
      class="flex max-h-80 w-96 max-w-full flex-col overflow-y-auto p-1"
      data-test="dbm-insights-panel"
    >
      <p
        v-if="!items.length"
        class="text-text-secondary px-2 py-1.5 text-xs"
        data-test="dbm-insights-empty"
      >
        {{ t("dbm.insights.empty") }}
      </p>
      <div
        v-for="item in items"
        :key="item.key"
        class="rounded-default flex items-start gap-2 px-2 py-1.5"
        :data-test="`dbm-recommendation-${item.id}`"
      >
        <span
          class="rounded-default mt-0.5 grid size-4.5 shrink-0 place-items-center"
          :class="DBM_SOFT_TONES[item.tone]"
        >
          <OIcon :name="DBM_TONE_ICONS[item.tone]" size="xs" />
        </span>
        <span class="flex min-w-0 flex-col leading-tight">
          <span class="text-text-heading text-xs font-semibold">{{ item.title }}</span>
          <span class="text-text-secondary text-2xs">{{ item.body }}</span>
        </span>
        <OTooltip side="left" :content="item.rule" />
      </div>
    </div>
  </OPopover>
</template>

<script setup lang="ts">
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { DBM_SOFT_TONES, DBM_TONE_ICONS } from "@/utils/dbm/tones";
import type { DbmRecommendationTone } from "@/utils/dbm/recommendations";

export interface DbmRecommendationMenuItem {
  key: string;
  id: string;
  tone: DbmRecommendationTone;
  title: I18nText;
  body: I18nText;
  rule: I18nText;
}

defineProps<{ items: DbmRecommendationMenuItem[] }>();

const { t } = useI18nTyped();
</script>
