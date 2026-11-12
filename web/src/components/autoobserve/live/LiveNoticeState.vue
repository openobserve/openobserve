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
      :variant="notice.severity === 'error' ? 'error' : 'neutral'"
      :icon="notice.icon"
      :title="notice.title"
      :description="notice.description"
      tone-icon
      class="flex-1"
    >
      <template v-if="size !== 'inline'" #illustration>
        <span class="flex size-22 items-center justify-center rounded-full" :class="tone.circle">
          <OIcon :name="notice.icon" size="xl" />
        </span>
      </template>
      <template #title>
        <span :class="tone.title">{{ notice.title }}</span>
      </template>
      <template v-if="notice.retry || (notice.details && detail) || action" #actions>
        <OButton
          v-if="notice.retry"
          variant="outline"
          :size="size === 'inline' ? 'sm' : 'md'"
          icon-left="refresh"
          :loading="busy"
          :data-test="retryTest"
          @click="emit('retry')"
        >
          {{ t("autoobserveLive.retry") }}
        </OButton>
        <OButton
          v-if="notice.details && detail"
          variant="ghost"
          :size="size === 'inline' ? 'sm' : 'md'"
          :icon-right="showDetail ? 'expand-less' : 'expand-more'"
          :aria-expanded="showDetail"
          :data-test="`${dataTest}-details`"
          @click="showDetail = !showDetail"
        >
          {{ t("autoobserveLive.notice.details") }}
        </OButton>
        <OButton
          v-if="action"
          variant="ghost-primary"
          :size="size === 'inline' ? 'sm' : 'md'"
          icon-right="arrow-forward"
          :data-test="`${dataTest}-action`"
          @click="emit('action')"
        >
          {{ action }}
        </OButton>
      </template>
      <template v-if="showDetail && detail" #extra>
        <OText variant="mono" class="text-text-secondary max-w-xl text-xs break-words">
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
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import type { LiveNoticeView } from "./liveCopy";

const props = defineProps<{
  notice: LiveNoticeView;
  size: "inline" | "block";
  dataTest: string;
  retryTest?: string;
  detail?: I18nText;
  action?: I18nText;
  busy?: boolean;
}>();

const emit = defineEmits<{ retry: []; action: [] }>();

const { t } = useI18nTyped();

const showDetail = ref(false);

const tone = computed(() =>
  props.notice.severity === "error"
    ? { circle: "bg-status-error-bg text-status-error-text", title: "text-status-error-text" }
    : { circle: "bg-surface-subtle text-text-secondary", title: "" },
);
</script>
