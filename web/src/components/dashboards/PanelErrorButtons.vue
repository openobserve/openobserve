<template>
  <div
    v-if="
      notices.length ||
      error ||
      exemplarError ||
      maxQueryRangeWarning ||
      sparklineWarning ||
      xAliasInconsistencyWarning ||
      isCachedDataDifferWithCurrentTimeRange ||
      (lastTriggeredAt && !viewOnly && !simplifiedPanelView)
    "
    class="flex flex-nowrap items-center"
  >
    <div
      v-if="notices.length"
      class="my-px flex shrink-0 flex-nowrap items-center gap-1 pe-1"
      data-test="panel-notice-chips"
    >
      <span
        v-for="notice in notices"
        :key="notice.id"
        :class="collapseClasses.chip"
        :data-test="legacyTestIds[notice.id]"
      >
        <OTooltip
          side="bottom"
          align="end"
          max-width="22rem"
          :delay="300"
          hoverable
          :open="openTooltip === notice.id"
          @update:open="(open: boolean) => setTooltipOpen(notice.id, open)"
        >
          <OTag
            :variant="notice.tone === 'error' ? 'error-soft' : 'warning-soft'"
            size="sm"
            clickable
            :icon="notice.icon"
            class="shrink-0"
            :data-test="`panel-notice-chip-${notice.id}`"
            @click="onChipClick"
          >
            {{ notice.chipLabel }}
          </OTag>
          <template #content>
            <PanelNoticeContent
              :notice="notice"
              :show-inspect="canInspect"
              @action="onNoticeAction"
              @open-inspector="onOpenInspector"
              @copied="closeTooltip"
            />
          </template>
        </OTooltip>
      </span>
      <span :class="collapseClasses.collapsed">
        <OTooltip
          side="bottom"
          align="end"
          max-width="22rem"
          :delay="300"
          hoverable
          :open="openTooltip === 'collapsed'"
          @update:open="(open: boolean) => setTooltipOpen('collapsed', open)"
        >
          <OTag
            :variant="collapsedTone === 'error' ? 'error-soft' : 'warning-soft'"
            size="sm"
            clickable
            :icon="collapsedTone === 'error' ? 'error-outline' : 'warning'"
            class="shrink-0"
            :aria-label="collapsedLabel"
            data-test="panel-notice-chip-collapsed"
            @click="onChipClick"
          >
            <span
              class="@max-[22rem]/panelbar:hidden"
              data-test="panel-notice-chip-collapsed-label"
            >
              {{ collapsedLabel }}
            </span>
            <span
              class="hidden @max-[22rem]/panelbar:inline"
              data-test="panel-notice-chip-collapsed-count"
            >
              {{ notices.length }}
            </span>
          </OTag>
          <template #content>
            <div class="flex flex-col gap-2" data-test="panel-notice-collapsed-content">
              <div class="text-text-heading font-semibold">
                {{
                  t(
                    "dashboard.panelErrorButtons.collapsedTitle",
                    { count: notices.length },
                    notices.length,
                  )
                }}
              </div>
              <PanelNoticeContent
                v-for="notice in notices"
                :key="notice.id"
                :notice="notice"
                @action="onNoticeAction"
                @copied="closeTooltip"
              />
              <div v-if="canInspect">
                <OButton
                  variant="ghost-primary"
                  size="xs"
                  data-test="panel-notice-action-open-inspector"
                  @click="onOpenInspector"
                >
                  {{ t("dashboard.panelErrorButtons.openInspector") }}
                </OButton>
              </div>
            </div>
          </template>
        </OTooltip>
      </span>
    </div>
    <OButton
      :aria-label="t('dashboard.panelError', { message: raw(error) })"
      v-if="error"
      :key="error"
      variant="ghost-warning"
      size="icon"
      icon-left="warning"
      data-test="panel-error-data"
    >
      <OTooltip side="bottom" align="end" max-width="26.25rem" hoverable>
        <template #content
          ><div class="whitespace-pre-wrap">{{ error }}</div></template
        >
      </OTooltip>
    </OButton>
    <OButton
      v-if="exemplarError"
      variant="ghost-warning"
      size="icon"
      icon-left="warning"
      :aria-label="t('dashboard.exemplars.loadFailed')"
      data-test="dashboard-panel-exemplars-error"
    >
      <OTooltip side="bottom" align="end" max-width="26.25rem" hoverable>
        <template #content>
          <div class="flex flex-col gap-1.5">
            <div class="font-medium">{{ t("dashboard.exemplars.loadFailed") }}</div>
            <div class="whitespace-pre-wrap" data-test="dashboard-panel-exemplars-error-message">
              {{ exemplarError }}
            </div>
            <div class="text-2xs">{{ t("dashboard.exemplars.loadFailedHint") }}</div>
            <div>
              <OButton
                variant="outline"
                size="xs"
                icon-left="replay"
                data-test="dashboard-panel-exemplars-retry"
                @click="$emit('retry-exemplars')"
              >
                {{ t("dashboard.exemplars.retry") }}
              </OButton>
            </div>
          </div>
        </template>
      </OTooltip>
    </OButton>
    <OButton
      :aria-label="t('dashboard.panelWarning')"
      v-if="maxQueryRangeWarning"
      variant="ghost-warning"
      size="icon"
      icon-left="warning"
      data-test="panel-max-duration-warning"
    >
      <OTooltip side="bottom" align="end" max-width="26.25rem" hoverable>
        <template #content
          ><div class="whitespace-pre-wrap" data-test="panel-max-duration-warning-content">
            {{ maxQueryRangeWarning }}
          </div></template
        >
      </OTooltip>
    </OButton>
    <OButton
      :aria-label="t('dashboard.panelWarning')"
      v-if="sparklineWarning"
      variant="ghost-warning"
      size="icon"
      data-test="panel-sparkline-warning"
    >
      <template #icon-left><OIcon name="show-chart" size="sm" /></template>
      <OTooltip side="bottom" align="end" max-width="26.25rem" hoverable>
        <template #content
          ><div class="whitespace-pre-wrap" data-test="panel-sparkline-warning-content">
            {{ sparklineWarning }}
          </div></template
        >
      </OTooltip>
    </OButton>
    <OButton
      :aria-label="t('dashboard.panelWarning')"
      v-if="xAliasInconsistencyWarning"
      variant="ghost-warning"
      size="icon"
      icon-left="warning"
      data-test="panel-x-alias-inconsistency-warning"
    >
      <OTooltip side="bottom" align="end" max-width="26.25rem" hoverable>
        <template #content>
          <div class="whitespace-pre-wrap">{{ t("dashboard.xAliasInconsistencyWarning") }}</div>
        </template>
      </OTooltip>
    </OButton>
    <OButton
      v-if="isCachedDataDifferWithCurrentTimeRange"
      variant="ghost-warning"
      size="icon"
      data-test="panel-is-cached-data-differ-with-current-time-range-warning"
    >
      <template #icon-left><OIcon name="running-with-errors" size="sm" /></template>
      <OTooltip
        side="bottom"
        align="end"
        hoverable
        :content="t('dashboard.panelErrorButtons.cachedDataDiffers')"
      />
    </OButton>
    <!-- Universal Last Refreshed Clock Icon and Time; a narrow bar drops it before any notice chip. -->
    <span
      v-if="lastTriggeredAt && !viewOnly && !simplifiedPanelView"
      class="lastRefreshedAt ms-1.25 overflow-hidden text-[smaller] text-ellipsis whitespace-nowrap @max-[28rem]/panelbar:hidden"
      data-test="panel-last-refreshed-at"
    >
      <span class="lastRefreshedAtIcon me-0.5 text-[smaller]">
        {{ "🕑" }}
        <OTooltip side="bottom" align="end">
          <template #content
            >{{ t("dashboard.panelErrorButtons.lastRefreshed")
            }}<RelativeTime :timestamp="lastTriggeredAt"
          /></template>
        </OTooltip>
      </span>
      <RelativeTime
        :timestamp="lastTriggeredAt"
        :fullTimePrefix="t('dashboard.panelErrorButtons.lastRefreshedAt')"
      />
    </span>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, ref, type PropType } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import RelativeTime from "@/components/common/RelativeTime.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import PanelNoticeContent from "@/components/dashboards/PanelNoticeContent.vue";
