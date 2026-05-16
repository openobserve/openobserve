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
  <div
    class="full-height"
    :class="store.state.theme === 'dark' ? 'bg-dark' : 'bg-white'"
  >
    <div>
      <div class="flex justify-between items-center q-px-md q-py-sm">
        <div data-test="add-pipeline-section-title" style="font-size: 18px">
          {{ t("pipeline.addPipeline") }}
        </div>
        <q-icon
          data-test="add-pipeline-close-dialog-btn"
          name="cancel"
          class="cursor-pointer"
          size="20px"
          v-close-popup="true"
        />
      </div>

      <div class="full-width bg-grey-4" style="height: 1px" />

      <div class="q-px-md">
        <div
          data-test="add-pipeline-name-input"
          class="alert-name-input o2-input"
          style="padding-top: 12px"
        >
          <OInput
            v-model="formData.name"
            :label="t('alerts.name') + ' *'"
            :readonly="isUpdating"
            :disabled="isUpdating"
            :error="!!nameError"
            :error-message="nameError"
            @update:model-value="nameError = ''"
            data-test="add-pipeline-name-input"
            style="min-width: 480px"
          />
        </div>
        <div
          data-test="add-pipeline-description-input"
          class="alert-name-input o2-input q-mb-sm"
        >
          <OInput
            v-model="formData.description"
            :label="t('alerts.description')"
            data-test="add-pipeline-description-input"
            style="min-width: 480px"
          />
        </div>
        <div
          data-test="add-pipeline-stream-type-select"
          class="alert-stream-type o2-input q-mr-sm q-mb-sm"
          style="padding-top: 0"
        >
          <OSelect
            v-model="formData.stream_type"
            :options="streamTypes"
            labelKey="label"
            valueKey="value"
            :label="t('alerts.streamType') + ' *'"
            :readonly="isUpdating"
            :disabled="isUpdating"
            :error="!!streamTypeError"
            :error-message="streamTypeError"
            @update:model-value="updateStreams(); streamTypeError = ''"
            data-test="add-pipeline-stream-type-select"
            style="min-width: 220px"
          />
        </div>
        <div
          data-test="add-pipeline-stream-select"
          class="o2-input"
          style="padding-top: 0"
        >
          <OSelect
            v-model="formData.stream_name"
            :options="indexOptions"
            :label="t('alerts.stream_name') + ' *'"
            :loading="isFetchingStreams"
            searchable
            :readonly="isUpdating"
            :disabled="isUpdating"
            :error="!!streamNameError"
            :error-message="streamNameError"
            @update:model-value="streamNameError = ''"
            data-test="add-pipeline-stream-select"
            style="min-width: 250px"
          />
        </div>
      </div>

      <div class="tw:flex tw:gap-2 q-mt-lg q-px-md">
        <OButton
          variant="outline"
          size="sm-action"
          data-test="add-pipeline-cancel-btn"
        >{{ t('alerts.cancel') }}</OButton>
        <OButton
          variant="primary"
          size="sm-action"
          @click="handleSave"
          data-test="add-pipeline-submit-btn"
        >{{ t('alerts.save') }}</OButton>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import useStreams from "@/composables/useStreams";
import { ref, computed, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";

const props = defineProps({
  isUpdating: {
    type: Boolean,
    required: false,
    default: false,
  },
});

const emit = defineEmits(["save"]);

const store = useStore();

const formData = ref({
  name: "",
  description: "",
  stream_type: "",
  stream_name: "",
});

const { getStreams } = useStreams();

const isFetchingStreams = ref(false);

const { t } = useI18n();

const streamTypes = ref([
  { label: "Logs", value: "logs" },
  { label: "Metrics", value: "metrics" },
  { label: "Traces", value: "traces" },
]);

const nameError = ref('');
const streamTypeError = ref('');
const streamNameError = ref('');

const indexOptions = ref([]);

const isValidName = computed(() => {
  const roleNameRegex = /^[a-zA-Z0-9+=,.@_-]+$/;
  // Check if the role name is valid
  return roleNameRegex.test(formData.value.name);
});

const updateStreams = (resetStream = true) => {
  if (resetStream) formData.value.stream_name = "";
  if (!formData.value.stream_type) return Promise.resolve();

  isFetchingStreams.value = true;

  return getStreams(formData.value.stream_type, false)
    .then((res: any) => {
      indexOptions.value = res.list.map((data: any) => {
        return data.name;
      });

      return Promise.resolve();
    })
    .catch(() => Promise.reject())
    .finally(() => (isFetchingStreams.value = false));
};

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
    filteredOptions = options.filter(
      (column: any) => column.toLowerCase().indexOf(value) > -1,
    );
  });
  return filteredOptions;
};

const handleSave = () => {
  nameError.value = '';
  streamTypeError.value = '';
  streamNameError.value = '';
  if (!formData.value.name) { nameError.value = t('common.nameRequired'); }
  if (!isValidName.value && formData.value.name) { nameError.value = "Use alphanumeric and '+=,.@-_' characters only, without spaces."; }
  if (!formData.value.stream_type) { streamTypeError.value = 'Field is required!'; }
  if (!formData.value.stream_name) { streamNameError.value = 'Field is required!'; }
  if (nameError.value || streamTypeError.value || streamNameError.value) return;
  savePipeline();
};

const savePipeline = () => {
  emit("save", formData.value);
};
</script>

<style lang="scss" scoped></style>
