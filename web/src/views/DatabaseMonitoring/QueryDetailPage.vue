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

<!--
  QueryDetailPage (FR-5 + FR-6) — one fingerprint, end to end.

  A full page rather than a drawer, because this screen is a destination: it is
  linked from a span, from the queries table, and pasted into incident channels,
  all of which need a URL.

  It is built around the 2am test's two weakest and strongest minutes:

   • 8–12 min (our best stage) — "show me one real bad execution". The samples
     scatter and its trace pivot get prominence rather than a tab, because this
     is the one thing the category does not do uniformly.
   • 12–15 min (our worst) — "what do I tell the channel". The copy button
     composes the message; every number in it is already on this page.

  Unit trap, load-bearing in two places: rollup metrics are NANOseconds
  (`end_time - start_time` on a span, undivided), while the raw-span `duration`
  column is MICROseconds (`(end_time - start_time) / 1000`). Samples are read
  from `duration` and converted once, at the boundary, so everything downstream
  of `loadSamples` is uniformly ns.
-->
<template>
  <OPageLayout
    :title="t('dbm.detail.title')"
    :back="{ label: backTarget.label, to: backTarget.to }"
    icon="storage"
    title-data-test="dbm-detail-title"
    scroll
  >
    <template #actions>
      <DateTime
        auto-apply
        menu-align="end"
        :default-type="range.type"
        :default-absolute-time="{ startTime: range.startTime, endTime: range.endTime }"
        :default-relative-time="range.relativeTimePeriod ?? undefined"
        data-test-name="dbm-detail-date-time"
        class="h-8"
        @on:date-change="onDateChange"
      />
      <OButton
        variant="outline"
        size="sm"
        icon-left="content-copy"
        class="shrink-0"
        data-test="dbm-detail-copy-summary"
        @click="copySummary"
      >
        {{ t("dbm.detail.copySummary") }}
        <OTooltip side="bottom" :content="t('dbm.detail.copySummaryHint')" />
      </OButton>
      <OButton
        variant="outline"
        size="icon-sm"
        icon-left="refresh"
        :loading="loading"
        class="shrink-0"
        data-test="dbm-detail-refresh"
        @click="load"
      >
        <OTooltip side="bottom" :content="t('dbm.common.reload')" />
      </OButton>
    </template>

    <div class="flex flex-col gap-4 pt-3">
      <!-- Identity: the statement, then the dimensions that locate it. -->
      <section class="flex flex-col gap-2" data-test="dbm-detail-identity">
        <div class="flex flex-wrap items-center gap-1.5">
          <OTag v-if="row?.db_system" type="dbSystem" :value="row.db_system" />
          <OTag v-for="chip in identityChips" :key="chip.key" :label="chip.label" size="xs" />
          <span v-if="firstSeenLabel" class="text-text-secondary text-xs">
            {{ firstSeenLabel }}
            <OTooltip side="bottom" :content="t('dbm.detail.firstSeenHint')" />
          </span>
          <span
            v-if="lastSeenLabel"
            class="text-text-secondary text-xs"
            data-test="dbm-detail-last-seen"
          >
            {{ lastSeenLabel }}
            <OTooltip side="bottom" :content="t('dbm.detail.lastSeenHint')" />
          </span>
          <div class="flex-1"></div>
          <!-- Beside the statement, not in the page actions: the question is
               about THIS query, and the button has to sit where the artifact is
               for that to be obvious. -->
          <DbmSuggestFixButton
            :label="t('dbm.ai.suggestFix')"
            :tooltip="t('dbm.ai.suggestFixHint')"
            data-test="dbm-detail-suggest-fix"
            @click="askAiForFix"
          />
        </div>

        <DbmQueryText
          :query="queryText"
          :db-system="row?.db_system ?? ''"
          data-test="dbm-detail-query-text"
        />
        <span v-if="row?.truncated" class="text-text-muted text-2xs">
          {{ t("dbm.queries.truncatedText") }}
        </span>
      </section>

      <!-- The headline numbers, before the charts: minute 0 of an incident is
           "how bad and how much of the database is it", and that is six
           figures, not a graph.

           Labelled with its VANTAGE because a second, server-side block sits
           below it (W6). These figures come from instrumented callers only —
           anything talking to the database without tracing is invisible here
           and IS counted in the block below. -->
      <div class="text-text-muted text-xs" data-test="dbm-detail-stats-provenance">
        {{ t("dbm.detail.serverMetrics.clientSubtitle") }}
      </div>
      <div
        class="border-border-default rounded-surface grid grid-cols-2 overflow-hidden border md:grid-cols-3 xl:grid-cols-6"
        data-test="dbm-detail-stats"
      >
        <div
          v-for="stat in headlineStats"
          :key="stat.id"
          class="border-border-subtle border-r border-b px-3 py-2 last:border-r-0"
          :data-test="`dbm-detail-stat-${stat.id}`"
        >
          <!-- The percentile the plain-English label stands for, alongside it in
               the quiet weight — the tile says what it means and what it is. -->
          <div class="flex items-baseline gap-1">
            <span class="text-text-label text-3xs font-semibold tracking-wide uppercase">
              {{ stat.label }}
            </span>
            <span v-if="stat.sub" class="text-text-muted text-3xs" data-test="dbm-detail-stat-sub">
              {{ stat.sub }}
            </span>
          </div>
          <div
            class="text-text-heading font-mono text-lg leading-tight font-semibold tabular-nums"
            :class="stat.tone"
          >
            {{ stat.value }}
          </div>
          <div class="text-text-secondary text-3xs">{{ stat.detail }}</div>
        </div>
      </div>

      <!-- Plan drift, promoted. "It got slow because the plan changed" is the
           most actionable finding on this page, and the section that computes it
           sits below three tables — so the FINDING surfaces here, beside the
           headline numbers, while the evidence stays where it is. Same state and
           copy as the plans section (nothing recomputed), and when there is no
           drift this renders nothing: only exceptions get a chip. -->
      <OBanner
        v-if="planDrift === 'drifted'"
        variant="warning"
        data-test="dbm-detail-plans-drift-top"
      >
        <div class="flex flex-wrap items-center gap-2">
          <span>{{ t("dbm.detail.plans.driftCallout", { count: plans.length }) }}</span>
          <OButton
            variant="outline"
            size="sm"
            class="shrink-0"
            data-test="dbm-detail-plans-drift-view"
            @click="scrollToPlans"
          >
            {{ t("dbm.detail.plans.viewPlans") }}
          </OButton>
        </div>
      </OBanner>

      <!-- W6 · What the DATABASE recorded.
           A SEPARATE block under its own heading, never merged into the grid
           above. The two vantages measure different populations over different
           windows: the client sees only instrumented callers and measures
           round-trip; the server sees every client and measures in-engine
           work. Provenance is therefore structural — each block states who was
           measured — rather than a tooltip a reader has to go looking for.
           No figure spans the two: subtracting a server MEAN from a client
           PERCENTILE, over misaligned windows, is arithmetic on incomparable
           quantities. -->
      <!-- Capture is off (or this row has no join key, so nothing server-side
           can ever surface): ONE quiet line with the route to the fix, not a
           panel in prime position on every un-instrumented install. The env-var
           detail is operator depth, so it lives in the tooltip, and the "Set
           up" button goes where the list pages' empty states already go.
           Renders only once the read has ANSWERED off — never while it is in
           flight, and never for a failed read (that is `failed`, below). -->
      <div
        v-if="serverMetricsRead === 'done' && serverMetrics.state === 'off'"
        class="flex flex-wrap items-center gap-2"
        data-test="dbm-detail-server-metrics"
      >
        <span class="text-text-muted text-xs" data-test="dbm-detail-server-metrics-off">
          {{ t("dbm.detail.serverMetrics.off") }}
          <OTooltip side="top" :content="t('dbm.detail.serverMetrics.offHint')" />
        </span>
        <OButton
          variant="outline"
          size="sm"
          class="shrink-0"
          data-test="dbm-detail-server-metrics-setup"
          @click="openDbmSetup"
        >
          {{ t("dbm.detail.serverMetrics.setUp") }}
        </OButton>
      </div>

      <section
        v-else
        class="card-container border-border-default rounded-surface flex flex-col border"
        data-test="dbm-detail-server-metrics"
      >
        <div class="flex flex-wrap items-baseline gap-2 p-3 pb-1">
          <h3 class="text-text-heading text-sm font-medium">
            {{ t("dbm.detail.serverMetrics.title") }}
          </h3>
          <span class="text-text-muted text-xs" data-test="dbm-detail-server-metrics-provenance">
            {{ t("dbm.detail.serverMetrics.subtitle") }}
          </span>
          <span
            v-if="serverMetrics.instance"
            class="text-text-secondary text-xs"
            data-test="dbm-detail-server-metrics-instance"
          >
            {{ t("dbm.detail.serverMetrics.instance", { instance: serverMetrics.instance }) }}
          </span>
          <!-- mysql/mariadb server records carry no database, so their
               counters span every database on the instance. Stated in the
               header, or the tiles below read as per-database figures — a
               claim that vantage cannot support. -->
          <span
            v-if="serverMetrics.state === 'matched' && serverMetrics.attribution === 'instance'"
            class="text-text-muted text-xs"
            data-test="dbm-detail-server-metrics-attribution"
          >
            {{ t("dbm.detail.serverMetrics.instanceWide") }}
          </span>
        </div>

        <!-- The read FAILED. Distinct from `off` on purpose: a failed request
             says nothing about whether capture is running, and the off copy
             sends the reader to reconfigure a collector that may be fine. -->
        <div
          v-if="serverMetricsRead === 'failed'"
          class="flex flex-col gap-1 px-3 pb-3"
          data-test="dbm-detail-server-metrics-failed"
        >
          <span class="text-text-secondary text-sm">
            {{ t("dbm.detail.serverMetrics.readFailed") }}
          </span>
          <span class="text-text-muted text-xs">
            {{ t("dbm.detail.serverMetrics.readFailedHint") }}
          </span>
        </div>

        <!-- In flight: the header only, never a claim — which sentence applies
             is exactly what the read has not answered yet. -->
        <template v-else-if="serverMetricsRead === 'done'">
          <!-- Two instances share this database name, so the join cannot tell
               which one ran the query. Deliberately NOT an error, and the
               numbers are withheld rather than guessed. -->
          <div
            v-if="serverMetrics.state === 'ambiguous'"
            class="flex flex-col gap-1 px-3 pb-3"
            data-test="dbm-detail-server-metrics-ambiguous"
          >
            <span class="text-text-secondary text-sm">
              {{ t("dbm.detail.serverMetrics.ambiguous") }}
            </span>
            <span class="text-text-muted text-xs">
              {{
                t("dbm.detail.serverMetrics.ambiguousHint", {
                  instances: serverMetrics.candidateInstances.join(", "),
                })
              }}
            </span>
          </div>

          <!-- Capture ran and found no counterpart. ORDINARY, not a failure:
               fingerprint convergence is partial by measurement, and the server
               legitimately sees statements no instrumented client issued. Muted
               copy, never error styling. -->
          <div
            v-else-if="serverMetrics.state === 'unmatched'"
            class="flex flex-col gap-1 px-3 pb-3"
            data-test="dbm-detail-server-metrics-unmatched"
          >
            <span class="text-text-secondary text-sm">
              {{ t("dbm.detail.serverMetrics.noMatch") }}
            </span>
            <span class="text-text-muted text-xs">
              {{ t("dbm.detail.serverMetrics.noMatchHint") }}
            </span>
          </div>

          <div
            v-else
            class="border-border-default grid grid-cols-2 overflow-hidden border-t md:grid-cols-3 xl:grid-cols-6"
            data-test="dbm-detail-server-metrics-tiles"
          >
            <div
              v-for="tile in serverTiles"
              :key="tile.id"
              class="border-border-subtle border-r border-b px-3 py-2 last:border-r-0"
              :data-test="`dbm-detail-server-metric-${tile.id}`"
            >
              <div class="text-text-label text-3xs font-semibold tracking-wide uppercase">
                {{ t(`dbm.detail.serverMetrics.${tile.labelKey}`) }}
              </div>
              <div
                class="text-text-heading font-mono text-lg leading-tight font-semibold tabular-nums"
              >
                {{ tile.value }}
              </div>
            </div>
          </div>
        </template>
      </section>

      <!-- Coverage, as the same quiet line the list pages carry. Hidden on a
           server-vantage-only entry: with NO client row and the database's
           own sections answering above, its "nothing to measure" state would
           contradict the visible data — the client heading already carries
           the instrumented-callers-only disclaimer, and there is no client
           coverage to be stale about. -->
      <DbmCoverageLine
        v-if="clientRowFound || !serverAnswering"
        :freshness="freshness"
        :hits="row ? [row] : []"
        :top-n-subset="topNSubset"
        :coded-error-share="uncodedErrorShare === undefined ? undefined : 1 - uncodedErrorShare"
        :error-count="row?.errors"
        subject="query"
        data-test="dbm-detail-coverage"
      />

      <!-- Fidelity disclosure. Fires only when the series actually contains
           below-top-N windows, so it describes this chart rather than standing
           permanently and being skipped. -->
      <OBanner
        v-if="history?.hasBelowTopN"
        variant="info"
        icon="info"
        data-test="dbm-detail-below-top-n"
      >
        <div class="flex flex-col gap-1">
          <span class="font-medium">{{ t("dbm.detail.belowTopN.title") }}</span>
          <span class="text-xs">
            {{
              history.backfillCapped
                ? t("dbm.detail.belowTopN.capped", { windows: BACKFILL_MAX_WINDOWS })
                : t("dbm.detail.belowTopN.body")
            }}
          </span>
        </div>
      </OBanner>

      <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <section
          class="card-container border-border-default rounded-surface flex flex-col border p-3"
          data-test="dbm-detail-latency-chart"
        >
          <h3 class="text-text-heading mb-1 text-sm font-medium">
            {{ t("dbm.detail.latencyTitle") }}
          </h3>
          <OSkeleton v-if="loading" variant="button" class="h-55 w-full" />
          <div v-else-if="!hasSeries" class="text-text-muted flex h-55 items-center justify-center">
            {{ t("dbm.detail.noSeries") }}
          </div>
          <div v-else class="h-55 w-full">
            <PanelSchemaRenderer
              :panel-schema="latencyPanelSchema"
              :selected-time-obj="selectedTimeObj"
              :variables-data="{}"
              :injected-promql-data="latencyInjectedData"
              :allow-annotations-add="false"
              :allow-annotations-a-p-i="false"
              data-test="dbm-detail-latency-panel"
            />
          </div>
        </section>

        <section
          class="card-container border-border-default rounded-surface flex flex-col border p-3"
          data-test="dbm-detail-volume-chart"
        >
          <h3 class="text-text-heading mb-1 text-sm font-medium">
            {{ t("dbm.detail.volumeTitle") }}
          </h3>
          <OSkeleton v-if="loading" variant="button" class="h-55 w-full" />
          <div v-else-if="!hasSeries" class="text-text-muted flex h-55 items-center justify-center">
            {{ t("dbm.detail.noSeries") }}
          </div>
          <div v-else class="h-55 w-full">
            <PanelSchemaRenderer
              :panel-schema="volumePanelSchema"
              :selected-time-obj="selectedTimeObj"
              :variables-data="{}"
              :injected-promql-data="volumeInjectedData"
              :allow-annotations-add="false"
              :allow-annotations-a-p-i="false"
              data-test="dbm-detail-volume-panel"
            />
          </div>
        </section>
      </div>

      <!-- Where it runs (FR-5). The same rows the two charts merge per window,
           folded per (instance, database) instead — served precomputed on the
           history response, so this section costs no extra read. Its rows ARE
           the page's dimension filters: clicking one narrows every number on
           this page to that instance or database, clicking again widens back
           out. The identity chips at the top stay as context; this is where
           that context becomes actionable.

           Honesty: the figures cover only the stretches where this query was
           heavy enough to track on its own (per instance), so they are floors,
           and the tooltip says so. Rows whose dimension was never reported
           render — their share must stay visible — but refuse the click: the
           stored rows spell "absent" two ways, and a filter on one spelling
           would silently miss the other. -->
      <section
        v-if="whereRows.length || whereScopeActive"
        class="card-container border-border-default rounded-surface flex flex-col border"
        data-test="dbm-detail-where-it-runs"
      >
        <div class="flex flex-wrap items-center gap-2 p-3 pb-1">
          <h3 class="text-text-heading text-sm font-medium">
            {{ t("dbm.detail.whereItRuns.title") }}
          </h3>
          <span class="text-text-secondary text-xs">
            {{ t("dbm.detail.whereItRuns.hint") }}
            <OTooltip side="top" :content="t('dbm.detail.whereItRuns.trackedHint')" />
          </span>
          <div class="flex-1"></div>
          <OButton
            v-if="whereScopeActive"
            variant="outline"
            size="sm"
            class="shrink-0"
            data-test="dbm-detail-where-show-all"
            @click="clearWhereScope"
          >
            {{ t("dbm.detail.whereItRuns.showAll") }}
          </OButton>
        </div>

        <!-- A focus that empties out still renders the section: the reader
             needs the way back, not a page that quietly hid the exit. -->
        <div
          v-if="!whereRows.length"
          class="text-text-muted p-6 pt-2 text-sm"
          data-test="dbm-detail-where-empty"
        >
          {{ t("dbm.detail.whereItRuns.emptyFiltered") }}
        </div>
        <OTable
          v-else
          :data="whereRows"
          :columns="whereColumns"
          row-key="rowKey"
          :loading="loading"
          :frame="false"
          :show-global-filter="false"
          :page-size="10"
          table-id="dbm-query-where-it-runs"
          data-test="dbm-detail-where-table"
          @row-click="onWhereRowClick"
        >
          <template #cell-location="{ row: whereRow }">
            <div class="flex min-w-0 items-center gap-1.5" :class="whereRow.isChild ? 'pl-6' : ''">
              <OIcon
                v-if="whereRow.isChild"
                name="database"
                size="xs"
                class="text-text-label shrink-0"
              />
              <span
                class="min-w-0 truncate"
                :class="[
                  whereRow.isChild ? 'text-text-secondary text-xs' : 'text-text-heading text-sm',
                  whereRow.label ? '' : 'text-text-muted italic',
                ]"
              >
                {{
                  whereRow.label
                    ? whereRow.label
                    : whereRow.isChild
                      ? t("dbm.breakdown.noSchema")
                      : t("dbm.detail.whereItRuns.noInstance")
                }}
              </span>
              <OTag
                v-if="isWhereRowActive(whereRow, whereScope)"
                :label="t('dbm.detail.whereItRuns.focused')"
                size="xs"
                :data-test="`dbm-detail-where-focused-${whereRow.rowKey}`"
              >
                <OTooltip side="top" :content="t('dbm.detail.whereItRuns.focusHint')" />
              </OTag>
            </div>
          </template>
          <template #cell-load="{ row: whereRow }">
            <ODataBarCell
              :value="whereRow.totalTimeNs"
              :max="whereTimeMax"
              :display="`${formatNs(whereRow.totalTimeNs)} · ${formatPercent(whereRow.share, 0)}`"
            />
          </template>
          <template #cell-calls="{ row: whereRow }">
            <span class="text-text-body font-mono text-xs tabular-nums">
              {{ formatCount(whereRow.calls) }}
            </span>
          </template>
          <template #cell-avg="{ row: whereRow }">
            <span
              class="font-mono text-xs tabular-nums"
              :class="whereRow.avgNs === null ? 'text-text-muted' : 'text-text-body'"
            >
              {{ whereRow.avgNs === null ? raw("—") : formatNs(whereRow.avgNs) }}
            </span>
          </template>
          <!-- A failure RATE, not a count — and red only past the calibrated
               threshold, same gating as the headline tile, so the two cannot
               give different answers to one question. -->
          <template #cell-errors="{ row: whereRow }">
            <span
              class="font-mono text-xs tabular-nums"
              :class="
                isCriticalErrorRate(whereRow.errors, whereRow.calls)
                  ? 'text-status-error-text font-semibold'
                  : 'text-text-muted'
              "
            >
              <template v-if="whereRow.errorRate === null">{{ raw("—") }}</template>
              <template v-else-if="whereRow.errors <= 0">{{
                t("dbm.queries.errorsNone")
              }}</template>
              <template v-else>{{ formatPercent(whereRow.errorRate, 0) }}</template>
            </span>
          </template>
        </OTable>
      </section>

      <!-- Errors by code (FR-5). Rendered only when there ARE coded failures:
           a standing empty "no errors" card would spend prime space saying
           nothing. The counts prefer the server's exact per-code tally over the
           range; when the scope is narrower than that tally exists at, the
           section falls back to counting the sample rows below — and SAYS so,
           because a capped sample undercounts precisely when errors spike. -->
      <section
        v-if="errorClasses.length"
        class="card-container border-border-default rounded-surface flex flex-col border"
        data-test="dbm-detail-error-codes"
      >
        <div class="flex flex-wrap items-baseline gap-2 p-3 pb-1">
          <h3 class="text-text-heading text-sm font-medium">
            {{ t("dbm.detail.errorsByCode.title") }}
          </h3>
          <span class="text-text-secondary text-xs" data-test="dbm-detail-error-codes-provenance">
            {{
              errorClassesExact
                ? t("dbm.detail.errorsByCode.exactHint")
                : t("dbm.detail.errorsByCode.sampleHint")
            }}
          </span>
        </div>
        <div class="flex flex-col gap-1.5 p-3 pt-1">
          <div
            v-for="entry in errorClasses"
            :key="entry.status_code"
            class="flex items-center gap-3"
            :data-test="`dbm-detail-error-code-${entry.status_code}`"
          >
            <span class="text-text-heading w-28 shrink-0 truncate font-mono text-xs">
              {{
                entry.status_code === "unknown"
                  ? t("dbm.detail.errorsByCode.noCode")
                  : entry.status_code
              }}
            </span>
            <span class="bg-surface-subtle h-1.5 w-40 shrink-0 overflow-hidden rounded-full">
              <span
                class="bg-status-error-text block h-full rounded-full"
                :style="{ width: errorCodeBarWidth(entry) }"
              ></span>
            </span>
            <span class="text-text-body font-mono text-xs tabular-nums">
              {{ formatCount(entry.errors) }}
            </span>
          </div>
        </div>
      </section>

      <!-- The two panels below read RAW traces, so they need to know which
           trace stream this fingerprint lives on — and the queries endpoint does
           not carry it. With several streams in the org there is no way to tell,
           and picking one silently would put another stream's callers under this
           query's headline numbers. So it says so, and asks. -->
      <OBanner
        v-if="streamAmbiguous"
        variant="warning"
        class="shrink-0"
        data-test="dbm-detail-stream-ambiguous"
      >
        <div class="flex flex-wrap items-center gap-2">
          <span>{{ t("dbm.detail.ambiguousStream") }}</span>
          <OSelect
            :model-value="pickedStream"
            :options="streamOptions"
            width="sm"
            :placeholder="t('dbm.detail.pickStream')"
            data-test="dbm-detail-stream-picker"
            @update:model-value="onStreamPick"
          />
        </div>
      </OBanner>

      <!-- Calling endpoints: who is responsible for this query's load. The
           per-caller bars answer the share question ("which caller do I go
           talk to") faster than a number does. -->
      <section
        class="card-container border-border-default rounded-surface flex flex-col border"
        data-test="dbm-detail-endpoints"
      >
        <div class="flex items-center justify-between gap-2 p-3 pb-1">
          <h3 class="text-text-heading text-sm font-medium">
            {{ t("dbm.detail.endpointsTitle") }}
          </h3>
          <span class="text-text-secondary text-xs">{{ t("dbm.detail.endpointsHint") }}</span>
        </div>
        <OTable
          :data="endpoints"
          :columns="endpointColumns"
          row-key="rowKey"
          :loading="loading"
          :frame="false"
          :show-global-filter="false"
          :page-size="10"
          table-id="dbm-query-endpoints"
          data-test="dbm-detail-endpoints-table"
        >
          <template #cell-caller="{ row: endpoint }">
            <div class="flex min-w-0 flex-col">
              <span class="text-text-heading truncate text-sm">{{ endpoint.serviceLabel }}</span>
              <span v-if="endpoint.endpoint" class="text-text-secondary truncate text-xs">
                {{ endpoint.endpoint }}
              </span>
            </div>
          </template>
          <template #cell-calls="{ row: endpoint }">
            <ODataBarCell
              :value="endpoint.calls"
              :max="endpointCallsMax"
              :display="`${formatCount(endpoint.calls)} · ${formatPercent(endpoint.share)}`"
            />
          </template>
          <template #cell-errors="{ row: endpoint }">
            <span
              class="tabular-nums"
              :class="endpoint.errors > 0 ? 'text-status-error-text' : 'text-text-muted'"
            >
              {{ formatCount(endpoint.errors) }}
            </span>
          </template>
          <template #cell-p95_ns="{ row: endpoint }">
            <span class="tabular-nums">{{ formatNs(endpoint.p95_ns) }}</span>
          </template>
          <template #cell-actions="{ row: endpoint }">
            <OButton
              variant="ghost"
              size="icon-sm"
              icon-left="open-in-new"
              :data-test="`dbm-detail-endpoint-traces-${endpoint.rowKey}`"
              @click="openEndpointTraces(endpoint)"
            >
              <OTooltip side="left" :content="t('dbm.detail.viewTraces')" />
            </OButton>
          </template>
          <template #empty>
            <div v-if="!loading" class="text-text-muted p-6 text-center text-sm">
              {{ endpointsError ?? t("dbm.detail.noEndpoints") }}
            </div>
          </template>
        </OTable>
      </section>

      <!-- Query plans. Provenance is PER ROW now (W-E3): generic NULL-bound
           estimates keep the gap tag — the statement EXPLAINed with every bind
           set to NULL, never executed, no latency ever shown beside it.
           Executed auto_explain rows are the plan Postgres really ran, and
           they alone may carry a duration, labelled "across N captured
           executions" because the capture is threshold-filtered and sampled.

           Above the samples, deliberately: plans are the diagnosis, samples the
           rawest evidence, so the diagnosis reads first. -->
      <section
        ref="plansSection"
        class="card-container border-border-default rounded-surface flex flex-col border"
        data-test="dbm-detail-plans"
      >
        <div class="flex flex-wrap items-center gap-2 p-3 pb-1">
          <h3 class="text-text-heading text-sm font-medium">
            {{ t("dbm.detail.plans.title") }}
          </h3>
        </div>

        <div v-if="plansError" class="text-text-muted p-6 text-center text-sm">
          {{ plansError }}
        </div>

        <!-- Zero plans, and the two causes read oppositely. Capture off is a
             config problem the reader can fix; capture on with no plan for THIS
             statement is normal — the database cannot explain a COMMIT,
             ROLLBACK or SHOW — so it must not be blamed on config. -->
        <template v-else-if="planEmpty === 'captureOff'">
          <div class="flex flex-col gap-1 p-6 text-center">
            <span class="text-text-secondary text-sm">{{ t("dbm.detail.plans.noPlans") }}</span>
            <span class="text-text-muted text-xs">{{ t("dbm.detail.plans.noPlansHint") }}</span>
          </div>
        </template>

        <template v-else-if="planEmpty === 'noPlanForQuery'">
          <div class="flex flex-col gap-1 p-6 text-center">
            <span class="text-text-secondary text-sm">{{
              t("dbm.detail.plans.noPlanForQuery")
            }}</span>
            <span class="text-text-muted text-xs">{{
              t("dbm.detail.plans.noPlanForQueryHint")
            }}</span>
          </div>
        </template>

        <!-- Good news, not a gap: executed-plan capture is on and running, and
             no execution of this query was slow enough to be captured. Must
             never read as a config error. -->
        <template v-else-if="planEmpty === 'noExecutionCaptured'">
          <div class="flex flex-col gap-1 p-6 text-center" data-test="dbm-detail-plans-not-slow">
            <span class="text-text-secondary text-sm">{{
              t("dbm.detail.plans.noExecutionCaptured")
            }}</span>
            <span class="text-text-muted text-xs">{{
              t("dbm.detail.plans.noExecutionCapturedHint")
            }}</span>
          </div>
        </template>

        <template v-else>
          <!-- Drift leads the section when it happened; otherwise the caveat
               does, because a single stable shape is NOT an all-clear. -->
          <OBanner
            v-if="planDrift === 'drifted'"
            variant="warning"
            class="mx-3 mb-2"
            data-test="dbm-detail-plans-drift"
          >
            {{ t("dbm.detail.plans.driftCallout", { count: plans.length }) }}
          </OBanner>
          <p v-else class="text-text-muted mx-3 mb-2 text-xs" data-test="dbm-detail-plans-stable">
            {{ t("dbm.detail.plans.stableCaveat") }}
          </p>

          <div class="flex flex-col gap-3 p-3 pt-0">
            <article
              v-for="plan in plans"
              :key="plan.rowKey"
              class="border-border-default rounded-default border"
              :data-test="`dbm-detail-plan-${plan.planHash}`"
            >
              <header
                class="border-border-default flex flex-wrap items-center gap-x-4 gap-y-1 border-b p-2"
              >
                <span class="text-text-heading font-mono text-xs">{{ plan.planHash }}</span>
                <!-- Per-row provenance (E-C): only GENERIC rows keep the gap
                     tag — they are the never-executed NULL-bound estimate.
                     Executed rows are labelled as what they are instead. -->
                <OTag
                  v-if="plan.planSource === 'auto_explain'"
                  variant="success-soft"
                  size="xs"
                  :label="t('dbm.detail.plans.executedLabel')"
                  :data-test="`dbm-detail-plan-source-executed-${plan.planHash}`"
                >
                  <OTooltip side="top" :content="t('dbm.detail.plans.executedTooltip')" />
                </OTag>
                <OTag
                  v-else
                  type="dataConfidence"
                  value="gap"
                  :label="t('dbm.detail.plans.sourceLabel')"
                  :data-test="`dbm-detail-plan-source-generic-${plan.planHash}`"
                >
                  <OTooltip side="top" :content="t('dbm.detail.plans.sourceTooltip')" />
                </OTag>
                <!-- No "share of calls" here (W2): it divided this plan's calls
                     by a window total summed from a DELTA feed whose first
                     emission per statement carries the entire
                     pg_stat_statements backlog, so the percentage was a
                     proportion of a total that never described the window. -->
                <span class="text-text-muted text-xs">
                  {{ t("dbm.detail.plans.firstSeen") }}: {{ formatClock(plan.firstSeen) }}
                </span>
                <span class="text-text-muted text-xs">
                  {{ t("dbm.detail.plans.lastSeen") }}: {{ formatClock(plan.lastSeen) }}
                </span>
                <!-- Duration IFF the hit measured one — executed rows only,
                     phrased "across N captured executions": the capture is
                     threshold-filtered and possibly sampled, so this is the
                     slow tail of a sample, never "average latency". -->
                <span
                  v-if="plan.avgDurationMs !== undefined"
                  class="text-text-secondary text-xs tabular-nums"
                  :data-test="`dbm-detail-plan-duration-${plan.planHash}`"
                >
                  {{
                    t("dbm.detail.plans.capturedDurations", {
                      avg: formatNs(plan.avgDurationMs * 1e6),
                      max: formatNs((plan.maxDurationMs ?? plan.avgDurationMs) * 1e6),
                      count: plan.executions ?? 1,
                    })
                  }}
                </span>
              </header>

              <!-- A nested list indented by depth, deliberately not a flame
                   graph: a correct readable tree beats a half-built diagram. -->
              <ol v-if="plan.nodes.length" class="flex flex-col gap-0.5 p-2">
                <li
                  v-for="(node, index) in plan.nodes"
                  :key="`${plan.rowKey}-${index}`"
                  class="flex items-baseline gap-2 text-xs"
                  :class="planIndentClass(node.depth)"
                >
                  <span class="text-text-heading">{{ raw(node.nodeType) }}</span>
                  <span v-if="node.relation" class="text-text-secondary">
                    {{ raw(node.relation) }}
                  </span>
                  <span v-if="node.index" class="text-text-secondary font-mono">
                    {{ raw(node.index) }}
                  </span>
                  <span v-if="node.totalCost !== null" class="text-text-muted tabular-nums">
                    {{ t("dbm.detail.plans.nodeCost", { cost: formatCount(node.totalCost) }) }}
                  </span>
                  <!-- est → act, only where the plan measured actuals
                       (executed, log_analyze on). Estimate-vs-actual skew is
                       the highest-value signal an executed plan adds: it is
                       the root cause of most plan-choice pathologies, and the
                       generic plan cannot express it at all. -->
                  <span
                    v-if="node.actualRows !== null"
                    class="text-text-secondary tabular-nums"
                    data-test="dbm-detail-plan-est-act"
                  >
                    {{
                      t("dbm.detail.plans.estVsAct", {
                        est: formatCount(node.planRows ?? 0),
                        act: formatCount(node.actualRows),
                      })
                    }}
                  </span>
                </li>
              </ol>
              <p v-else class="text-text-muted p-2 text-xs">
                {{ t("dbm.detail.plans.noTree") }}
              </p>
            </article>
          </div>
        </template>
      </section>

      <!-- Slow samples. The scatter spreads across BOTH
           time and duration so the distribution's shape is visible, not only
           its tail. Every point pivots to its trace. -->
      <section
        class="card-container border-border-default rounded-surface flex flex-col border"
        data-test="dbm-detail-samples"
      >
        <div class="flex items-center justify-between gap-2 p-3 pb-1">
          <h3 class="text-text-heading text-sm font-medium">
            {{ t("dbm.detail.samplesTitle") }}
          </h3>
          <span class="text-text-secondary text-xs">{{ t("dbm.detail.samplesHint") }}</span>
        </div>

        <div v-if="samples.length" class="h-50 w-full px-3">
          <ChartRenderer :data="{ options: samplesOption }" @click="onSampleClick" />
        </div>

        <OTable
          :data="samples"
          :columns="sampleColumns"
          row-key="rowKey"
          :loading="loading"
          :frame="false"
          :show-global-filter="false"
          :page-size="10"
          table-id="dbm-query-samples"
          data-test="dbm-detail-samples-table"
          @row-click="openSampleTrace"
        >
          <template #cell-timestamp="{ row: sample }">
            <span class="tabular-nums">{{ formatClock(sample.timestamp) }}</span>
          </template>
          <template #cell-duration="{ row: sample }">
            <span class="tabular-nums">{{ formatNs(sample.durationNs) }}</span>
          </template>
          <template #cell-status="{ row: sample }">
            <OTag
              v-if="sample.isError"
              type="dataConfidence"
              value="gap"
              :label="t('dbm.detail.sampleError')"
            />
            <span v-else class="text-text-muted">{{ raw("—") }}</span>
          </template>
          <template #cell-actions="{ row: sample }">
            <OButton
              variant="ghost"
              size="icon-sm"
              icon-left="open-in-new"
              :data-test="`dbm-detail-sample-trace-${sample.rowKey}`"
              @click.stop="openSampleTrace(sample)"
            >
              <OTooltip side="left" :content="t('dbm.detail.viewTrace')" />
            </OButton>
          </template>
          <template #empty>
            <div v-if="!loading" class="text-text-muted p-6 text-center text-sm">
              {{ samplesError ?? t("dbm.detail.noSamples") }}
            </div>
          </template>
        </OTable>
      </section>
    </div>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";

import DbmCoverageLine from "@/components/dbm/DbmCoverageLine.vue";
import DbmQueryText from "@/components/dbm/DbmQueryText.vue";
import DbmSuggestFixButton from "@/components/dbm/DbmSuggestFixButton.vue";
import DateTime from "@/components/DateTime.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import ODataBarCell from "@/lib/core/Table/cells/ODataBarCell.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectModelValue, SelectOption } from "@/lib/forms/Select/OSelect.types";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import dbMonitoringService, {
  type EndpointRow,
  type ErrorCodeCount,
  type Freshness,
  type QueryStatsRow,
} from "@/services/db_monitoring";
import searchService from "@/services/search";
import { toast } from "@/lib/feedback/Toast/useToast";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { takeDbmQueryDetailSeed } from "@/composables/dbm/dbmQueryDetailSeed";
import { useDbmRequestSeq } from "@/composables/dbm/useDbmRequestSeq";
import { useDbmScope, type DbmDateChange } from "@/composables/dbm/useDbmScope";
import useStreams from "@/composables/useStreams";
import {
  contextRegistry,
  createDbmContextProvider,
  DBM_CONTEXT_KEY,
} from "@/composables/contextProviders";
import { chartColor } from "@/utils/chartTheme";
import { buildQueryFixPrompt } from "@/utils/dbm/aiPrompts";
import { DBM_SETUP_ROUTE } from "@/utils/dbm/emptyAction";
import {
  planDriftLevel,
  planEmptyReason,
  planIndentClass,
  planRows,
  type PlanDriftLevel,
  type PlanRow,
} from "@/utils/dbm/plans";
import {
  formatCount,
  formatNs,
  formatPercent,
  formatSignedPercent,
  oneLine,
} from "@/utils/dbm/format";
import {
  readServerMetrics,
  serverMetricsTiles,
  type DbmServerMetrics,
} from "@/utils/dbm/serverMetrics";
import { buildHistorySeries, errorRateValues, qpsValues, seriesValues } from "@/utils/dbm/history";
import {
  buildWhereItRunsRows,
  isWhereRowActive,
  whereRowClickScope,
  type QueryBreakdownRow,
  type WhereItRunsRow,
  type WhereItRunsScope,
} from "@/utils/dbm/whereItRuns";
import { buildSamplesOption, type DbmChartTheme } from "@/utils/dbm/historyChart";
import {
  buildHistoryRows,
  buildInjectedHistoryData,
  buildLatencyPanelSchema,
  buildVolumePanelSchema,
} from "@/utils/dbm/historyPanelSchema";
import { buildIncidentSummary } from "@/utils/dbm/incidentSummary";
import { deltaFor, isCriticalErrorRate } from "@/utils/dbm/insights";
import { escapeSingleQuotes } from "@/utils/zincutils";

