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
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import { ALERT_SECTIONS, type AlertSectionId } from "./alertFormSections";

withDefaults(
  defineProps<{
    id: AlertSectionId;
    /** 1-based position among the editor's sections. */
    index: number;
    title: I18nText;
    /** Title of the following section; omit on the last one. */
    nextTitle?: I18nText;
  }>(),
  { nextTitle: undefined },
);

const emit = defineEmits<{ (e: "next"): void }>();

const { t } = useI18nTyped();
const total = ALERT_SECTIONS.length;
</script>

<template>
  <section
    :data-snap-section="id"
    :data-test="`add-alert-section-${id}`"
    class="border-border-default flex flex-col border-b last:border-b-0 [&_[data-snap-stop]]:scroll-mt-18"
  >
    <header
      class="bg-surface-base border-border-default sticky top-0 z-1 flex flex-col gap-0.5 border-b px-6 py-3 max-lg:static max-lg:z-auto max-md:px-4"
    >
      <span class="text-text-secondary text-xs" :data-test="`add-alert-section-${id}-eyebrow`">
        {{ t("alerts.sections.eyebrow", { n: index, total }) }}
      </span>
      <h2
        class="text-text-heading m-0 text-xl font-semibold focus:outline-none"
        tabindex="-1"
        data-snap-heading
        :data-test="`add-alert-section-${id}-title`"
      >
        {{ title }}
      </h2>
    </header>
    <div class="flex flex-1 flex-col gap-4 px-6 py-4 max-md:px-4">
      <slot />
    </div>
    <div v-if="nextTitle" class="px-6 pb-4 max-md:px-4">
      <OButton
        variant="ghost-primary"
        size="sm"
        icon-right="arrow-downward"
        :data-test="`add-alert-section-${id}-next`"
        @click="emit('next')"
      >
        {{ t("alerts.sections.next", { title: nextTitle }) }}
      </OButton>
    </div>
  </section>
</template>
