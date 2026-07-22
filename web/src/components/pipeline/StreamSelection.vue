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
  <div class="h-full bg-surface-base">
    <div>
      <div class="flex justify-between items-center px-3 py-2">
        <div data-test="add-pipeline-section-title" style="font-size: var(--text-lg)">
          {{ t("pipeline.addPipeline") }}
        </div>
        <OIcon
          data-test="add-pipeline-close-dialog-btn"
          name="cancel"
          class="cursor-pointer"
          size="md"
          v-close-popup="true"
        />
      </div>

      <div class="w-full bg-separator" style="height: 1px" />

      <!-- Inline form — the Save button lives inside the <OForm>, so Enter submits
           natively via type="submit" (no form-id needed; R4 case 1). -->
      <OForm id="add-pipeline-form" :form="form" v-slot="{ isSubmitting }">
        <div class="px-3">
          <div data-test="add-pipeline-name-input" class="alert-name-input o2-input pt-3">
            <OFormInput
              name="name"
              :label="t('alerts.name')"
              required
              :readonly="isUpdating"
              :disabled="isUpdating"
              data-test="add-pipeline-name-input"
              style="min-width: 480px"
            />
          </div>
          <div data-test="add-pipeline-description-input" class="alert-name-input o2-input mb-2">
            <OFormInput
              name="description"
              :label="t('alerts.description')"
              data-test="add-pipeline-description-input"
              style="min-width: 480px"
            />
          </div>
          <div
            data-test="add-pipeline-stream-type-select"
            class="alert-stream-type o2-input mr-2 mb-2 pt-0"
          >
            <OFormSelect
              name="stream_type"
              :options="streamTypes"
              labelKey="label"
              valueKey="value"
              :label="t('alerts.streamType')"
              required
              :readonly="isUpdating"
              :disabled="isUpdating"
              data-test="add-pipeline-stream-type-select"
              style="min-width: 220px"
            />
          </div>
          <div data-test="add-pipeline-stream-select" class="o2-input pt-0">
            <OFormSelect
              name="stream_name"
              :options="indexOptions"
              :label="t('alerts.stream_name')"
              required
              :loading="isFetchingStreams"
              searchable
              :readonly="isUpdating"
              :disabled="isUpdating"
              data-test="add-pipeline-stream-select"
              style="min-width: 250px"
            />
          </div>
        </div>

        <div class="flex gap-2 mt-4 px-3">
          <OButton
            variant="outline"
            size="sm-action"
            :disabled="isSubmitting"
            data-test="add-pipeline-cancel-btn"
            >{{ t("alerts.cancel") }}</OButton
          >
          <OButton
            variant="primary"
            size="sm-action"
            type="submit"
            :loading="isSubmitting"
            data-test="add-pipeline-submit-btn"
            >{{ t("alerts.save") }}</OButton
          >
        </div>
      </OForm>
    </div>
  </div>
</template>

<script lang="ts" setup>
import useStreams from "@/composables/useStreams";
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import {
  makeAddPipelineSchema,
  addPipelineDefaults,
  type AddPipelineForm,
} from "./StreamSelection.schema";

defineProps({
  isUpdating: {
    type: Boolean,
    required: false,
    default: false,
  },
});

const emit = defineEmits(["save"]);

const store = useStore();

const { getStreams } = useStreams();

const isFetchingStreams = ref(false);

const { t } = useI18n();

// Co-located schema (factory keeps the required message i18n-driven).
const addPipelineSchema = makeAddPipelineSchema(t);

// Rule ③ OWNER pattern: this component OWNS <OForm> and needs to read the
// form-owned `stream_type` to drive the updateStreams() side effect, so it
// creates the form here with useOForm and reads it reactively via form.useStore
// — a SINGLE source of truth (no mirror ref, no store.subscribe). The form is
// handed to <OForm :form="form">.
const form = useOForm<AddPipelineForm>({
  defaultValues: addPipelineDefaults(),
  schema: addPipelineSchema,
  onSubmit: (value) => onSubmit(value),
});

const streamTypes = ref([
  { label: "Logs", value: "logs" },
  { label: "Metrics", value: "metrics" },
  { label: "Traces", value: "traces" },
]);

const indexOptions = ref<string[]>([]);
const filteredStreams = ref<string[]>([]);

// Refetch the stream list (+ reset the dependent stream_name) for a stream_type.
// Reads/writes the FORM-owned values (the select is form-owned now).
const updateStreams = (resetStream = true) => {
  const streamType = form.state.values.stream_type ?? "";
  if (resetStream) {
    form.setFieldValue("stream_name", "", {
      dontUpdateMeta: true,
    });
  }
  if (!streamType) return Promise.resolve();

  isFetchingStreams.value = true;

  return getStreams(streamType, false)
    .then((res: any) => {
      indexOptions.value = res.list.map((data: any) => {
        return data.name;
      });

      return Promise.resolve();
    })
    .catch(() => Promise.reject())
    .finally(() => (isFetchingStreams.value = false));
};

// ── Run updateStreams() when the form-owned stream_type changes ──────────────
// (preserves the old `@update:model-value="updateStreams()"` side effect). The
// form is the single source of truth: read `stream_type` reactively via
// form.useStore and refetch options (+ reset stream_name) on a real change.
// `flush: "sync"` matches the old form.store.subscribe timing: the reset runs the
// instant stream_type changes — before any later setFieldValue("stream_name", …)
// in the same tick can be clobbered by a late-flushed watcher.
watch(
  form.useStore((s: any) => s.values.stream_type),
  (newType, prev) => {
    if (newType !== prev) updateStreams();
  },
  { flush: "sync" },
);

const filterStreams = (val: string, update: any) => {
  filteredStreams.value = filterColumns(indexOptions.value, val, update);
};

const filterColumns = (options: any[], val: String, update: Function) => {
  let filteredOptions: any[] = [];
  if (val === "") {
    update(() => {
      filteredOptions = [...options];
    });
    return filteredOptions;
  }
  update(() => {
    const value = val.toLowerCase();
    filteredOptions = options.filter((column: any) => column.toLowerCase().indexOf(value) > -1);
  });
  return filteredOptions;
};

// @submit handler — OForm only calls it once the schema passes (name required +
// regex, stream_type + stream_name required), so the schema gates the emit (the
// old hand-rolled handleSave/nameError/streamTypeError/streamNameError checks are
// gone). The parent owns the actual async save.
const onSubmit = (value: AddPipelineForm) => {
  emit("save", value);
};

defineExpose({
  form,
  streamTypes,
  indexOptions,
  filteredStreams,
  isFetchingStreams,
  updateStreams,
  filterStreams,
  filterColumns,
  onSubmit,
});
</script>
