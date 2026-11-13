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
  <div class="flex min-w-0 items-center gap-2 px-2.5 pt-2" :data-test="dataTest">
    <OInlineNotice
      class="min-w-0"
      variant="warning"
      :text="text"
      :action-label="t('search.runQuery')"
      :action-data-test="`${dataTest}-run`"
      @action="emit('run')"
    />
    <OShortcut v-if="shortcutId" :id="shortcutId" class="shrink-0 max-md:hidden" />
  </div>
</template>

<script setup lang="ts">
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OInlineNotice from "@/lib/feedback/InlineNotice/OInlineNotice.vue";
import OShortcut from "@/lib/core/Shortcut/OShortcut.vue";

defineProps<{ text: I18nText; dataTest: string; shortcutId?: string }>();
const emit = defineEmits<{ run: [] }>();
const { t } = useI18nTyped();
</script>
