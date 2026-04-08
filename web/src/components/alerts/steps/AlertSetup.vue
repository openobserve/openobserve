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
  <div class="step-alert-setup" :class="store.state.theme === 'dark' ? 'dark-mode' : 'light-mode'">
    <q-form ref="step1Form" @submit.prevent>

      <!-- ── Section 1: What are you monitoring? ─────────────────────── -->
      <div class="setup-section tw:mb-6">
        <div class="section-label tw:mb-1">{{ t('alerts.setup.whatToMonitor') }}</div>
        <div class="section-hint tw:mb-3">{{ t('alerts.setup.whatToMonitorHint') }}</div>

        <!-- Stream Type + Stream Name row -->
        <div class="tw:flex tw:items-start tw:gap-3">
          <!-- Stream Type segmented button -->
          <div class="tw:flex-shrink-0">
            <div class="tw:text-xs tw:font-medium tw:mb-2 stream-type-label">
              {{ t('alerts.streamType') }} *
            </div>
            <div
              class="stream-type-switch"
              :class="{ 'switch-disabled': beingUpdated }"
              data-test="add-alert-stream-type-select-dropdown"
            >
              <button
                v-for="type in streamTypes"
                :key="type"
                type="button"
                class="stream-type-btn"
                :class="{ 'btn-active': formData.stream_type === type }"
                :disabled="beingUpdated"
                @click="!beingUpdated && selectStreamType(type)"
              >
                <q-icon :name="streamTypeIcon(type)" size="0.9rem" class="tw:mr-1" />
                <span>{{ type }}</span>
              </button>
            </div>
          </div>

          <!-- Pipe separator -->
          <div class="stream-field-pipe tw:flex-shrink-0 tw:flex tw:items-end tw:pb-1">|</div>

          <!-- Stream Name -->
          <div class="tw:min-w-0" style="max-width: 27rem;">
            <div class="tw:text-xs tw:font-medium tw:mb-2 stream-type-label">
              {{ t('alerts.stream_name') }} *
            </div>
            <q-select
              ref="streamFieldRef"
              data-test="add-alert-stream-name-select-dropdown"
              v-model="formData.stream_name"
              :options="filteredStreams"
              :loading="isFetchingStreams"
              color="input-border"
              class="no-case stream-name-select"
              dense
              use-input
              outlined
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
      </div>

      <!-- ── Section 2: Alert Type ────────────────────────────────────── -->
      <div class="setup-section tw:mb-6">
        <div class="section-label tw:mb-1">{{ t('alerts.setup.alertTypeLabel') }}</div>
        <div class="section-hint tw:mb-3">{{ t('alerts.setup.alertTypeHint') }}</div>

        <div class="alert-type-cards tw:grid tw:gap-3"
          :class="isAnomalyDetectionEnabled ? 'tw:grid-cols-3' : 'tw:grid-cols-2'">

          <!-- Scheduled -->
          <div
            data-test="add-alert-scheduled-alert-radio"
            class="alert-type-card"
            :class="{
              'card-selected': formData.is_real_time === 'false',
              'card-disabled': beingUpdated
            }"
            @click="!beingUpdated && (formData.is_real_time = 'false')"
          >
            <div class="tw:flex tw:items-start tw:gap-3">
              <div class="card-icon-wrap">
                <q-icon name="schedule" size="1.25rem" />
              </div>
              <div class="tw:flex-1">
                <div class="card-title">{{ t('alerts.alertTypeCards.scheduledLabel') }}</div>
                <div class="card-desc">{{ t('alerts.alertTypeCards.scheduledDesc') }}</div>
              </div>
              <q-icon
                v-if="formData.is_real_time === 'false'"
                name="check_circle"
                size="1rem"
                class="card-check-icon"
              />
            </div>
          </div>

          <!-- Real-time -->
          <div
            data-test="add-alert-realtime-alert-radio"
            class="alert-type-card"
            :class="{
              'card-selected': formData.is_real_time === 'true',
              'card-disabled': beingUpdated
            }"
            @click="!beingUpdated && (formData.is_real_time = 'true')"
          >
            <div class="tw:flex tw:items-start tw:gap-3">
              <div class="card-icon-wrap">
                <q-icon name="bolt" size="1.25rem" />
              </div>
              <div class="tw:flex-1">
                <div class="card-title">{{ t('alerts.alertTypeCards.realtimeLabel') }}</div>
                <div class="card-desc">{{ t('alerts.alertTypeCards.realtimeDesc') }}</div>
              </div>
              <q-icon
                v-if="formData.is_real_time === 'true'"
                name="check_circle"
                size="1rem"
                class="card-check-icon"
              />
            </div>
          </div>

          <!-- Anomaly Detection -->
          <div
            v-if="isAnomalyDetectionEnabled"
            data-test="add-alert-anomaly-detection-radio"
            class="alert-type-card"
            :class="{
              'card-selected': formData.is_real_time === 'anomaly',
              'card-disabled': beingUpdated
            }"
            @click="!beingUpdated && (formData.is_real_time = 'anomaly')"
          >
            <div class="tw:flex tw:items-start tw:gap-3">
              <div class="card-icon-wrap">
                <q-icon name="auto_graph" size="1.25rem" />
              </div>
              <div class="tw:flex-1">
                <div class="card-title">{{ t('alerts.alertTypeCards.anomalyLabel') }}</div>
                <div class="card-desc">{{ t('alerts.alertTypeCards.anomalyDesc') }}</div>
              </div>
              <q-icon
                v-if="formData.is_real_time === 'anomaly'"
                name="check_circle"
                size="1rem"
                class="card-check-icon"
              />
            </div>
          </div>
        </div>
      </div>

    </q-form>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, type PropType } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import {
  outlinedSearch,
  outlinedBarChart,
  outlinedAccountTree,
} from "@quasar/extras/material-icons-outlined";

