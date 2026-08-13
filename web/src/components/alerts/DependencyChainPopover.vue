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
  "View dependencies" trigger: a small graph icon (added ALONGSIDE a row's
  existing actions — never replacing them) that opens a compact popover anchored
  to it, showing that row's dependency chain (DependencyUsagePanel). On-demand and
  subtle — no page, no drawer, no row expansion.

  Delete lives HERE (not in the panel) because a modal ConfirmDialog can't render
  inside the popover without dismissing it. The panel emits `requestDelete`; this
  wrapper closes the popover, opens the same ConfirmDialog the list pages use, and
  performs the delete (a backend 409 "used by" surfaces as a toast). Used from the
  Templates, Notification Destinations and Alerts list action columns.
-->
<template>
  <OPopover v-model:open="open" side="bottom" align="end" :side-offset="4" content-class="p-0">
    <template #trigger>
      <OButton
        variant="ghost"
        size="icon-sm"
        :data-test="`view-dependencies-${focus.name}`"
        @click.stop
      >
        <OIcon name="graph-1" size="sm" />
        <OTooltip side="top" :content="t('alert_dependencies.viewDependencies')" />
      </OButton>
    </template>

    <div class="h-[26rem] w-100 max-w-[92vw]" data-test="view-dependencies-popover">
      <DependencyUsagePanel
        v-if="open"
        :focus="focus"
        @request-delete="onRequestDelete"
        @open="onOpenInPlace"
      />
    </div>
  </OPopover>

  <ConfirmDialog
    v-model="confirm.visible"
    :title="t('alert_dependencies.deleteTitle', { name: confirm.node?.name || '' })"
    :message="t('alert_dependencies.deleteMessage')"
    @update:ok="performDelete"
    @update:cancel="cancelDelete"
  />
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useStore } from "vuex";
import { useI18nTyped, raw } from "@/types/i18n";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ConfirmDialog from "../ConfirmDialog.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import destinationService from "@/services/alert_destination";
import templateService from "@/services/alert_templates";
import alertsService from "@/services/alerts";
import DependencyUsagePanel from "./DependencyUsagePanel.vue";
import { invalidateDependencyGraphCache } from "@/composables/alerts/useDependencyGraph";
import type { DepFocus, DepNode } from "@/composables/alerts/useDependencyGraph";

defineProps<{ focus: DepFocus }>();
const emit = defineEmits<{
  (e: "deleted"): void;
  (e: "open", node: DepNode): void;
}>();

const { t } = useI18nTyped();
const store = useStore();
const open = ref(false);
const confirm = ref<{ visible: boolean; node: DepNode | null }>({ visible: false, node: null });

// A row asked to delete: close the popover (so the modal isn't stacked on it) and
// open the real ConfirmDialog.
const onRequestDelete = (node: DepNode) => {
  open.value = false;
  confirm.value = { visible: true, node };
};
// An in-place-editable entity (template/destination on its own list route) was
// opened: close the popover and let the host list page open its native editor —
// a router.push can't (same route won't remount).
const onOpenInPlace = (node: DepNode) => {
  open.value = false;
  emit("open", node);
};
const cancelDelete = () => {
  confirm.value = { visible: false, node: null };
};
const performDelete = async () => {
  const n = confirm.value.node;
  confirm.value = { visible: false, node: null };
  if (!n) return;
  const org_identifier = store.state.selectedOrganization.identifier;
  try {
    if (n.kind === "destination") {
      await destinationService.delete({ org_identifier, destination_name: n.name });
    } else if (n.kind === "template") {
      await templateService.delete({ org_identifier, template_name: n.name });
    } else if (n.kind === "alert" && n.alertId) {
      await alertsService.delete_by_alert_id(org_identifier, n.alertId, n.folderId);
    } else {
      return;
    }
    // The cached graph now references a deleted entity — drop it so the next open
    // (here or on another list page) refetches.
    invalidateDependencyGraphCache();
    toast({ variant: "success", message: t("alert_dependencies.deletedToast", { name: n.name }) });
    emit("deleted");
  } catch (err: any) {
    toast({
      variant: "error",
      message:
        raw(err?.response?.data?.message) ||
        t("alert_dependencies.deleteFailedToast", { name: n.name }),
    });
  }
};
</script>
