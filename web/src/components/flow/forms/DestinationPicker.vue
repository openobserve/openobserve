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
    <!-- Mode toggle — a bare control OUTSIDE the form: it swaps the select-existing
         form for the CreateDestinationForm create child. Always visible, so the user
         can toggle back to picking an existing destination without hunting for Cancel. -->
    <OSwitch
      v-model="createNewDestination"
      :label="t('flow.destination.createNew')"
      :disabled="disabled"
      data-test="destination-picker-create-toggle"
    />

    <!-- inline create destination form (own save/cancel) -->
    <div v-if="createNewDestination && !disabled" class="w-full">
      <CreateDestinationForm
        :forced-type="forcedType"
        @created="onDestinationCreated"
        @cancel="createNewDestination = false"
      />
    </div>

    <!-- pick existing destination -->
    <OForm v-else :form="form">
      <OFormSelect
        name="selectedDestination"
        :label="t('flow.destination.select')"
        :required="!optional"
        :disabled="disabled"
        :options="destinationOptions"
        tabindex="0"
        data-test="destination-picker-select"
      />
    </OForm>
  </div>
</template>

<script lang="ts" setup>
import { destinationKeys } from "@/services/alert_destination.querykeys";
import { destinationsQuery } from "@/services/alert_destination.queries";
import { queryClient } from "@/composables/query/queryClient";
import { computed, onBeforeMount, ref, watch } from "vue";
import { useI18nTyped } from "@/types/i18n";
import { useStore } from "vuex";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { isCustomDestination } from "@/utils/destinationType";
import CreateDestinationForm from "@/components/pipeline/NodeForm/CreateDestinationForm.vue";
import {
  makeExternalDestinationSchema,
  type ExternalDestinationForm,
} from "@/components/pipeline/NodeForm/ExternalDestination.schema";

// `forcedType`, when set, is forwarded to the inline create form to lock its
// destination type and skip the type-selection step (workflows → "custom").
// `optional` (Workflows) lets the picker be saved with NO destination selected —
// `submit()` then returns an empty `destination_name` instead of null, and the
// required schema check is skipped. `disabled` greys the whole picker out (used by
// the Workflows "Set up later" toggle). Both default false so Pipelines are
// unaffected.
const props = withDefaults(
  defineProps<{
    initialName?: string;
    forcedType?: string;
    optional?: boolean;
    disabled?: boolean;
  }>(),
  {
    initialName: "",
    forcedType: undefined,
    optional: false,
    disabled: false,
  },
);
const emit = defineEmits<{ (e: "expand", value: boolean): void }>();

const { t } = useI18nTyped();
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
  // newly-created destination shows, then apply any pending selection. Drop the
  // cached list first so this is a real refetch and not a cache hit.
  await queryClient.invalidateQueries({ queryKey: destinationKeys.all(store.state.selectedOrganization.identifier) });
  await getDestinations();
  if (pendingSelection.value) {
    form.setFieldValue("selectedDestination", pendingSelection.value);
    pendingSelection.value = "";
  }
});

const toOption = (d: any) => ({
  label: d.name,
  value: d.name,
  subLabel: d.url && d.url.length > 70 ? d.url.slice(0, 70) + "..." : d.url,
  subLabelInline: true,
});

// Show the destination URL as a sub-label. When the host locks the type to custom
// (Workflows), prebuilt provider destinations are filtered out — they are listed by
// the shared pipeline endpoint but cannot be executed by a workflow node.
const destinationOptions = computed(() => {
  const all = destinations.value;
  if (props.forcedType !== "custom") return all.map(toOption);

  const custom = all.filter(isCustomDestination);
  const options = custom.map(toOption);

  // A node saved before this filter existed may point at a prebuilt destination.
  // Keep it listed (flagged) rather than letting it vanish — an empty picker would
  // silently downgrade the node to a placeholder on the next Save.
  const saved = props.initialName
    ? all.find((d: any) => d.name === props.initialName && !isCustomDestination(d))
    : undefined;
  if (saved) {
    options.unshift({
      ...toOption(saved),
      subLabel: t("flow.destination.unsupportedType"),
    });
  }
  return options;
});

// Pipeline-module external destinations.
const getDestinations = async () => {
  try {
    destinations.value = await queryClient.fetchQuery(destinationsQuery(store.state.selectedOrganization.identifier, "pipeline"));
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
  // Optional (Workflows placeholder): empty is allowed. Read the current value
  // WITHOUT running the required schema, so no inline error and empty resolves to
  // "" rather than null.
  if (props.optional) {
    const name = (form.state.values.selectedDestination as string) || "";
    return {
      org_id: store.state.selectedOrganization.identifier,
      destination_name: name,
    };
  }
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