export default defineComponent({
  name: "Step1AlertSetup",
  components: {},
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
    streamFieldRef: {
      type: Object as PropType<any>,
      default: null,
    },
    streamTypeFieldRef: {
      type: Object as PropType<any>,
      default: null,
    },
  },
  emits: ["update:streams", "filter:streams", "update:stream-name"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();
    const step1Form = ref(null);

    const isAnomalyDetectionEnabled = computed(
      () => store.state.zoConfig.anomaly_detection_enabled === true,
    );

    const streamTypeIcon = (type: string): string => {
      const icons: Record<string, string> = {
        logs: outlinedSearch,
        metrics: outlinedBarChart,
        traces: outlinedAccountTree,
      };
      return icons[type] ?? "circle";
    };

    const selectStreamType = (type: string) => {
      props.formData.stream_type = type;
      emit("update:streams");
    };

    const updateStreams = () => {
      emit("update:streams");
    };

    const filterStreams = (val: string, update: any) => {
      emit("filter:streams", val, update);
    };

    const handleStreamNameChange = (streamName: string) => {
      emit("update:stream-name", streamName);
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
      isAnomalyDetectionEnabled,
      streamTypeIcon,
      selectStreamType,
      updateStreams,
      filterStreams,
      handleStreamNameChange,
      validate,
    };
  },
});
</script>

<style scoped lang="scss">
.step-alert-setup {
  width: 100%;

  .setup-section {
    .section-label {
      font-size: 0.875rem;
      font-weight: 700;
      letter-spacing: 0.01em;
      color: var(--o2-text-primary);
    }

    .section-hint {
      font-size: 0.8125rem;
      color: var(--o2-text-secondary);
      line-height: 1.4;
    }
  }

  // Alert type selection cards
  .alert-type-cards {
    .alert-type-card {
      border: 1.5px solid var(--o2-border);
      border-radius: 0.5rem;
      padding: 0.875rem 1rem;
      cursor: pointer;
      transition: border-color 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease;
      position: relative;

      &:hover:not(.card-disabled) {
        border-color: var(--o2-primary-btn-bg);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--o2-primary-btn-bg) 15%, transparent);
      }

      &.card-selected {
        border-color: var(--o2-primary-btn-bg);
        border-width: 2px;
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--o2-primary-btn-bg) 20%, transparent);
      }

      &.card-disabled {
        cursor: not-allowed;
        opacity: 0.6;
      }

      .card-icon-wrap {
        width: 2rem;
        height: 2rem;
        border-radius: 0.375rem;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        background-color: var(--o2-primary-background);
        color: var(--o2-primary-color);
      }

      .card-title {
        font-size: 0.875rem;
        font-weight: 600;
        margin-bottom: 0.25rem;
        color: var(--o2-text-primary);
      }

      .card-desc {
        font-size: 0.75rem;
        line-height: 1.45;
        color: var(--o2-text-secondary);
      }

      .card-check-icon {
        color: var(--o2-primary-btn-bg);
        flex-shrink: 0;
        margin-top: 0.125rem;
      }
    }
  }

  // Stream type segmented switch
  .stream-type-label {
    color: var(--o2-text-secondary);
    letter-spacing: 0.01em;
  }

  .stream-type-switch {
    display: inline-flex;
    border: 1.5px solid var(--o2-border);
    border-radius: 0.5rem;
    overflow: hidden;
    background: transparent;

    &.switch-disabled {
      opacity: 0.55;
      pointer-events: none;
    }

    .stream-type-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0.375rem 1.1rem;
      font-size: 0.8125rem;
      font-weight: 500;
      text-transform: capitalize;
      background: transparent;
      border: none;
      border-right: 1.5px solid var(--o2-border);
      cursor: pointer;
      color: var(--o2-text-secondary);
      transition: background-color 0.12s ease, color 0.12s ease;
      outline: none;
      white-space: nowrap;

      &:last-child {
        border-right: none;
      }

      &:hover:not(:disabled) {
        background: color-mix(in srgb, var(--o2-primary-btn-bg) 10%, white 6%);
        color: var(--o2-primary-color);
      }

      &.btn-active {
        background: var(--o2-primary-btn-bg);
        color: var(--o2-primary-btn-text);
        font-weight: 600;

        .q-icon {
          color: var(--o2-primary-btn-text);
        }
      }

      &:disabled {
        cursor: not-allowed;
      }
    }
  }

  .form-field {
    width: 100%;
  }

  .stream-field-pipe {
    font-size: 1.25rem;
    color: var(--o2-border);
    line-height: 2rem;
    padding-top: 1.375rem;
    user-select: none;
  }

  // Match stream name select border to stream type toggle border width/style
  .stream-name-select {
    :deep(.q-field__control) {
      border: 1.5px solid var(--o2-border) !important;
      border-radius: 0.5rem !important;
    }

    :deep(.q-field--focused .q-field__control) {
      border-color: var(--o2-primary-color) !important;
    }
  }
}
</style>