const ChartRenderer = defineAsyncComponent(
  () => import("@/components/dashboards/panels/ChartRenderer.vue"),
);
const PanelSchemaRenderer = defineAsyncComponent(
  () => import("@/components/dashboards/PanelSchemaRenderer.vue"),
);

/** `HISTORY_BACKFILL_MAX_WINDOWS` in api.rs — printed in the capped disclosure. */
const BACKFILL_MAX_WINDOWS = 6;
/** Enough to show a distribution without turning the scatter into a smear. */
const SAMPLE_LIMIT = 100;
/**
 * Rows pulled when locating this fingerprint's row in the scope. The match is a
 * client-side find, so a fingerprint ranked below this is not found at all —
 * generous on purpose, and still one bounded response.
 */
const ROW_LOOKUP_LIMIT = 500;
/**
 * Rollup interval assumed until the real one is inferred from the gaps between
 * history points. Matches `ZO_DB_MONITORING_INTERVAL_SECS`' 900s default, so the
 * first paint of QPS and the band merge are right in the common case.
 */
const DEFAULT_INTERVAL_MICROS = 15 * 60 * 1_000_000;
/**
 * Phrasing cutoffs for a change figure. Under the deadband we say "about the
 * same" rather than print noise; at or above the multiple we switch from a
 * percentage to "N× more", which reads better once a number stops being a
 * percentage anyone can picture; past the round-off point the decimal is
 * spurious precision.
 */
