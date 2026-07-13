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
  Shared "pick a Pipeline (remote) Destination" body for the flow canvases
  (Pipelines + Workflows). Pick an existing external destination or create one
  inline (CreateDestinationForm). The surrounding chrome (drawer/modal +
  Save/Cancel/Delete) lives in each module's wrapper, which reads the result via
  `getPayload()`.

  Emits `expand(boolean)` while the inline create form is open (the host hides
  its own footer — CreateDestinationForm carries its own Save/Cancel).
-->
<template>
  <div
    data-test="destination-picker"
    class="tw:w-full tw:flex tw:flex-col tw:gap-4"
  >
    <OSwitch
      v-model="createNewDestination"
      :label="t('flow.destination.createNew')"
      data-test="destination-picker-create-toggle"
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
        :label="t('flow.destination.select') + ' *'"
        :options="destinationOptions"
        :loading="loading"
        tabindex="0"
        data-test="destination-picker-select"
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

const props = withDefaults(
  defineProps<{ initialName?: string }>(),
  { initialName: "" },
);
const emit = defineEmits<{ (e: "expand", value: boolean): void }>();

const { t } = useI18n();
const store = useStore();

const loading = ref(false);
const destinations = ref<any[]>([]);
const selectedDestination = ref<string>(props.initialName || "");
const createNewDestination = ref(false);

watch(createNewDestination, (v) => {
  emit("expand", v);
  if (!v) getDestinations(); // returning from create — a new one may exist
});

// Show the destination URL as a sub-label.
const destinationOptions = computed(() =>
  destinations.value.map((d: any) => ({
    label: d.name,
    value: d.name,
    subLabel: d.url && d.url.length > 70 ? d.url.slice(0, 70) + "..." : d.url,
    subLabelInline: true,
  })),
);

// Pipeline-module external destinations.
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
      toast({ variant: "error", message: t("flow.destination.loadError") });
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

// Read the current selection as a node payload, or null (toasts on no selection).
const getPayload = () => {
  if (!selectedDestination.value) {
    toast({ variant: "warning", message: t("flow.destination.required") });
    return null;
  }
  return {
    org_id: store.state.selectedOrganization.identifier,
    destination_name: selectedDestination.value,
  };
};

defineExpose({ getPayload });
</script>
