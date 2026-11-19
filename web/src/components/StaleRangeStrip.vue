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

<template>
  <div
    role="status"
    class="bg-surface-subtle text-text-body border-border-default flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-0 border-b border-solid px-3 py-1.5 text-xs"
    :data-test="dataTest"
  >
    <OIcon name="info-outline" size="xs" class="shrink-0" aria-hidden="true" />
    <span class="min-w-0">{{ text }}</span>
    <OButton
      variant="ghost"
      size="xs"
      class="text-text-link min-h-6 shrink-0 pointer-coarse:min-h-8"
      :data-test="`${dataTest}-run`"
      @click="emit('run')"
      >{{ runLabel ?? t("search.runQuery") }}</OButton
    >
    <OShortcut v-if="shortcutId" :id="shortcutId" class="shrink-0 max-md:hidden" />
    <template v-if="backLabel">
      <OButton
        variant="ghost"
        size="xs"
        class="text-text-link min-h-6 shrink-0 pointer-coarse:min-h-8"
        :data-test="`${dataTest}-back`"
        @click="emit('back')"
        >{{ backLabel }}</OButton
      >
      <OShortcut v-if="backShortcutId" :id="backShortcutId" class="shrink-0 max-md:hidden" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OShortcut from "@/lib/core/Shortcut/OShortcut.vue";

defineProps<{
  text: I18nText;
  dataTest: string;
  shortcutId?: string;
  runLabel?: I18nText;
  backLabel?: I18nText;
  backShortcutId?: string;
}>();
const emit = defineEmits<{ run: []; back: [] }>();
const { t } = useI18nTyped();
</script>