const DELTA_PHRASING = { deadband: 0.05, timesFrom: 2, roundFrom: 10 } as const;

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();
const { getStreams } = useStreams(t);

// This page is a route root, so MainLayout's `@sendToAiChat` binding is on it
// directly — no re-emit chain needed.
const emit = defineEmits<{
  (e: "sendToAiChat", value: { query: string; autoSend: boolean }): void;
}>();

const { range, current, previous, refresh, setRange, queryParams } = useDbmScope(route.query);

// The picker, a stream pick and a manual refresh can all be in flight together;
// this is what stops one stream's callers landing under another's headline.
const requestSeq = useDbmRequestSeq();

const fingerprint = computed(() => String(route.query.fingerprint ?? ""));

/**
 * Which traces stream to read the callers and samples from.
 *
 * The queries endpoint does NOT currently return `trace_stream_name` on its
 * rows, so the param the list page forwards is often empty. Falling back to
 * the conventional `"default"` stream is the one thing this must not do: in a
 * deployment with several trace streams that silently attributes ANOTHER
 * stream's callers and samples to this fingerprint's headline numbers, and it
 * does not error — it returns plausible rows. Wrong attribution in the exact
 * place a user decides what to fix.
 *
 * So the stream is RESOLVED rather than guessed. With exactly one trace stream
 * in the org there is no ambiguity and it is used; with several, the panels say
 * they cannot tell which stream this query belongs to and offer the choice,
 * rather than picking one and presenting the result as authoritative.
 */
