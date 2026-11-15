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
<!-- The header shared by the AI pages with a date range; `dataTest` is the prefix of the page's data-test ids. -->
<template>
  <OPageLayout
    :data-test="`${dataTest}-page`"
    :title="header?.title ?? title"
    :about="header?.about ?? about"
    bleed
    :scroll="false"
  >
    <template v-if="hasTabs" #header-tabs><AiSectionTabs /></template>
    <template #actions>
      <!-- Compare mode (version-compare) makes windows per-version, so the
           page-level picker is disabled and explains why via a tooltip. Wrapping
           in OTooltip even when enabled is harmless — `disabled` on OTooltip
           itself suppresses the bubble in that case. -->
      <OTooltip
        :content="raw(dateDisabledTooltip ?? '')"
        :disabled="!dateDisabled || !dateDisabledTooltip"
      >
        <ODateTimeRange
          ref="dateTimeRef"
          auto-apply
          menu-align="end"
          calendar-presets
          :default-type="dateState.valueType"
          :default-absolute-time="{
            startTime: dateState.startTime ?? 0,
            endTime: dateState.endTime ?? 0,
          }"
          :default-relative-time="dateState.relativeTimePeriod ?? ''"
          :disabled="dateDisabled"
          :data-test="`${dataTest}-date-time`"
          @on:date-change="$emit('date-change', $event)"
        />
      </OTooltip>
      <ORefreshButton
        :last-run-at="lastRunAt"
        :loading="isLoading"
        :data-test="`${dataTest}-refresh-btn`"
        @click="$emit('refresh')"
      />
    </template>

    <template v-if="$slots.subnav" #subnav><slot name="subnav" /></template>
    <slot />
  </OPageLayout>
</template>

<script setup lang="ts">
import { raw, type I18nText } from "@/types/i18n";
import { ref } from "vue";
import type { AiDateState } from "@/enterprise/composables/useAiDateRange";
import ODateTimeRange from "@/lib/forms/DateTimeRange/ODateTimeRange.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import AiSectionTabs from "./AiSectionTabs.vue";
import { useAiSectionTabs } from "./aiSectionTabs";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

const { hasTabs, header } = useAiSectionTabs();

defineProps<{
  /** Page prefix — the header derives `${dataTest}-page`,
      `${dataTest}-date-time`, `${dataTest}-refresh-btn` from it, reproducing
      each page's existing data-test values unchanged. */
  dataTest: string;
  title: I18nText;
  about: I18nText;
  /** Shared AI date-range state (useAiDateRange().state) bound to the picker. */
  dateState: AiDateState;
  /** Epoch-ms of the last refresh, shown on the refresh control (or null). */
  lastRunAt: number | null;
  /** Whether a refresh is in flight — disables + spins the refresh control. */
  isLoading: boolean;
  /** Disables the page date-picker (version-compare modes with per-version
      windows: sinceRollout / manual). Defaults to false — every other page
      leaves the picker enabled. */
  dateDisabled?: boolean;
  /** Tooltip explaining WHY the picker is disabled. Only shown when
      `dateDisabled` is true. */
  dateDisabledTooltip?: I18nText;
}>();

defineEmits<{
  (e: "date-change", payload: unknown): void;
  (e: "refresh"): void;
}>();

// Exposed for parity with the per-page usage, which held a `dateTimeRef` to
// the picker. Pages that need the imperative handle can access it via a
// template ref on the shell's forwarded picker.
const dateTimeRef = ref<InstanceType<typeof ODateTimeRange> | null>(null);
defineExpose({ dateTimeRef });
</script>
