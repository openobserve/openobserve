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
  <div
    class="flex w-full flex-1 flex-col"
    :role="notice.severity === 'error' ? 'alert' : undefined"
    :data-test="dataTest"
  >
    <OEmptyState
      :size="size"
      :kind="kind"
      :icon="notice.icon"
      :title="notice.title"
      :text="notice.description"
      class="flex-1"
    >
      <template v-if="notice.retry || action" #actions>
        <OButton
          v-if="notice.retry"
          variant="secondary"
          :size="buttonSize"
          :loading="busy"
          :data-test="retryTest"
          @click="emit('retry')"
        >
          {{ t("autoobserveLive.retry") }}
        </OButton>
        <OButton
          v-else-if="action"
          variant="secondary"
          :size="buttonSize"
          :data-test="`${dataTest}-action`"
          @click="emit('action')"
        >
          {{ action }}
        </OButton>
      </template>
      <template v-if="notice.details && detail" #extra>
        <OButton
          variant="link"
          size="sm"
          :icon-end="showDetail ? 'expand-less' : 'expand-more'"
          :aria-expanded="showDetail"
          :data-test="`${dataTest}-details`"
          @click="showDetail = !showDetail"
        >
          {{ t("autoobserveLive.notice.details") }}
        </OButton>
        <OText
          v-if="showDetail"
          variant="mono"
          class="text-text-secondary max-w-xl text-xs wrap-break-word"
        >
          {{ detail }}
        </OText>
      </template>
    </OEmptyState>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import type { EmptyStateKind, EmptyStateSize } from "@/lib/core/EmptyState/OEmptyState.types";
import type { LiveNoticeView } from "./liveCopy";

const props = defineProps<{
  notice: LiveNoticeView;
  size: EmptyStateSize;
  dataTest: string;
  retryTest?: string;
  detail?: I18nText;
  action?: I18nText;
  busy?: boolean;
}>();

const emit = defineEmits<{ retry: []; action: [] }>();

const { t } = useI18nTyped();

const showDetail = ref(false);
const buttonSize = computed(() => (props.size === "compact" ? "sm" : undefined));

// A denial is the only error notice drawn with the lock, and it is not a failed load (K5).
const kind = computed<EmptyStateKind>(() => {
  if (props.notice.severity !== "error") return "first-run";
  return props.notice.icon === "lock" ? "denied" : "error";
});
</script>