const streamParam = computed(() => (route.query.stream as string) || "");
/** Trace streams in this org, for resolving an unspecified stream. */
const traceStreams = ref<string[]>([]);
const streamsLoaded = ref(false);
/** Chosen in the disclosure below the panels when the org has several. */
const pickedStream = ref<string>("");
const systemFilter = computed(() => (route.query.system as string) ?? undefined);
const instanceFilter = computed(() => (route.query.instance as string) ?? undefined);
const namespaceFilter = computed(() => (route.query.namespace as string) ?? undefined);

const row = ref<QueryStatsRow | null>(null);
/** Whether the CLIENT fetch found this query — a painted seed does not count. */
const clientRowFound = ref(false);
const previousRow = ref<QueryStatsRow | null>(null);
/**
 * The clicked row the queries list handed off, when this page was opened from
 * it under the SAME org/fingerprint/window (see `dbmQueryDetailSeed`). One
 * shot: the next `load()` consumes it, so a window change or a refresh always
 * fetches cold. `null` on a deep link, a reload, or a mismatched hand-off —
 * those take the full sequential fetch.
 */
const seedRow = ref<QueryStatsRow | null>(null);
/**
 * Whether the scope-dependent figures — the share of database, the two deltas
 * — have been computed by THIS page's fetch. A seeded first paint shows the
 * row's own numbers immediately, but the share and deltas depend on the
 * detail's scope (`stmtClass: "all"`, this instance) and previous window, so
 * until the fetch lands their caption lines stay blank rather than claiming
 * `0%` or "new".
 */
