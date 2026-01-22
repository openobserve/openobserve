<template>
  <div class="row items-center no-wrap">
    <q-btn
      v-if="error"
      :key="error"
      :icon="outlinedWarning"
      flat
      size="xs"
      padding="2px"
      data-test="panel-error-data"
      class="warning"
    >
      <q-tooltip anchor="bottom right" self="top right" max-width="220px">
        <div style="white-space: pre-wrap">
          {{ error }}
        </div>
      </q-tooltip>
    </q-btn>
    <q-btn
      v-if="maxQueryRangeWarning"
      :icon="outlinedWarning"
      flat
      size="xs"
      padding="2px"
      data-test="panel-max-duration-warning"
      class="warning"
    >
      <q-tooltip anchor="bottom right" self="top right" max-width="220px">
        <div style="white-space: pre-wrap">
          {{ maxQueryRangeWarning }}
        </div>
      </q-tooltip>
    </q-btn>
    <q-btn
      v-if="limitNumberOfSeriesWarningMessage"
      :icon="symOutlinedDataInfoAlert"
      flat
      size="xs"
      padding="2px"
      data-test="panel-limit-number-of-series-warning"
      class="warning"
    >
      <q-tooltip anchor="bottom right" self="top right">
        <div style="white-space: pre-wrap">
          {{ limitNumberOfSeriesWarningMessage }}
        </div>
      </q-tooltip>
    </q-btn>
    <q-btn
      v-if="isCachedDataDifferWithCurrentTimeRange"
      :icon="outlinedRunningWithErrors"
      flat
      size="xs"
      padding="2px"
      data-test="panel-is-cached-data-differ-with-current-time-range-warning"
    >
      <q-tooltip anchor="bottom right" self="top right">
        <div style="white-space: pre-wrap">
          The data shown is cached and is different from the selected time
          range.
        </div>
      </q-tooltip>
    </q-btn>
    <q-btn
      v-if="isPartialData && !isPanelLoading"
      :icon="symOutlinedClockLoader20"
      flat
      size="xs"
      padding="2px"
      data-test="panel-partial-data-warning"
      class="warning"
    >
      <q-tooltip anchor="bottom right" self="top right">
        <div style="white-space: pre-wrap">
          The data shown is incomplete because the loading was interrupted.
          Refresh to load complete data.
        </div>
      </q-tooltip>
    </q-btn>

    <!-- Universal Last Refreshed Clock Icon and Time -->
    <span v-if="lastTriggeredAt && !viewOnly" class="lastRefreshedAt">
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
export default defineComponent({
  name: "PanelErrorButtons",
  components: { RelativeTime },
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
  display: flex;
  align-items: center;
  margin-left: 8px;
  font-size: 13px;
}
.lastRefreshedAtIcon {
  margin-right: 4px;
  display: flex;
  align-items: center;
}
</style>
