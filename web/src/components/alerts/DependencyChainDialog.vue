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
  "View dependencies" dialog — used on the Alerts list where the trigger lives in
  the ⋯ more-menu. Selecting the item closes the menu and opens this small
  centered dialog with the focused dependency graph (DependencyChainGraph), so a
  popover never stacks on the open dropdown. Destinations/Templates use the
  anchored popover instead; both render the same graph.
-->
<template>
  <ODialog v-model:open="openModel" size="md" :title="dialogTitle">
    <div class="h-[26rem]" data-test="view-dependencies-dialog-body">
      <DependencyChainGraph
        v-if="open && focus"
        :focus="focus"
        @deleted="emit('deleted')"
        @close="openModel = false"
      />
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped, raw } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import DependencyChainGraph from "./DependencyChainGraph.vue";
import type { DepFocus } from "@/composables/alerts/useDependencyGraph";

const props = defineProps<{
  open: boolean;
  focus: DepFocus | null;
}>();
const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "deleted"): void;
}>();

const { t } = useI18nTyped();

const openModel = computed({
  get: () => props.open,
  set: (v: boolean) => emit("update:open", v),
});

const dialogTitle = computed(() =>
  props.focus?.name
    ? t("alert_dependencies.dialogTitle", { name: raw(props.focus.name) })
    : t("alert_dependencies.header"),
);
</script>
