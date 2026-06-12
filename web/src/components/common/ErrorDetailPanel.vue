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
    class="tw:text-left tw:rounded-lg tw:border tw:border-border-default tw:bg-surface-panel tw:flex tw:flex-col"
    data-test="error-detail-panel"
  >
    <!-- Summary row (always shown) -->
    <div class="tw:px-4 tw:py-3 tw:flex tw:flex-col tw:gap-1">
      <p
        v-if="summaryLine"
        class="tw:text-sm tw:font-medium tw:text-text-body tw:m-0"
        data-test="error-detail-summary"
      >
        {{ summaryLine }}
      </p>
      <small
        v-if="traceId"
        class="tw:text-text-caption"
        data-test="error-detail-trace-id"
      >
        <span class="tw:font-medium">{{ t("queryError.traceId") }}</span>
        {{ traceId }}
      </small>
    </div>

    <!-- Toggle row -->
    <template v-if="hasDetail">
      <div class="tw:border-t tw:border-border-default tw:px-4 tw:py-1">
        <button
          type="button"
          class="tw:flex tw:items-center tw:gap-1.5 tw:text-xs tw:text-text-secondary tw:py-1.5 tw:cursor-pointer tw:bg-transparent tw:border-0 tw:p-0 tw:hover:text-text-body tw:transition-colors"
          data-test="error-detail-toggle-btn"
          @click="emit('toggle-detail')"
        >
          <OIcon
            :name="showDetail ? 'expand-less' : 'expand-more'"
            size="xs"
          />
          {{ showDetail ? t("queryError.hideDetail") : t("queryError.showDetail") }}
        </button>
      </div>

      <!-- Expanded body — scrollable, capped height -->
      <div
        v-if="showDetail"
        class="tw:border-t tw:border-border-default tw:px-4 tw:py-3 tw:max-h-52 tw:overflow-y-auto"
        data-test="error-detail-body"
      >
        <p
          class="tw:text-xs tw:font-mono tw:text-text-secondary tw:m-0 tw:whitespace-pre-wrap tw:break-all"
        >
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
