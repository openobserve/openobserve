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
import { computed, provide } from "vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import {
  SETTING_ROW_BARE_KEY,
  SETTING_ROW_GRID_KEY,
} from "@/lib/core/SettingRow/OSettingRow.types";
import AlertStepNav from "./AlertStepNav.vue";
import { ALERT_SECTIONS, type AlertSectionDef, type AlertSectionId } from "./alertFormSections";

const props = withDefaults(
  defineProps<{
    id: AlertSectionId;
    /** The steps this alert type has, in order; numbering and the arrows follow it. */
    sections?: readonly AlertSectionDef[];
    title: I18nText;
    /** What the step asks for, opened from the info button beside the title. */
    help: I18nText;
    /** False while another section is in view: its step buttons fade out but stay in the Tab order. */
    current?: boolean;
  }>(),
  { sections: () => ALERT_SECTIONS, current: undefined },
);

const emit = defineEmits<{
  /** The header arrows: scroll to the section and put the Tab start on its heading. */
  go: [id: AlertSectionId];
  /** Back / Next after the last field: scroll to the step and focus its first control. */
  step: [id: AlertSectionId];
}>();

const { t } = useI18nTyped();
const total = computed(() => props.sections.length);
const index = computed(() => props.sections.findIndex((section) => section.id === props.id) + 1);
const previous = computed(() => props.sections[index.value - 2]);
const next = computed(() => props.sections[index.value]);
const previousLabel = computed(() =>
  previous.value
    ? t("alerts.sections.back", { title: t(previous.value.navKey) })
    : t("alerts.sections.previousStep"),
);
const nextLabel = computed(() =>
  next.value
    ? t("alerts.sections.next", { title: t(next.value.navKey) })
    : t("alerts.sections.nextStep"),
);

// The key also tells nested steps to drop their own card; the body restores the S4 rule and padding.
provide(SETTING_ROW_BARE_KEY, true);
provide(SETTING_ROW_GRID_KEY, true);
</script>

<!-- The header band is the sticky header (data-snap-sticky), so a stuck card shows one header, never two. -->
<template>
  <section
    :data-snap-section="id"
    :data-test="`add-alert-section-${id}`"
    class="flex flex-col px-4 py-2 max-lg:px-3 [&_[data-snap-stop]]:scroll-mt-20"
  >
    <div v-if="$slots.lead" class="px-1 pb-2" :data-test="`add-alert-section-${id}-lead`">
      <slot name="lead" />
    </div>
    <div
      class="bg-surface-overlay border-border-default rounded-surface flex flex-col border"
      :data-test="`add-alert-section-${id}-card`"
    >
      <header
        data-snap-sticky
        class="bg-surface-subtle border-border-default rounded-t-surface sticky top-0 z-30 flex min-h-9 flex-wrap items-center gap-x-2 border-b px-4 py-0.5 max-lg:static max-lg:z-auto"
      >
        <h2
          class="text-text-heading m-0 text-sm font-semibold focus:outline-none"
          tabindex="-1"
          data-snap-heading
          :data-test="`add-alert-section-${id}-title`"
        >
          {{ title }}
        </h2>
        <span
          class="text-text-secondary text-xs whitespace-nowrap max-xl:sr-only"
          :data-test="`add-alert-section-${id}-eyebrow`"
        >
          {{ t("alerts.sections.eyebrow", { n: index, total }) }}
        </span>
        <OPopover side="bottom" align="start" :aria-label="t('alerts.sections.aboutStep')">
          <template #trigger>
            <OButton
              variant="ghost"
              size="icon-xs-sq"
              icon-left="info-outline"
              :aria-label="t('alerts.sections.aboutStep')"
              :data-test="`add-alert-section-${id}-about`"
            />
          </template>
          <p
            class="text-text-body text-compact m-0 w-80 max-w-[calc(100vw-1.5rem)] p-3"
            :data-test="`add-alert-section-${id}-help`"
          >
            {{ help }}
          </p>
        </OPopover>
        <div v-if="$slots.tools" class="flex min-w-0 items-center">
          <slot name="tools" />
        </div>
        <div
          class="ms-auto flex shrink-0 gap-1"
          :class="current === false && 'opacity-0 focus-within:opacity-100'"
          :data-test="`add-alert-section-${id}-steps`"
        >
          <OButton
            variant="outline"
            size="icon-xs-sq"
            icon-left="keyboard-arrow-up"
            :disabled="!previous"
            :aria-label="previousLabel"
            :data-test="`add-alert-section-${id}-prev`"
            @click="previous && emit('go', previous.id)"
          >
            <OTooltip v-if="previous" side="bottom" :content="previousLabel" />
          </OButton>
          <OButton
            variant="outline"
            size="icon-xs-sq"
            icon-left="keyboard-arrow-down"
            :disabled="!next"
            :aria-label="nextLabel"
            :data-test="`add-alert-section-${id}-next`"
            @click="next && emit('go', next.id)"
          >
            <OTooltip v-if="next" side="bottom" :content="nextLabel" />
          </OButton>
        </div>
      </header>
      <div
        class="[&_[data-o-setting-row]]:border-border-default [&_[data-landed]]:bg-accent/8 -mt-px flex flex-col px-4 pb-2 [&_[data-o-setting-row]]:border-t [&_[data-o-setting-row]]:py-2 motion-safe:[&_[data-o-setting-row]]:transition-colors"
        data-section-body
      >
        <slot />
      </div>
      <div
        v-if="$slots.optional"
        class="border-border-default rounded-b-surface hidden flex-col border-t px-4 py-1.5 has-[>:not(:empty):not([style*='display:_none'])]:flex"
        :data-test="`add-alert-section-${id}-optional`"
      >
        <slot name="optional" />
      </div>
      <AlertStepNav :id="id" :sections="sections" class="px-4 pb-3" @step="emit('step', $event)" />
    </div>
  </section>
</template>
