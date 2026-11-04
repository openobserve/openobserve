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
    class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm"
    role="status"
    :data-test="`overview-status-${status.kind}`"
  >
    <OIcon :name="look.icon" size="sm" :class="['shrink-0', look.tone]" />
    <span class="font-medium" :class="look.tone" data-test="overview-status-text">{{
      headline
    }}</span>
    <template v-for="item in status.items" :key="item.key">
      <span class="text-text-secondary" aria-hidden="true">{{ raw("·") }}</span>
      <OButton
        variant="ghost-primary"
        size="xs"
        :data-test="`overview-status-item-${item.key}`"
        @click="emit('select', item.key)"
      >
        {{ t(`overview.status.items.${item.key}`, { count: item.count }, item.count) }}
      </OButton>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import type { AttentionKey, OverviewStatus, OverviewStatusKind } from "./overviewFormat";

const props = defineProps<{ status: OverviewStatus }>();

const emit = defineEmits<{ select: [key: AttentionKey] }>();

const { t } = useI18nTyped();

const LOOKS: Record<OverviewStatusKind, { icon: IconName; tone: string }> = {
  danger: { icon: "error", tone: "text-status-negative" },
  warning: { icon: "warning", tone: "text-status-warning-text" },
  checking: { icon: "schedule", tone: "text-text-secondary" },
  partial: { icon: "warning-amber", tone: "text-status-warning-text" },
  unmonitored: { icon: "info-outline", tone: "text-text-secondary" },
  clear: { icon: "check-circle", tone: "text-status-positive" },
};

const HEADLINES: Record<OverviewStatusKind, I18nKey> = {
  danger: "overview.status.attention",
  warning: "overview.status.attention",
  checking: "overview.status.checking",
  partial: "overview.status.partial",
  unmonitored: "overview.status.unmonitored",
  clear: "overview.status.clear",
};

const look = computed(() => LOOKS[props.status.kind]);

// the counts are in unlike units, so they stay on the items and are never summed into the headline
const headline = computed<I18nText>(() => t(HEADLINES[props.status.kind]));
</script>