import type { SeriesLimitInfo } from "@/utils/dashboard/panelDiagnostics";
import {
  buildPanelNotices,
  seriesTotalBoundOf,
  type PanelNoticeActionId,
  type PanelNoticeId,
} from "@/utils/dashboard/panelNotices";

// e2e and older specs select the series-cap and interrupted notices by their pre-chip ids.
const legacyTestIds: Partial<Record<PanelNoticeId, string>> = {
  "series-cap": "panel-limit-number-of-series-warning",
  interrupted: "panel-partial-data-warning",
};

// Below these widths the chips fold into one "N issues" chip: the full chips must fit beside the title floor and the hover controls.
const COLLAPSE_CLASSES = {
  single: {
    chip: "inline-flex @max-[32rem]/panelbar:hidden",
    collapsed: "hidden @max-[32rem]/panelbar:inline-flex",
  },
  multiple: {
    chip: "inline-flex @max-[36rem]/panelbar:hidden",
    collapsed: "hidden @max-[36rem]/panelbar:inline-flex",
  },
};

export default defineComponent({
  name: "PanelErrorButtons",
  components: { RelativeTime, OButton, OIcon, OTag, OTooltip, PanelNoticeContent },
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
    seriesLimit: {
      type: Object as PropType<SeriesLimitInfo | null>,
      default: null,
    },
    serverPartial: {
      type: Boolean,
      default: false,
    },
    /** The server stopped at its row limit, so the series total is only a lower bound. */
    rowsCapped: {
      type: Boolean,
      default: false,
    },
    serverPartialReasons: {
      type: Array as PropType<string[]>,
      default: () => [],
    },
    functionErrors: {
      type: Array as PropType<string[]>,
      default: () => [],
    },
    sparklineWarning: {
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
    xAliasInconsistencyWarning: {
      type: Boolean,
      default: false,
    },
    exemplarError: {
      type: String,
      default: "",
    },
    /** The host can open this panel's editor ("Use Top N", "Edit function"). */
    canEdit: {
      type: Boolean,
      default: false,
    },
    /** The host can open this panel's Query Inspector; chips then open it on click. */
    canInspect: {
      type: Boolean,
      default: false,
    },
    /** The host can rerun this panel's queries ("Refresh"). */
    canRefresh: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["retry-exemplars", "open-inspector", "edit-panel", "refresh-panel"],
  setup(props, { emit }) {
    const { t } = useI18nTyped();

    const notices = computed(() =>
      buildPanelNotices(
        {
          seriesLimit: props.seriesLimit,
          seriesLimitMessage: props.limitNumberOfSeriesWarningMessage,
          seriesTotalBound: seriesTotalBoundOf({
            rowsCapped: props.rowsCapped,
            serverPartial: props.serverPartial,
          }),
          serverPartial: props.serverPartial,
          partialReasons: props.serverPartialReasons,
          interrupted: props.isPartialData && !props.isPanelLoading,
          functionErrors: props.functionErrors,
          canEdit: props.canEdit && !props.viewOnly,
          canRefresh: props.canRefresh,
        },
        t,
      ),
    );

    const collapsedTone = computed(() =>
      notices.value.some((notice) => notice.tone === "error") ? "error" : "warning",
    );

    const collapsedLabel = computed(() =>
      t(
        "dashboard.panelErrorButtons.collapsedChip",
        { count: notices.value.length },
        notices.value.length,
      ),
    );

    const collapseClasses = computed(() =>
      notices.value.length > 1 ? COLLAPSE_CLASSES.multiple : COLLAPSE_CLASSES.single,
    );

    // Controlled, so an action can close its tooltip at once instead of leaving it over the dialog it opened.
    const openTooltip = ref<string | null>(null);
    const setTooltipOpen = (id: string, open: boolean) => {
      if (open) openTooltip.value = id;
      else if (openTooltip.value === id) openTooltip.value = null;
    };
    const closeTooltip = () => {
      openTooltip.value = null;
    };

    const onChipClick = () => {
      closeTooltip();
      if (props.canInspect) emit("open-inspector");
    };

    const onOpenInspector = () => {
      closeTooltip();
      emit("open-inspector");
    };

    const onNoticeAction = (id: PanelNoticeActionId) => {
      closeTooltip();
      if (id === "refresh") emit("refresh-panel");
      else emit("edit-panel", id);
    };

    return {
      raw,
      t,
      notices,
      collapsedTone,
      collapsedLabel,
      collapseClasses,
      legacyTestIds,
      onChipClick,
      onNoticeAction,
      onOpenInspector,
      openTooltip,
      setTooltipOpen,
      closeTooltip,
    };
  },
});
</script>
