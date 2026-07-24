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
  Save/Cancel/Delete) lives in each module's wrapper.

  Follows the migrated form house style: the select lives in an <OForm> driven by
  the shared zod schema, so "destination is required" is enforced by the schema
  and rendered inline on the field (no imperative toast). Hosts drive it via the
  exposed async `submit()`, which validates and returns the payload (or null).

  Emits `expand(boolean)` while the inline create form is open (the host hides
  its own footer — CreateDestinationForm carries its own Save/Cancel).
-->
<template>
  <div data-test="destination-picker" class="flex w-full flex-col gap-4">
    <!-- Mode toggle — a bare control OUTSIDE the form: it swaps the
         select-existing form for the CreateDestinationForm create child. -->
    <OSwitch
      v-model="createNewDestination"
      :label="t('flow.destination.createNew')"
      data-test="destination-picker-create-toggle"
    />

    <!-- inline create destination form (own save/cancel) -->
    <div v-if="createNewDestination" class="w-full">
      <CreateDestinationForm
        @created="onDestinationCreated"
        @cancel="createNewDestination = false"
      />
    </div>

    <!-- pick existing destination -->
    <OForm v-else :form="form">
      <OFormSelect
        name="selectedDestination"
        :label="t('flow.destination.select')"
        required
        :options="destinationOptions"
        tabindex="0"
        data-test="destination-picker-select"
      />
    </OForm>
  </div>
</template>

<script lang="ts" setup>
import { computed, onBeforeMount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import destinationService from "@/services/alert_destination";
import CreateDestinationForm from "@/components/pipeline/NodeForm/CreateDestinationForm.vue";
import {
  makeExternalDestinationSchema,
  type ExternalDestinationForm,
} from "@/components/pipeline/NodeForm/ExternalDestination.schema";

const props = withDefaults(defineProps<{ initialName?: string }>(), {
  initialName: "",
});
const emit = defineEmits<{ (e: "expand", value: boolean): void }>();

const { t } = useI18n();
const store = useStore();

const destinations = ref<any[]>([]);
const createNewDestination = ref(false);

// ── OForm wiring (OWNER pattern) ─────────────────────────────────────────────
// Owned here via useOForm to match the sibling pickers (ConditionBuilder /
// FunctionPicker) instead of reaching into an internal form through a template
// ref. The required rule comes from the shared schema (same one the pipeline
// external-destination form uses) and renders inline on the select. The form
// instance outlives the OForm element's v-if remount, so a just-created
// destination can be pushed in with setFieldValue.
const validated = ref<ExternalDestinationForm | null>(null);
const form = useOForm<ExternalDestinationForm>({
  defaultValues: { selectedDestination: props.initialName || "" },
  schema: makeExternalDestinationSchema(t),
  onSubmit: (values) => {
    validated.value = values;
  },
});

// A destination name to auto-select once the post-create refetch lands.
const pendingSelection = ref("");

watch(createNewDestination, async (v) => {
  emit("expand", v);
  if (v) return;
  // Returning from create (either cancelled or just created) — refetch once so a
  // newly-created destination shows, then apply any pending selection.
  await getDestinations();
  if (pendingSelection.value) {
    form.setFieldValue("selectedDestination", pendingSelection.value);
    pendingSelection.value = "";
  }
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
  }
};

onBeforeMount(getDestinations);

const onDestinationCreated = (name: string) => {
  // Leave create mode; the createNewDestination watch does the single refetch and
  // then selects this destination (avoids a duplicate list call).
  pendingSelection.value = name;
  createNewDestination.value = false;
};

// Host bridge: validate through the schema and return the node payload, or null
// when invalid (OForm renders the error inline on the field). onSubmit (above)
// only fires on a schema-valid submit, so `validated` stays null otherwise.
const submit = async () => {
  if (createNewDestination.value) return null; // still in the inline create form
  validated.value = null;
  await form.handleSubmit();
  const values = validated.value as ExternalDestinationForm | null;
  const name = values?.selectedDestination;
  if (!name) return null;
  return {
    org_id: store.state.selectedOrganization.identifier,
    destination_name: name,
  };
};

defineExpose({ submit, createNewDestination, getDestinations });
</script>
