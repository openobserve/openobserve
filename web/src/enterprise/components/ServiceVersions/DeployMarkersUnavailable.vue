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
  <OButton
    v-if="unavailableDeployServices.size"
    variant="ghost"
    size="chip"
    icon-left="refresh"
    class="text-text-secondary"
    data-test="svcver-marker-unavailable-retry"
    @click="retry"
    >{{ t("serviceVersions.rum.markers.unavailable") }}</OButton
  >
</template>
<script setup lang="ts">
import { onBeforeUnmount } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import { unavailableDeployServices } from "@/composables/dashboard/deployMarkerScope";
const emit = defineEmits<{ retry: [] }>();
const { t } = useI18nTyped();
function retry() {
  unavailableDeployServices.clear();
  emit("retry");
}
onBeforeUnmount(() => unavailableDeployServices.clear());
</script>
