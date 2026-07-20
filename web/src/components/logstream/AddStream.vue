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
  <ODialog
    v-if="!isInPipeline"
    data-test="add-stream-dialog"
    :open="open"
    size="md"
    :title="t('logStream.add')"
    :secondary-button-label="t('logStream.cancel')"
    :primary-button-label="t('common.save')"
    form-id="add-stream-form"
    @update:open="emits('update:open', $event)"
    @click:secondary="emits('update:open', false)"
  >
    <div class="w-full">
      <OForm
        id="add-stream-form"
        :form="addStreamForm"
      >
        <div class="mt-2">
          <OFormInput
            data-test="add-stream-name-input"
            name="name"
            :label="t('common.name')"
            required
            class="showLabelOnTop"
            :help-text="t('logStream.streamNameHelpText')"
            tabindex="0"
          />
        </div>

        <div class="mt-2">
          <OFormSelect
            data-test="add-stream-type-input"
            name="stream_type"
            :options="filteredStreamTypes"
            :label="t('alerts.streamType')"
            required
            labelKey="label"
            valueKey="value"
            class="showLabelOnTop"
          />
        </div>

        <div data-test="add-stream-data-retention-input" v-if="showDataRetention" class="mt-2">
          <OFormInput
            data-test="add-stream-data-retention"
            name="dataRetentionDays"
            :label="t('logStream.dataRetention')"
            required
            class="showLabelOnTop"
            type="number"
          />
        </div>

        <StreamFieldInputs
          class="mt-4"
          form-field-name="fields"
        />
      </OForm>
    </div>
  </ODialog>

  <!-- Inline form for pipeline usage: rendered inside <ODrawer> in Stream.vue.
       The drawer owns the footer Cancel/Save (built-in ODrawer footer); its Save
       submits this form via `form-id="add-stream-node-form"`, so no inline
       buttons here. -->
    <div v-else class="p-4 w-full">
      <OForm
        id="add-stream-node-form"
        :form="addStreamForm"
      >
        <div class="mt-2">
          <OFormInput
            data-test="add-stream-name-input"
            name="name"
            :label="t('common.name')"
            required
            class="showLabelOnTop"
            :help-text="t('logStream.streamNameHelpText')"
            tabindex="0"
          />
        </div>

        <div class="mt-2">
          <OFormSelect
            data-test="add-stream-type-input"
            name="stream_type"
            :options="filteredStreamTypes"
            :label="t('alerts.streamType')"
            required
            labelKey="label"
            valueKey="value"
            class="showLabelOnTop"
          />
        </div>

        <div data-test="add-stream-data-retention-input" v-if="showDataRetention" class="mt-2">
          <OFormInput
            data-test="add-stream-data-retention"
            name="dataRetentionDays"
            :label="t('logStream.dataRetention')"
            required
            class="showLabelOnTop"
            type="number"
          />
        </div>

        <StreamFieldInputs
          class="mt-4"
          form-field-name="fields"
        />
      </OForm>
    </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import StreamFieldInputs from "./StreamFieldInputs.vue";
import streamService from "@/services/stream";
import { useStore } from "vuex";
import { computed } from "vue";
import useStreams from "@/composables/useStreams";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import { useReo } from "@/services/reodotdev_analytics";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  makeAddStreamSchema,
  addStreamDefaults,
  type AddStreamForm,
} from "./AddStream.schema";

const { t } = useI18n();


const streamTypes = [
  { label: "Logs", value: "logs" },
  { label: "Metrics", value: "metrics" },
  { label: "Traces", value: "traces" },
];

const emits = defineEmits(["streamAdded", "close", "added:stream-added", "update:open"]);
const props = defineProps<{
  isInPipeline: boolean;
  open?: boolean;
}>();


const { addStream, getStream } = useStreams();

const store = useStore();

// Scalar validation now lives in the co-located Zod schema. The retention rule
// is conditional on org config (`data_retention_days`), captured here; the
// stream-type half of the condition is read from the form in superRefine.
const addStreamSchema = makeAddStreamSchema(
  !!(store.state.zoConfig.data_retention_days || false),
  t,
);

// Rule ③ OWNER pattern: this component OWNS <OForm> and must read form state
// (stream_type) to drive the parent-side `v-if="showDataRetention"`. So create
// the ONE form here with useOForm, hand it to <OForm :form="addStreamForm">, and
// read it reactively with form.useStore — single source of truth, NO mirror.
// The save is wired through useOForm({ onSubmit }), not @submit.
// onSubmit fires only when the WHOLE schema passes — scalars AND the dynamic
// `fields` rows (StreamFieldInputs is now form-mode, so an empty/invalid row
// blocks submit and shows per-row errors). No separate validate() bridge.
const addStreamForm = useOForm<AddStreamForm>({
  defaultValues: addStreamDefaults(),
  schema: addStreamSchema,
  onSubmit: (value) => saveStream(value),
});

const { track } = useReo();

