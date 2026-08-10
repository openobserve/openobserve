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
  AiPageShell — the ONE page header shared by every AI Observability page
  (Sessions, Agent Graph, Agent Behavior, LLM Insights). It reproduces today's
  per-page OPageLayout header EXACTLY — same markup, same class strings, same
  `data-test` pattern — parameterizing only what differs between pages:

    - `dataTest`  — the page prefix. Every page today derives its header
                    data-test values as `${prefix}-page`, `${prefix}-date-time`,
                    `${prefix}-refresh-btn` (e.g. Behavior = `ai-agent-behavior`,
                    Sessions = `ai-sessions`, Graph = `ai-agent-graph`, LLM =
                    `ai-llm-insights`). Passing the bare prefix reproduces all
                    three unchanged.
    - `title` / `subtitle` / `icon` — resolved header content (each page owns
                    its own i18n keys / icon).
    - `dateState` — the shared useAiDateRange() state bound to the picker.
    - `lastRunAt` / `isLoading` — drive the refresh control.

  The default slot is the page body; `#subnav` is the scope bar / tabs strip.
  `date-change` / `refresh` are forwarded so each page wires its own effects.
-->
<template>
  <OPageLayout
    :data-test="`${dataTest}-page`"
    :title="title"
    :subtitle="subtitle"
    :icon="icon"
    bleed
    :scroll="false"
  >
    <template #actions>
      <!-- Last-refreshed indicator (staleness dot + relative time), left of the
           picker — the labeled Refresh button carries no timestamp of its own. -->
      <AiLastRefreshed
        class="mr-1"
        :last-run-at="lastRunAt"
        :loading="isLoading"
        :data-test="`${dataTest}-last-refreshed`"
      />

      <!-- Compare mode (version-compare) makes windows per-version, so the
           page-level picker is disabled and explains why via a tooltip. Wrapping
           in OTooltip even when enabled is harmless — `disabled` on OTooltip
           itself suppresses the bubble in that case. -->
      <OTooltip
        :content="raw(dateDisabledTooltip ?? '')"
        :disabled="!dateDisabled || !dateDisabledTooltip"
      >
        <DateTime
          ref="dateTimeRef"
          auto-apply
          menu-align="end"
          :default-type="dateState.valueType"
          :default-absolute-time="{
            startTime: dateState.startTime ?? 0,
            endTime: dateState.endTime ?? 0,
          }"
          :default-relative-time="dateState.relativeTimePeriod ?? ''"
          :disable="dateDisabled"
          :data-test="`${dataTest}-date-time`"
          class="h-8"
          @on:date-change="$emit('date-change', $event)"
        />
      </OTooltip>
      <!-- Labeled primary Refresh button, matching the Metrics explorer toolbar.
           Disabled + spinning while a query is in flight (cancel isn't
           supported). -->
      <OButton
        variant="primary"
        size="sm-toolbar"
        icon-left="refresh"
        :disabled="isLoading"
        :loading="isLoading"
        :data-test="`${dataTest}-refresh-btn`"
        @click="$emit('refresh')"
      >
        {{ t("common.refresh") }}
      </OButton>
    </template>

    <template v-if="$slots.subnav" #subnav><slot name="subnav" /></template>
    <slot />
  </OPageLayout>
</template>

<script setup lang="ts">
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { ref } from "vue";
import type { AiDateState } from "@/enterprise/composables/useAiDateRange";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import DateTime from "@/components/DateTime.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import AiLastRefreshed from "./AiLastRefreshed.vue";

const { t } = useI18nTyped();

defineProps<{
  /** Page prefix — the header derives `${dataTest}-page`,
      `${dataTest}-date-time`, `${dataTest}-refresh-btn` from it, reproducing
      each page's existing data-test values unchanged. */
  dataTest: string;
  /** Resolved page title (each page passes its own t(...) value). */
  title: I18nText;
  /** Resolved page subtitle. */
  subtitle: I18nText;
  /** OPageHeader icon name. */
  icon: IconName;
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
const dateTimeRef = ref<InstanceType<typeof DateTime> | null>(null);
defineExpose({ dateTimeRef });
</script>
