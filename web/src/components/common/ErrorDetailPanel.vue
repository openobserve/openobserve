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
  ErrorDetailPanel — collapsible error detail card used inside QueryErrorState.

  Shows:
    • summaryLine  — first sentence of the error message (always visible)
    • traceId      — backend trace ID for support / debugging
    • detailBody   — expanded full message + raw SQL detail (hidden by default)

  The parent owns the showDetail boolean and toggles it via @toggle-detail.
-->
<template>
  <div
    class="rounded-default border-border-default bg-surface-panel flex flex-col border text-left"
    data-test="error-detail-panel"
  >
    <!-- Summary row (always shown) -->
    <div class="flex flex-col gap-1 px-4 py-3">
      <p
        v-if="summaryLine"
        class="text-text-body m-0 text-sm font-medium"
        data-test="error-detail-summary"
      >
        {{ summaryLine }}
      </p>
      <small v-if="traceId" class="text-text-secondary" data-test="error-detail-trace-id">
        <span class="font-medium">{{ t("queryError.traceId") }}</span>
        {{ traceId }}
      </small>
    </div>

    <!-- Toggle row -->
    <template v-if="hasDetail">
      <div class="border-border-default border-t px-4 py-1">
        <button
          type="button"
          class="text-text-secondary hover:text-text-body flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 py-1.5 text-xs transition-colors"
          data-test="error-detail-toggle-btn"
          @click="emit('toggle-detail')"
        >
          <OIcon :name="showDetail ? 'expand-less' : 'expand-more'" size="xs" />
          {{ showDetail ? t("queryError.hideDetail") : t("queryError.showDetail") }}
        </button>
      </div>

      <!-- Expanded body — scrollable, capped height -->
      <div
        v-if="showDetail"
        class="border-border-default max-h-52 overflow-y-auto border-t px-4 py-3"
        data-test="error-detail-body"
      >
        <p class="text-text-secondary m-0 font-mono text-xs break-all whitespace-pre-wrap">
          {{ detailBody }}
        </p>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";

defineProps<{
  summaryLine: string;
  detailBody: string;
  hasDetail: boolean;
  traceId: string;
  showDetail: boolean;
}>();

const emit = defineEmits<{ "toggle-detail": [] }>();
const { t } = useI18n();
</script>