const rowStatsReady = ref(false);
/**
 * W6 — what the database itself recorded for this statement.
 *
 * Holds only what a read RETURNED; `serverMetricsRead` below says whether a
 * read has answered at all. The split matters: an empty envelope standing in
 * for in-flight and failed reads too would put one `off` sentence over three
 * situations — and send a reader whose request merely failed off to
 * reconfigure a collector that was fine.
 */
const serverMetrics = ref<DbmServerMetrics>(readServerMetrics(null));
/**
 * The read's lifecycle, apart from its result. `off` — like every other claim
 * about capture — may render only once a read has actually answered (`done`);
 * `failed` renders its own could-not-be-read line, which claims nothing about
 * whether capture is running.
 */
const serverMetricsRead = ref<"loading" | "failed" | "done">("loading");
const serverTiles = computed(() => serverMetricsTiles(serverMetrics.value));
const freshness = ref<Freshness | null>(null);
const topNSubset = ref(false);
const scopeTotalNs = ref(0);
const otherShare = ref<number | undefined>(undefined);
const history = ref<ReturnType<typeof buildHistorySeries> | null>(null);
/**
 * The rollup's EXACT per-status-code error counts, from the history response.
 * Empty either when there were no coded errors or when the scope was narrower
 * than the counts exist at — `errorClasses` below then falls back to the
 * sample-derived approximation and the section labels itself accordingly.
 */
const exactErrorClasses = ref<ErrorCodeCount[]>([]);
/**
 * Per-(instance, namespace) totals for this fingerprint, from the history
 * response — the "Where it runs" section. Tracked windows only (see the
 * response contract), so the section's copy presents them as at-least totals.
 */
const breakdownRows = ref<QueryBreakdownRow[]>([]);
const intervalMicros = ref(DEFAULT_INTERVAL_MICROS);
const endpoints = ref<EndpointCallerRow[]>([]);
const endpointsError = ref<string | null>(null);
const plans = ref<PlanRow[]>([]);

/**
 * Whether the database's own sections are carrying this page — server
 * counters matched or plans present. Gates the client coverage line on a
 * server-vantage-only entry, where "nothing to measure" would sit directly
 * under a section full of measurements.
 */
const serverAnswering = computed(
  () => serverMetrics.value.state === "matched" || plans.value.length > 0,
);
const planDrift = ref<PlanDriftLevel>("none");
/** Why the section is empty, when it is — see `planEmptyReason`. */
const planEmpty = ref<ReturnType<typeof planEmptyReason>>("captureOff");
const plansError = ref<string | null>(null);
/** Anchor for the promoted drift callout's "View plans" jump. */
const plansSection = ref<HTMLElement | null>(null);
/**
 * The top callout promotes the drift FINDING; the plan evidence stays in its
 * section below, so the action is a jump rather than a second rendering.
 */
const scrollToPlans = () => {
  plansSection.value?.scrollIntoView({ behavior: "smooth", block: "start" });
};
const samples = ref<SampleRow[]>([]);
const samplesError = ref<string | null>(null);
const loading = ref(false);

const org = computed(() => store.state.selectedOrganization?.identifier as string);

interface EndpointCallerRow extends EndpointRow {
  rowKey: string;
  serviceLabel: I18nText;
  /** Share of this fingerprint's calls, `0`–`1`. */
  share: number;
}

interface SampleRow {
  rowKey: string;
  /** Span start, microseconds. */
  timestamp: number;
  /** Converted from the raw `duration` column (µs) at the boundary. */
  durationNs: number;
  traceId: string;
  isError: boolean;
  statusCode: string;
}

/**
 * Where "back" goes: the tab the reader drilled in FROM (`?from=`), not a
 * hardcoded Top queries. Four origins navigate here — Top queries, Activity,
 * Slowest calls, Deadlocks — and handing an Activity reader back to Top
 * queries strands them on a tab they never stood on. An absent or unknown
 * `from` falls back to Top queries, the detail page's natural parent (deep
 * links and the traces-side entry point carry no origin).
 */
const backTarget = computed(() => {
  const targets: Record<string, { name: string; label: I18nText }> = {
    queries: { name: "dbmQueries", label: t("dbm.detail.backToQueries") },
    activity: { name: "dbmActivity", label: t("dbm.detail.backToActivity") },
    samples: { name: "dbmSamples", label: t("dbm.detail.backToSamples") },
    deadlocks: { name: "dbmDeadlocks", label: t("dbm.detail.backToDeadlocks") },
  };
  const origin = targets[(route.query.from as string) ?? ""] ?? targets.queries;
  return {
    label: origin.label,
    to: {
      name: origin.name,
      query: {
        org_identifier: route.query.org_identifier,
        ...queryParams.value,
        system: systemFilter.value,
        instance: instanceFilter.value,
        namespace: namespaceFilter.value,
      },
    },
  };
});

const queryText = computed(() => oneLine(row.value?.query_norm) || fingerprint.value);

const identityChips = computed(() => {
  const chips: { key: string; label: I18nText }[] = [];
  const current = row.value;
  if (!current) return chips;
  if (current.db_instance) chips.push({ key: "instance", label: raw(current.db_instance) });
  if (current.db_namespace) chips.push({ key: "namespace", label: raw(current.db_namespace) });
  if (current.env) chips.push({ key: "env", label: raw(current.env) });
  if (current.operation) chips.push({ key: "operation", label: raw(current.operation) });
  // The internal query id is deliberately NOT shown. It is an implementation
  // detail with no meaning to a DBA, it looks like something they should
  // recognise, and it is already in the URL for anyone who needs it.
  return chips;
});

/**
 * "First seen in top queries" — never "first executed".
 *
 * The series starts at the first window this fingerprint ranked INTO the
 * top-N, which is not when the query first ran. A long-lived query pushed over
 * the cut by a traffic shift would otherwise be labelled new, and mislabeling
 * it is the fastest way this page loses a DBA's trust.
 */
const firstSeenLabel = computed(() => {
  const first = history.value?.points.find((point) => point.plottable);
  if (!first) return null;
  return t("dbm.detail.firstSeen", { time: formatClock(first.timestamp) });
});

/**
 * "Last seen" under the same contract as first-seen: the latest point where
 * this fingerprint was tracked individually (the live point counts — it is the
 * most recent tracked activity). Suppressed when it would restate first-seen's
 * timestamp: one tracked window means the two chips would print one fact twice.
 */
const lastSeenLabel = computed(() => {
  const points = history.value?.points ?? [];
  const first = points.find((point) => point.plottable);
  const last = [...points].reverse().find((point) => point.plottable);
  if (!first || !last || last.timestamp === first.timestamp) return null;
  return t("dbm.detail.lastSeen", { time: formatClock(last.timestamp) });
});

const hasSeries = computed(() => (history.value?.points.length ?? 0) > 0);

const formatClock = (micros: number): string =>
  new Date(Math.floor(micros / 1000)).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

// ─── Charts ──────────────────────────────────────────────────────────────────

/**
 * The two history charts render through `PanelSchemaRenderer` — the shared
 * dashboard engine — rather than a hand-built ECharts option, so they inherit
 * the app's units, axes, legend, tooltip, timezone and theming. The series are
 * computed here from the classified history rather than by a query, so they
 * reach the renderer through its pre-fetched-results injection path. See
 * `utils/dbm/historyPanelSchema.ts` for why that path is the right one.
 */
const latencyPanelSchema = computed(() =>
  buildLatencyPanelSchema({
    p50: t("dbm.detail.columns.p50"),
    p95: t("dbm.queries.columns.p95"),
    p99: t("dbm.queries.columns.p99"),
    time: t("dbm.detail.columns.time"),
  }),
);

const volumePanelSchema = computed(() =>
  buildVolumePanelSchema({
    qps: t("dbm.detail.qps"),
    errorRate: t("dbm.detail.errorRate"),
    time: t("dbm.detail.columns.time"),
  }),
);

/**
 * The window the renderer pins the time axis to. MICROSECONDS straight into
 * `new Date()` — the dashboard pipeline's convention. Dividing by 1000 yields a
 * correct-looking Date whose getTime() is in ms, which the converter then
 * misreads and the chart renders empty.
 */
const selectedTimeObj = computed(() => ({
  start_time: new Date(current.value.startTime),
  end_time: new Date(current.value.endTime),
}));

const latencyInjectedData = computed(() => {
  const series = history.value;
  if (!series) return undefined;
  return buildInjectedHistoryData(
    buildHistoryRows(series.points, {
      p50: seriesValues(series.points, "p50_ns"),
      p95: seriesValues(series.points, "p95_ns"),
      p99: seriesValues(series.points, "p99_ns"),
    }),
    current.value,
  );
});

const volumeInjectedData = computed(() => {
  const series = history.value;
  if (!series) return undefined;
  return buildInjectedHistoryData(
    buildHistoryRows(series.points, {
      qps: qpsValues(series.points, intervalMicros.value),
      // Emitted as a PERCENTAGE number rather than the 0–1 ratio, so the rate
      // shares a legible scale with the call bars on the panel's single value
      // axis instead of flattening into the baseline.
      error_rate: errorRateValues(series.points).map((rate) => (rate === null ? null : rate * 100)),
    }),
    current.value,
  );
});

// ─── Samples scatter ─────────────────────────────────────────────────────────

/**
 * The samples scatter stays a hand-built ECharts option (the sanctioned
 * escape hatch) for ONE reason: `PanelSchemaRenderer` does not re-emit chart
 * clicks. It binds ChartRenderer's `@click` to its own drilldown handler and
 * its `emits` list carries no `click`, so a point click is consumed internally.
 * This scatter exists to pivot to the clicked execution's trace — that pivot is
 * the panel's whole purpose, and routing it through a dashboard drilldown would
 * mean configuring a URL template instead of calling `openSampleTrace`.
 * Convert this the moment PanelSchemaRenderer forwards `click`.
 */

/**
 * Read the registered `--color-*` tokens so the scatter follows the theme.
 * ECharts renders to a canvas with no CSS cascade, so a class cannot reach it —
 * the token has to be resolved to a value and handed over. `chartColor` is the
 * sanctioned seam for that (it owns the light-theme fallbacks used before the
 * token stylesheet is live), so no colour is spelled out here. Depends on the
 * theme state so the colours re-resolve on a light/dark flip.
 */
const chartTheme = computed<Pick<DbmChartTheme, "calls" | "errors" | "axisLabel" | "splitLine">>(
  () => {
    void store.state.theme;
    return {
      calls: chartColor("--color-chart-series-1"),
      errors: chartColor("--color-severity-error-color"),
      axisLabel: chartColor("--color-text-secondary"),
      splitLine: chartColor("--color-border-default"),
    };
  },
);

const samplesOption = computed(() =>
  buildSamplesOption(samples.value, chartTheme.value, formatNs, formatClock, {
    ok: t("dbm.detail.sampleOk"),
    error: t("dbm.detail.sampleError"),
  }),
);

// ─── Headline stats ──────────────────────────────────────────────────────────

