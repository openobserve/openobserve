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
  <div class="flex min-w-0 flex-col gap-1">
    <!-- One Monaco per query breaks the transcript budget; wrapped, since overlay scrollbars hide a sideways overflow -->
    <OCodeBlock
      :code="text"
      class="my-0!"
      :lang="lang"
      :copyable="false"
      :toolbar="false"
      wrap
      :max-lines="MAX_LINES"
      contrast="aa"
      :scroll-label="label"
      :data-test="dataTest"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import type { QueryRef } from "@/composables/assistant/pure";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import type { I18nText } from "@/types/i18n";

const MAX_LINES = 12;

const props = defineProps<{
  text: string;
  language: QueryRef["language"];
  /** The scroll region's name; unique per block, as two regions of one name are one landmark to a reader. */
  label: I18nText;
  dataTest: string;
}>();

const lang = computed(() => (props.language === "regex" ? "plaintext" : props.language));
</script>
