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
  <div data-test="destination-picker" class="w-full flex flex-col gap-4">
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
    <OForm
      v-else
      ref="formRef"
      :schema="destinationSchema"
      :default-values="defaultValues"
      @submit="onFormSubmit"
    >
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

// Shared schema (same one the pipeline external-destination form uses), so the
// required rule can't drift between the two canvases.
const destinationSchema = makeExternalDestinationSchema(t);

const formRef = ref<any>(null);
const destinations = ref<any[]>([]);
const createNewDestination = ref(false);

// Seed for `:default-values` (edit prefill / a just-created destination). The
// form owns the live value once mounted.
const selectedDestinationSeed = ref<string>(props.initialName || "");
const defaultValues = computed((): ExternalDestinationForm => ({
  selectedDestination: selectedDestinationSeed.value,
}));

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
  // Seed it so the form re-mounts (toggling out of create mode) with the value;
  // if the select form is already mounted, push it in directly.
  selectedDestinationSeed.value = name;
  createNewDestination.value = false;
  if (formRef.value?.form) {
    formRef.value.form.setFieldValue("selectedDestination", name);
  }
  getDestinations();
};

// Captured on a schema-valid submit so the imperative `submit()` below can hand
// the values back to the host.
const validated = ref<ExternalDestinationForm | null>(null);
const onFormSubmit = (values: ExternalDestinationForm) => {
  validated.value = values;
};

// Host bridge: validate through the schema and return the node payload, or null
// when invalid (OForm renders the error inline on the field).
const submit = async () => {
  const form = formRef.value;
  if (!form) return null;
  validated.value = null;
  const ok = await form.validate();
  if (!ok) return null;
  const name = form.form?.getFieldValue?.("selectedDestination") ?? "";
  if (!name) return null;
  return {
    org_id: store.state.selectedOrganization.identifier,
    destination_name: name,
  };
};

defineExpose({ submit, createNewDestination, formRef, getDestinations });
</script>
