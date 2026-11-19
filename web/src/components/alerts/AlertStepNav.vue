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
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import type { AlertSectionDef, AlertSectionId } from "./alertFormSections";

const props = defineProps<{
  sections: readonly AlertSectionDef[];
  /** The step this nav closes; it links to the steps either side. */
  id: AlertSectionId;
}>();

const emit = defineEmits<{
  /** Scroll to the step and focus its first control. */
  step: [id: AlertSectionId];
}>();

const { t } = useI18nTyped();
const index = computed(() => props.sections.findIndex((section) => section.id === props.id));
const previous = computed(() => props.sections[index.value - 1]);
const next = computed(() => props.sections[index.value + 1]);
</script>

<template>
  <div
    v-if="previous || next"
    class="flex items-center justify-end gap-2 pt-2"
    data-test="add-alert-step-nav"
  >
    <OButton
      v-if="previous"
      variant="ghost"
      size="sm"
      icon-left="arrow-back"
      data-test="add-alert-step-back"
      @click="emit('step', previous.id)"
    >
      {{ t("alerts.sections.back", { title: t(previous.navKey) }) }}
    </OButton>
    <OButton
      v-if="next"
      variant="outline"
      size="sm"
      icon-right="arrow-forward"
      data-test="add-alert-step-next"
      @click="emit('step', next.id)"
    >
      {{ t("alerts.sections.next", { title: t(next.navKey) }) }}
    </OButton>
  </div>
</template>
