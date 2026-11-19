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
import { computed, watch } from "vue";
import {
  loadPackCatalog,
  packById,
  packCatalogState,
} from "@/composables/starterPacks/usePackCatalog";

const props = withDefaults(defineProps<{ org?: string; requires?: string | string[] }>(), {
  org: "",
  requires: undefined,
});

const load = () => {
  if (props.org) void loadPackCatalog(props.org);
};

// Content that reads a fixed pack in setup would throw if the served catalog dropped it.
const ready = computed(
  () =>
    packCatalogState.value === "ready" &&
    (!props.requires || [props.requires].flat().some((id) => !!packById(id))),
);

watch(() => props.org, load, { immediate: true });
</script>

<template>
  <slot v-if="ready" />
</template>
