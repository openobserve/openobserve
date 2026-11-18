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
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import {
  loadPackCatalog,
  packById,
  packCatalogState,
} from "@/composables/starterPacks/usePackCatalog";
import { useI18nTyped } from "@/types/i18n";

const props = withDefaults(
  defineProps<{ org?: string; notice?: boolean; requires?: string | string[] }>(),
  { org: "", notice: false, requires: undefined },
);

const { t } = useI18nTyped();

// Content that reads a fixed pack in setup would throw if the served catalog dropped it.
const ready = computed(
  () =>
    packCatalogState.value === "ready" &&
    (!props.requires || [props.requires].flat().some((id) => !!packById(id))),
);

watch(
  () => props.org,
  (org) => {
    if (org) void loadPackCatalog(org);
  },
  { immediate: true },
);
</script>

<template>
  <slot v-if="ready" />
  <OEmptyState
    v-else-if="notice && packCatalogState === 'error'"
    size="block"
    variant="error"
    illustration="broken-panel"
    :title="t('starterPacks.unavailable')"
    :action-label="t('alert_library.retry')"
    action-icon="refresh"
    data-test="starter-packs-unavailable"
    @action="loadPackCatalog(org)"
  />
</template>
