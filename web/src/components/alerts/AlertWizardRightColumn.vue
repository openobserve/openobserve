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
  <!-- Right Column: Preview & Summary (calc to account for gap) -->
  <div class="tw:flex-[0_0_calc(32%-0.625rem)] tw:flex tw:flex-col tw:gap-2 tw:overflow-y-auto tw:overflow-x-clip" style="height: calc(100vh - 302px); position: sticky; top: 0;">
    <!-- Preview Section -->
    <div
      class="collapsible-section card-container preview-section tw:flex tw:flex-col tw:transition-all tw:duration-300 tw:bg-(--o2-card-bg) tw:rounded-md tw:shadow-[0_0_5px_1px_var(--o2-hover-shadow)] tw:border tw:border-(--o2-border-color)"
      :style="previewSectionStyle"
    >
      <div
        class="section-header tw:flex tw:items-center tw:justify-between tw:px-4 tw:py-3 tw:cursor-pointer tw:shrink-0 tw:border-b tw:border-[var(--o2-border-color,rgba(0,0,0,0.08))] tw:transition-all tw:duration-200 tw:rounded-t-md tw:select-none"
        @click="togglePreview"
      >
        <div class="tw:flex tw:items-center tw:gap-2">
          <span class="tw:text-sm tw:font-semibold">{{ t('alerts.preview') }}</span>
          <!-- Status Indicator -->
          <div
            v-if="evaluationStatus && !isRealTime"
            class="alert-status-indicator tw:flex tw:items-center tw:gap-1.5 tw:px-2 tw:py-1 tw:rounded tw:border-l-[0.1875rem] tw:border-l-solid tw:bg-[rgba(76,175,80,0.08)] tw:border-l-[#4caf50]"
            :class="{
              'status-would-trigger': evaluationStatus.wouldTrigger,
              'status-would-not-trigger': !evaluationStatus.wouldTrigger,
              'status-indicator-light': store.state.theme !== 'dark'
            }"
            data-test="alert-status-indicator"
          >
            <OIcon
              :name="evaluationStatus.wouldTrigger ? 'check-circle' : 'cancel'" size="sm"
              class="tw:text-xs tw:flex-shrink-0"
              :class="evaluationStatus.wouldTrigger ? 'tw:text-green-500' : 'tw:text-gray-400'"
            />
            <span class="tw:text-xs tw:font-semibold tw:tracking-wide tw:uppercase tw:flex-shrink-0 tw:whitespace-nowrap">
              {{ evaluationStatus.wouldTrigger ? t('alerts.wouldTrigger') : t('alerts.wouldNotTrigger') }}
            </span>
            <span class="status-separator tw:text-xs tw:flex-shrink-0">•</span>
            <span class="tw:text-xs">
              {{ evaluationStatus.reason }}
            </span>
          </div>
        </div>
        <OButton
          variant="ghost"
          size="icon-circle-sm"
          @click.stop="togglePreview"
          class="expand-toggle-btn tw:opacity-50 tw:transition-all tw:duration-200"
        >
          <OIcon :name="expandState.preview ? 'expand-less' : 'expand-more'" size="sm" />
        </OButton>
      </div>
      <div v-show="expandState.preview" class="section-content tw:flex-1 tw:flex tw:flex-col">
        <keep-alive>
          <preview-alert
            style="height: 100%;"
            ref="previewAlertRef"
            :formData="formData"
            :query="previewQuery"
            :selectedTab="selectedTab"
            :isAggregationEnabled="isAggregationEnabled"
            :isUsingBackendSql="isUsingBackendSql"
            :isEditorOpen="isEditorOpen"
          />
        </keep-alive>
      </div>
    </div>

    <!-- Summary Section -->
    <div
      class="collapsible-section card-container tw:flex tw:flex-col tw:transition-all tw:duration-300 tw:bg-(--o2-card-bg) tw:rounded-md tw:shadow-[0_0_5px_1px_var(--o2-hover-shadow)] tw:border tw:border-(--o2-border-color)"
      :style="summarySectionStyle"
    >
      <div
        class="section-header tw:flex tw:items-center tw:justify-between tw:px-4 tw:py-3 tw:cursor-pointer tw:shrink-0 tw:border-b tw:border-[var(--o2-border-color,rgba(0,0,0,0.08))] tw:transition-all tw:duration-200 tw:rounded-t-md tw:select-none"
        @click="toggleSummary"
      >
        <span class="tw:text-sm tw:font-semibold">{{ t('alerts.summary.title') }}</span>
        <OButton
          variant="ghost"
          size="icon-circle-sm"
          @click.stop="toggleSummary"
          class="expand-toggle-btn tw:opacity-50 tw:transition-all tw:duration-200"
        >
          <OIcon :name="expandState.summary ? 'expand-less' : 'expand-more'" size="sm" />
        </OButton>
      </div>
      <div v-show="expandState.summary" class="summary-section-content tw:flex-1 tw:overflow-hidden tw:flex tw:flex-col">
        <alert-summary
          style="height: 100%; overflow: auto;"
          :formData="formData"
          :destinations="destinations"
          :focusManager="focusManager"
          :wizardStep="wizardStep"
          :previewQuery="previewQuery"
          :generatedSqlQuery="generatedSqlQuery"
        />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, reactive, watch, onMounted, onUnmounted, type PropType } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import PreviewAlert from "./PreviewAlert.vue";
