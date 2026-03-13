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
    class="step-anomaly-setup"
    :class="store.state.theme === 'dark' ? 'dark-mode' : 'light-mode'"
  >
    <div class="step-content card-container tw:px-3 tw:py-4">
      <q-form ref="formRef" @submit.prevent>
        <!-- Name -->
        <div class="form-field tw:mb-4">
          <q-input
            v-model="config.name"
            :label="t('alerts.name') + ' *'"
            class="showLabelOnTop"
            stack-label
            dense
            borderless
            :readonly="isEdit"
            :disable="isEdit"
            placeholder="e.g. K8s CPU Spike"
            :rules="[(v: any) => !!v || t('common.nameRequired')]"
            hide-bottom-space
            data-test="anomaly-setup-name"
          />
        </div>

        <!-- Folder Selection -->
        <div class="form-field tw:mb-4">
          <SelectFolderDropDown
            :disableDropdown="isEdit"
            :type="'alerts'"
            :style="'height: 36px;'"
            @folder-selected="onFolderSelected"
            :activeFolderId="activeFolderId"
          />
        </div>

        <!-- Stream Type + Stream Name (2-col grid) -->
        <div class="tw:grid tw:grid-cols-1 md:tw:grid-cols-2 tw:gap-4 tw:mb-4">
          <!-- Stream Type -->
          <div class="form-field">
            <q-select
              v-model="config.stream_type"
              :options="streamTypes"
              :label="t('alerts.streamType') + ' *'"
              :popup-content-style="{ textTransform: 'lowercase' }"
              class="showLabelOnTop no-case"
              stack-label
              borderless
              dense
              hide-bottom-space
              :readonly="isEdit"
              :disable="isEdit"
              :rules="[(v: any) => !!v || 'Field is required!']"
              data-test="anomaly-setup-stream-type"
              @update:model-value="onStreamTypeChange"
            />
          </div>

          <!-- Stream Name -->
          <div class="form-field">
            <q-select
              v-model="config.stream_name"
              :options="filteredStreams"
              :label="t('alerts.stream_name') + ' *'"
              class="showLabelOnTop no-case"
              stack-label
              dense
              use-input
              borderless
              hide-selected
              hide-bottom-space
              fill-input
              :input-debounce="400"
              :loading="loadingStreams"
              :readonly="isEdit"
              :disable="isEdit"
              :rules="[(v: any) => !!v || 'Field is required!']"
              data-test="anomaly-setup-stream-name"
              @filter="filterStreams"
            >
              <template #no-option>
                <q-item>
                  <q-item-section class="text-grey">
                    {{ config.stream_type ? "No streams found" : "Select a stream type first" }}
                  </q-item-section>
                </q-item>
              </template>
            </q-select>
          </div>
        </div>

        <!-- Description -->
        <div class="form-field tw:mb-4">
          <div class="manual-field-label">{{ t('alerts.description') }}</div>
          <div class="description-wrapper">
            <q-input
              v-model="config.description"
              type="textarea"
              rows="5"
              borderless
              dense
              placeholder="Optional description"
              hide-bottom-space
              :input-style="{ padding: '0.5rem 0.75rem' }"
              data-test="anomaly-setup-description"
            />
          </div>
        </div>
      </q-form>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, watch, type PropType } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import streamService from "@/services/stream";
import SelectFolderDropDown from "@/components/common/sidebar/SelectFolderDropDown.vue";

export default defineComponent({
  name: "AnomalySetup",

  components: {
    SelectFolderDropDown,
  },

  props: {
    config: {
      type: Object as PropType<any>,
      required: true,
    },
    isEdit: {
      type: Boolean,
      default: false,
    },
    activeFolderId: {
      type: String,
      default: "default",
    },
  },

  emits: ["update:active-folder-id"],

  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();
    const formRef = ref<any>(null);

    const streamTypes = ["logs", "metrics", "traces"];
    const allStreams = ref<string[]>([]);
    const filteredStreams = ref<string[]>([]);
    const loadingStreams = ref(false);

    const loadStreams = async () => {
      if (!props.config.stream_type) return;
      loadingStreams.value = true;
      try {
        const res = await streamService.nameList(
          store.state.selectedOrganization.identifier,
          props.config.stream_type,
          false,
        );
        allStreams.value = (res.data?.list || []).map((s: any) => s.name);
        filteredStreams.value = allStreams.value;
      } finally {
        loadingStreams.value = false;
      }
    };

    const onStreamTypeChange = () => {
      props.config.stream_name = "";
      loadStreams();
    };

    const filterStreams = (val: string, update: any) => {
      update(() => {
        const needle = val.toLowerCase();
        filteredStreams.value = needle
          ? allStreams.value.filter((s) => s.toLowerCase().includes(needle))
          : allStreams.value;
      });
    };

    const onFolderSelected = (folder: any) => {
      emit("update:active-folder-id", folder);
    };

    const validate = async (): Promise<boolean> => {
      return formRef.value ? formRef.value.validate() : true;
    };

    watch(
      () => props.config.stream_type,
      (val) => {
        if (val) loadStreams();
      },
      { immediate: true },
    );

    return {
      t,
      store,
      formRef,
      streamTypes,
      filteredStreams,
      loadingStreams,
      onStreamTypeChange,
      filterStreams,
      onFolderSelected,
      validate,
    };
  },
});
</script>

<style lang="scss" scoped>
.step-anomaly-setup {
  height: 100%;

  .step-content {
    border-radius: 8px;
    height: 100%;
    overflow-y: auto;
  }

  &.dark-mode {
    .step-content {
      background-color: #212121;
      border: 1px solid #343434;
    }
  }

  &.light-mode {
    .step-content {
      background-color: #ffffff;
      border: 1px solid #e6e6e6;
    }
  }
}

.manual-field-label {
  font-size: 0.75rem;
  font-weight: 700;
  line-height: 1.25;
  margin-bottom: 0.25rem;
  opacity: 0.7;
}

.description-wrapper {
  border: 1px solid var(--o2-border-color, rgba(0, 0, 0, 0.12));
  border-radius: 0.25rem;
}
</style>