/**
 * The six numbers that answer minute 0. Each carries a second line saying what
 * it is worth: whether it changed, whether it is exact, whether "none" means
 * no failures or no visibility. A big number with no qualifier is the thing
 * that gets quoted in an incident channel and then walked back.
 */
const headlineStats = computed(() => {
  const current = row.value;
  const share = scopeTotalNs.value > 0 ? (current?.total_time_ns ?? 0) / scopeTotalNs.value : 0;
  const calls = current?.calls ?? 0;
  const errors = current?.errors ?? 0;
  const callsChange = deltaFor(current?.calls, previousRow.value?.calls);
  const latencyChange = deltaFor(current?.p95_ns, previousRow.value?.p95_ns);

  const changeWords = (delta: ReturnType<typeof deltaFor>): I18nText => {
    if (delta.state !== "changed" || delta.ratio === undefined) return t("dbm.delta.new");
    if (Math.abs(delta.ratio) < DELTA_PHRASING.deadband) return t("dbm.delta.noChange");
    const factor = 1 + delta.ratio;
    if (factor >= DELTA_PHRASING.timesFrom)
      return t("dbm.delta.timesMore", {
        ratio: factor >= DELTA_PHRASING.roundFrom ? Math.round(factor) : factor.toFixed(1),
      });
    return raw(formatSignedPercent(delta.ratio));
  };

  // On a seeded first paint the VALUES are the clicked row's and correct, but
  // the share and the deltas are this page's own scope arithmetic and have not
  // been computed yet — their caption lines stay blank until the fetch lands,
  // because "0% of database" and "new" are claims, not placeholders.
  return [
    {
      id: "load",
      label: t("dbm.detail.stats.load"),
      sub: undefined,
      value: raw(formatNs(current?.total_time_ns)),
      detail: rowStatsReady.value
        ? t("dbm.detail.stats.loadShare", { percent: formatPercent(share, 0) })
        : raw(""),
      tone: "",
    },
    {
      id: "calls",
      label: t("dbm.detail.stats.calls"),
      sub: undefined,
      value: raw(formatCount(calls)),
      detail: rowStatsReady.value
        ? t("dbm.detail.stats.callsDelta", { change: changeWords(callsChange) })
        : raw(""),
      tone: "",
    },
    {
      id: "p50",
      label: t("dbm.detail.stats.p50"),
      sub: raw("p50"),
      value: raw(formatNs(current?.p50_ns)),
      // Per-query percentiles are combined across windows rather than
      // recomputed, so they are close but not exact — and the stat says so
      // instead of leaving the reader to assume precision it does not have.
      detail: t("dbm.detail.stats.approx"),
      tone: "",
    },
    {
      id: "p95",
      label: t("dbm.detail.stats.p95"),
      sub: raw("p95"),
      value: raw(formatNs(current?.p95_ns)),
      detail: rowStatsReady.value ? changeWords(latencyChange) : raw(""),
      tone: "",
    },
    {
      id: "max",
      label: t("dbm.detail.stats.max"),
      sub: raw("max"),
      value: raw(formatNs(current?.max_ns)),
      // A maximum is a real observed call, never a fused estimate.
      detail: t("dbm.detail.stats.exact"),
      tone: "",
    },
    {
      id: "errors",
      label: t("dbm.detail.stats.errors"),
      sub: undefined,
      value:
        errors <= 0
          ? t("dbm.queries.errorsNone")
          : calls > 0 && errors >= calls
            ? t("dbm.queries.errorsAll")
            : raw(formatCount(errors)),
      detail: errors <= 0 ? t("dbm.detail.stats.noErrors") : t("dbm.detail.stats.exact"),
      // Red only past a real failure RATE — reddening on any error at all
      // would make one failure in a million read as loudly as a total outage.
      tone: isCriticalErrorRate(errors, calls) ? "text-status-error-text" : "text-text-label",
    },
  ];
});

// ─── Coverage inputs ─────────────────────────────────────────────────────────

/**
 * Share of errors with no driver status code, computed from the samples we
 * actually read. It is a sample-based estimate, and the drawer copy says so.
 */
const uncodedErrorShare = computed(() => {
  const errored = samples.value.filter((sample) => sample.isError);
  if (!errored.length) return undefined;
  const uncoded = errored.filter((sample) => !sample.statusCode || sample.statusCode === "unknown");
  return uncoded.length / errored.length;
});

// ─── Endpoint table ──────────────────────────────────────────────────────────

const endpointCallsMax = computed(() =>
  endpoints.value.reduce((max, endpoint) => Math.max(max, endpoint.calls), 0),
);

const endpointColumns = computed<OTableColumnDef<EndpointCallerRow>[]>(() => [
  {
    id: "caller",
    header: t("dbm.detail.columns.caller"),
    size: 320,
    sortable: false,
    meta: { isName: true },
  },
  {
    id: "calls",
    header: t("dbm.detail.columns.callShare"),
    accessorKey: "calls",
    size: 220,
    sortable: true,
  },
  {
    id: "errors",
    header: t("dbm.queries.columns.errors"),
    accessorKey: "errors",
    size: 100,
    sortable: true,
    meta: { align: "right" },
  },
  {
    id: "p95_ns",
    header: t("dbm.queries.columns.p95"),
    accessorKey: "p95_ns",
    size: 110,
    sortable: true,
    meta: {
      align: "right",
      headerSubLabel: raw("p95"),
      headerTooltip: t("dbm.queries.columnHints.p95"),
    },
  },
  { id: "actions", header: raw(""), size: 60, isAction: true },
]);

// ─── Where it runs ───────────────────────────────────────────────────────────

const whereRows = computed<WhereItRunsRow[]>(() => buildWhereItRunsRows(breakdownRows.value));

/** The page's current dimension focus, straight from the URL. */
const whereScope = computed<WhereItRunsScope>(() => ({
  instance: instanceFilter.value || undefined,
  namespace: namespaceFilter.value || undefined,
}));

const whereScopeActive = computed(
  () => Boolean(whereScope.value.instance) || Boolean(whereScope.value.namespace),
);

/**
 * Bar scale: the heaviest INSTANCE. Children draw against the same max, so a
 * namespace's bar is directly comparable with its parent's — both are shares
 * of this query's tracked time.
 */
const whereTimeMax = computed(() =>
  whereRows.value
    .filter((entry) => !entry.isChild)
    .reduce((max, entry) => Math.max(max, entry.totalTimeNs), 0),
);

/**
 * Sorting is off on every column, deliberately: the rows are a tree flattened
 * in ranked order, and sorting the flat list would tear namespaces away from
 * their instance — the same reasoning as the databases overview.
 */
const whereColumns = computed<OTableColumnDef<WhereItRunsRow>[]>(() => [
  {
    id: "location",
    header: t("dbm.detail.whereItRuns.columns.location"),
    size: 320,
    sortable: false,
    meta: { isName: true },
  },
  { id: "load", header: t("dbm.queries.columns.load"), size: 220, sortable: false },
  {
    id: "calls",
    header: t("dbm.detail.columns.calls"),
    accessorKey: "calls",
    size: 110,
    sortable: false,
    meta: { align: "right" },
  },
  {
    id: "avg",
    header: t("dbm.detail.whereItRuns.columns.avg"),
    size: 120,
    sortable: false,
    meta: { align: "right" },
  },
  {
    id: "errors",
    header: t("dbm.queries.columns.errors"),
    size: 110,
    sortable: false,
    meta: { align: "right" },
  },
]);

/**
 * Move the page to a new dimension focus. The filters live in the URL (they
 * are the same `instance`/`namespace` params the list page hands over), so the
 * route updates first — every computed reads from it — and then the page
 * refetches under the new scope. `undefined` values drop their key, which is
 * how vue-router clears a param.
 */
const applyWhereScope = async (scope: WhereItRunsScope) => {
  await router
    .replace({
      query: { ...route.query, instance: scope.instance, namespace: scope.namespace },
    })
    .catch(() => {});
  await load();
};

const onWhereRowClick = (whereRow: WhereItRunsRow) => {
  // Rows with an unreported dimension return null here — visible, never a
  // filter (see the section comment in the template).
  const next = whereRowClickScope(whereRow, whereScope.value);
  if (next) void applyWhereScope(next);
};

const clearWhereScope = () => {
  void applyWhereScope({ instance: undefined, namespace: undefined });
};

const sampleColumns = computed<OTableColumnDef<SampleRow>[]>(() => [
  {
    id: "timestamp",
    header: t("dbm.detail.columns.time"),
    accessorKey: "timestamp",
    size: 140,
    sortable: true,
  },
  {
    id: "duration",
    header: t("dbm.detail.columns.duration"),
    accessorKey: "durationNs",
    size: 140,
    sortable: true,
    meta: { align: "right" },
  },
  { id: "status", header: t("dbm.detail.columns.status"), size: 120, sortable: false },
  { id: "actions", header: raw(""), size: 60, isAction: true },
]);

// ─── Loading ─────────────────────────────────────────────────────────────────

/**
 * The trace stream this fingerprint lives on, in descending order of authority:
 * the URL, the row itself, the user's explicit pick, and finally the org's only
 * trace stream — which is unambiguous precisely because there is no other one it
 * could be. Never a hardcoded name.
 */
const traceStream = computed(
  () =>
    streamParam.value ||
    row.value?.trace_stream_name ||
    pickedStream.value ||
    (traceStreams.value.length === 1 ? traceStreams.value[0] : ""),
);

/**
 * True when the org has several trace streams and nothing has told us which one
 * carries this fingerprint. The panels below disclose it and offer the choice
 * instead of rendering another stream's rows under this query's headline.
 */
const streamAmbiguous = computed(
  () => streamsLoaded.value && !traceStream.value && traceStreams.value.length > 1,
);

const loadTraceStreams = async () => {
  try {
    const response = (await getStreams("traces", false, false)) as { list?: { name: string }[] };
    traceStreams.value = (response?.list ?? []).map((stream) => stream.name).filter(Boolean);
  } catch {
    traceStreams.value = [];
  } finally {
    streamsLoaded.value = true;
  }
};

/**
 * A stream name safe to interpolate as a table name.
 *
 * The allowlist is the authority — a name the org actually has cannot be an
 * injection. The shape check is the fallback for when the stream list could not
 * be fetched: OpenObserve stream names are identifiers, so anything carrying a
 * quote, a space or a semicolon is not one and is refused.
 */
const isSafeStreamName = (name: string): boolean => {
  if (!name) return false;
  if (traceStreams.value.includes(name)) return true;
  return /^[A-Za-z0-9_-]+$/.test(name);
};

const streamOptions = computed<SelectOption[]>(() =>
  traceStreams.value.map((name) => ({ label: raw(name), value: name })),
);

