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
import { computed, inject } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import type { AlertSectionId } from "./alertFormSections";
import { ALERT_SUGGESTIONS_KEY } from "@/composables/alerts/useAlertSuggestions";

const props = defineProps<{
  section: AlertSectionId;
  anchor: "query" | "end";
}>();

const { t } = useI18nTyped();
const suggestions = inject(ALERT_SUGGESTIONS_KEY, null);

const active = computed(() => {
  const current = suggestions?.current(props.section) ?? null;
  return current?.anchor === props.anchor ? current : null;
});
const onAdd = () => active.value && suggestions?.add(active.value.id);
const onNotNow = () => active.value && suggestions?.notNow(active.value.id);
</script>

<template>
  <OBanner
    v-if="active"
    variant="info"
    dense
    inline-actions
    :data-test="`add-alert-suggestion-${section}`"
    :data-suggestion="active.id"
  >
    {{ active.text }}
    <span v-if="active.queued" class="text-text-secondary">
      {{ t("alerts.form.suggestionsQueued", { count: active.queued }, active.queued) }}
    </span>
    <template #actions>
      <OButton
        variant="primary"
        size="sm"
        :data-test="`add-alert-suggestion-${section}-add`"
        @click="onAdd"
      >
        {{ active.actionLabel }}
      </OButton>
      <OButton
        variant="ghost"
        size="sm"
        :data-test="`add-alert-suggestion-${section}-not-now`"
        @click="onNotNow"
      >
        {{ t("alerts.form.notNow") }}
      </OButton>
    </template>
  </OBanner>
</template>
