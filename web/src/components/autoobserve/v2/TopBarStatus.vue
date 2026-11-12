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
  <span class="flex min-w-0 items-center gap-x-2 whitespace-nowrap" data-test="autoobserve2-topbar">
    <span>{{ live ? date : today }}</span>
    <span
      v-if="live"
      class="flex min-w-32 items-center gap-x-2"
      :aria-hidden="checked.kind === 'none' ? 'true' : undefined"
      data-test="autoobserve2-topbar-checked"
    >
      <template v-if="checked.kind !== 'none'">
        <span aria-hidden="true">·</span>
        <OSkeleton v-if="checked.kind === 'loading'" animation="none" class="h-3 w-28" />
        <span v-else>{{ checked.text }}</span>
      </template>
    </span>
    <template v-else>
      <span aria-hidden="true">·</span>
      <span>{{ t("autoobserve2.topbar.checked", { count: LAST_CHECKED }, LAST_CHECKED) }}</span>
    </template>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { DEMO_DATE } from "../data/facts";
import { LAST_CHECKED } from "./fixtures";
import type { CheckedView } from "../live/liveCopy";

withDefaults(defineProps<{ live?: boolean; date?: I18nText; checked?: CheckedView }>(), {
  live: false,
  date: () => raw(""),
  checked: () => ({ kind: "none" }),
});

const { t, locale } = useI18nTyped();

// The date follows the demo dataset so "Today" in every entry matches it; the greeting follows the viewer.
const today = computed(() =>
  new Date(Date.UTC(...DEMO_DATE, 12)).toLocaleDateString(locale.value, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }),
);
</script>
