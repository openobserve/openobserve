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
  active: AlertSectionId;
}>();

const emit = defineEmits<{
  /** Scroll to the step and focus its first control. */
  step: [id: AlertSectionId];
}>();

const { t } = useI18nTyped();
const index = computed(() => props.sections.findIndex((section) => section.id === props.active));
const previous = computed(() => props.sections[index.value - 1]);
const next = computed(() => props.sections[index.value + 1]);
</script>

<!-- Both buttons stay mounted, so the bar never shifts as the current step changes. -->
<template>
  <div class="flex shrink-0 items-center gap-2" data-test="add-alert-step-nav">
    <OButton
      variant="ghost"
      size="sm"
      icon-left="arrow-upward"
      :disabled="!previous"
      data-test="add-alert-step-back"
      @click="previous && emit('step', previous.id)"
    >
      {{
        previous
          ? t("alerts.sections.back", { title: t(previous.navKey) })
          : t("alerts.sections.previousStep")
      }}
    </OButton>
    <OButton
      variant="outline"
      size="sm"
      icon-right="arrow-downward"
      :disabled="!next"
      data-test="add-alert-step-next"
      @click="next && emit('step', next.id)"
    >
      {{
        next ? t("alerts.sections.next", { title: t(next.navKey) }) : t("alerts.sections.nextStep")
      }}
    </OButton>
  </div>
</template>
