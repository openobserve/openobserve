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
  <div class="border-card-glass-border bg-surface-panel border-b border-solid p-3">
    <div class="flex items-center gap-3">
      <OIcon name="hub" size="md" />
      <div class="flex flex-col">
        <span class="text-sm font-semibold">{{ t("correlation.dimensionBasedCorrelation") }}</span>
        <span class="text-text-secondary text-xs">{{
          t("correlation.tracesFromService", { service })
        }}</span>
      </div>
      <div class="ms-auto flex items-center gap-2">
        <span
          v-if="versionOptions.length > 1"
          class="flex items-center gap-2"
          data-test="svcver-correlation-version-filter"
        >
          <span class="text-text-secondary text-xs font-semibold">{{
            t("serviceVersions.correlation.versionFilter")
          }}</span>
          <OSelect
            v-model="version"
            :options="versionOptions"
            labelKey="label"
            valueKey="value"
            class="dimension-dropdown min-w-30"
          />
        </span>
        <OTooltip v-if="locked" :content="lockedReason">
          <span class="inline-flex">
            <OButton
              variant="ghost"
              size="sm-action"
              disabled
              icon-left="lock"
              data-test="correlation-view-traces-page"
              class="text-xs"
            >
              {{ t("correlation.viewInTraces") }}
            </OButton>
          </span>
        </OTooltip>
        <OButton
          v-else
          variant="ghost"
          size="sm-action"
          icon-left="open-in-new"
          data-test="correlation-view-traces-page"
          class="text-xs"
          @click="emit('open')"
        >
          {{ t("correlation.viewInTraces") }}
        </OButton>
        <OTag type="fieldTag" value="primary" :class="{ invisible: count === null }">
          {{ count ?? 0 }} {{ t("menu.traces") }}
        </OTag>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

defineProps<{
  service: string;
  /** Null while the traces are loading or failed, keeping the tag's width. */
  count: number | null;
  versionOptions: { label: I18nText; value: string }[];
  locked: boolean;
  lockedReason?: I18nText;
}>();
const version = defineModel<string>("version");
const emit = defineEmits<{ open: [] }>();
const { t } = useI18nTyped();
</script>