/**
 * Picking a stream re-reads the panels that depend on it; history follows too.
 *
 * All three share ONE token, so picking A then B voids A's three responses
 * together — without it, A's callers and samples land under B-labelled headline
 * stats, which is the mis-attribution the stream-resolution design exists to
 * prevent.
 */
const onStreamPick = (value: SelectModelValue) => {
  pickedStream.value = typeof value === "string" ? value : "";
  const token = requestSeq.begin();
  void Promise.all([
    loadHistory(token),
    loadEndpoints(token),
    loadSamples(token),
    loadPlans(token),
  ]);
};

const load = async () => {
  if (!org.value || !fingerprint.value) return;
  const token = requestSeq.begin();
  // One shot: only THIS load may answer with the hand-off. Every later load —
  // a window change, a refresh — starts cold, so a seed can never outlive the
  // window it was fetched under.
  const seed = seedRow.value;
  seedRow.value = null;
  loading.value = true;
  rowStatsReady.value = false;
  refresh();

  // The stream list exists to RESOLVE an unknown stream (and to feed the
  // picker when the org has several). When the stream traveled in the URL or
  // on the seeded row it is already resolved, so the fetch would answer a
  // question nobody is asking — skipped. `isSafeStreamName`'s identifier-shape
  // fallback still guards the interpolation the allowlist normally covers.
  const streamKnown = Boolean(streamParam.value || seed?.trace_stream_name);
  const streamsSettled = streamKnown ? Promise.resolve() : loadTraceStreams();

  try {
    if (seed) {
      // Seeded entry: the row paints NOW, and everything the panel batch used
      // to wait on — the trace stream, the server-metrics join key — is on the
      // seed already. The row fetch refines (share, deltas, freshness) rather
      // than gates, so the whole page loads in one concurrent wave.
      row.value = seed;
      await Promise.all([
        loadRow(token, seed),
        loadServerMetrics(token),
        streamsSettled.then(() =>
          Promise.all([
            loadHistory(token),
            loadEndpoints(token),
            loadSamples(token),
            loadPlans(token),
          ]),
        ),
      ]);
    } else {
      // Cold entry (deep link, reload, window change): history needs the
      // stream resolved from the row, and endpoints/samples need it too — so
      // both the row and the stream list are settled before the panels run.
      // The stream list is what lets an unspecified stream resolve to the
      // org's only one instead of being guessed.
      await Promise.all([loadRow(token), streamsSettled]);
      if (requestSeq.isStale(token)) return;
      await Promise.all([
        loadHistory(token),
        loadEndpoints(token),
        loadSamples(token),
        loadPlans(token),
        // Runs in this batch rather than the one above: the join key comes
        // from the row's engine and database, so it needs `loadRow` to have
        // landed.
        loadServerMetrics(token),
      ]);
    }
  } finally {
    if (!requestSeq.isStale(token)) loading.value = false;
  }
};

/**
 * The fingerprint's row, plus the same row in the previous window for the
 * deltas the incident summary quotes — both from ONE request. The previous
 * window rides the endpoint's baseline contract (`baseline_start_time` /
 * `baseline_end_time`, the same one the list page uses), which reads the two
 * windows server-side under the same filters — exactly what two sequential
 * calls did here before, minus a round trip. Either way the result is filtered
 * client-side to the exact fingerprint rather than trusting a text match.
 */
const loadRow = async (token: number = requestSeq.current(), seed: QueryStatsRow | null = null) => {
  const response = await dbMonitoringService.getQueries(org.value, {
    system: systemFilter.value,
    instance: instanceFilter.value,
    namespace: namespaceFilter.value,
    stream: streamParam.value || undefined,
    stmtClass: "all",
    limit: ROW_LOOKUP_LIMIT,
    startTime: current.value.startTime,
    endTime: current.value.endTime,
    baselineStartTime: previous.value.startTime,
    baselineEndTime: previous.value.endTime,
  });

  // A newer window or stream pick already owns the page.
  if (requestSeq.isStale(token)) return;

  const hits = response.data.hits ?? [];
  const others = response.data.other ?? [];
  // A miss here can be a rank below `ROW_LOOKUP_LIMIT`, not proof of absence.
  // When this load was seeded, the seed answered the SAME window — falling
  // back to it keeps the page painted rather than flashing away the row the
  // reader just clicked. On a cold load there is no seed: no row, no claim.
  const fetched = hits.find((hit) => hit.fingerprint === fingerprint.value) ?? null;
  // A seed painting the header is NOT client data: a server-vantage entry
  // (Activity, the database-reported lists) seeds text and dimensions with no
  // client row anywhere. The coverage gate keys on what the FETCH found.
  clientRowFound.value = fetched !== null;
  row.value = fetched ?? seed ?? null;
  // A server-side baseline failure degrades the deltas to "no baseline" rather
  // than comparing against an empty set it would misread as change.
  const baselineHits = response.data.baseline_read_failed
    ? []
    : (response.data.baseline_hits ?? []);
  previousRow.value = baselineHits.find((hit) => hit.fingerprint === fingerprint.value) ?? null;
  freshness.value = response.data.freshness;
  topNSubset.value = response.data.top_n_subset;

  const sum = (rows: QueryStatsRow[]) =>
    rows.reduce((acc, entry) => acc + (entry.total_time_ns ?? 0), 0);
  scopeTotalNs.value = sum(hits) + sum(others);
  otherShare.value =
    scopeTotalNs.value > 0 && !response.data.top_n_subset
      ? sum(others) / scopeTotalNs.value
      : undefined;
  rowStatsReady.value = true;
};

const loadHistory = async (token: number = requestSeq.current()) => {
  try {
    const response = await dbMonitoringService.getQueryHistory(org.value, {
      fingerprint: fingerprint.value,
      startTime: current.value.startTime,
      endTime: current.value.endTime,
      stream: traceStream.value || undefined,
      system: systemFilter.value,
      instance: instanceFilter.value,
      namespace: namespaceFilter.value,
    });

    if (requestSeq.isStale(token)) return;

    const series = response.data.series ?? [];
    // The rollup interval is not in the payload; infer it from the gap between
    // consecutive windows so band merging and QPS use the real window length
    // rather than a hardcoded guess that breaks on a non-default config.
    const gaps = series
      .slice(1)
      .map((point, index) => point.timestamp - series[index].timestamp)
      .filter((gap) => gap > 0);
    if (gaps.length) intervalMicros.value = Math.min(...gaps);

    history.value = buildHistorySeries(series, {
      intervalMicros: intervalMicros.value,
      backfillCapped: response.data.backfill_capped,
    });
    exactErrorClasses.value = response.data.error_classes ?? [];
    breakdownRows.value = response.data.breakdown ?? [];
  } catch {
    if (requestSeq.isStale(token)) return;
    history.value = null;
    exactErrorClasses.value = [];
    breakdownRows.value = [];
  }
};

const loadEndpoints = async (token: number = requestSeq.current()) => {
  endpointsError.value = null;
  if (!traceStream.value) {
    // The endpoint 400s without a stream, so the reason is stated rather than
    // showing an empty table that looks like "no callers" — or, worse, rows
    // read from whichever stream happened to be named `default`.
    if (requestSeq.isStale(token)) return;
    endpointsError.value = streamAmbiguous.value
      ? t("dbm.detail.ambiguousStream")
      : t("dbm.detail.noStream");
    endpoints.value = [];
    return;
  }

  try {
    const response = await dbMonitoringService.getQueryEndpoints(org.value, {
      fingerprint: fingerprint.value,
      stream: traceStream.value,
      startTime: current.value.startTime,
      endTime: current.value.endTime,
    });
    if (requestSeq.isStale(token)) return;

    const hits = response.data.hits ?? [];
    const totalCalls = hits.reduce((acc, hit) => acc + (hit.calls ?? 0), 0);

    endpoints.value = hits.map((hit, index) => ({
      ...hit,
      rowKey: `${hit.service_name ?? "null"}-${hit.endpoint ?? "null"}-${index}`,
      // A null caller is a real result: the DB span's trace root fell outside
      // the window or is missing, so the call is genuinely unattributed.
      serviceLabel: hit.service_name ? raw(hit.service_name) : t("dbm.detail.unattributed"),
      share: totalCalls > 0 ? (hit.calls ?? 0) / totalCalls : 0,
    }));
  } catch (err: unknown) {
    if (requestSeq.isStale(token)) return;
    endpointsError.value = errorMessage(err);
    endpoints.value = [];
  }
};

/**
 * Distinct captured plans for this query.
 *
 * Unlike the endpoints read above, this needs no trace stream: plans are
 * server-vantage records and the handler defaults to the shared logs stream.
 */
const loadPlans = async (token: number = requestSeq.current()) => {
  plansError.value = null;
  try {
    const { data } = await dbMonitoringService.getQueryPlans(org.value, {
      fingerprint: fingerprint.value,
      startTime: current.value.startTime,
      endTime: current.value.endTime,
    });
    if (requestSeq.isStale(token)) return;
    plans.value = planRows(data);
    planDrift.value = planDriftLevel(data);
    planEmpty.value = planEmptyReason(data);
  } catch (err: unknown) {
    if (requestSeq.isStale(token)) return;
    plansError.value = errorMessage(err);
    plans.value = [];
    planDrift.value = "none";
    // The error branch renders instead of the empty state, so this only has to
    // be a state that claims nothing new about capture.
    planEmpty.value = "captureOff";
  }
};

/**
 * W6 — the database's own counters for this statement.
 *
 * The join key is (engine, database, fingerprint): the instance is deliberately
 * NOT sent, because behind a connection pooler the client records the pooler's
 * address while the server records the real host, and an instance-keyed join
 * drops every match. Without both an engine and a database there is no key at
 * all, so the read is skipped rather than sent — MySQL top queries carry no
 * database, and a request without one would match every database.
 *
 * A failed read never takes the rest of the page down with it — this is
 * supplementary detail beside a page whose point is the query — but it is
 * surfaced as `failed`, never as `off`: a failed request says nothing about
 * whether capture is running, and the off copy prescribes a collector fix.
 */
const loadServerMetrics = async (token: number = requestSeq.current()) => {
  serverMetricsRead.value = "loading";
  // The join key prefers the loaded client row but falls back to the URL
  // scope: a server-vantage entry (Activity, Deadlocks) has no client row to
  // read from — on a fleet with no APM there is none at all — yet the origin
  // page already knew the engine and database and passed them. Without the
  // fallback this read never fires there and the section claims capture is
  // off while /query/server_metrics holds data.
  const engine = row.value?.db_system ?? systemFilter.value;
  const database = row.value?.db_namespace ?? namespaceFilter.value;
  // mysql/mariadb server records carry no database, so for them the endpoint
  // matches instance-wide and a missing client namespace is no obstacle.
  const databaseless = engine === "mysql" || engine === "mariadb";
  if (!engine || (!database && !databaseless)) {
    // No join key, no request: nothing server-side can ever surface for this
    // row, so the quiet off line — with its route to setup — is the floor.
    serverMetrics.value = readServerMetrics(null);
    serverMetricsRead.value = "done";
    return;
  }
  try {
    const { data } = await dbMonitoringService.getQueryServerMetrics(org.value, {
      fingerprint: fingerprint.value,
      engine,
      database: databaseless ? undefined : database,
      startTime: current.value.startTime,
      endTime: current.value.endTime,
    });
    if (requestSeq.isStale(token)) return;
    serverMetrics.value = readServerMetrics(data);
    serverMetricsRead.value = "done";
  } catch {
    if (requestSeq.isStale(token)) return;
    serverMetrics.value = readServerMetrics(null);
    serverMetricsRead.value = "failed";
  }
};

