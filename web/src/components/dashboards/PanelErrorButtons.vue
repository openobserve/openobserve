<template>
  <div
    v-if="error || maxQueryRangeWarning || limitNumberOfSeriesWarningMessage || isCachedDataDifferWithCurrentTimeRange || (isPartialData && !isPanelLoading) || (lastTriggeredAt && !viewOnly && !simplifiedPanelView)"
    class="row items-center no-wrap"
  >
    <OButton
  variant="ghost"
  size="sm"
  v-if="error"
  :key="error"
  data-test="panel-error-data"
  class="warning">
  <template #icon-left><TriangleAlert class="tw:w-4 tw:h-4" /></template>
  <q-tooltip anchor="bottom right" self="top right" max-width="220px">
        <div style="white-space: pre-wrap">
          {{ error }}
        </div>
      </q-tooltip>
</OButton>
    <OButton
  variant="ghost"
  size="sm"
  v-if="maxQueryRangeWarning"
  data-test="panel-max-duration-warning"
  class="warning">
  <template #icon-left><TriangleAlert class="tw:w-4 tw:h-4" /></template>
  <q-tooltip anchor="bottom right" self="top right" max-width="220px">
        <div style="white-space: pre-wrap">
          {{ maxQueryRangeWarning }}
        </div>
      </q-tooltip>
</OButton>
    <OButton
  variant="ghost"
  size="sm"
  v-if="limitNumberOfSeriesWarningMessage"
  data-test="panel-limit-number-of-series-warning"
  class="warning">
  <template #icon-left><DatabaseZap class="tw:w-4 tw:h-4" /></template>
  <q-tooltip anchor="bottom right" self="top right">
        <div style="white-space: pre-wrap">
          {{ limitNumberOfSeriesWarningMessage }}
        </div>
      </q-tooltip>
</OButton>
    <OButton
  variant="ghost"
  size="sm"
  v-if="isCachedDataDifferWithCurrentTimeRange"
  data-test="panel-is-cached-data-differ-with-current-time-range-warning">
  <template #icon-left><AlertTriangle class="tw:w-4 tw:h-4" /></template>
  <q-tooltip anchor="bottom right" self="top right">
        <div style="white-space: pre-wrap">
          The data shown is cached and is different from the selected time
          range.
        </div>
      </q-tooltip>
</OButton>
    <OButton
  variant="ghost"
  size="sm"
  v-if="isPartialData && !isPanelLoading"
  data-test="panel-partial-data-warning"
  class="warning">
  <template #icon-left><Loader2 class="tw:w-4 tw:h-4" /></template>
  <q-tooltip anchor="bottom right" self="top right">
        <div style="white-space: pre-wrap">
          The data shown is incomplete because the loading was interrupted.
          Refresh to load complete data.
        </div>
      </q-tooltip>
</OButton>

    <!-- Universal Last Refreshed Clock Icon and Time -->
    <span v-if="lastTriggeredAt && !viewOnly && !simplifiedPanelView" class="lastRefreshedAt">
      <span class="lastRefreshedAtIcon">
        🕑
        <q-tooltip anchor="bottom right" self="top right">
          Last Refreshed: <RelativeTime :timestamp="lastTriggeredAt" />
        </q-tooltip>
      </span>
      <RelativeTime
        :timestamp="lastTriggeredAt"
        fullTimePrefix="Last Refreshed At: "
      />
    </span>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import RelativeTime from "@/components/common/RelativeTime.vue";
import {
  outlinedWarning,
  outlinedRunningWithErrors,
} from "@quasar/extras/material-icons-outlined";
import {
  symOutlinedClockLoader20,
  symOutlinedDataInfoAlert,
} from "@quasar/extras/material-symbols-outlined";

import OButton from "@/lib/core/Button/Button.vue";
import { AlertTriangle, DatabaseZap, Loader2, TriangleAlert } from "lucide-vue-next";
export default defineComponent({

name: "PanelErrorButtons",
  components: { RelativeTime,
    OButton,
    TriangleAlert,
    DatabaseZap,
    AlertTriangle,
    Loader2,
},
  props: {
    error: {
      type: String,
      default: "",
    },
    maxQueryRangeWarning: {
      type: String,
      default: "",
    },
    limitNumberOfSeriesWarningMessage: {
      type: String,
      default: "",
    },
    isCachedDataDifferWithCurrentTimeRange: {
      type: Boolean,
      default: false,
    },
    isPartialData: {
      type: Boolean,
      default: false,
    },
    isPanelLoading: {
      type: Boolean,
      default: false,
    },
    lastTriggeredAt: {
      type: [String, Number, Date, null],
      default: null,
    },
    viewOnly: {
      type: Boolean,
      default: false,
    },
    simplifiedPanelView: {
      type: Boolean,
      default: false,
    },
  },
  setup() {
    return {
      outlinedWarning,
      outlinedRunningWithErrors,
      symOutlinedClockLoader20,
      symOutlinedDataInfoAlert,
    };
  },
});
</script>

<style scoped>
.warning {
  color: var(--q-warning);
}
.lastRefreshedAt {
  font-size: smaller;
  margin-left: 5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  &::after {
    content: "";
  }

  &::before {
    content: "";
  }

  & .lastRefreshedAtIcon {
    font-size: smaller;
    margin-right: 2px;
  }
}
</style>
