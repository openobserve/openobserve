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
  <!-- The severity spine is drawn by the table row (get-row-status-color),
       matching the sessions page — no in-cell border. -->
  <div class="flex flex-col gap-0.5 min-w-0" data-test="rum-error-issue-cell">
    <div class="flex items-baseline gap-1 min-w-0">
      <span
        class="issue-cell__type shrink-0"
        :class="
          isUnhandled
            ? 'issue-cell__type--unhandled'
            : 'issue-cell__type--handled'
        "
        data-test="rum-error-issue-cell-type"
        >{{ issue.error_type || t("rum.error") }}:</span
      >
      <span
        class="font-semibold truncate min-w-0 text-[var(--o2-text-body)]"
        :title="issue.error_message"
        data-test="rum-error-issue-cell-message"
        >{{ issue.error_message }}</span
      >
    </div>

    <div class="flex items-center gap-1.5 min-w-0 overflow-hidden">
      <OTag
        v-if="issue.error_handling"
        :label="issue.error_handling"
        :variant="isUnhandled ? 'error-outline' : 'warning-outline'"
        size="xs"
        shape="rounded"
        class="uppercase shrink-0"
        data-test="rum-error-issue-cell-handling-tag"
      />
      <code
        v-if="topFrame"
        class="truncate min-w-0"
        :title="topFrame.line !== null ? `${topFrame.file}:${topFrame.line}` : topFrame.file"
        data-test="rum-error-issue-cell-frame"
        >{{ topFrame.file
        }}<template v-if="topFrame.line !== null"
          >:{{ topFrame.line }}</template
        ></code
      >
      <OTag
        v-if="route"
        :label="route"
        variant="default-soft"
        size="xs"
        shape="rounded"
        class="shrink-0"
        data-test="rum-error-issue-cell-route-tag"
      />
      <small
        v-if="issue.service"
        class="truncate"
        data-test="rum-error-issue-cell-service"
        >{{ issue.service }}</small
      >
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import OTag from "@/lib/core/Badge/OTag.vue";
import { parseTopFrame, routeFromUrl } from "@/utils/rum/errorIssueUtils";

const props = defineProps<{
  issue: {
    error_type?: string;
    error_message?: string;
    error_handling?: string;
    error_stack?: string;
    service?: string;
    view_url?: string;
  };
}>();

const { t } = useI18n();

// "handled" is the only safe state — treat missing/other values as unhandled.
const isUnhandled = computed(() => props.issue.error_handling !== "handled");

const topFrame = computed(() => parseTopFrame(props.issue.error_stack));

const route = computed(() => routeFromUrl(props.issue.view_url));
</script>

<style scoped lang="scss">
.issue-cell__type {
  font-weight: var(--font-semibold);

  &--unhandled {
    color: var(--o2-severity-error-color);
  }

  &--handled {
    color: var(--o2-severity-warning-color);
  }
}
</style>
