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
  "Send To Destination" node body (drawer content only — chrome lives in
  WorkflowNodeDrawer). Picks an existing *Alert Destination* (webhook / email /
  action) or creates a new one inline. This reuses the alert-side destination
  form (AddDestination with `isAlerts`), NOT the pipeline external-destination
  form — workflows dispatch notifications via Alert Destinations (design D4).

  Serialized node_type is `send_to_destination` (planned
  NodeData::SendToDestination { destination_name }). WorkflowEditor mirrors the
  display `destination_type` into node.meta (it's not a NodeData field).

  WorkflowNodeDrawer's Save calls submit(), which returns
  { destination_name, destination_type } or null when nothing is selected.
-->
<template>
  <div
    data-test="workflow-destination-body"
    class="tw:w-full tw:flex tw:flex-col tw:gap-4"
  >
    <OSwitch
      v-model="createNewDestination"
      :label="t('workflow.node.destinationCreateNew')"
      data-test="workflow-destination-create-toggle"
    />

    <!-- inline create alert destination (own header / save / cancel) -->
    <div v-if="createNewDestination" class="tw:w-full">
      <AddDestination
        ref="addDestRef"
        :is-alerts="true"
        :embedded="true"
        :destination="null"
        :templates="templates"
        @get:destinations="onDestinationCreated"
        @cancel:hideform="createNewDestination = false"
      />
    </div>

    <!-- pick existing alert destination -->
    <template v-else>
      <OSelect
        v-model="selectedDestination"
        :label="t('workflow.node.destinationSelect') + ' *'"
        :options="destinationOptions"
        :loading="loading"
        tabindex="0"
        data-test="workflow-destination-select"
      />
    </template>
  </div>
</template>

<script lang="ts" setup>
import { computed, onBeforeMount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import destinationService from "@/services/alert_destination";
import templateService from "@/services/alert_templates";
import AddDestination from "@/components/alerts/AddDestination.vue";
import { workflowObj } from "@/plugins/workflows/useWorkflowCanvas";

const { t } = useI18n();
const store = useStore();

const savedData = workflowObj.currentSelectedNodeData?.data || {};

const loading = ref(false);
const destinations = ref<any[]>([]);
const templates = ref<any[]>([]);
const selectedDestination = ref<string>(savedData.destination_name || "");
const createNewDestination = ref(false);
const addDestRef = ref<any>(null);

// Refresh the list when returning from create mode (a new one may exist).
watch(createNewDestination, (v) => {
  if (!v) getDestinations();
});

// Alert destinations only support webhook / email / action dispatch. Show the
// type as a sub-label so the user can tell channels apart.
const destinationOptions = computed(() =>
  destinations.value.map((d: any) => ({
    label: d.name,
    value: d.name,
    subLabel: (d.type || "").toUpperCase(),
    subLabelInline: true,
  })),
);

// The dispatch channel of the selected destination (webhook/email/action),
// carried into node.meta for display.
const selectedType = computed(
  () =>
    destinations.value.find((d: any) => d.name === selectedDestination.value)
      ?.type || savedData.destination_type || "",
);

// Alert-module destinations (module = "alert"), the same source the alert form
// uses. Restrict to the dispatchable types (mirrors AlertsDestinationList).
const getDestinations = async () => {
  loading.value = true;
  try {
    const res = await destinationService.list({
      page_num: 1,
      page_size: 100000,
      sort_by: "name",
      desc: false,
      org_identifier: store.state.selectedOrganization.identifier,
      module: "alert",
    });
    destinations.value = (res.data || []).filter(
      (d: any) =>
        d.type === "http" || d.type === "email" || d.type === "action",
    );
  } catch (e: any) {
    if (e?.response?.status !== 403) {
      toast({ variant: "error", message: t("workflow.node.destinationLoadError") });
    }
  } finally {
    loading.value = false;
  }
};

// AddDestination needs the alert templates for its (custom) template selector.
const getTemplates = async () => {
  try {
    const res = await templateService.list({
      org_identifier: store.state.selectedOrganization.identifier,
    });
    templates.value = res.data || [];
  } catch {
    // Non-fatal — the picker still works; only custom-template create needs it.
  }
};

onBeforeMount(() => {
  getDestinations();
  getTemplates();
});

// AddDestination emits `get:destinations` after a successful save. Refresh the
// list, close create mode; the new one becomes selectable.
const onDestinationCreated = () => {
  createNewDestination.value = false;
  getDestinations();
};

// Called by WorkflowNodeDrawer on Save. Toasts on no selection and returns null
// to block the save.
const submit = () => {
  if (!selectedDestination.value) {
    toast({
      variant: "warning",
      message: t("workflow.node.destinationRequired"),
    });
    return null;
  }
  return {
    destination_name: selectedDestination.value,
    destination_type: selectedType.value,
  };
};

// Trigger the embedded create form's save from the drawer's sticky footer.
const saveInlineDestination = () => addDestRef.value?.saveDestination?.();
// Leave create mode (drawer Cancel while creating a destination).
const cancelCreate = () => {
  createNewDestination.value = false;
};

// Exposed so the drawer's own sticky footer can drive the inline create form
// (its footer is hidden via `embedded`). `createNewDestination` lets the drawer
// route Save/Cancel to the right action and hide Delete while creating.
defineExpose({
  submit,
  createNewDestination,
  saveInlineDestination,
  cancelCreate,
});
</script>