/**
 * The off line's "Set up" — same destination as the list pages' empty-state
 * `open-setup` action, so every un-instrumented DBM surface routes to the one
 * setup page instead of describing an env var and stopping there.
 */
const openDbmSetup = () => {
  router.push({
    name: DBM_SETUP_ROUTE,
    query: { org_identifier: store.state.selectedOrganization.identifier },
  });
};

/**
 * Slowest executions, straight from the raw trace stream.
 *
 * `duration` is MICROseconds here while every rollup metric on this page is
 * NANOseconds, so it is converted once, on the way in. Getting this wrong makes
 * samples read 1000x faster than the p95 they sit under.
 */
const loadSamples = async (token: number = requestSeq.current()) => {
  samplesError.value = null;
  if (!traceStream.value) {
    if (requestSeq.isStale(token)) return;
    samplesError.value = streamAmbiguous.value
      ? t("dbm.detail.ambiguousStream")
      : t("dbm.detail.noStream");
    samples.value = [];
    return;
  }

  // The stream is a TABLE name, so it cannot be escaped as a literal the way
  // the fingerprint below is — and it arrives from `route.query`, which anyone
  // can write. It is checked against the org's real trace streams first, and
  // falls back to a strict identifier shape for the case where the list could
  // not be fetched. Anything else is refused rather than interpolated.
  const stream = traceStream.value;
  if (!isSafeStreamName(stream)) {
    if (requestSeq.isStale(token)) return;
    samplesError.value = t("dbm.detail.invalidStream");
    samples.value = [];
    return;
  }

  const sql =
    `SELECT _timestamp, trace_id, duration, span_status, o2_db_status_code ` +
    `FROM "${stream}" ` +
    `WHERE o2_db_fingerprint = '${escapeSingleQuotes(fingerprint.value)}' ` +
    `ORDER BY duration DESC`;

  try {
    const response = await searchService.search({
      org_identifier: org.value,
      query: {
        query: {
          sql,
          start_time: current.value.startTime,
          end_time: current.value.endTime,
          from: 0,
          size: SAMPLE_LIMIT,
        },
      },
      page_type: "traces",
    });

    if (requestSeq.isStale(token)) return;

    samples.value = (response.data?.hits ?? []).map(
      (hit: Record<string, unknown>, index: number) => ({
        rowKey: `${String(hit.trace_id ?? index)}-${index}`,
        timestamp: Number(hit._timestamp ?? 0),
        durationNs: Number(hit.duration ?? 0) * 1000,
        traceId: String(hit.trace_id ?? ""),
        isError: String(hit.span_status ?? "") === "ERROR",
        statusCode: String(hit.o2_db_status_code ?? ""),
      }),
    );
  } catch (err: unknown) {
    if (requestSeq.isStale(token)) return;
    samplesError.value = errorMessage(err);
    samples.value = [];
  }
};

const errorMessage = (err: unknown): string =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
  t("dbm.common.loadFailed");

// ─── Pivots ──────────────────────────────────────────────────────────────────

/** The traces route hydrates from `stream`/`filter`/`from`/`to` query params. */
const openTraces = (filter: string) => {
  router
    .push({
      name: "traces",
      query: {
        org_identifier: route.query.org_identifier,
        stream: traceStream.value,
        filter,
        from: String(current.value.startTime),
        to: String(current.value.endTime),
      },
    })
    .catch(() => {});
};

const openSampleTrace = (sample: SampleRow) => {
  if (!sample.traceId) return;
  openTraces(`trace_id = '${escapeSingleQuotes(sample.traceId)}'`);
};

const openEndpointTraces = (endpoint: EndpointCallerRow) => {
  const clauses = [`o2_db_fingerprint = '${escapeSingleQuotes(fingerprint.value)}'`];
  if (endpoint.service_name) {
    clauses.push(`service_name = '${escapeSingleQuotes(endpoint.service_name)}'`);
  }
  openTraces(clauses.join(" AND "));
};

/** ECharts hands back the datum; map it to the sample that produced it. */
const onSampleClick = (params: unknown) => {
  const value = (params as { value?: [number, number] })?.value;
  if (!value) return;
  const sample = samples.value.find(
    (entry) => entry.timestamp === value[0] && entry.durationNs === value[1],
  );
  if (sample) openSampleTrace(sample);
};

// ─── Incident summary ────────────────────────────────────────────────────────

const copySummary = async () => {
  const current = row.value;
  if (!current) return;

  const summary = buildIncidentSummary({
    row: current,
    window: { startTime: windowStart(), endTime: windowEnd() },
    totalTimeDelta: deltaFor(current.total_time_ns, previousRow.value?.total_time_ns),
    p95Delta: deltaFor(current.p95_ns, previousRow.value?.p95_ns),
    callsDelta: deltaFor(current.calls, previousRow.value?.calls),
    share: scopeTotalNs.value > 0 ? (current.total_time_ns ?? 0) / scopeTotalNs.value : undefined,
    endpoints: endpoints.value,
    errorClasses: errorClasses.value,
    freshness: freshness.value,
    topNSubset: topNSubset.value,
    otherShare: otherShare.value,
    permalink: permalink(),
  });

  try {
    await navigator.clipboard.writeText(summary);
    toast({ variant: "success", message: t("dbm.detail.summaryCopied") });
  } catch {
    toast({ variant: "error", message: t("dbm.detail.summaryCopyFailed") });
  }
};

const windowStart = () => current.value.startTime;
const windowEnd = () => current.value.endTime;

/**
 * Errors by status code — EXACT counts from the history response when the
 * server could provide them, else the counts derived from the sample rows.
 * The two are not the same measurement: samples are capped, so their counts
 * undercount precisely when errors spike. `errorClassesExact` says which one
 * is on screen so the section (and the copied summary) can label it.
 */
const errorClassesExact = computed(() => exactErrorClasses.value.length > 0);

const errorClasses = computed<ErrorCodeCount[]>(() => {
  if (errorClassesExact.value) return exactErrorClasses.value;
  const counts = new Map<string, number>();
  for (const sample of samples.value) {
    if (!sample.isError) continue;
    const code = sample.statusCode || "unknown";
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([status_code, errors]) => ({ status_code, errors }))
    .sort((a, b) => b.errors - a.errors);
});

/** Bar width for one code, against the largest bucket — same drawing as the
 *  coverage line's bar: the number beside it is the claim, the bar is the
 *  same claim drawn. */
const errorCodeBarWidth = (entry: ErrorCodeCount): string => {
  const max = errorClasses.value[0]?.errors ?? 0;
  if (max <= 0) return "0%";
  return `${Math.max(2, Math.round((entry.errors / max) * 100))}%`;
};

/** A link with the window frozen, so the numbers still mean something later. */
const permalink = (): string => {
  const url = new URL(window.location.href);
  // The window travels as period OR from/to, never both — the app-wide
  // convention, so the link opens the same range everywhere else too.
  for (const [key, value] of Object.entries(queryParams.value)) {
    if (value === undefined) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  return url.toString();
};

/** Mirror the window into the URL, so a reload and a shared link keep it. */
const syncUrl = () => {
  router.replace({ query: { ...route.query, ...queryParams.value } }).catch(() => {});
};

const onDateChange = (value: DbmDateChange) => {
  setRange(value);
  syncUrl();
  // Fetch only on a genuine pick — `onMounted` already loads, and the picker's
  // mount replay would otherwise double every request. See
  // `DbmDateChange.userChangedValue`.
  if (value?.userChangedValue !== false) load();
};

// ─── AI ──────────────────────────────────────────────────────────────────────

/**
 * "Why is this slow and what do I do" — composed from what is already on screen,
 * so the assistant answers about THIS query rather than asking the user to
 * describe it. Sent with `autoSend` so the click is the whole interaction.
 */
const askAiForFix = () => {
  const current = row.value;
  emit("sendToAiChat", {
    query: buildQueryFixPrompt({
      queryNorm: current?.query_norm || queryText.value,
      dbSystem: current?.db_system,
      dbInstance: current?.db_instance,
      p50Ns: current?.p50_ns,
      p95Ns: current?.p95_ns,
      p99Ns: current?.p99_ns,
      maxNs: current?.max_ns,
      totalTimeNs: current?.total_time_ns,
      calls: current?.calls,
      errors: current?.errors,
      callsPerTrace: callsPerTrace.value,
      endpoints: endpoints.value.map((endpoint) => ({
        service: endpoint.service_name,
        endpoint: endpoint.endpoint,
        calls: endpoint.calls,
      })),
    }),
    autoSend: true,
  });
};

/**
 * How many times this statement runs per request. The endpoint rollup does not
 * carry it, so it is derived from calls ÷ traces — the same ratio the list page
 * shows, and the number that separates "slow query" from "query run 40 times".
 */
const callsPerTrace = computed<number | null>(() => {
  const calls = row.value?.calls;
  const traces = row.value?.traces;
  if (!calls || !traces) return null;
  return calls / traces;
});

const dbmContext = createDbmContextProvider(
  () => ({
    currentPage: "query_detail" as const,
    scope: {
      startTime: current.value.startTime,
      endTime: current.value.endTime,
      period: range.value.relativeTimePeriod,
      system: systemFilter.value ?? row.value?.db_system,
      instance: instanceFilter.value ?? row.value?.db_instance,
      namespace: namespaceFilter.value,
    },
    focus: { fingerprint: fingerprint.value, query: row.value?.query_norm },
  }),
  store,
);

onMounted(() => {
  contextRegistry.register(DBM_CONTEXT_KEY, dbmContext);
  contextRegistry.setActive(DBM_CONTEXT_KEY);
  // Claim the queries list's hand-off, when there is one for exactly this
  // org, fingerprint and window — `load()` consumes it for the instant first
  // paint. `null` on a deep link, a reload or any mismatch, which is the full
  // cold fetch this page always did.
  seedRow.value = takeDbmQueryDetailSeed(org.value, fingerprint.value, range.value);
  load();
});

onBeforeUnmount(() => {
  contextRegistry.unregister(DBM_CONTEXT_KEY);
  contextRegistry.setActive("");
});
</script>
