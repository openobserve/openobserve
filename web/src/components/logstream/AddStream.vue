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
    <div class="tw:w-full">
      <OForm id="add-stream-form" :default-values="streamInputsDefault" @submit="submitForm">
        <div class="tw:mt-2">
          <OInput
            data-test="add-stream-name-input"
            v-model="streamInputs.name"
            :label="t('common.name') + ' *'"
            class="showLabelOnTop"
            :error="!!nameError"
            :error-message="nameError"
            :help-text="!nameError ? streamNameHelpText : undefined"
            @update:model-value="validateStreamName"
            tabindex="0"
          />
        </div>

        <div class="tw:mt-2">
          <OSelect
            data-test="add-stream-type-input"
            v-model="streamInputs.stream_type"
            :options="filteredStreamTypes"
            :label="t('alerts.streamType') + ' *'"
            labelKey="label"
            valueKey="value"
            class="showLabelOnTop"
            :error="!!streamTypeError"
            :error-message="streamTypeError"
            @update:model-value="streamTypeError = ''"
          />
        </div>

        <div data-test="add-stream-data-retention-input" v-if="showDataRetention" class="tw:mt-2">
          <OInput
            data-test="add-stream-data-retention"
            v-model="streamInputs.dataRetentionDays"
            :label="t('logStream.dataRetention') + ' *'"
            class="showLabelOnTop"
            type="number"
            :error="!!dataRetentionError"
            :error-message="dataRetentionError"
            @update:model-value="dataRetentionError = ''"
          />
        </div>

        <StreamFieldInputs
          ref="fieldInputsRef"
          class="tw:mt-4"
          :fields="fields"
          @add="addField"
          @remove="removeField"
        />
      </OForm>
    </div>
  </ODialog>

  <!-- Inline form for pipeline usage (no drawer wrapper) -->
    <div v-else class="tw:p-4 tw:w-full">
      <OForm :default-values="streamInputsDefault" @submit="submitForm">
        <div class="tw:mt-2">
          <OInput
            data-test="add-stream-name-input"
            v-model="streamInputs.name"
            :label="t('common.name') + ' *'"
            class="showLabelOnTop"
            :error="!!nameError"
            :error-message="nameError"
            :help-text="!nameError ? streamNameHelpText : undefined"
            @update:model-value="validateStreamName"
            tabindex="0"
          />
        </div>

        <div class="tw:mt-2">
          <OSelect
            data-test="add-stream-type-input"
            v-model="streamInputs.stream_type"
            :options="filteredStreamTypes"
            :label="t('alerts.streamType') + ' *'"
            labelKey="label"
            valueKey="value"
            class="showLabelOnTop"
            :error="!!streamTypeError"
            :error-message="streamTypeError"
            @update:model-value="streamTypeError = ''"
          />
        </div>

        <div data-test="add-stream-data-retention-input" v-if="showDataRetention" class="tw:mt-2">
          <OInput
            data-test="add-stream-data-retention"
            v-model="streamInputs.dataRetentionDays"
            :label="t('logStream.dataRetention') + ' *'"
            class="showLabelOnTop"
            type="number"
            :error="!!dataRetentionError"
            :error-message="dataRetentionError"
            @update:model-value="dataRetentionError = ''"
          />
        </div>

        <StreamFieldInputs
          ref="fieldInputsRef"
          class="tw:mt-4"
          :fields="fields"
          @add="addField"
          @remove="removeField"
        />

        <div class="tw:flex tw:justify-start tw:mt-6 tw:gap-2">
          <OButton
            data-test="add-stream-cancel-btn"
            variant="outline"
            size="sm-action"
            @click="emits('close')"
          >{{ t('logStream.cancel') }}</OButton>
          <OButton
            data-test="add-stream-save-btn"
            variant="primary"
            size="sm-action"
            type="submit"
          >{{ t('common.save') }}</OButton>
        </div>
      </OForm>
    </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import StreamFieldInputs from "./StreamFieldInputs.vue";
