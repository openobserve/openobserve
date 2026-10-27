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
  <div class="sr-only" role="status" aria-live="polite" aria-atomic="true" :data-test="dataTest">
    {{ message }}
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";

import type { I18nText } from "@/types/i18n";

withDefaults(defineProps<{ dataTest?: string }>(), { dataTest: "assistant-status-region" });

const message = ref<I18nText | "">("");

/** Speaks one sentence; a repeat of the last one is dropped so a reader never hears it twice (`95` §2.1). */
function announce(text: I18nText): void {
  if (text === message.value) return;
  message.value = text;
}

defineExpose({ announce });
</script>
