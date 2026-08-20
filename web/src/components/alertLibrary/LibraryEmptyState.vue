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

<!--
  LibraryEmptyState — shown only when NOT ONE alert in the active pack matches a
  stream this org receives. That is the single case the stat strip cannot
  express: "0" is a number, "here is how to fix it" is not.

  Deliberately the DEFAULT (neutral) banner variant. An alert that cannot run is
  inert, not urgent, and the cards behind it already recede — a warning tint here
  would make the same state shout and fade at once.
-->
<template>
  <OBanner
    variant="default"
    icon="sensors-off"
    dense
    inline-actions
    data-test="alert-library-empty-state"
  >
    <span class="flex flex-wrap gap-x-1">
      <span class="text-text-heading font-medium">{{ t("alert_library.noCollectorTitle") }}</span>
      <span class="text-text-secondary">{{
        t("alert_library.noCollectorDescription", { count: props.count, pack: props.packLabel })
      }}</span>
    </span>
    <template #actions>
      <OButton
        variant="outline"
        size="sm"
        icon-left="open-in-new"
        data-test="alert-library-empty-state-action"
        @click="emit('action')"
      >
        {{ t("alert_library.setupGuide") }}
      </OButton>
    </template>
  </OBanner>
</template>

<script setup lang="ts">
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";

const props = defineProps<{
  /** Display name of the pack being browsed. */
  packLabel: I18nText;
  /** How many alerts the pack holds — none of which can run yet. */
  count: number;
}>();

const emit = defineEmits<{ action: [] }>();

const { t } = useI18nTyped();
</script>
