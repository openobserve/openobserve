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
  <div class="step-alert-setup" :class="store.state.theme === 'dark' ? 'dark-mode' : 'light-mode'">
    <div class="step-content card-container tw:px-3 tw:py-4">
      <q-form ref="step1Form" @submit.prevent>
        <!-- Alert Name -->
        <div class="form-field tw:mb-4">
          <q-input
            data-test="add-alert-name-input"
            v-model="formData.name"
            :label="t('alerts.name') + ' *'"
            class="showLabelOnTop"
            stack-label
            dense
            borderless
            v-bind:readonly="beingUpdated"
            v-bind:disable="beingUpdated"
            :rules="[
              (val: any) =>
                !!val
                  ? isValidResourceName(val) ||
                    `Characters like :, ?, /, #, and spaces are not allowed.`
                  : t('common.nameRequired'),
            ]"
            tabindex="0"
            hide-bottom-space
          />
        </div>

        <!-- Folder Selection -->
        <div class="form-field tw:mb-4">
          <SelectFolderDropDown
            :disableDropdown="beingUpdated"
            :type="'alerts'"
            :style="'height: 36px;'"
            @folder-selected="updateActiveFolderId"
            :activeFolderId="activeFolderId"
          />
        </div>

        <!-- Stream Type and Stream Name Row -->
        <div class="tw:grid tw:grid-cols-1 md:tw:grid-cols-2 tw:gap-4">
          <!-- Stream Type -->
          <div class="form-field">
            <q-select
              ref="streamTypeFieldRef"
              data-test="add-alert-stream-type-select-dropdown"
              v-model="formData.stream_type"
              :options="streamTypes"
              :label="t('alerts.streamType') + ' *'"
              :popup-content-style="{ textTransform: 'lowercase' }"
              class="showLabelOnTop no-case"
              stack-label
              borderless
              dense
              hide-bottom-space
              v-bind:readonly="beingUpdated"
              v-bind:disable="beingUpdated"
              @update:model-value="updateStreams()"
              :rules="[(val: any) => !!val || 'Field is required!']"
            />
          </div>

          <!-- Stream Name -->
          <div class="form-field">
            <q-select
              ref="streamFieldRef"
              data-test="add-alert-stream-name-select-dropdown"
              v-model="formData.stream_name"
              :options="filteredStreams"
              :label="t('alerts.stream_name') + ' *'"
              :loading="isFetchingStreams"
              color="input-border"
              class="showLabelOnTop no-case"
              stack-label
              dense
              use-input
              borderless
              hide-selected
              hide-bottom-space
              fill-input
              :input-debounce="400"
              v-bind:readonly="beingUpdated"
              v-bind:disable="beingUpdated"
              @filter="filterStreams"
              @update:model-value="handleStreamNameChange"
              behavior="menu"
              :rules="[(val: any) => !!val || 'Field is required!']"
            />
          </div>
        </div>

        <!-- Alert Type (Scheduled/Real-time) -->
        <div class="form-field tw:mb-4 tw:mt-4">
          <div class="tw:flex tw:items-center tw:gap-5">
            <q-radio
              data-test="add-alert-scheduled-alert-radio"
              v-bind:readonly="beingUpdated"
              v-bind:disable="beingUpdated"
              v-model="formData.is_real_time"
              :checked="formData.is_real_time"
              val="false"
              dense
              :label="t('alerts.scheduled')"
              class="q-ml-none o2-radio-button"
            />
            <q-radio
              data-test="add-alert-realtime-alert-radio"
              v-bind:readonly="beingUpdated"
              v-bind:disable="beingUpdated"
              v-model="formData.is_real_time"
              :checked="!formData.is_real_time"
              val="true"
              dense
              :label="t('alerts.realTime')"
              class="q-ml-none o2-radio-button"
            />
          </div>
        </div>
      </q-form>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, type PropType } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { isValidResourceName } from "@/utils/zincutils";
import SelectFolderDropDown from "../../common/sidebar/SelectFolderDropDown.vue";

export default defineComponent({
  name: "Step1AlertSetup",
  components: {
    SelectFolderDropDown,
  },
  props: {
    formData: {
      type: Object as PropType<any>,
      required: true,
    },
    beingUpdated: {
      type: Boolean,
      default: false,
    },
    streamTypes: {
      type: Array as PropType<string[]>,
      required: true,
    },
    filteredStreams: {
      type: Array as PropType<string[]>,
      required: true,
    },
    isFetchingStreams: {
      type: Boolean,
      default: false,
    },
    activeFolderId: {
      type: String,
      required: true,
    },
    streamFieldRef: {
      type: Object as PropType<any>,
      default: null,
    },
    streamTypeFieldRef: {
      type: Object as PropType<any>,
      default: null,
    },
  },
  emits: ["update:streams", "filter:streams", "update:stream-name", "update:active-folder-id"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();
    const step1Form = ref(null);

    const updateStreams = () => {
      emit("update:streams");
    };

    const filterStreams = (val: string, update: any) => {
      emit("filter:streams", val, update);
    };

    const handleStreamNameChange = (streamName: string) => {
      emit("update:stream-name", streamName);
    };

    const updateActiveFolderId = (folderId: any) => {
      emit("update:active-folder-id", folderId);
    };

    const validate = async () => {
      if (step1Form.value) {
        return await (step1Form.value as any).validate();
      }
      return false;
    };

    return {
      t,
      store,
      step1Form,
      isValidResourceName,
      updateStreams,
      filterStreams,
      handleStreamNameChange,
      updateActiveFolderId,
      validate,
    };
  },
});
</script>

<style scoped lang="scss">
.step-alert-setup {
  width: 100%;
  margin: 0 auto;
  height: 100%;

  .step-content {
    border-radius: 8px;
    height: 100%;
  }

  .step-header {
    .step-title {
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 0.2rem;
    }

    .step-subtitle {
      font-size: 13px;
      opacity: 0.8;
      margin: 0;
      margin-bottom: 0.5rem;
    }
  }

  .form-field {
    width: 100%;
  }

  &.dark-mode {
    .step-content {
      background-color: #212121;
      border: 1px solid #343434;
    }

    .step-title {
      color: #ffffff;
    }

    .step-subtitle {
      color: #bdbdbd;
    }
  }

  &.light-mode {
    .step-content {
      background-color: #ffffff;
      border: 1px solid #e6e6e6;
    }

    .step-title {
      color: #1a1a1a;
    }

    .step-subtitle {
      color: #5c5c5c;
    }
  }
}
</style>