import AlertSummary from "./AlertSummary.vue";
import OButton from "@/lib/core/Button/OButton.vue";

import OIcon from "@/lib/core/Icon/OIcon.vue";
export default defineComponent({
  name: "AlertWizardRightColumn",
  components: {
    PreviewAlert,
    AlertSummary,
    OButton,
    OIcon,
},
  props: {
    formData: {
      type: Object as PropType<any>,
      required: true,
    },
    previewQuery: {
      type: String,
      default: "",
    },
    generatedSqlQuery: {
      type: String,
      default: "",
    },
    selectedTab: {
      type: String,
      default: "custom",
    },
    isAggregationEnabled: {
      type: Boolean,
      default: false,
    },
    destinations: {
      type: Array as PropType<any[]>,
      default: () => [],
    },
    focusManager: {
      type: Object as PropType<any>,
      default: undefined,
    },
    wizardStep: {
      type: Number,
      required: false,
      default: 1,
    },
    isUsingBackendSql: {
      type: Boolean,
      default: false,
    },
    isEditorOpen: {
      type: Boolean,
      default: false,
    },
  },
  setup(props, { expose }) {
    const store = useStore();
    const { t } = useI18n();
    const previewAlertRef = ref(null);

    // Reactive ref for evaluation status
    const evaluationStatus = ref(null);

    // Watch the child component's evaluation status
    watch(
      () => previewAlertRef.value?.evaluationStatus,
      (newStatus) => {
        evaluationStatus.value = newStatus;
      },
      { deep: true, immediate: true }
    );

    // Computed property to check if this is a real-time alert
    const isRealTime = computed(() => {
      return props.formData.is_real_time === "true" || props.formData.is_real_time === true;
    });

    // Load saved state from localStorage or use defaults
    const loadExpandState = () => {
      try {
        const saved = localStorage.getItem('alertWizardExpandState');
        if (saved) {
          return JSON.parse(saved);
        }
      } catch (e) {
        console.error('Failed to load expand state:', e);
      }
      return { preview: true, summary: true };
    };

    // Expand/collapse state for both sections
    const expandState = reactive(loadExpandState());

    // Save state to localStorage
    const saveExpandState = () => {
      try {
        localStorage.setItem('alertWizardExpandState', JSON.stringify({
          preview: expandState.preview,
          summary: expandState.summary,
        }));
      } catch (e) {
        console.error('Failed to save expand state:', e);
      }
    };

    // Toggle functions - simple toggle for each section
    const togglePreview = () => {
      expandState.preview = !expandState.preview;
      saveExpandState();
    };

    const toggleSummary = () => {
      expandState.summary = !expandState.summary;
      saveExpandState();
    };

    // Calculate section heights based on expand state
    const previewSectionStyle = computed(() => {
      if (!expandState.preview) {
        // Preview collapsed: only show header
        return { flex: "0 0 auto" };
      } else if (expandState.summary) {
        // Both expanded: 50% each
        return { flex: "1", minHeight: "250px" };
      } else {
        // Preview expanded, summary collapsed: take all space
        return { flex: "1", minHeight: "250px" };
      }
    });

    const summarySectionStyle = computed(() => {
      if (!expandState.summary) {
        // Summary collapsed: only show header
        return { flex: "0 0 auto" };
      } else if (expandState.preview) {
        // Both expanded: 50% each
        return { flex: "1", minHeight: "250px" };
      } else {
        // Summary expanded, preview collapsed: take all space
        return { flex: "1", minHeight: "250px" };
      }
    });


    // Expose refreshData method from PreviewAlert
    const refreshData = () => {
      if (previewAlertRef.value) {
        (previewAlertRef.value as any).refreshData();
      }
    };

    // Note: ResizeObserver in PanelSchemaRenderer should automatically detect size changes
    // and resize the chart without any intervention. We're keeping this watcher commented
    // to verify if manual intervention is needed.

    // watch(
    //   () => [expandState.preview, expandState.summary],
    //   async () => {
    //     // Wait for CSS transition to complete
    //     await new Promise(resolve => setTimeout(resolve, 350));
    //     if (previewAlertRef.value && expandState.preview) {
    //       (previewAlertRef.value as any).resizeChart();
    //     }
    //   }
    // );

    // Handle window resize to rerender chart (without refetching data)
    let resizeTimeout: NodeJS.Timeout;
    const handleResize = () => {
      // Debounce resize events to avoid excessive rerenders
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (previewAlertRef.value && expandState.preview) {
          (previewAlertRef.value as any).resizeChart();
        }
      }, 300);
    };

    // Setup resize listener on mount
    onMounted(() => {
      window.addEventListener('resize', handleResize);
    });

    // Cleanup resize listener on unmount
    onUnmounted(() => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(resizeTimeout);
    });

    // Expose the method to parent component
    expose({
      refreshData,
    });

    return {
      t,
      store,
      previewAlertRef,
      expandState,
      togglePreview,
      toggleSummary,
      previewSectionStyle,
      summarySectionStyle,
      evaluationStatus,
      isRealTime,
    };
  },
});
</script>

<style>
.collapsible-section .section-header:hover {
  background: rgba(0, 0, 0, 0.04);
}

.collapsible-section .section-header:active {
  background: rgba(0, 0, 0, 0.06);
}

.collapsible-section .expand-toggle-btn:hover {
  opacity: 1;
}

/* Status Indicator Styles */
.alert-status-indicator.status-would-not-trigger {
  background: rgba(158, 158, 158, 0.08);
  border-left-color: #9e9e9e;
}

.alert-status-indicator.status-indicator-light {
  background: rgba(76, 175, 80, 0.04);
}

.alert-status-indicator.status-would-not-trigger.status-indicator-light {
  background: rgba(158, 158, 158, 0.04);
}

.alert-status-indicator .status-separator {
  color: rgba(255, 255, 255, 0.3);
}

.alert-status-indicator.status-indicator-light .status-separator {
  color: rgba(0, 0, 0, 0.3);
}

.alert-status-indicator span:last-child {
  color: rgba(255, 255, 255, 0.65);
}

.alert-status-indicator.status-indicator-light span:last-child {
  color: rgba(0, 0, 0, 0.6);
}
</style>
