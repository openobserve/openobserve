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
import { SETTING_ROW_BARE_KEY } from "@/lib/core/SettingRow/OSettingRow.types";
import { ALERT_SECTIONS, type AlertSectionId } from "./alertFormSections";

const props = defineProps<{
  id: AlertSectionId;
  /** 1-based position among the editor's sections. */
  index: number;
  title: I18nText;
  /** One sentence under the title. */
  help: I18nText;
}>();

const { t } = useI18nTyped();
const total = ALERT_SECTIONS.length;
const icon = computed(() => ALERT_SECTIONS.find((section) => section.id === props.id)?.icon);

provide(SETTING_ROW_BARE_KEY, true);
</script>

<template>
  <section
    :data-snap-section="id"
    :data-test="`add-alert-section-${id}`"
    class="max-lg:border-border-default flex flex-col max-lg:border-b max-lg:last:border-b-0 [&_[data-snap-stop]]:scroll-mt-28"
  >
    <header
      class="bg-surface-base sticky top-0 z-1 flex items-start gap-4 px-6 pt-6 pb-4 max-lg:static max-lg:z-auto max-lg:pt-4 max-md:gap-3 max-md:px-4"
    >
      <span
        v-if="icon"
        class="bg-surface-subtle text-accent rounded-surface flex size-10 shrink-0 items-center justify-center"
        :data-test="`add-alert-section-${id}-icon`"
      >
        <OIcon :name="icon" size="md" />
      </span>
      <div class="flex min-w-0 flex-col gap-1">
        <span class="text-text-secondary text-xs" :data-test="`add-alert-section-${id}-eyebrow`">
          {{ t("alerts.sections.eyebrow", { n: index, total }) }}
        </span>
        <h2
          class="text-text-heading m-0 text-2xl font-semibold focus:outline-none"
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
    </header>
    <div class="flex flex-1 flex-col ps-20 pe-6 pb-6 max-lg:ps-6 max-md:px-4">
      <slot />
    </div>
  </section>
</template>
