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
    class="text-left rounded-default border border-border-default bg-surface-panel flex flex-col"
    data-test="error-detail-panel"
  >
    <!-- Summary row (always shown) -->
    <div class="px-4 py-3 flex flex-col gap-1">
      <p
        v-if="summaryLine"
        class="text-sm font-medium text-text-body m-0"
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
      <div class="border-t border-border-default px-4 py-1">
        <button
          type="button"
          class="flex items-center gap-1.5 text-xs text-text-secondary py-1.5 cursor-pointer bg-transparent border-0 p-0 hover:text-text-body transition-colors"
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
        class="border-t border-border-default px-4 py-3 max-h-52 overflow-y-auto"
        data-test="error-detail-body"
      >
        <p class="text-xs font-mono text-text-secondary m-0 whitespace-pre-wrap break-all">
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
