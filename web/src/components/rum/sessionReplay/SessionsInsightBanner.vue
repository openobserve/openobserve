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
  <!-- Soft variants only — an insight is a hint, not an alarm. The solid
       `error` banner stays reserved for hard failures. -->
  <OBanner
    :variant="insight.kind === 'frustration' ? 'warning' : 'error-soft'"
    :icon="insight.kind === 'frustration' ? 'sentiment-very-dissatisfied' : 'error-outline'"
    dense
    inline-actions
    data-test="rum-sessions-insight-banner"
  >
    <span data-test="rum-sessions-insight-text">{{ message }}</span>
    <template #actions>
      <div class="flex items-center gap-3 whitespace-nowrap">
        <!-- Error cluster: filter the table to THIS error, not all error
             sessions; plus a jump to Error Tracking pre-filtered. Buttons
             inherit the banner text color so they stay readable on every
             banner variant. -->
        <template v-if="insight.kind === 'error'">
          <button
            type="button"
            class="text-current text-compact font-medium underline underline-offset-3 hover:opacity-75"
            data-test="rum-sessions-insight-filter-btn"
            @click="emit('filter')"
          >
            {{ t("rum.seeSessions") }}
          </button>
          <button
            type="button"
            class="text-current text-compact font-medium underline underline-offset-3 hover:opacity-75"
            data-test="rum-sessions-insight-open-error-tracking-btn"
            @click="emit('open-error-tracking')"
          >
            {{ t("rum.openErrorTracking") }}
          </button>
        </template>
        <button
          v-else
          type="button"
          class="text-current text-compact font-medium underline underline-offset-3 hover:opacity-75"
          data-test="rum-sessions-insight-apply-btn"
          @click="emit('apply')"
        >
          {{ t("rum.seeSessions") }}
        </button>
      </div>
    </template>
  </OBanner>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";

export interface InsightPayload {
  kind: "frustration" | "error" | "errorSpike";
  count: number;
  target?: string;
  view?: string;
  message?: string;
  rate?: number;
}

const props = defineProps<{
  insight: InsightPayload;
}>();

const emit = defineEmits<{
  /** Apply the matching health segment (frustration / error spike). */
  apply: [];
  /** Filter the sessions table to this exact error (error cluster). */
  filter: [];
  /** Navigate to Error Tracking pre-filtered to this error. */
  "open-error-tracking": [];
}>();

const { t } = useI18n();

// Show the path, not the full URL — the origin is the same for every view.
const viewPath = computed(() => {
  if (!props.insight.view) return "";
  try {
    return new URL(props.insight.view).pathname;
  } catch {
    return props.insight.view;
  }
});

const truncate = (text: string, max = 120) => (text.length > max ? `${text.slice(0, max)}…` : text);

const message = computed(() => {
  if (props.insight.kind === "frustration") {
    return props.insight.view
      ? t("rum.insightFrustrationWithView", {
          count: props.insight.count,
          target: props.insight.target,
          view: viewPath.value,
        })
      : t("rum.insightFrustration", {
          count: props.insight.count,
          target: props.insight.target,
        });
  }
  if (props.insight.kind === "error") {
    return t("rum.insightError", {
      count: props.insight.count,
      message: truncate(props.insight.message || ""),
    });
  }
  return t("rum.insightErrorSpike", {
    count: props.insight.count,
    rate: props.insight.rate,
  });
});
</script>
