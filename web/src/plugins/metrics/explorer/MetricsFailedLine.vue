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
import OFailedPill from "@/lib/feedback/FailedPill/OFailedPill.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";

withDefaults(
  defineProps<{
    /** The failure in full, for the tooltip and screen readers. */
    sentence: I18nText;
    /** Off when another control on the page already retries this failure. */
    retry?: boolean;
    dataTest: string;
  }>(),
  { retry: true },
);

const emit = defineEmits<{ retry: [] }>();

const { t } = useI18nTyped();
</script>

<template>
  <div role="alert" class="min-w-0">
    <OFailedPill
      :sentence="sentence"
      :marker="t('components.value.couldntLoad')"
      :retry="retry"
      :data-test="dataTest"
      @retry="emit('retry')"
    />
  </div>
</template>
