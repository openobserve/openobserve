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
  <div class="flex-[0_0_calc(32%-0.625rem)] flex flex-col gap-2 overflow-y-auto overflow-x-clip h-[calc(100vh-18.875rem)] sticky top-0">
    <!-- Preview Section -->
    <div
      class="collapsible-section preview-section flex flex-col transition-all duration-300 bg-card-glass-bg rounded-md shadow-[0_0_5px_1px_var(--color-hover-shadow)] border border-card-glass-border"
      :class="previewSectionClass"
    >
      <div
        class="flex items-center justify-between px-4 py-3 cursor-pointer shrink-0 border-b border-card-glass-border transition-all duration-200 rounded-t-md select-none hover:bg-black/4 active:bg-black/[0.06]"
        @click="togglePreview"
      >
        <div class="flex items-center gap-2">
          <span class="text-sm font-semibold">{{ t('alerts.preview') }}</span>
          <!-- Status Indicator -->
          <div
            v-if="evaluationStatus && !isRealTime"
            class="alert-status-indicator group flex items-center gap-1.5 px-2 py-1 rounded-sm border-l-[0.1875rem] border-l-solid bg-status-success-bg border-l-status-positive"
            :class="{
              'bg-surface-subtle border-l-border-strong': !evaluationStatus.wouldTrigger,
            }"
            data-test="alert-status-indicator"
          >
            <OIcon
              :name="evaluationStatus.wouldTrigger ? 'check-circle' : 'cancel'" size="sm"
              class="text-xs flex-shrink-0"
              :class="evaluationStatus.wouldTrigger ? 'text-status-positive' : 'text-text-muted'"
            />
            <span class="text-xs font-semibold tracking-wide uppercase flex-shrink-0 whitespace-nowrap">
              {{ evaluationStatus.wouldTrigger ? t('alerts.wouldTrigger') : t('alerts.wouldNotTrigger') }}
            </span>
            <span class="text-xs flex-shrink-0 text-[rgba(0,0,0,0.3)] dark:text-[rgba(255,255,255,0.3)]">•</span>
            <span class="text-xs text-[rgba(0,0,0,0.6)] dark:text-[rgba(255,255,255,0.65)]">
              {{ evaluationStatus.reason }}
            </span>
          </div>
        </div>
        <OButton
          variant="ghost"
          size="icon-circle-sm"
          @click.stop="togglePreview"
          class="expand-toggle-btn opacity-50 transition-all duration-200 hover:opacity-100"
        >
          <OIcon :name="expandState.preview ? 'expand-less' : 'expand-more'" size="sm" />
        </OButton>
      </div>
      <div v-show="expandState.preview" class="section-content flex-1 flex flex-col">
        <keep-alive>
          <preview-alert class="h-full"
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
      class="collapsible-section flex flex-col transition-all duration-300 bg-card-glass-bg rounded-md shadow-[0_0_5px_1px_var(--color-hover-shadow)] border border-card-glass-border"
      :class="summarySectionClass"
    >
      <div
        class="flex items-center justify-between px-4 py-3 cursor-pointer shrink-0 border-b border-card-glass-border transition-all duration-200 rounded-t-md select-none hover:bg-black/4 active:bg-black/[0.06]"
        @click="toggleSummary"
      >
        <span class="text-sm font-semibold">{{ t('alerts.summary.title') }}</span>
        <OButton
          variant="ghost"
          size="icon-circle-sm"
          @click.stop="toggleSummary"
          class="expand-toggle-btn opacity-50 transition-all duration-200 hover:opacity-100"
        >
          <OIcon :name="expandState.summary ? 'expand-less' : 'expand-more'" size="sm" />
        </OButton>
      </div>
      <div v-show="expandState.summary" class="summary-section-content flex-1 overflow-hidden flex flex-col">
        <alert-summary class="h-full overflow-auto"
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
    // Collapsed: header only (flex-none === `flex: 0 0 auto`).
    // Expanded: share the space, whether or not the other section is open.
    const previewSectionClass = computed(() =>
      expandState.preview ? "flex-1 min-h-62.5" : "flex-none",
    );

    const summarySectionClass = computed(() =>
      expandState.summary ? "flex-1 min-h-62.5" : "flex-none",
    );


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
      previewSectionClass,
      summarySectionClass,
      evaluationStatus,
      isRealTime,
    };
  },
});
</script>
