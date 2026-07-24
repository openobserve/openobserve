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
    ref="root"
    class="group relative flex flex-col h-full overflow-hidden border border-border-default rounded-default hover:border-primary focus-within:border-primary"
    role="group"
    :aria-label="
      t('metrics.explorer.card.ariaLabel', {
        name: card.name,
        type: badgeLabel,
      })
    "
    :data-test="`metrics-explorer-card-${card.name}`"
  >
    <!-- Deliberately NOT a button. Making the whole card clickable meant any
         attempt to select the metric name — or drag across the help text —
         navigated away to the editor instead. The open-in-editor icon is the
         only affordance that navigates, so this is a plain container and its
         text stays selectable. Still fully keyboard reachable: the action bar
         reveals on `focus-within`, so tabbing lands on Refresh / Configure /
         Pin / Open. -->
    <!-- Matches the dashboard panel bar's box (PanelContainer's
         dashboard-panel-bar): same min-height, padding and bottom border, no
         tint. -->
    <div
      class="relative flex items-center gap-2 min-w-0 min-h-7 py-1 px-2 border-b border-border-default"
    >
      <!-- The name gets the full header width; the type badge sits in the
           footer, where it cannot truncate the name it describes. -->
      <div class="flex items-center gap-1.5 min-w-0">
        <!-- Matches the dashboard panel title's classes (PanelContainer's
             dashboard-panel-header): same size, weight, tracking and token. -->
        <span
          class="whitespace-nowrap overflow-hidden text-ellipsis text-compact font-medium text-text-heading tracking-[0.02em]"
          :title="card.name"
          >{{ card.name }}</span
        >
      </div>

      <!-- Spacer, then the right-hand cluster (PanelContainer: title, `flex-1`
           spacer, then the action row). -->
      <div class="flex-1" />

      <!-- The action row: `size="icon"` buttons sitting adjacent (no gap).
           Order (left→right): Help → Configure → Open → Pin → 🕑 clock → Refresh. -->
      <div class="flex flex-nowrap items-center shrink-0">
        <!-- Help — the SAME element the dashboard panel bar uses for its panel
             description (PanelContainer `dashboard-panel-description-info`): an
             info-outline icon with a width-capped, pre-wrapped OTooltip. NOT a
             dropdown item — a full help sentence in an unbounded menu item blew
             the menu out to full-page width. -->
        <OButton
          v-if="card.help"
          variant="ghost"
          size="icon"
          icon-left="info-outline"
          :aria-label="
            t('metrics.explorer.card.helpAria', {
              name: card.name,
              help: card.help,
            })
          "
          :data-test="`metrics-explorer-card-help-${card.name}`"
          @click.stop
        >
          <OTooltip side="bottom" align="end" max-width="13.75rem">
            <template #content
              ><div class="whitespace-pre-wrap">{{ card.help }}</div></template
            >
          </OTooltip>
        </OButton>

        <!-- Configure — visible icon button (only when the card is configurable). -->
        <OButton
          v-if="card.configurable"
          variant="ghost"
          size="icon"
          icon-left="settings"
          :aria-label="
            t('metrics.explorer.card.configureAria', { name: card.name })
          "
          :data-test="`metrics-explorer-card-fn-${card.name}`"
          @click="$emit('configure', card)"
        >
          <OTooltip :content="t('metrics.explorer.card.configureTooltip')" />
        </OButton>

        <!-- The drill-in. The ONLY thing that navigates; the chart and card are
             not click targets, so the metric name stays selectable.

             `edit`, not `open-in-new`: this opens the metric in the in-page
             Visualize workspace to CHANGE it (query, chart type, functions), and
             open-in-new is the web's idiom for "leaves this page / new tab",
             which this does not do. -->
        <OButton
          variant="ghost"
          size="icon"
          icon-left="edit"
          :aria-label="t('metrics.explorer.card.openAria', { name: card.name })"
          :data-test="`metrics-explorer-card-select-${card.name}`"
          @click="$emit('select', card)"
        >
          <OTooltip :content="t('metrics.explorer.card.openTooltip')" />
        </OButton>

        <!-- Pin (star). Always visible. -->
        <OButton
          variant="ghost"
          size="icon"
          :icon-left="isFavorite ? 'favorite' : 'favorite-border'"
          :aria-label="
            isFavorite
              ? t('metrics.explorer.card.favoriteRemoveAria', {
                  name: card.name,
                })
              : t('metrics.explorer.card.favoriteAddAria', { name: card.name })
          "
          :aria-pressed="String(isFavorite)"
          :data-test="`metrics-explorer-card-favorite-${card.name}`"
          @click="$emit('toggle-favorite', card)"
        >
          <OTooltip
            :content="
              isFavorite
                ? t('metrics.explorer.card.favoriteRemoveTooltip')
                : t('metrics.explorer.card.favoriteAddTooltip')
            "
          />
        </OButton>

        <!-- Last Refreshed — the SAME element the dashboard panel bar carries
             (PanelErrorButtons): 🕑 with the relative tooltip. `ml-1.25` matches
             PanelErrorButtons' spacing. A card restored from cache says how old
             its data really is instead of passing it off as live. -->
        <span
          v-if="preview?.lastTriggeredAt"
          class="lastRefreshedAt ml-1.25 mr-0.5 text-[smaller] whitespace-nowrap overflow-hidden text-ellipsis shrink-0"
          :data-test="`metrics-explorer-card-last-refreshed-${card.name}`"
        >
          <!-- eslint-disable-next-line vue/no-bare-strings-in-template -- decorative clock emoji glyph, not localizable text -->
          <span class="text-[smaller] mr-0.5">
            🕑
            <OTooltip side="bottom" align="end">
              <template #content
                >{{ t("metrics.metricCard.lastRefreshed") }}
                <RelativeTime :timestamp="preview.lastTriggeredAt"
              /></template>
            </OTooltip>
          </span>
          <RelativeTime
            :timestamp="preview.lastTriggeredAt"
            :full-time-prefix="t('metrics.explorer.card.lastRefreshedPrefix')"
          />
        </span>

        <!-- Refresh — always visible, rightmost with the clock (the freshness
             cluster). Re-runs this card's query, dropping the cached response so
             a metric that has started emitting shows up. -->
        <OButton
          v-if="!card.unsupported"
          variant="ghost"
          size="icon"
          icon-left="refresh"
          :loading="preview?.status === 'loading'"
          :aria-label="
            t('metrics.explorer.card.refreshAria', { name: card.name })
          "
          :data-test="`metrics-explorer-card-refresh-${card.name}`"
          @click="$emit('refresh', card)"
        >
          <OTooltip :content="t('metrics.explorer.card.refreshTooltip')" />
        </OButton>
      </div>
    </div>

    <!-- Flush to the frame, like a panel body — the chart's own converter
         margins are the only inset, same as dashboards. -->
    <div class="relative flex-1 min-h-0">
      <!-- The SAME loader a dashboard panel shows (PanelSchemaRenderer): a thin
           progress bar over the body, with whatever chart is already there kept
           visible beneath it. The card has no chunk-level progress to report,
           so the bar runs at its indeterminate floor with the shimmer. -->
      <LoadingProgress
        :loading="preview?.status === 'loading'"
        :loading-progress-percentage="0"
      />

      <!-- Unsupported: a placeholder rather than a wrong chart. The open-in-
           editor icon still works, so the metric stays explorable. -->
      <div
        v-if="card.unsupported"
        class="flex flex-col items-center justify-center gap-1.5 h-full text-2xs opacity-65 text-text-secondary"
        :data-test="`metrics-explorer-card-unsupported-${card.name}`"
      >
        <OIcon name="help-outline" size="sm" />
        <span>{{ t("metrics.explorer.card.unsupported") }}</span>
      </div>

      <!-- Understood, but the chosen variant is not something a card can draw —
           an info metric's label table renders through a component the card does
           not use. The drill-in works: the editor renders the table properly. -->
      <div
        v-else-if="preview?.status === 'unavailable'"
        class="flex flex-col items-center justify-center gap-1.5 h-full text-2xs opacity-65 text-text-secondary"
        :data-test="`metrics-explorer-card-nopreview-${card.name}`"
      >
        <OIcon name="table-chart" size="sm" />
        <span>{{ t("metrics.explorer.card.noPreview") }}</span>
      </div>

      <div
        v-else-if="preview?.status === 'error'"
        class="flex flex-col items-center justify-center gap-1.5 h-full text-2xs opacity-65 text-text-secondary"
        :data-test="`metrics-explorer-card-error-${card.name}`"
      >
        <!-- The backend's message is the only thing that distinguishes a
             timeout from a bad query from a permissions failure, so it has to
             be reachable. It is often a paragraph, though — far more than a
             card this size can hold — so it lives on hover.

             OTooltip is nested as the FIRST child, which (having no preceding
             sibling) binds its hover listeners to this whole parent — the icon
             AND the label — so the hover target is a readable block rather than
             a 16px dot. -->
        <span
          class="inline-flex flex-col items-center gap-1.5 cursor-help"
          :aria-label="
            t('metrics.explorer.card.queryFailedAria', {
              name: card.name,
              error: preview.error,
            })
          "
          :data-test="`metrics-explorer-card-error-tip-${card.name}`"
        >
          <OTooltip
            :content="errorTooltip"
            content-class="whitespace-pre-line"
            max-width="360px"
            :delay="200"
          />
          <OIcon name="error-outline" size="sm" class="text-error-600" />
          <span>{{ t("metrics.explorer.queryFailed") }}</span>
        </span>

        <div class="flex items-center gap-1">
          <OButton
            variant="ghost-primary"
            size="xs"
            :data-test="`metrics-explorer-card-retry-${card.name}`"
            @click.stop="$emit('refresh', card)"
          >
            {{ t("metrics.explorer.retry") }}
          </OButton>

          <!-- A tooltip cannot be selected, so the trace id in it can only be
               retyped by hand. This is how it leaves the page. -->
          <OButton
            variant="ghost"
            size="xs"
            :aria-label="
              t('metrics.explorer.card.copyErrorAria', { name: card.name })
            "
            :data-test="`metrics-explorer-card-copy-error-${card.name}`"
            @click.stop="copyErrorReport"
          >
            {{ t("metrics.explorer.card.copyDetails") }}
            <OTooltip
              :content="errorReport"
              content-class="whitespace-pre-line"
              max-width="360px"
              :delay="400"
            />
          </OButton>
        </div>
      </div>

      <!-- First load: blank body under the progress bar, exactly like a
           dashboard panel's first load. (The trailing skeleton below stays for
           IDLE cards — the below-the-fold not-yet-queried state a dashboard
           panel does not have.) -->
      <div
        v-else-if="preview?.status === 'loading' && !preview.results.length"
        class="h-full"
        :data-test="`metrics-explorer-card-skeleton-${card.name}`"
      />

      <!-- Has data, but `rate()` could not make a point out of it — fewer than two
           samples in its window. Deliberately NOT the "No data" tile: the metric
           is populated. The hint carries the actual remedy, which is the user's to
           choose (a wider range, or a shorter scrape interval). -->
      <!-- The same inline OEmptyState a dashboard panel shows for no data
           (PanelSchemaRenderer) — same component, same icon, same i18n key. -->
      <OEmptyState
        v-else-if="isSparse"
        size="inline"
        icon="show-chart"
        :backdrop="false"
        class="h-full"
        :data-test="`metrics-explorer-card-sparse-${card.name}`"
      >
        <template #title>
          <span class="inline-flex items-center gap-1 cursor-help">
            <OTooltip
              :content="t('metrics.explorer.card.sparseHint')"
              content-class="whitespace-pre-line"
              max-width="320px"
              :delay="200"
            />
            {{ t("metrics.explorer.card.sparse") }}
          </span>
        </template>
      </OEmptyState>

      <OEmptyState
        v-else-if="isEmpty"
        size="inline"
        icon="bar-chart"
        :title="t('panel.noData')"
        :backdrop="false"
        class="h-full"
        :data-test="`metrics-explorer-card-nodata-${card.name}`"
      />

      <!-- The CONVERSION failed — the query succeeded, so the preview is
           status "done" and none of the error branches above catch it. -->
      <div
        v-else-if="renderError"
        class="flex flex-col items-center justify-center gap-1.5 h-full text-2xs text-text-secondary"
        :data-test="`metrics-explorer-card-render-error-${card.name}`"
      >
        <span class="inline-flex items-center gap-1 cursor-help">
          <OTooltip
            :content="renderError"
            content-class="whitespace-pre-line"
            max-width="360px"
            :delay="200"
          />
          <OIcon name="error-outline" size="sm" class="text-error-600" />
          <span>{{ t("metrics.explorer.queryFailed") }}</span>
        </span>
        <OButton
          variant="ghost-primary"
          size="xs"
          :data-test="`metrics-explorer-card-render-retry-${card.name}`"
          @click.stop="onRetryRender"
        >
          {{ t("metrics.explorer.retry") }}
        </OButton>
      </div>

      <MetricCardChart
        v-else-if="preview?.results?.length"
        :results="preview.results"
        :queries="queries"
        :chart-type="preview.chartType"
        :unit="o2Unit.unit"
        :unit-custom="o2Unit.unitCustom ?? undefined"
        :bucket-unit="bucketO2Unit.unit ?? undefined"
        :bucket-unit-custom="bucketO2Unit.unitCustom ?? undefined"
        :color="color"
        :time-range="dataTimeRange"
        @error="renderError = String($event ?? '')"
        @zoom="$emit('zoom', $event)"
        @contextmenu="onChartContextMenu"
      />

      <div v-else class="h-full">
        <OSkeleton type="rect" animation="none" class="h-full w-full" />
      </div>

      <!-- The chart is real, but it came from a re-query. Say so rather than
           silently showing data the plain query did not produce. -->
      <div
        v-if="preview?.nanGuardApplied"
        class="absolute top-0.5 left-0.5 opacity-60"
        :data-test="`metrics-explorer-card-nan-guard-${card.name}`"
      >
        <span class="inline-flex cursor-help">
          <OTooltip
            :content="t('metrics.explorer.card.nanGuard')"
            max-width="360px"
            :delay="200"
          />
          <OIcon name="info-outline" size="xs" />
        </span>
      </div>

      <!-- A refresh that fails on top of a good result keeps the old chart up,
           so this badge is the ONLY place its error can be read. -->
      <div
        v-if="preview?.stale"
        class="absolute top-0.5 right-0.5 opacity-60"
        :data-test="`metrics-explorer-card-stale-${card.name}`"
      >
        <!-- No room for a Copy button beside a live chart, so the badge itself
             is the button: hover to read the failure, click to take it. -->
        <button
          type="button"
          class="inline-flex cursor-pointer"
          :aria-label="
            t('metrics.explorer.card.staleCopyAria', { name: card.name })
          "
          :data-test="`metrics-explorer-card-stale-copy-${card.name}`"
          @click.stop="copyErrorReport"
        >
          <OTooltip
            :content="staleTooltip"
            content-class="whitespace-pre-line"
            max-width="360px"
            :delay="200"
          />
          <OIcon name="sync-problem" size="xs" />
        </button>
      </div>
    </div>

    <!-- The footer pads itself now that the frame is flush, mirroring how the
         panel bar pads itself. -->
    <div class="flex items-center justify-between gap-2 text-3xs px-2 py-1">
      <!-- The function actually in effect, so a ⚙ override is visible on the
           card rather than silently identical to the default. -->
      <span class="opacity-70 text-text-secondary truncate">{{
        preview?.footerLabel || card.footerLabel
      }}</span>

      <div class="flex items-center gap-1.5 flex-none">
        <!-- Cached data fetched for a differently-sized window. Same warning the
             dashboards raise on a panel. -->
        <span
          v-if="preview?.cachedDataDiffersFromTimeRange"
          class="inline-flex text-warning-600 cursor-help"
          :data-test="`metrics-explorer-card-cached-differs-${card.name}`"
        >
          <OTooltip
            :content="t('metrics.explorer.card.cachedDiffers')"
            max-width="360px"
            :delay="200"
          />
          <OIcon name="running-with-errors" size="xs" />
        </span>

        <span class="opacity-70 text-text-secondary">{{ unitLabel }}</span>
        <!-- Badge text is never the sole carrier of meaning — the footer
             function label sits right beside it. -->
        <OTag
          type="metricType"
          :value="card.typeFilterBucket"
          :data-test="`metrics-explorer-card-badge-${card.name}`"
        />
      </div>
    </div>

    <!-- Create Alert — the SAME menu the dashboard panel raises on right-click
         (PanelSchemaRenderer mounts this exact component), so the gesture and the
         wording are identical wherever a chart is. Position is viewport-fixed
         from the click, so the card's `overflow-hidden` cannot clip it. -->
    <AlertContextMenu
      :visible="alertMenu.visible"
      :x="alertMenu.x"
      :y="alertMenu.y"
      :value="alertMenu.value"
      @select="onCreateAlert"
      @close="alertMenu.visible = false"
    />
  </div>
