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
  <article
    ref="rootEl"
    class="relative flex gap-3 transition-shadow duration-700 sm:gap-4"
    :data-test="`autoobserve2-change-${change.id}`"
  >
    <span
      class="bg-surface-base relative z-10 mt-1 flex size-9 shrink-0 items-center justify-center rounded-full bg-linear-to-br ring-1 transition-colors duration-700 sm:size-10"
      :class="TUNING_LOOK.badge"
      aria-hidden="true"
    >
      <OIcon :name="TUNING_LOOK.icon" size="sm" />
    </span>
    <div
      class="bg-surface-base border-border-subtle rounded-surface relative flex min-w-0 flex-1 flex-col gap-1 overflow-hidden border px-4 py-3.5 shadow-xs transition duration-200 hover:-translate-y-px hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:px-5"
      :class="{ 'ring-accent ring-2': flash }"
    >
      <span class="absolute inset-y-0 start-0 w-1" :class="TUNING_LOOK.accent" aria-hidden="true" />
      <div class="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <h3
          class="text-text-heading min-w-0 text-base leading-snug font-semibold text-pretty"
          :data-test="`autoobserve2-change-${change.id}-headline`"
        >
          {{ headline }}
        </h3>
        <span class="flex shrink-0 items-center gap-2.5">
          <OTag
            :variant="STATE_LOOK[change.state].variant"
            size="sm"
            :label="t(STATE_LOOK[change.state].key)"
            :data-test="`autoobserve2-change-${change.id}-status`"
          />
        </span>
      </div>
      <p class="text-text-secondary max-w-[65ch] text-sm leading-relaxed text-pretty">
        {{ actors.join(" · ") }}
      </p>
      <p
        v-for="(shift, i) in change.shifts"
        :key="i"
        class="bg-surface-base border-border-subtle rounded-default mt-1 inline-flex max-w-full flex-wrap items-center gap-x-1.5 self-start border px-2 py-0.5 text-xs leading-5"
        :data-test="`autoobserve2-change-${change.id}-shift`"
      >
        <span class="text-text-secondary line-through">{{ shift.from }}</span>
        <OIcon name="arrow-forward" size="xs" class="text-text-muted" aria-hidden="true" />
        <span class="sr-only">{{ t("autoobserve2.needs.shiftTo") }}</span>
        <span class="text-text-heading font-semibold">{{ shift.to }}</span>
        <span class="text-text-secondary">· {{ shift.setting }}</span>
      </p>
      <div class="-ms-2 mt-1.5 flex flex-wrap items-center gap-x-1 gap-y-2">
        <OButton
          variant="ghost-muted"
          size="xs"
          :icon-right="open ? 'expand-less' : 'expand-more'"
          :aria-expanded="open"
          :aria-controls="detailsId"
          :data-test="`autoobserve2-change-${change.id}-details-toggle`"
          @click="emit('update:open', !open)"
        >
          {{
            open
              ? t("autoobserve2.activityPage.actions.hideDetails")
              : t("autoobserve2.activityPage.actions.showDetails")
          }}
        </OButton>
        <OButton
          v-if="change.state === 'done'"
          variant="ghost-muted"
          size="xs"
          icon-left="undo"
          :loading="undoing"
          :data-test="`autoobserve2-change-${change.id}-undo`"
          @click="onUndo"
        >
          {{ t("autoobserve2.activityPage.actions.undo") }}
        </OButton>
      </div>
      <ChangeDetails
        v-if="open"
        :id="detailsId"
        class="mt-2.5"
        :change="change"
        :actors="actors"
        :alert-href="alertHref"
      />
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import ChangeDetails from "./ChangeDetails.vue";
import { changeHeadline, STATE_LOOK, TUNING_LOOK, type Change } from "./changes";

const props = defineProps<{
  change: Change;
  open: boolean;
  actors: I18nText[];
  alertHref: string | null;
  undoing?: boolean;
  flash?: boolean;
}>();

const emit = defineEmits<{
  "update:open": [open: boolean];
  undo: [];
}>();

const { t } = useI18nTyped();

const rootEl = ref<HTMLElement | null>(null);

const detailsId = computed(() => `autoobserve2-change-details-${props.change.id}`);

const headline = computed(() => changeHeadline(t, props.change));

// Undo removes its own button, so focus moves to the row's details toggle instead of falling to the page.
const onUndo = async () => {
  emit("undo");
  await nextTick();
  rootEl.value
    ?.querySelector<HTMLElement>(
      `[data-test="autoobserve2-change-${props.change.id}-details-toggle"]`,
    )
    ?.focus();
};
</script>
