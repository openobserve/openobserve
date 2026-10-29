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
    <!-- An answer can hold 40 query blocks and one Monaco each breaks the transcript budget, so the text is a highlighted block that never wraps -->
    <OCodeBlock
      :code="text"
      class="my-0!"
      :lang="lang"
      :copyable="false"
      :toolbar="false"
      :wrap="false"
      :max-lines="MAX_LINES"
      contrast="aa"
      :scroll-label="label"
      :data-test="dataTest"
    />
    <OText
      v-if="hasLongLine"
      variant="meta"
      class="md:hidden"
      data-test="assistant-query-scroll-hint"
    >
      {{ t("assistant.evidence.scrollHint") }}
    </OText>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import type { QueryRef } from "@/composables/assistant/pure";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";

const MAX_LINES = 12;
const PHONE_LINE_CHARS = 40;

const props = defineProps<{
  text: string;
  language: QueryRef["language"];
  /** The scroll region's name; unique per block, as two regions of one name are one landmark to a reader. */
  label: I18nText;
  dataTest: string;
}>();

const { t } = useI18nTyped();

const lang = computed(() => (props.language === "regex" ? "plaintext" : props.language));
const hasLongLine = computed(() =>
  props.text.split("\n").some((line) => line.length > PHONE_LINE_CHARS),
);
</script>