// Reactive READ of the form-owned stream_type (single source of truth) so
// `showDataRetention` — which also depends on org config the schema can't read —
// re-evaluates when the user changes the type. form.useStore tracks changes
// (a `form.state.values` read inside a computed would not).
const formStreamType = addStreamForm.useStore(
  (s: any) => (s.values.stream_type as string) ?? "",
);

// The form lives in this component's setup (owner pattern), so — unlike the old
// in-dialog-body form — it is NOT recreated when the reka-ui overlay unmounts/
// remounts its body on close→open. Reset to fresh defaults whenever the dialog
// opens so each reopen starts blank (the equivalent of the old
// `:default-values`-on-remount behavior). reset() also zeroes submissionAttempts
// → no stale "required" errors flash. Dialog mode only; the inline pipeline form
// has no `open` toggle.
watch(
  () => props.open,
  (isOpen, wasOpen) => {
    if (isOpen && !wasOpen) addStreamForm.reset();
  },
);

const isSchemaUDSEnabled = computed(() => {
  return store.state.zoConfig.user_defined_schemas_enabled;
});

const filteredStreamTypes = computed(() => {
  //here we can filter out based on isInPipeline prop
  //but for testing purpose we are returning all streamTypes
  return streamTypes;
});


const showDataRetention = computed(
  () =>
    !!(store.state.zoConfig.data_retention_days || false) &&
    formStreamType.value !== "enrichment_tables"
);

// `value` is the fully-validated @submit payload — scalars AND the `fields`
// rows (StreamFieldInputs is form-mode now) — and the single source of truth.
const saveStream = async (value: AddStreamForm) => {
  let isStreamPresent = false;

  await getStream(value.name, value.stream_type, false)
    .then(() => {
      toast({
        message: `Stream "${value.name}" of type "${value.stream_type}" is already present.`,
        variant: "warning",
      });
      isStreamPresent = true;
    })
    .catch(() => {});

  if (isStreamPresent) return;

  const payload = getStreamPayload(
    Number(value.dataRetentionDays),
    value.fields ?? [],
  );
  if (!payload) return;

  await streamService
    .createStream(
      store.state.selectedOrganization.identifier,
      value.name,
      value.stream_type,
      payload
    )
    .then(() => {
      toast({
        message: "Stream created successfully",
        variant: "success",
      });

      return streamService
        .schema(
          store.state.selectedOrganization.identifier,
          value.name,
          value.stream_type
        )
        .then((streamRes: any) => {
          addStream(streamRes.data);
          emits("streamAdded");
          emits("close");
          emits("added:stream-added", value);
        });
    })
    .catch((err) => {
      if(err.response.status != 403){
        toast({
        message: err.response?.data?.message || "Failed to create stream",
        variant: "error",
      });
      }
    });
    track("Button Click", {
      button: "Save Stream",
      page: "Add Stream"
    });

};

const getStreamPayload = (dataRetentionDays: number, rows: any[]) => {
  let stream: {
    fields: any[];
    settings: {
      partition_keys: any[];
      index_fields: any[];
      full_text_search_keys: any[];
      bloom_filter_fields: any[];
      data_retention?: number;
      defined_schema_fields: any[];
    }
  } = {
    fields: [],
    settings: {
      partition_keys: [],
      index_fields: [],
      full_text_search_keys: [],
      bloom_filter_fields: [],
      defined_schema_fields: [],
    }
  };

  if (showDataRetention.value && dataRetentionDays < 1) {
    toast({
      message:
        "Invalid Data Retention Period: Retention period must be at least 1 day.",
      variant: "error",
    });
    return;
  }

  if (showDataRetention.value) {
    stream.settings["data_retention"] = Number(dataRetentionDays);
  }

  rows.forEach((field) => {

    field.name = field.name
      .trim()
      .toLowerCase()
      .replace(/ /g, "_")
      .replace(/-/g, "_");
    
    // add to field list
    stream.fields.push(field);

    // process index types
    field.index_type?.forEach((index: string) => {
      if (index === "fullTextSearchKey") {
        stream.settings.full_text_search_keys.push(field.name);
      }

      if (index === "secondaryIndexKey") {
        stream.settings.index_fields.push(field.name);
      }

      if (index === "keyPartition") {
        stream.settings.partition_keys.push({
          field: field.name,
          types: "value",
        });
      }
      if (index === "prefixPartition") {
        stream.settings.partition_keys.push({
          field: field.name,
          types: "prefix",
        });
      }

      if (index.includes("hashPartition")) {
        const [, buckets] = index.split("_");
        stream.settings.partition_keys.push({
          field: field.name,
          types: {
            hash: Number(buckets),
          },
        });
      }

      if (index === "bloomFilterKey") {
        stream.settings.bloom_filter_fields.push(field.name);
      }
    });

    if (isSchemaUDSEnabled.value) {
      stream.settings.defined_schema_fields.push(field.name);
    }
  });

  return stream;
};
</script>

