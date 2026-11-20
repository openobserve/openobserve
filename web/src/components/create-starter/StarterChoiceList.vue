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

<!-- The ways to start, one row each, the form last; arrow keys move between rows. -->
<template>
  <div
    ref="listEl"
    class="flex flex-col gap-2"
    data-test="create-starter-choices"
    @keydown.down.prevent="move(1)"
    @keydown.up.prevent="move(-1)"
  >
    <StarterChoiceRow
      v-for="pane in panes"
      :key="pane.id"
      :icon="PANE_ICON[pane.id]"
      :label="pane.label"
      :description="pane.description"
      :meta="pane.count ? matchText(pane.count) : null"
      :locked-reason="pane.availability === 'locked' ? pane.lockedReason : undefined"
      :data-test="`create-starter-pane-${pane.id}`"
      @click="emit('pick', pane.id)"
    />
    <StarterChoiceRow
      icon="edit-note"
      :label="formLabel"
      :description="formDescription"
      affordance="go"
      data-test="create-starter-use-form"
      @click="emit('form')"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import StarterChoiceRow from "@/components/create-starter/StarterChoiceRow.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { PANE_ICON, type StarterPane } from "./createStarter.types";

defineProps<{
  panes: readonly StarterPane[];
  formLabel: I18nText;
  formDescription: I18nText;
}>();

const emit = defineEmits<{ pick: [id: StarterPane["id"]]; form: [] }>();

const { t, locale } = useI18nTyped();
const listEl = ref<HTMLElement | null>(null);

const matchText = (n: number) =>
  t("createStarter.matchCount", { count: new Intl.NumberFormat(locale.value).format(n) }, n);

const rows = () => [...(listEl.value?.querySelectorAll<HTMLElement>(":scope > button") ?? [])];

const move = (by: number) => {
  const list = rows();
  const at = list.indexOf(document.activeElement as HTMLElement);
  list[at < 0 ? (by > 0 ? 0 : list.length - 1) : (at + by + list.length) % list.length]?.focus();
};
</script>
