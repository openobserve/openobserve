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
import OFormSection from "@/lib/core/FormSection/OFormSection.vue";
import type { I18nText } from "@/types/i18n";

defineProps<{
  sectionId: string;
  /** With a title the section is one card; without, a plain column of its own cards. */
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
    <OFormSection
      v-if="title"
      variant="plain"
      :title="title"
      :description="description"
      :data-test="`slack-section-${sectionId}-heading`"
    >
      <template v-if="$slots.actions" #actions>
        <slot name="actions" />
      </template>
      <slot />
    </OFormSection>
    <slot v-else />
  </section>
</template>
