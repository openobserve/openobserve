<!-- Copyright 2023 OpenObserve Inc.

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
        <div class="flex items-start alert-settings-row">
          <div class="tw:font-semibold flex items-center" style="width: 190px; height: 36px">
            {{ t("alerts.name") }} <span class="text-negative tw:ml-1">*</span>
          </div>
          <div style="width: calc(100% - 190px)">
            <q-input
              v-model="config.name"
              :readonly="isEdit"
              :disable="isEdit"
              dense
              borderless
              placeholder="e.g. K8s CPU Spike"
              :rules="[(v) => !!v || 'Name is required']"
              data-test="anomaly-setup-name"
              style="background: none"
            />
            <div
              v-if="isEdit"
              class="text-caption tw:mt-1"
              :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
            >
              Name cannot be changed after creation.
            </div>
          </div>
        </div>

        <!-- Stream Type + Stream Name (2-col grid) -->
        <div class="flex items-start alert-settings-row">
          <div class="tw:font-semibold flex items-center" style="width: 190px; height: 36px">
            Stream <span class="text-negative tw:ml-1">*</span>
          </div>
          <div style="width: calc(100% - 190px)">
            <div class="tw:grid tw:grid-cols-1 md:tw:grid-cols-2 tw:gap-4">
              <!-- Stream Type -->
              <div>
                <div
                  class="text-caption tw:mb-1"
                  :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
                >
                  Stream Type
                </div>
                <q-select
                  v-model="config.stream_type"
                  :options="streamTypes"
                  :readonly="isEdit"
                  :disable="isEdit"
                  dense
                  borderless
                  :rules="[(v) => !!v || 'Stream type is required']"
                  data-test="anomaly-setup-stream-type"
                  @update:model-value="onStreamTypeChange"
                />
              </div>
              <!-- Stream Name -->
              <div>
                <div
                  class="text-caption tw:mb-1"
                  :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
                >
                  Stream Name
                </div>
                <q-select
                  v-model="config.stream_name"
                  :options="filteredStreams"
                  :readonly="isEdit"
                  :disable="isEdit"
                  dense
                  borderless
                  use-input
                  input-debounce="300"
                  :loading="loadingStreams"
                  placeholder="Select stream"
                  :rules="[(v) => !!v || 'Stream name is required']"
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
          </div>
        </div>

        <!-- Description -->
        <div class="flex items-start alert-settings-row">
          <div class="tw:font-semibold flex items-center" style="width: 190px; height: 36px">
            Description
          </div>
          <div style="width: calc(100% - 190px)">
            <q-input
              v-model="config.description"
              dense
              borderless
              type="textarea"
              rows="3"
              placeholder="Optional description"
              data-test="anomaly-setup-description"
              style="background: none"
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

export default defineComponent({
  name: "AnomalySetup",

  props: {
    config: {
      type: Object as PropType<any>,
      required: true,
    },
    isEdit: {
      type: Boolean,
      default: false,
    },
  },

  setup(props) {
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

    const validate = async (): Promise<boolean> => {
      return formRef.value ? formRef.value.validate() : true;
    };

    watch(
      () => props.config.stream_type,
      (val) => { if (val) loadStreams(); },
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
      validate,
    };
  },
});
</script>

<style lang="scss" scoped>
.step-anomaly-setup {
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

.alert-settings-row {
  margin-bottom: 24px !important;
  padding-bottom: 0 !important;
}
</style>
