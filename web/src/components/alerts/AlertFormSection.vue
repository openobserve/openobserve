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
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { SETTING_ROW_BARE_KEY } from "@/lib/core/SettingRow/OSettingRow.types";
import { ALERT_SECTIONS, type AlertSectionId } from "./alertFormSections";

const props = defineProps<{
  id: AlertSectionId;
  /** 1-based position among the editor's sections. */
  index: number;
  title: I18nText;
  /** One sentence under the title. */
  help: I18nText;
  /** False while another section is in view: its step buttons hide so only one pair shows. */
  current?: boolean;
}>();

const emit = defineEmits<{ go: [id: AlertSectionId] }>();

const { t } = useI18nTyped();
const total = ALERT_SECTIONS.length;
const def = computed(() => ALERT_SECTIONS.find((section) => section.id === props.id));
const icon = computed(() => def.value?.icon);
const previous = computed(() => ALERT_SECTIONS[props.index - 2]);
const next = computed(() => ALERT_SECTIONS[props.index]);
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

provide(SETTING_ROW_BARE_KEY, true);
</script>

<template>
  <section
    :data-snap-section="id"
    :data-test="`add-alert-section-${id}`"
    class="max-lg:border-border-default flex flex-col max-lg:border-b max-lg:last:border-b-0 [&_[data-snap-stop]]:scroll-mt-24"
  >
    <header
      class="bg-surface-base sticky top-0 z-30 flex items-start gap-3 px-4 pt-4 pb-3 max-lg:static max-lg:z-auto max-lg:pt-3"
    >
      <span
        v-if="icon"
        class="bg-surface-subtle text-accent rounded-surface flex size-8 shrink-0 items-center justify-center"
        :data-test="`add-alert-section-${id}-icon`"
      >
        <OIcon :name="icon" size="sm" />
      </span>
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-text-secondary text-xs" :data-test="`add-alert-section-${id}-eyebrow`">
          {{
            def?.optional
              ? t("alerts.sections.eyebrowOptional", { n: index, total })
              : t("alerts.sections.eyebrow", { n: index, total })
          }}
        </span>
        <h2
          class="text-text-heading m-0 text-xl font-semibold focus:outline-none"
          tabindex="-1"
          data-snap-heading
          :data-test="`add-alert-section-${id}-title`"
        >
          {{ title }}
        </h2>
        <p class="text-text-secondary m-0 text-sm" :data-test="`add-alert-section-${id}-help`">
          {{ help }}
        </p>
      </div>
      <div
        class="flex shrink-0 gap-1 max-md:hidden"
        :class="current === false && 'invisible'"
        :data-test="`add-alert-section-${id}-steps`"
      >
        <OButton
          variant="outline"
          size="icon-sm"
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
          size="icon-sm"
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
    <div class="flex flex-1 flex-col px-4 pb-4">
      <slot />
    </div>
  </section>
</template>
