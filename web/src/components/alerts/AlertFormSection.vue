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
import { ALERT_SECTIONS, type AlertSectionId } from "./alertFormSections";

defineProps<{
  id: AlertSectionId;
  /** 1-based position among the editor's sections. */
  index: number;
  title: I18nText;
  /** One sentence under the title. */
  help: I18nText;
}>();

const { t } = useI18nTyped();
const total = ALERT_SECTIONS.length;
</script>

<template>
  <section
    :data-snap-section="id"
    :data-test="`add-alert-section-${id}`"
    class="flex flex-col [&_[data-snap-stop]]:scroll-mt-28"
  >
    <header
      class="bg-surface-base sticky top-0 z-1 flex flex-col gap-1 px-6 pt-6 pb-4 max-lg:static max-lg:z-auto max-lg:pt-4 max-md:px-4"
    >
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
    </header>
    <div class="flex flex-1 flex-col px-6 pb-6 max-md:px-4">
      <div class="rounded-surface bg-surface-overlay border-border-default border px-3 py-1">
        <slot />
      </div>
    </div>
  </section>
</template>
