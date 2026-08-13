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

<!--
  "View dependencies" side panel — a right-hand ODrawer wrapping the reusable
  AlertDependenciesGraph focused on one row (a template, destination or alert).
  Shows that entity's full dependency chain with the same Open / Delete node
  actions. Opened from the Templates, Notification Destinations and Alerts lists.
-->
<template>
  <ODrawer
    v-model:open="openModel"
    side="right"
    size="xl"
    bleed
    :title="drawerTitle"
    title-data-test="view-dependencies-drawer-title"
  >
    <div class="h-full min-h-0" data-test="view-dependencies-drawer-body">
      <AlertDependenciesGraph
        v-if="open"
        embedded
        :focus="focus"
        @deleted="emit('deleted')"
        @close="openModel = false"
      />
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped, raw } from "@/types/i18n";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import AlertDependenciesGraph from "./AlertDependenciesGraph.vue";
import type { DepFocus } from "@/composables/alerts/useDependencyGraph";

const props = defineProps<{
  open: boolean;
  focus: DepFocus | null;
}>();
const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  // Bubbled from the graph so the originating list can refresh after a delete.
  (e: "deleted"): void;
}>();

const { t } = useI18nTyped();

const openModel = computed({
  get: () => props.open,
  set: (v: boolean) => emit("update:open", v),
});

// Title names the row so the panel's scope is obvious.
const drawerTitle = computed(() =>
  props.focus?.name
    ? t("alert_dependencies.dialogTitle", { name: raw(props.focus.name) })
    : t("alert_dependencies.header"),
);
</script>
