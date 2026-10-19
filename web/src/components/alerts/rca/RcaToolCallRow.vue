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
  <li data-test="rca-tool-call" class="flex min-w-0 flex-col gap-0.5 px-2.5 py-1.5">
    <div class="flex min-w-0 items-center gap-2">
      <span
        data-test="rca-tool-call-name"
        class="text-text-heading text-2xs min-w-0 truncate font-mono font-bold"
      >
        {{ call.tool }}
      </span>
      <span class="flex-1" />
      <span
        v-if="call.result_summary"
        data-test="rca-tool-call-summary"
        class="text-text-secondary text-2xs shrink-0 font-mono"
      >
        {{ call.result_summary }}
      </span>
      <span
        data-test="rca-tool-call-status"
        class="text-2xs shrink-0 font-bold"
        :class="statusClass"
      >
        {{ statusText }}
      </span>
    </div>

    <button
      v-if="call.key_arg"
      type="button"
      data-test="rca-tool-call-arg"
      class="text-text-secondary text-2xs min-w-0 cursor-pointer border-none bg-transparent p-0 text-start font-mono"
      :class="argExpanded ? 'break-all whitespace-pre-wrap' : 'truncate'"
      :aria-expanded="argExpanded"
      :aria-controls="argId"
      @click="argExpanded = !argExpanded"
    >
      <span :id="argId">{{ call.key_arg }}</span>
      <OTooltip v-if="!argExpanded" :content="keyArgText" max-width="32rem" overflow-only />
    </button>

    <p
      v-if="call.error"
      data-test="rca-tool-call-error"
      class="text-status-negative text-2xs m-0 font-mono break-words"
    >
      {{ call.error }}
    </p>

    <template v-if="hasRawData">
      <button
        type="button"
        data-test="rca-tool-call-raw-toggle"
        class="text-accent text-2xs cursor-pointer self-start border-none bg-transparent p-0"
        :aria-expanded="rawOpen"
        :aria-controls="rawId"
        @click="rawOpen = !rawOpen"
      >
        {{
          rawOpen
            ? t("alerts.incidents.rcaThread.hideToolData")
            : t("alerts.incidents.rcaThread.showToolData")
        }}
      </button>
      <div v-if="rawOpen" :id="rawId" class="flex flex-col gap-1">
        <pre
          v-if="inputText"
          data-test="rca-tool-call-input"
          class="rounded-default bg-surface-subtle text-text-body text-2xs m-0 max-h-60 overflow-auto p-2 font-mono break-all whitespace-pre-wrap"
          >{{ inputText }}</pre>
        <pre
          v-if="call.output"
          data-test="rca-tool-call-output"
          class="rounded-default bg-surface-subtle text-text-body text-2xs m-0 max-h-60 overflow-auto p-2 font-mono break-all whitespace-pre-wrap"
          >{{ call.output }}</pre>
      </div>
    </template>
  </li>
</template>

<script setup lang="ts">
import { computed, ref, useId } from "vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import type { RcaToolCall } from "@/services/incidents";
import { formatRcaDuration, rcaToolStatusLabel } from "@/utils/incidents/rcaThread";

const props = defineProps<{ call: RcaToolCall }>();

const { t } = useI18nTyped();

const argExpanded = ref(false);
const rawOpen = ref(false);
const argId = useId();
const rawId = useId();

const keyArgText = computed(() => raw(props.call.key_arg));

const statusText = computed(() => {
  const label = rcaToolStatusLabel(props.call);
  const duration = props.call.duration_ms;
  return props.call.status === "ok" && duration !== null
    ? t("alerts.incidents.rcaThread.toolStatusWithDuration", {
        status: label,
        duration: formatRcaDuration(duration),
      })
    : label;
});

const statusClass = computed(() => {
  switch (props.call.status) {
    case "ok":
      return "text-status-positive";
    case "error":
      return "text-status-negative";
    default:
      return "text-accent";
  }
});

const inputText = computed(() => {
  const input = props.call.input;
  if (input === undefined || input === null) return "";
  return typeof input === "string" ? input : JSON.stringify(input, null, 2);
});

const hasRawData = computed(() => inputText.value !== "" || !!props.call.output);
</script>
