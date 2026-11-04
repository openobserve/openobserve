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
<script setup lang="ts">
import { computed } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import type { ValueState } from "./OValue.types";

const props = withDefaults(
  defineProps<{
    state: ValueState;
    /** Shown when `state` is "value"; a real 0 shows "0". */
    value?: string | number | null;
    /** Why the value couldn't load, from `valueErrorCause`. */
    errorCause?: I18nText;
    /** Narrow cells (under 6 rem) show the error icon alone; the words stay for screen readers. */
    iconOnly?: boolean;
    /** Width of the loading bar, sized to the expected value. */
    skeletonClass?: string;
    dataTest?: string;
  }>(),
  {
    value: null,
    errorCause: undefined,
    iconOnly: false,
    skeletonClass: "w-12",
    dataTest: undefined,
  },
);

const { t } = useI18nTyped();

const isZero = computed(() => props.value === 0 || props.value === "0");
const tooltip = computed(() =>
  t("components.value.couldntLoadTooltip", {
    cause: props.errorCause ?? t("components.value.causeServer"),
  }),
);
</script>

<template>
  <span
    class="inline-flex max-w-full items-center align-middle tabular-nums"
    :aria-busy="state === 'loading' ? 'true' : undefined"
    :data-state="state"
    :data-test="dataTest"
  >
    <template v-if="state === 'loading'">
      <OSkeleton
        type="text"
        animation="none"
        aria-hidden="true"
        :class="['h-[1em]', skeletonClass]"
      />
      <span class="sr-only">{{ t("components.skeleton.loading") }}</span>
    </template>
    <template v-else-if="state === 'none'">
      <span class="text-text-muted" aria-hidden="true">—</span>
      <span class="sr-only">{{ t("components.value.noValue") }}</span>
    </template>
    <!-- Focusable so the cause in the tooltip is reachable from the keyboard. -->
    <span
      v-else-if="state === 'error'"
      tabindex="0"
      class="text-status-error-text rounded-default focus-visible:outline-focus-ring-accent inline-flex items-center gap-1 whitespace-nowrap outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid"
    >
      <!-- First child, so it binds to this marker; below, so it covers this column, not the row above. -->
      <OTooltip :content="tooltip" side="bottom" />
      <OIcon name="error-outline" size="xs" />
      <span :class="iconOnly && 'sr-only'">{{ t("components.value.couldntLoad") }}</span>
    </span>
    <span v-else :class="isZero && 'text-text-secondary'">{{ value }}</span>
  </span>
</template>