import type { Ref } from "vue";
import streamService from "@/services/stream";
import { useStore } from "vuex";
import { computed } from "vue";
import useStreams from "@/composables/useStreams";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useReo } from "@/services/reodotdev_analytics";
import { toast } from "@/lib/feedback/Toast/useToast";

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

const fields: Ref<any[]> = ref([]);
const addStreamFormRef = ref<any>(null);
const fieldInputsRef = ref<any>(null);
const nameError = ref('');
const streamTypeError = ref('');
const dataRetentionError = ref('');

// Allowed characters mirror the backend `format_stream_name` regex
// (src/config/src/utils/schema.rs): alphanumeric, underscore and colon only.
const streamNameRegex = /^[a-zA-Z0-9_:]+$/;
const streamNameHelpText = "Use alphanumeric characters, underscore and colon only.";

const validateStreamName = () => {
  if (streamInputs.value.name && !streamNameRegex.test(streamInputs.value.name)) {
    nameError.value = streamNameHelpText;
  } else {
    nameError.value = '';
  }
};

const submitForm = () => {
  if (!validateStream()) return;
  saveStream();
};

const store = useStore();


const { track } = useReo();

const streamInputsDefault = {
  name: "",
  stream_type: "",
  index_type: [],
  dataRetentionDays: 14,
};

const streamInputs = ref({
  ...streamInputsDefault,
});

const getDefaultField = () => {
  return {
    uuid: crypto.randomUUID(),
    name: "",
    type: undefined,
    index_type: [],
  };
};


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
    streamInputs.value.stream_type !== "enrichment_tables"
);

const validateStream = () => {
  let valid = true;
  if (!streamInputs.value.name.trim()) {
    nameError.value = 'Field is required!';
    valid = false;
  } else if (!streamNameRegex.test(streamInputs.value.name)) {
    nameError.value = streamNameHelpText;
    valid = false;
  }
  if (!streamInputs.value.stream_type) {
    streamTypeError.value = 'Field is required!';
    valid = false;
  }
  if (showDataRetention.value && !(streamInputs.value.dataRetentionDays > 0)) {
    dataRetentionError.value = 'Field is required!';
    valid = false;
  }
  // Fields are optional, but any field that has been added must pass the
  // name/data-type validation in the child before the stream can be saved.
  if (
    fieldInputsRef.value &&
    typeof fieldInputsRef.value.validate === "function" &&
    !fieldInputsRef.value.validate()
  ) {
    valid = false;
  }
  return valid;
};

const saveStream = async () => {
  if (!validateStream()) return;
  let isStreamPresent = false;

  await getStream(
    streamInputs.value.name,
    streamInputs.value.stream_type,
    false
  )
    .then(() => {
      toast({
        message: `Stream "${streamInputs.value.name}" of type "${streamInputs.value.stream_type}" is already present.`,
        variant: "warning",
      });
      isStreamPresent = true;
    })
    .catch(() => {});

  if (isStreamPresent) return;

  const payload = getStreamPayload();
  streamService
    .createStream(
      store.state.selectedOrganization.identifier,
      streamInputs.value.name,
      streamInputs.value.stream_type,
      payload
    )
    .then(() => {
      toast({
        message: "Stream created successfully",
        variant: "success",
      });

      streamService
        .schema(
          store.state.selectedOrganization.identifier,
          streamInputs.value.name,
          streamInputs.value.stream_type
        )
        .then((streamRes: any) => {
          addStream(streamRes.data);
          emits("streamAdded");
          emits("close");
          emits("added:stream-added", streamInputs.value);
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

const getStreamPayload = () => {
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

  if (showDataRetention.value && streamInputs.value.dataRetentionDays < 1) {
    toast({
      message:
        "Invalid Data Retention Period: Retention period must be at least 1 day.",
      variant: "error",
    });
    return;
  }

  if (showDataRetention.value) {
    stream.settings["data_retention"] = Number(streamInputs.value.dataRetentionDays);
  }

  fields.value.forEach((field) => {

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

const addField = () => {
  fields.value.push(getDefaultField());
};

const removeField = (field: any, index: number) => {
  fields.value.splice(index, 1);
};
</script>

