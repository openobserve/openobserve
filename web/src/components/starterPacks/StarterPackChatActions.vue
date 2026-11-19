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
import { computed } from "vue";
import { useStore } from "vuex";
import { STARTER_PACKS_ENABLED } from "@/constants/starterPacks";
import { digestPackIds } from "@/composables/starterPacks/packDigest";
import StarterPackCatalogGate from "./StarterPackCatalogGate.vue";
import StarterPackChatRows from "./StarterPackChatRows.vue";

// The user message the reply answers; only a pack digest block in it brings the rows.
const props = defineProps<{ request: string }>();

const store = useStore();
const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const packIds = computed(() => (STARTER_PACKS_ENABLED ? digestPackIds(props.request) : []));
</script>

<template>
  <StarterPackCatalogGate v-if="packIds.length && org" :org="org">
    <StarterPackChatRows :key="`${org}:${packIds.join(',')}`" :org="org" :pack-ids="packIds" />
  </StarterPackCatalogGate>
</template>
