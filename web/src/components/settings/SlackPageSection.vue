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
import { raw, type I18nText } from "@/types/i18n";

defineProps<{
  sectionId: string;
  /** Without a title the section is a plain column: one section reads as today's page. */
  title?: I18nText;
  description?: I18nText;
}>();
</script>

<template>
  <section
    :id="`slack-section-${sectionId}`"
    class="flex scroll-mt-16 flex-col gap-6"
    :data-test="`slack-section-${sectionId}`"
  >
    <div
      v-if="title"
      class="flex flex-col gap-0.5"
      :data-test="`slack-section-${sectionId}-heading`"
    >
      <h2 class="text-text-heading m-0 flex items-baseline gap-1.5 text-xl font-semibold">
        {{ title }}
        <span class="text-text-muted font-normal" aria-hidden="true">{{ raw("#") }}</span>
      </h2>
      <p v-if="description" class="text-text-secondary m-0 max-w-190 text-sm">{{ description }}</p>
    </div>
    <slot />
  </section>
</template>
