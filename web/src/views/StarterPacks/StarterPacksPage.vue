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
import { computed, useTemplateRef } from "vue";
import { useStore } from "vuex";
import StarterPackFindMore from "@/components/starterPacks/StarterPackFindMore.vue";
import StarterPackLibraryTab from "@/components/starterPacks/StarterPackLibraryTab.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import { useI18nTyped } from "@/types/i18n";

const { t } = useI18nTyped();
const store = useStore();
const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const list = useTemplateRef<InstanceType<typeof StarterPackLibraryTab>>("list");
// Find more can add pack items, so the list re-reads what is installed.
const refreshList = () => void list.value?.refresh();
</script>

<template>
  <OPageLayout
    bleed
    :title="t('menu.starterPacks')"
    :subtitle="t('starterPacks.libraryTabs.subtitle')"
    icon="inventory-2"
    title-data-test="starter-packs-title"
    data-test="starter-packs-page"
  >
    <template #actions>
      <StarterPackFindMore :key="org" :org="org" daily-toggle @changed="refreshList" />
    </template>
    <StarterPackLibraryTab v-if="org" ref="list" :key="org" :org="org" />
  </OPageLayout>
</template>