</template>

<script lang="ts">
import {
  computed,
  defineAsyncComponent,
  defineComponent,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
  type PropType,
} from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import useTheme from "@/composables/useTheme";
import MetricCardChart from "./MetricCardChart.vue";

// Async, exactly as PanelSchemaRenderer imports it: the menu is only ever
// needed once a user right-clicks a chart, so it stays out of the grid's chunk.
const AlertContextMenu = defineAsyncComponent(
  () => import("@/components/dashboards/AlertContextMenu.vue"),
);
import RelativeTime from "@/components/common/RelativeTime.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import LoadingProgress from "@/components/common/LoadingProgress.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { copyToClipboard } from "@/utils/clipboard";
import OTag from "@/lib/core/Badge/OTag.vue";
import { BADGE_LABELS, cardColorForIndex } from "@/utils/metrics/metricPalette";
import { toO2Unit } from "@/utils/metrics/metricDefaults";
import type { MetricCard as MetricCardModel } from "@/utils/metrics/metricFamily";
import {
  hasSamples,
  type CardPreview,
} from "@/composables/metrics/useMetricsExplorerGrid";

/** Human-facing unit text for the card footer. */
const UNIT_LABELS: Record<string, string> = {
  seconds: "s",
  milliseconds: "ms",
  microseconds: "µs",
  nanoseconds: "ns",
  bytes: "bytes",
  "bytes-per-sec": "bytes/s",
  "count-per-sec": "c/s",
  "ms-per-sec": "ms/s",
  "us-per-sec": "µs/s",
  "ns-per-sec": "ns/s",
  bits: "bits",
  "bits-per-sec": "bits/s",
  percent: "%",
  "percent-1": "%",
  celsius: "°C",
  volts: "V",
  amperes: "A",
  joules: "J",
  watts: "W",
  short: "",
  none: "",
};

