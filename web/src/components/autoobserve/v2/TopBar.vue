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
  <nav class="flex items-center gap-1" data-test="autoobserve2-nav">
    <ViewSwitch class="me-1" />
    <div
      class="items-center"
      :class="searchOpen ? 'flex' : 'hidden sm:flex'"
      data-test="autoobserve2-nav-search"
    >
      <label :for="SEARCH_ID" class="sr-only">{{ t("autoobserve2.nav.searchLabel") }}</label>
      <OInput
        :id="SEARCH_ID"
        v-model="search"
        size="sm"
        class="w-44"
        :placeholder="t('autoobserve2.nav.searchPlaceholder')"
        data-test="autoobserve2-nav-search-input"
        @keydown.enter="submit"
        @blur="collapse"
      >
        <template #icon-left>
          <OIcon name="search" size="sm" class="text-text-secondary" />
        </template>
      </OInput>
    </div>
    <OButton
      v-if="!searchOpen"
      variant="ghost-muted"
      size="icon-sm"
      class="sm:hidden"
      :aria-label="t('autoobserve2.nav.searchLabel')"
      data-test="autoobserve2-nav-search-open"
      @click="openSearch"
    >
      <OIcon name="search" size="sm" />
    </OButton>
    <OButton
      variant="ghost-muted"
      size="sm"
      icon-left="history"
      data-test="autoobserve2-nav-history"
      @click="emit('open', 'history')"
    >
      {{ t("autoobserve2.nav.history") }}
    </OButton>
    <OButton
      variant="ghost-muted"
      size="icon-sm"
      :aria-label="t('autoobserve2.nav.settings')"
      data-test="autoobserve2-nav-settings"
      @click="emit('open', 'settings')"
    >
      <OIcon name="settings" size="sm" />
      <OTooltip :content="t('autoobserve2.nav.settings')" />
    </OButton>
    <OButton
      variant="ghost-muted"
      size="icon-sm"
      :aria-label="t('autoobserve2.nav.howItWorks')"
      data-test="autoobserve2-nav-how-it-works"
      @click="emit('open', 'howItWorks')"
    >
      <OIcon name="help-outline" size="sm" />
      <OTooltip :content="t('autoobserve2.nav.howItWorks')" />
    </OButton>
  </nav>
</template>

<script setup lang="ts">
import { nextTick, ref } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ViewSwitch from "./ViewSwitch.vue";

const emit = defineEmits<{
  open: [drawer: "history" | "settings" | "howItWorks"];
  search: [query: string];
}>();

const { t } = useI18nTyped();

const SEARCH_ID = "autoobserve2-nav-search-field";

const search = ref("");
// Below the sm breakpoint the field hides behind an icon button until asked for.
const searchOpen = ref(false);

const openSearch = async () => {
  searchOpen.value = true;
  await nextTick();
  document.getElementById(SEARCH_ID)?.focus();
};

const collapse = () => {
  if (!search.value.trim()) searchOpen.value = false;
};

const submit = () => {
  const query = search.value.trim();
  if (query) emit("search", query);
};
</script>
