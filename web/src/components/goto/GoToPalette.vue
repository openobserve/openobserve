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
import { ref, watch } from "vue";
import { useRouter } from "vue-router";

import GoToResults from "@/components/goto/GoToResults.vue";
import { openAssistant, useAssistantCapability } from "@/composables/assistant";
import type { HomeReturnState } from "@/composables/goto/homeReturn";
import type { GoToMatch } from "@/composables/goto/types";
import { openGoToMatch, useGoToIndex } from "@/composables/goto/useGoToIndex";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { useI18nTyped } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    /** Set when the palette opened on Home, so the target page offers the way back. */
    homeReturn?: HomeReturnState | null;
  }>(),
  { homeReturn: null },
);
const open = defineModel<boolean>("open", { default: false });

const LISTBOX_ID = "go-to-palette-listbox";

const { t } = useI18nTyped();
const router = useRouter();
const capability = useAssistantCapability();
const query = ref("");
const active = ref(-1);
const results = ref<InstanceType<typeof GoToResults> | null>(null);
const { matches } = useGoToIndex(query, {
  canAsk: () => capability.assistantCanChat.value,
  enabled: () => open.value,
});

watch(open, (isOpen) => {
  if (isOpen) query.value = "";
});

function select(match: GoToMatch): void {
  const text = query.value.trim();
  open.value = false;
  if (match.kind !== "ask") {
    openGoToMatch(match, router, text, props.homeReturn);
    return;
  }
  void openAssistant({
    entryKind: "go_to_palette",
    entryVerb: "ask",
    objectKind: "none",
    intent: "send",
    thread: "new",
    container: "sidebar",
    payload: { text, chips: [] },
  });
}

function onKeydown(event: KeyboardEvent): void {
  results.value?.onKeydown(event);
}
</script>

<template>
  <ODialog v-model:open="open" size="md" :show-close="false" data-test="go-to-palette">
    <div class="flex flex-col gap-2" @keydown="onKeydown">
      <OSearchInput
        v-model="query"
        size="md"
        :placeholder="t('overview.goTo.placeholder')"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded="true"
        aria-autocomplete="list"
        :aria-controls="LISTBOX_ID"
        :aria-activedescendant="results?.activeDescendant"
        data-test="go-to-palette-input"
      />
      <div class="flex max-h-96 flex-col overflow-y-auto">
        <GoToResults
          ref="results"
          v-model:active="active"
          :matches="matches"
          :query="query"
          :listbox-id="LISTBOX_ID"
          data-test="go-to-palette-results"
          @select="select"
          @close="open = false"
        />
      </div>
    </div>
  </ODialog>
</template>