export default defineComponent({
  name: "MetricCard",
  components: {
    MetricCardChart,
    RelativeTime,
    OButton,
    OIcon,
    OSkeleton,
    OEmptyState,
    LoadingProgress,
    OTag,
    OTooltip,
    AlertContextMenu,
  },
  props: {
    card: { type: Object as PropType<MetricCardModel>, required: true },
    preview: {
      type: Object as PropType<CardPreview | undefined>,
      default: undefined,
    },
    queries: { type: Array as PropType<any[]>, default: () => [] },
    /** Position in the FULL filtered+sorted set, so colours are scroll-stable. */
    index: { type: Number, required: true },
    isFavorite: { type: Boolean, default: false },
    /** The queried window (µs). Handed to the chart so its axis says the truth. */
    timeRange: {
      type: Object as PropType<{ start_time: number; end_time: number }>,
      default: null,
    },
  },
  emits: [
    "select",
    "configure",
    "toggle-favorite",
    "visible",
    "hidden",
    // `refresh`, not `retry`: both the header button and the no-data card's
    // retry button emit `refresh` (the parent listens for `@refresh` and calls
    // `grid.refreshCard`). Declare it here — an undeclared emit falls through to
    // $attrs and binds to the root ELEMENT as a DOM listener, so a handler can
    // silently never fire when the event name matches a DOM event.
    "refresh",
    // A drag-select on the card's chart, as `{start, end}` epoch ms. Forwarded
    // straight from MetricCardChart — the card takes no action of its own,
    // because a zoom re-ranges the WHOLE grid (every card shares one window),
    // which only the explorer can do.
    "zoom",
  ],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();
    const router = useRouter();
    const root = ref<HTMLElement | null>(null);
    const { isDark } = useTheme();

    /* ------------------------------------------------ create alert */

    /**
     * Right-click a data point -> Create Alert, the same gesture a dashboard
     * panel offers. Handled HERE rather than emitted to the explorer: the menu is
     * positioned from the click and the payload is this card's own query, so
     * there is nothing for the parent to decide. (`contextmenu` is also a real
     * DOM event name — emitting it would bind to the root element and fire on
     * every right-click anywhere on the card, which is the trap the `refresh`
     * note above describes.)
     */
    const alertMenu = reactive({ visible: false, x: 0, y: 0, value: 0 });

    const onChartContextMenu = (event: {
      x: number;
      y: number;
      value: number;
    }) => {
      // The clicked point's value seeds the threshold, so the alert opens
      // pre-filled with the number the user actually pointed at.
      if (!Number.isFinite(event?.value)) return;
      alertMenu.visible = true;
      alertMenu.x = event.x;
      alertMenu.y = event.y;
      alertMenu.value = event.value;
    };

    /**
     * The same `panelData` contract the dashboard path builds
     * (usePanelActions.handleCreateAlert) and the alert page reads: queries +
     * queryType + timeRange + the chosen condition/threshold.
     *
     * `yAxisColumn` is deliberately absent — it is SQL-only there too; a PromQL
     * alert thresholds the expression's own value.
     */
    const onCreateAlert = (selection: {
      condition: string;
      threshold: number;
    }) => {
      alertMenu.visible = false;

      const queries = props.queries ?? [];
      if (!queries.length) return;

      const panelData = {
        panelTitle: props.card.name,
        panelId: `metrics-explorer-card-${props.card.name}`,
        queries: queries.map((q: any) => ({
          query: q.expr,
          customQuery: true,
          fields: { stream_type: "metrics" },
          config: { promql_legend: q.legendTemplate ?? "" },
        })),
        queryType: "promql",
        timeRange: props.timeRange,
        threshold: selection.threshold,
        condition: selection.condition,
        executedQuery: queries[0]?.expr,
      };

      router.push({
        name: "addAlert",
        query: {
          org_identifier: store.state.selectedOrganization?.identifier,
          fromPanel: "true",
          panelData: encodeURIComponent(JSON.stringify(panelData)),
        },
      });
    };

    const color = computed(() => cardColorForIndex(props.index, isDark.value));
    // Kept for the card's aria label; the VISIBLE badge renders through the
    // registry's metricType group, which owns the label and colour.
    const badgeLabel = computed(
      () => BADGE_LABELS[props.card.typeFilterBucket] ?? t("metrics.metricCard.other"),
    );

    const o2Unit = computed(() =>
      toO2Unit(props.preview?.unit ?? props.card.unit),
    );
    const bucketO2Unit = computed(() =>
      props.preview?.bucketUnit
        ? toO2Unit(props.preview.bucketUnit)
        : { unit: null, unitCustom: null },
    );
    const unitLabel = computed(
      () => UNIT_LABELS[props.preview?.unit ?? props.card.unit] ?? "",
    );

    /**
     * The failure, in full: the message, then the backend's internal cause and
     * the trace id.
     *
     * The last two are noise to someone reading a chart and the first two things
     * asked for when they report the failure, so they go below the message
     * rather than into it. One preformatted string rather than a rich slot —
     * OTooltip renders its content in a portal that only mounts while open, so a
     * slot's contents cannot be asserted in a test.
     */
    const errorTooltip = computed(() => {
      const preview = props.preview;
      if (!preview?.error) return "";
      return [
        preview.error,
        preview.errorDetail,
        preview.errorTraceId
          ? t("metrics.metricCard.traceId", { id: preview.errorTraceId })
          : "",
      ]
        .filter(Boolean)
        .join("\n");
    });

    /** As above, but a stale card still shows its old chart, so it says so. */
    const staleTooltip = computed(() => {
      const failure = errorTooltip.value;
      const preamble = t("metrics.explorer.card.stalePreamble");
      const body = failure ? `${preamble}\n\n${failure}` : preamble;
      return `${body}\n\n${t("metrics.explorer.card.staleClickToCopy")}`;
    });

    /**
     * The failure as something you can paste into a bug report.
     *
     * A tooltip cannot be selected — it closes the moment the pointer leaves the
     * icon — so reading the trace id off one and retyping it is the worst part
     * of reporting a broken panel. The query goes in too: the user never typed
     * it, so the card is the only thing that knows what actually ran.
     */
    const errorReport = computed(() => {
      const preview = props.preview;
      if (!preview?.error) return "";
      return [
        t("metrics.metricCard.metricLabel", { name: props.card.name }),
        ...(preview.errorQueries?.length
          ? [
              t("metrics.metricCard.queryLabel", {
                query: preview.errorQueries.join("\n       "),
              }),
            ]
          : []),
        t("metrics.metricCard.errorLabel", { error: preview.error }),
        preview.errorDetail
          ? t("metrics.metricCard.causeLabel", { cause: preview.errorDetail })
          : "",
        preview.errorTraceId
          ? t("metrics.metricCard.traceId", { id: preview.errorTraceId })
          : "",
      ]
        .filter(Boolean)
        .join("\n");
    });

    const copyErrorReport = () =>
      copyToClipboard(errorReport.value, {
        successMessage: t("metrics.explorer.card.errorCopied"),
      });

    /**
     * A CONVERSION failure from the chart child. The preview itself is "done"
     * (the query succeeded), so none of the preview error branches show it —
     * this is its only surface. Cleared whenever new results arrive, and by
     * the tile's own Retry.
     */
    const renderError = ref("");
    watch(
      () => props.preview?.results,
      () => {
        renderError.value = "";
      },
    );
    const onRetryRender = () => {
      renderError.value = "";
      emit("refresh", props.card);
    };

    /**
     * The card stays visible in the grid even with no data, so users still learn
     * the metric exists.
     */
    const isEmpty = computed(() => {
      const preview = props.preview;
      if (!preview || preview.status !== "done") return false;
      return !preview.results.some(hasSamples);
    });

    /**
     * Empty, but only because `rate()` had too few samples to work with — the
     * metric itself carries data in this window (the grid probed for it). A
     * strictly narrower case than `isEmpty`, and the template tests it first.
     */
    const isSparse = computed(() => !!props.preview?.sparse && isEmpty.value);

    /**
     * The window the chart's x-axis is drawn against: the one this data was
     * FETCHED for, falling back to the selected one.
     *
     * They are the same thing on the live path. They diverge only for a card
     * painted from the persisted cache, and there the selected window is a lie:
     * a relative range ("Past 15 Minutes") re-resolves against `now` on every
     * mount, so `timeRange` marches forward with the wall clock while the cached
     * points stay where they were. Pinning to it drew an axis of 10:15-10:30 over
     * data from 09:40 — the chart appeared to drift on its own.
     *
     * Dashboards never hit this because their pin is streaming-only (it is gated
     * on `loading`, which a cache paint leaves false), so a cached panel just
     * auto-ranges onto its own data. A card pins deliberately — it has to, since
     * one sparse series would otherwise invent a two-day axis — so it must pin to
     * the window that is actually true of the data.
     */
    const dataTimeRange = computed(
      () => props.preview?.cachedTimeRange ?? props.timeRange,
    );

    // Lazy queries: only cards in (or within one viewport of) the scroll window
    // fetch anything.
    let observer: IntersectionObserver | null = null;
    onMounted(() => {
      if (!root.value || typeof IntersectionObserver === "undefined") {
        emit("visible", props.card);
        return;
      }
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            emit(entry.isIntersecting ? "visible" : "hidden", props.card);
          }
        },
        { rootMargin: "100% 0px" },
      );
      observer.observe(root.value);
    });

    onBeforeUnmount(() => {
      observer?.disconnect();
      observer = null;
      // The virtualizer unmounts rows as they scroll out, and an IntersectionObserver
      // fires no final event on disconnect. Without this the parent would keep the
      // card in its on-screen set forever and re-query it on every refresh.
      emit("hidden", props.card);
    });

    return {
      t,
      root,
      color,
      badgeLabel,
      o2Unit,
      bucketO2Unit,
      unitLabel,
      errorTooltip,
      staleTooltip,
      errorReport,
      copyErrorReport,
      isEmpty,
      isSparse,
      dataTimeRange,
      renderError,
      onRetryRender,
      alertMenu,
      onChartContextMenu,
      onCreateAlert,
    };
  },
});
</script>
