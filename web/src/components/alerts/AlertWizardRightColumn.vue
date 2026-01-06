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
  <!-- Right Column: Preview & Summary (calc to account for gap) -->
  <div class="tw:flex-[0_0_calc(32%-0.625rem)] tw:flex tw:flex-col tw:gap-2" style="height: calc(100vh - 302px); position: sticky; top: 0;">
    <!-- Preview Section -->
    <div
      class="collapsible-section card-container"
      :style="previewSectionStyle"
    >
      <div
        class="section-header tw:flex tw:items-center tw:justify-between tw:px-4 tw:py-3 tw:cursor-pointer"
        @click="togglePreview"
      >
        <span class="tw:text-sm tw:font-semibold">{{ t('alerts.preview') }}</span>
        <q-btn
          flat
          dense
          round
          size="xs"
          :icon="expandState.preview ? 'expand_less' : 'expand_more'"
          @click.stop
          class="expand-toggle-btn"
        />
      </div>
      <div v-show="expandState.preview" class="section-content">
        <preview-alert
          style="height: 100%; overflow: auto;"
          ref="previewAlertRef"
          :formData="formData"
          :query="previewQuery"
          :selectedTab="selectedTab"
          :isAggregationEnabled="isAggregationEnabled"
          :isUsingBackendSql="isUsingBackendSql"
        />
      </div>
    </div>

    <!-- Summary Section -->
    <div
      class="collapsible-section card-container"
      :style="summarySectionStyle"
    >
      <div
        class="section-header tw:flex tw:items-center tw:justify-between tw:px-4 tw:py-3 tw:cursor-pointer"
        @click="toggleSummary"
      >
        <span class="tw:text-sm tw:font-semibold">{{ t('alerts.summary.title') }}</span>
        <q-btn
          flat
          dense
          round
          size="xs"
          :icon="expandState.summary ? 'expand_less' : 'expand_more'"
          @click.stop
          class="expand-toggle-btn"
        />
      </div>
      <div v-show="expandState.summary" class="section-content">
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
import { defineComponent, ref, computed, reactive, watch, type PropType } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import PreviewAlert from "./PreviewAlert.vue";
import AlertSummary from "./AlertSummary.vue";

export default defineComponent({
  name: "AlertWizardRightColumn",
  components: {
    PreviewAlert,
    AlertSummary,
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
  },
  setup(props, { expose }) {
    const store = useStore();
    const { t } = useI18n();
    const previewAlertRef = ref(null);

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
        return { flex: "1", minHeight: "0" };
      } else {
        // Preview expanded, summary collapsed: take all space
        return { flex: "1", minHeight: "0" };
      }
    });

    const summarySectionStyle = computed(() => {
      if (!expandState.summary) {
        // Summary collapsed: only show header
        return { flex: "0 0 auto" };
      } else if (expandState.preview) {
        // Both expanded: 50% each
        return { flex: "1", minHeight: "0" };
      } else {
        // Summary expanded, preview collapsed: take all space
        return { flex: "1", minHeight: "0" };
      }
    });


    // Expose refreshData method from PreviewAlert
    const refreshData = () => {
      if (previewAlertRef.value) {
        (previewAlertRef.value as any).refreshData();
      }
    };

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
    };
  },
});
</script>

<style scoped lang="scss">
.collapsible-section {
  display: flex;
  flex-direction: column;
  transition: all 0.3s ease;
  // Ensure card-container styles are applied
  background-color: var(--o2-card-bg);
  border-radius: 0.375rem;
  box-shadow: 0 0 5px 1px var(--o2-hover-shadow);
  border: 1px solid var(--o2-border-color, rgba(0, 0, 0, 0.08));
  overflow: hidden;

  .section-header {
    flex-shrink: 0;
    border-bottom: 1px solid rgba(0, 0, 0, 0.08);
    transition: all 0.2s ease;
    border-radius: 0.375rem 0.375rem 0 0;
    user-select: none;

    &:hover {
      background: rgba(0, 0, 0, 0.04);
    }

    &:active {
      background: rgba(0, 0, 0, 0.06);
    }
  }

  .section-content {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .expand-toggle-btn {
    opacity: 0.5;
    transition: all 0.2s ease;

    &:hover {
      opacity: 1;
    }
  }
}
</style>
