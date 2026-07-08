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
  WorkflowNodeDrawer). Mirrors pipeline's ExternalDestination: pick an existing
  Pipeline (remote) Destination or create one inline. The serialized node_type is
  `remote_stream` (NodeData::RemoteStream { org_id, destination_name }) — the same
  node the pipeline uses to forward records to an external destination.

  NOTE: v1 uses pipeline/remote destinations (not alert destinations). Backend
  just needs RemoteStream added to `is_workflow_node()` to accept this on save.

  WorkflowNodeDrawer's Save calls submit(), which returns { org_id,
  destination_name } or null when nothing is selected. While the inline create
  form is open, WorkflowNodeDrawer hides its own footer (CreateDestinationForm
  has its own Save/Cancel) — it reads `createNewDestination` (exposed below).
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

    <!-- inline create destination form (own save/cancel) -->
    <div v-if="createNewDestination" class="tw:w-full">
      <CreateDestinationForm
        @created="onDestinationCreated"
        @cancel="createNewDestination = false"
      />
    </div>

    <!-- pick existing destination -->
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
import CreateDestinationForm from "@/components/pipeline/NodeForm/CreateDestinationForm.vue";
import { workflowObj } from "@/plugins/workflows/useWorkflowCanvas";

const { t } = useI18n();
const store = useStore();

const savedData = workflowObj.currentSelectedNodeData?.data || {};

const loading = ref(false);
const destinations = ref<any[]>([]);
const selectedDestination = ref<string>(savedData.destination_name || "");
const createNewDestination = ref(false);

// Refresh the list when returning from create mode (a new one may exist).
watch(createNewDestination, (v) => {
  if (!v) getDestinations();
});

// Show the destination URL as a sub-label, like pipeline's ExternalDestination.
const destinationOptions = computed(() =>
  destinations.value.map((d: any) => ({
    label: d.name,
    value: d.name,
    subLabel: d.url && d.url.length > 70 ? d.url.slice(0, 70) + "..." : d.url,
    subLabelInline: true,
  })),
);

// Pipeline-module external destinations (same source the pipeline form uses).
const getDestinations = async () => {
  loading.value = true;
  try {
    const res = await destinationService.list({
      page_num: 1,
      page_size: 100000,
      sort_by: "name",
      desc: false,
      org_identifier: store.state.selectedOrganization.identifier,
      module: "pipeline",
    });
    destinations.value = res.data || [];
  } catch (e: any) {
    if (e?.response?.status !== 403) {
      toast({ variant: "error", message: t("workflow.node.destinationLoadError") });
    }
  } finally {
    loading.value = false;
  }
};

onBeforeMount(getDestinations);

const onDestinationCreated = (name: string) => {
  createNewDestination.value = false;
  selectedDestination.value = name;
  getDestinations();
};

// Called by WorkflowNodeDrawer on Save. Toasts on no selection (pipeline's
// ExternalDestination behaviour) and returns null to block the save.
const submit = () => {
  if (!selectedDestination.value) {
    toast({
      variant: "warning",
      message: t("workflow.node.destinationRequired"),
    });
    return null;
  }
  return {
    org_id: store.state.selectedOrganization.identifier,
    destination_name: selectedDestination.value,
  };
};

// Exposed so the drawer can hide its own Save/Cancel while the inline create
// form (which has its own footer) is open — mirrors pipeline ExternalDestination.
defineExpose({ submit, createNewDestination });
</script>
