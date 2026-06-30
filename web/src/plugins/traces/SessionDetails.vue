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
    class="session-details-page tw:h-[calc(100vh-2.6rem)]"
  >
  <div
    class="session-details card-container tw:h-full tw:flex tw:flex-col tw:overflow-hidden tw:bg-[var(--o2-card-bg-solid)]"
  >
    <!-- Header — fixed top bar (back button + title + session identity +
         status/turns badges, trace-explorer action pinned right). Sits above the
         scrolling body as a flex-shrink-0 sibling, mirroring IncidentDetailDrawer.
         The card owns no horizontal padding, so the border spans edge-to-edge and
         the header pads its own content. -->
    <div
      class="tw:flex tw:items-center tw:flex-nowrap tw:flex-shrink-0 tw:h-[68px] tw:px-[1rem] tw:border-b tw:border-border-default"
      data-test="session-detail-header"
    >
      <div class="tw:flex tw:items-center tw:gap-3 tw:flex-1 tw:min-w-0">
        <div
          data-test="session-detail-back-btn"
          class="tw:flex tw:justify-center tw:items-center tw:cursor-pointer tw:border-[1.5px] tw:border-current tw:rounded-full tw:w-[22px] tw:h-[22px] tw:flex-shrink-0"
          :title="t('traces.sessionDetail.backToSessions')"
          @click="goBack"
        >
          <OIcon name="arrow-back-ios-new" size="xs" />
        </div>
        <div class="tw:text-xl tw:font-semibold tw:text-text-primary tw:flex-shrink-0">
          {{ t('traces.sessionDetail.pageTitle') }}
        </div>

        <!-- Session id pill (primary-tinted, copyable) — shows the full id -->
        <span
          v-if="detail"
          class="tw:font-semibold tw:px-2 tw:py-1 tw:rounded-md tw:inline-flex tw:items-center tw:gap-1.5 tw:flex-shrink-0"
          :class="store.state.theme === 'dark' ? 'tw:text-blue-400 tw:bg-blue-900/50' : 'tw:text-blue-600 tw:bg-blue-50'"
          data-test="session-detail-title"
        >
          <span class="tw:font-mono tw:text-sm">{{ detail.sessionId }}</span>
          <OIcon
            name="content-copy"
            size="xs"
            class="tw:cursor-pointer tw:opacity-70 hover:tw:opacity-100 tw:flex-shrink-0"
            @click="copySessionId"
          />
        </span>
      </div>

    </div>

    <!-- Scrollable body — owns its own scroll so the header above stays fixed.
         Pads itself horizontally (the card has no px) so focus rings on edge
         controls aren't clipped by the scroll container's overflow. -->
    <div class="tw:flex-1 tw:flex tw:flex-col tw:min-h-0 tw:overflow-y-auto tw:px-[0.625rem] tw:pt-[0.625rem]">
    <!-- Loading — full-page skeleton mirroring the real layout (standard O2 wave
         shimmer) so nothing jumps when data lands. -->
    <div
      v-if="loading"
      class="tw:flex tw:flex-col tw:flex-1 tw:min-h-0 tw:overflow-hidden"
      data-test="session-detail-skeleton"
    >
      <!-- Shape row: KPI tiles + ribbon -->
      <div class="tw:grid tw:grid-cols-2 tw:gap-[0.625rem] tw:mb-[0.625rem] tw:flex-shrink-0">
        <div class="tw:grid tw:grid-cols-3 tw:gap-[0.625rem]">
          <div v-for="n in 6" :key="n" :class="kpiCardClass()">
            <OSkeleton type="rect" animation="wave" class="tw:rounded tw:w-[3rem] tw:h-[0.7rem]" />
            <OSkeleton type="rect" animation="wave" class="tw:rounded tw:w-[4.5rem] tw:h-[1.3rem] tw:mt-[0.3rem]" />
            <OSkeleton type="rect" animation="wave" class="tw:rounded tw:w-[6.5rem] tw:h-[0.6rem] tw:mt-[0.4rem]" />
          </div>
        </div>
        <div class="card-container tw:rounded-lg tw:border tw:border-[var(--o2-border-color)] tw:p-[1rem]">
          <OSkeleton type="rect" animation="wave" class="tw:rounded tw:w-[8rem] tw:h-[0.85rem]" />
          <OSkeleton type="rect" animation="wave" class="tw:rounded tw:w-full tw:h-[70px] tw:mt-[0.75rem]" />
        </div>
      </div>

      <!-- Lower: conversation (left) + rail (right) -->
      <div class="tw:grid tw:grid-cols-[minmax(0,1fr)_340px] tw:gap-[0.625rem] tw:flex-1 tw:min-h-0">
        <!-- Conversation column: toolbar + panel -->
        <div class="tw:flex tw:flex-col tw:min-w-0 tw:min-h-0">
          <div class="tw:flex tw:items-center tw:gap-[0.5rem] tw:mb-[0.625rem] tw:flex-shrink-0">
            <OSkeleton type="rect" animation="wave" class="tw:rounded tw:flex-1 tw:h-[36px]" />
            <OSkeleton v-for="n in 3" :key="n" type="rect" animation="wave" class="tw:rounded tw:w-[8rem] tw:h-[36px]" />
          </div>
          <div class="card-container tw:rounded-lg tw:border tw:border-[var(--o2-border-color)] tw:flex tw:flex-col tw:flex-1 tw:min-h-0 tw:overflow-hidden">
            <div class="tw:flex tw:items-center tw:gap-[0.625rem] tw:px-[1rem] tw:py-[0.75rem] tw:border-b tw:border-[var(--o2-border-color)] tw:flex-shrink-0">
              <OSkeleton type="rect" animation="wave" class="tw:rounded tw:w-[7rem] tw:h-[1rem]" />
            </div>
            <div class="tw:flex tw:flex-col tw:gap-[0.5rem] tw:p-[0.5rem] tw:flex-1 tw:min-h-0 tw:overflow-hidden">
              <OSkeleton v-for="n in 14" :key="n" type="rect" animation="wave" class="tw:rounded tw:w-full tw:h-[3rem] tw:flex-shrink-0" />
            </div>
          </div>
        </div>

        <!-- Rail: 3 hotspot card skeletons (share the rail height) -->
        <div class="tw:flex tw:flex-col tw:gap-[0.625rem] tw:min-h-0">
          <div
            v-for="c in 3"
            :key="c"
            class="card-container tw:rounded-lg tw:border tw:border-[var(--o2-border-color)] tw:flex tw:flex-col tw:flex-1 tw:min-h-0 tw:overflow-hidden"
          >
            <div class="tw:px-[0.75rem] tw:py-[0.5rem] tw:border-b tw:border-[var(--o2-border-color)] tw:flex-shrink-0">
              <OSkeleton type="rect" animation="wave" class="tw:rounded tw:w-[6rem] tw:h-[0.8rem]" />
            </div>
            <div class="tw:flex tw:flex-col tw:gap-[0.4rem] tw:p-[0.5rem] tw:flex-1 tw:min-h-0 tw:overflow-hidden">
              <OSkeleton v-for="r in 8" :key="r" type="rect" animation="wave" class="tw:rounded tw:w-full tw:h-[1.25rem] tw:flex-shrink-0" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Error -->
    <div
      v-else-if="error"
      class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:flex-1 tw:text-center"
    >
      <OIcon
        name="error-outline"
        size="xl"
        class="tw:mb-3 tw:text-[var(--o2-status-error-text)]"
      />
      <div class="tw:text-base tw:text-[var(--o2-text-primary)] tw:mb-2">
        {{ t('traces.sessionDetail.failedToLoad') }}
      </div>
      <div
        class="tw:text-sm tw:text-[var(--o2-text-muted)] tw:mb-3 tw:max-w-[30rem]"
      >
        {{ error }}
      </div>
      <OButton variant="outline" size="sm" @click="load">{{ t('traces.sessionDetail.retry') }}</OButton>
    </div>

    <!-- Not found -->
    <div
      v-else-if="!detail"
      class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:flex-1 tw:text-center"
    >
      <OIcon
        name="search-off"
        size="xl"
        class="tw:mb-3 tw:text-[var(--o2-text-muted)]"
      />
      <div class="tw:text-base tw:text-[var(--o2-text-primary)] tw:mb-2">
        {{ t('traces.sessionDetail.sessionNotFound') }}
      </div>
      <div class="tw:text-sm tw:text-[var(--o2-text-muted)] tw:max-w-[30rem]">
        {{ t('traces.sessionDetail.noSpansFound', { id: sessionId }) }}
      </div>
    </div>

    <!-- Content -->
    <template v-else>
      <!-- Shape row: KPI tiles (left) + session ribbon (right), always two
           equal columns side by side (matches the mockup's 1fr 1fr). -->
      <div
        class="tw:grid tw:grid-cols-2 tw:gap-[0.625rem] tw:mb-[0.625rem] tw:flex-shrink-0"
      >
      <!-- KPI strip — six session-level metric tiles. Card chrome + danger
           variant are Tailwind utilities (see kpiCardClass / kpiAccentClass),
           matching the LLM Insights dashboard so the AI module stays consistent. -->
      <div
        class="tw:grid tw:grid-cols-3 tw:gap-[0.625rem]"
        data-test="session-detail-kpis"
      >
        <div
          v-for="card in kpiCards"
          :key="card.key"
          :class="kpiCardClass(card.variant)"
          :data-test="`session-detail-kpi-${card.key}`"
        >
          <!-- Title uses the default primary text colour for every tile — same as
               the LLM Insights KPI label (which sets no colour, so it inherits the
               primary text). No red/orange on the Errors/Latency labels. -->
          <div class="tw:text-[0.7rem] tw:leading-normal tw:font-semibold tw:text-[var(--o2-text-primary)]">
            {{ card.label }}
          </div>
          <div class="tw:flex tw:items-baseline tw:gap-[0.2rem]">
            <span
              :class="['tw:text-[1.4rem] tw:font-bold tw:leading-none tw:tabular-nums', kpiAccentClass(card.variant) || 'tw:text-[var(--o2-text-primary)]']"
            >
              {{ card.value }}
            </span>
            <span
              v-if="card.unit"
              class="tw:text-[0.8rem] tw:font-semibold tw:text-[var(--o2-text-secondary)]"
            >
              {{ card.unit }}
            </span>
            <template v-if="card.estimate">
              <OIcon
                name="info"
                size="xs"
                class="tw:ml-[0.15rem] tw:cursor-default tw:text-[var(--o2-text-muted)]"
              />
              <OTooltip max-width="240px">
                <template #content>
                  {{ t('traces.sessionDetail.kpiSub.cacheEstimate') }}
                </template>
              </OTooltip>
            </template>
          </div>
          <div
            class="tw:flex tw:items-center tw:flex-wrap tw:gap-1 tw:text-[0.65rem] tw:leading-normal tw:font-medium tw:text-[var(--o2-text-secondary)]"
          >
            <span v-if="card.subLead">{{ card.subLead }}</span>
            <template v-for="chip in card.subTurns" :key="chip.n">
              <TurnPreviewCard
                v-if="traces[chip.n - 1]"
                :turn="traces[chip.n - 1]"
                :index="chip.n - 1"
                :cache-pct="cacheRatio"
              >
                <span
                  class="tw:inline-flex tw:items-center tw:justify-center tw:min-w-[1rem] tw:h-[1.05rem] tw:px-[0.3rem] tw:rounded-[0.3rem] tw:border tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-card-bg)] tw:text-[var(--o2-text-primary)] tw:text-[0.68rem] tw:font-bold tw:leading-none tw:cursor-pointer tw:transition-colors hover:tw:bg-[color-mix(in_srgb,var(--o2-text-primary)_8%,var(--o2-card-bg))] hover:tw:border-[color-mix(in_srgb,var(--o2-text-primary)_25%,var(--o2-border-color))]"
                  @click="jumpToTurn(chip.n)"
                >{{ chip.label }}</span>
              </TurnPreviewCard>
            </template>
            <OButton
              v-if="card.filterErrors"
              variant="outline-destructive"
              size="xs"
              icon-left="filter-alt"
              data-test="session-detail-filter-errors"
              @click="filterToErrors"
            >
              {{ t('traces.sessionDetail.kpiSub.filterErrors') }}
            </OButton>
            <span v-if="card.subTail">{{ card.subTail }}</span>
          </div>
        </div>
      </div>

      <!-- Session ribbon — one bar per turn, Cost/Latency/Tokens toggle -->
      <SessionRibbon :traces="traces" :cache-pct="cacheRatio" @jump="jumpToTurn" />
      </div>

      <!-- Lower area: conversation column (left) + hotspot rail (right). Full-page
           scroll — the column grows with content; the rail sticks (items-start so
           it doesn't stretch to the tall conversation's height). -->
      <div
        class="tw:grid tw:grid-cols-[minmax(0,1fr)_340px] tw:gap-[0.625rem] tw:items-start"
      >
      <!-- Conversation column: toolbar + panel -->
      <div class="tw:flex tw:flex-col tw:min-w-0 tw:min-h-0">

      <!-- Conversation toolbar: search (fills width) + status + model filters.
           Sorting lives on the Collapsed view's metric column headers. -->
      <div class="tw:flex tw:items-center tw:gap-[0.5rem] tw:mb-[0.625rem] tw:flex-shrink-0">
        <OSearchInput
          v-model="searchText"
          :placeholder="t('traces.sessionDetail.searchPlaceholder')"
          clearable
          :debounce="200"
          size="xs"
          class="no-border tw:flex-1! tw:h-[36px]"
        />
        <div class="tw:w-[9rem] tw:flex-shrink-0">
          <OSelect
            v-model="statusFilter"
            :label="t('traces.sessionDetail.filters.status')"
            label-position="inside"
            :options="statusOptions"
          />
        </div>
        <div class="tw:w-[12rem] tw:flex-shrink-0">
          <OSelect
            v-model="modelFilter"
            :label="t('traces.sessionDetail.filters.model')"
            label-position="inside"
            :options="modelOptions"
          />
        </div>
      </div>

      <!-- Conversation panel -->
      <div
        class="card-container tw:rounded-lg tw:border tw:border-[var(--o2-border-color)] tw:mb-[0.625rem] tw:flex tw:flex-col tw:overflow-hidden"
        data-test="session-conversation-panel"
      >
        <!-- panel header: title + count chip + jump buttons -->
        <div
          class="tw:flex tw:items-center tw:gap-[0.625rem] tw:px-[1rem] tw:py-[0.75rem] tw:border-b tw:border-[var(--o2-border-color)] tw:flex-shrink-0"
        >
          <span class="tw:text-[0.95rem] tw:font-semibold tw:text-[var(--o2-text-primary)]">
            {{ t('traces.sessionDetail.conversation') }}
          </span>
          <OBadge size="sm" variant="default-soft">
            {{ t('traces.sessionDetail.turnCount', {
              count: filteredTraces.length,
              unit: filteredTraces.length === 1 ? t('traces.sessionDetail.turn') : t('traces.sessionDetail.turns'),
            }) }}
          </OBadge>
          <OToggleGroup :model-value="viewMode" @update:model-value="setViewMode">
            <OToggleGroupItem value="collapsed" size="sm">
              {{ t('traces.sessionDetail.viewCollapsed') }}
            </OToggleGroupItem>
            <OToggleGroupItem value="pretty" size="sm">
              {{ t('traces.sessionDetail.viewPretty') }}
            </OToggleGroupItem>
          </OToggleGroup>
        </div>

        <!-- Conversation body — natural height; the page scrolls, not this. -->
        <div>

        <!-- turn list (Collapsed view) -->
        <div
          v-show="viewMode === 'collapsed'"
          class="tw:flex tw:flex-col tw:gap-[0.5rem] tw:p-[0.5rem]"
        >
          <!-- column headers — clickable sort controls for the three metric bars
               (OTable-style arrows). Aligned to the same grid template as each
               turn row, sticky so they persist on scroll. -->
          <div
            v-if="filteredTraces.length"
            class="tw:sticky tw:top-0 tw:z-[5] tw:grid tw:grid-cols-[auto_auto_minmax(0,1fr)_5rem_5rem_5rem] tw:items-center tw:gap-[0.75rem] tw:px-[0.75rem] tw:py-[0.4rem] tw:bg-[var(--o2-card-bg-solid)] tw:border-b tw:border-[var(--o2-border-color)] tw:text-[0.72rem] tw:font-medium tw:text-[var(--o2-text-primary)]"
            data-test="session-turn-columns"
          >
            <span></span>
            <span></span>
            <span></span>
            <button
              v-for="col in sortableColumns"
              :key="col.key"
              type="button"
              class="tw:flex tw:items-center tw:justify-end tw:gap-[0.15rem] tw:cursor-pointer tw:select-none hover:tw:text-[var(--o2-text-primary)]"
              :data-test="`session-turn-sort-${col.key}`"
              @click="toggleSort(col.key)"
            >
              {{ t(col.label) }}
              <OIcon
                :name="sortIconName(col.key)"
                size="xs"
                :class="sortIcon(col.key) === 'none' ? 'tw:opacity-40' : 'tw:text-[var(--color-table-sort-icon-active)]'"
              />
            </button>
          </div>
          <div
            v-for="trace in filteredTraces"
            :key="trace.traceId"
            :id="`turn-${originalTurnIndex(trace.traceId) + 1}`"
            :class="turnRowClass(trace)"
            :data-test="`session-turn-row-${trace.traceId}`"
          >
            <!-- collapsed header (click to expand) -->
            <div
              class="tw:grid tw:grid-cols-[auto_auto_minmax(0,1fr)_5rem_5rem_5rem] tw:items-center tw:gap-[0.75rem] tw:px-[0.75rem] tw:py-[0.6rem] tw:cursor-pointer hover:tw:bg-[color-mix(in_srgb,var(--o2-text-primary)_3%,var(--o2-card-bg))]"
              @click="toggleTurn(trace.traceId)"
            >
              <OIcon
                :name="isExpanded(trace.traceId) ? 'expand-more' : 'chevron-right'"
                size="sm"
                class="tw:text-[var(--o2-text-muted)] tw:flex-shrink-0"
              />
              <span
                class="tw:inline-flex tw:items-center tw:justify-center tw:w-[1.5rem] tw:h-[1.5rem] tw:rounded-full tw:text-[0.7rem] tw:font-bold tw:tabular-nums tw:flex-shrink-0"
                :class="trace.status === 'error'
                  ? 'tw:bg-[color-mix(in_srgb,var(--o2-service-health-critical)_15%,transparent)] tw:text-[var(--o2-service-health-critical)]'
                  : 'tw:bg-[color-mix(in_srgb,var(--o2-service-health-healthy)_15%,transparent)] tw:text-[var(--o2-service-health-healthy)]'"
              >
                {{ originalTurnIndex(trace.traceId) + 1 }}
              </span>
              <div class="tw:min-w-0 tw:flex tw:flex-col tw:gap-[0.15rem]">
                <div class="tw:text-[0.8rem] tw:font-semibold tw:text-[var(--o2-text-primary)] tw:truncate">
                  {{ trace.turnUserMessage || '—' }}
                </div>
                <div
                  class="tw:text-[0.72rem] tw:truncate"
                  :class="trace.status === 'error' ? 'tw:text-[var(--o2-service-health-critical)]' : 'tw:text-[var(--o2-text-secondary)]'"
                >
                  {{ secondaryLine(trace) }}
                </div>
              </div>
              <div class="tw:flex tw:flex-col tw:gap-[0.2rem] tw:min-w-0">
                <span class="tw:text-[0.72rem] tw:font-semibold tw:tabular-nums tw:text-right tw:text-[var(--o2-text-secondary)]">
                  {{ formatDuration(trace.durationNanos) }}
                </span>
                <OProgressBar
                  :value="ratio(trace.durationNanos, maxTurnLat)"
                  :variant="trace.durationNanos >= 5e9 ? 'warning' : 'default'"
                  size="xs"
                />
              </div>
              <div class="tw:flex tw:flex-col tw:gap-[0.2rem] tw:min-w-0">
                <span class="tw:text-[0.72rem] tw:font-semibold tw:tabular-nums tw:text-right tw:text-[var(--o2-text-secondary)]">
                  ${{ trace.cost.toFixed(4) }}
                </span>
                <OProgressBar :value="ratio(trace.cost, maxTurnCost)" size="xs" />
              </div>
              <div class="tw:flex tw:flex-col tw:gap-[0.2rem] tw:min-w-0">
                <span class="tw:text-[0.72rem] tw:font-semibold tw:tabular-nums tw:text-right tw:text-[var(--o2-text-secondary)]">
                  {{ formatTokens(trace.tokens) }}
                </span>
                <OProgressBar :value="ratio(trace.tokens, maxTurnTokens)" size="xs" />
              </div>
            </div>

            <!-- expanded body (basic messages + stats; full Ledger is S6) -->
            <div
              v-if="isExpanded(trace.traceId)"
              class="tw:border-t tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-card-bg-solid)] tw:p-[0.75rem]"
            >
              <!-- loading skeleton -->
              <div v-if="sessionSpansLoading" class="tw:flex tw:flex-col tw:gap-[0.4rem]">
                <OSkeleton type="rect" animation="wave" class="tw:rounded tw:w-[40%] tw:h-[0.7rem]" />
                <OSkeleton type="rect" animation="wave" class="tw:rounded tw:w-[90%] tw:h-[0.65rem]" />
                <OSkeleton type="rect" animation="wave" class="tw:rounded tw:w-[80%] tw:h-[0.65rem]" />
                <OSkeleton type="rect" animation="wave" class="tw:rounded tw:w-[60%] tw:h-[0.65rem]" />
              </div>

              <div v-else class="tw:flex tw:flex-col tw:gap-[0.625rem]">
                <!-- user block -->
                <div class="tw:rounded-lg tw:border tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-card-bg)] tw:overflow-hidden">
                  <div class="tw:flex tw:items-center tw:justify-between tw:px-[0.625rem] tw:py-[0.375rem] tw:border-b tw:border-[var(--o2-border-color)]">
                    <span class="tw:text-[0.75rem] tw:font-bold tw:text-[var(--o2-text-primary)]">
                      {{ t('traces.sessionDetail.roles.user') }}
                    </span>
                    <OIcon
                      v-if="turnDetail(trace.traceId)?.userMessage"
                      name="content-copy"
                      size="xs"
                      class="tw:cursor-pointer tw:text-[var(--o2-text-muted)] hover:tw:text-[var(--o2-text-primary)]"
                      @click="copyText(turnDetail(trace.traceId)?.userMessage?.content)"
                    />
                  </div>
                  <div class="tw:px-[0.75rem] tw:py-[0.625rem] tw:text-[0.8rem] tw:leading-relaxed tw:text-[var(--o2-text-primary)] tw:whitespace-pre-wrap tw:break-words tw:max-h-[12rem] tw:overflow-y-auto">
                    {{ turnDetail(trace.traceId)?.userMessage?.content || t('traces.sessionDetail.noUserMessage') }}
                  </div>
                </div>

                <!-- tool calls — between user input and assistant output, same
                     "Show calls" thread used by the Pretty view (ThreadView) -->
                <ThreadToolCalls
                  :tool-calls="toolCallsForTurn(trace.traceId)"
                  @span-selected="onSpanSelected"
                />

                <!-- assistant block -->
                <div class="tw:rounded-lg tw:border tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-card-bg)] tw:overflow-hidden">
                  <div class="tw:flex tw:items-center tw:justify-between tw:px-[0.625rem] tw:py-[0.375rem] tw:border-b tw:border-[var(--o2-border-color)]">
                    <span class="tw:flex tw:items-center tw:gap-[0.375rem] tw:text-[0.75rem] tw:font-bold tw:text-[var(--o2-text-primary)]">
                      {{ t('traces.sessionDetail.roles.assistant') }}
                      <OBadge v-if="turnDetail(trace.traceId)?.model" size="sm" variant="purple-soft">
                        {{ turnDetail(trace.traceId)?.model }}
                      </OBadge>
                    </span>
                    <OIcon
                      v-if="turnDetail(trace.traceId)?.assistantMessage"
                      name="content-copy"
                      size="xs"
                      class="tw:cursor-pointer tw:text-[var(--o2-text-muted)] hover:tw:text-[var(--o2-text-primary)]"
                      @click="copyText(turnDetail(trace.traceId)?.assistantMessage?.content)"
                    />
                  </div>
                  <!-- assistant content rendered as markdown (headings, tables,
                       code, bold). v-html is sanitized in renderMarkdown(). -->
                  <div
                    v-if="turnDetail(trace.traceId)?.assistantMessage?.content"
                    class="markdown-body tw:px-[0.75rem] tw:py-[0.625rem] tw:text-[0.8rem] tw:text-[var(--o2-text-primary)] tw:break-words tw:max-h-[16rem] tw:overflow-auto"
                    v-html="renderMarkdown(turnDetail(trace.traceId)?.assistantMessage?.content)"
                  />
                  <div
                    v-else
                    class="tw:px-[0.75rem] tw:py-[0.625rem] tw:text-[0.8rem] tw:text-[var(--o2-text-muted)]"
                  >
                    {{ t('traces.sessionDetail.noAssistantMessage') }}
                  </div>
                </div>

                <!-- compact stats footer -->
                <div class="tw:flex tw:flex-wrap tw:items-center tw:gap-x-[0.75rem] tw:gap-y-[0.25rem] tw:text-[0.7rem] tw:text-[var(--o2-text-secondary)] tw:tabular-nums">
                  <span>{{ formatTime(trace.startTimeMicros) }}</span>
                  <span>· {{ formatDuration(trace.durationNanos) }}</span>
                  <span>· ${{ trace.cost.toFixed(4) }}</span>
                  <span>· {{ formatTokens(trace.inputTokens) }} → {{ formatTokens(trace.outputTokens) }}</span>
                  <span v-if="turnDetail(trace.traceId)">
                    · {{ turnDetail(trace.traceId)!.llmCalls }} {{ t('traces.sessionDetail.stats.llmCalls') }}
                    · {{ turnDetail(trace.traceId)!.toolCalls }} {{ t('traces.sessionDetail.stats.toolCalls') }}
                  </span>
                  <div class="tw:flex-1"></div>
                  <OButton variant="outline" size="sm" @click="openTrace(trace.traceId)">
                    <OIcon name="open-in-new" size="xs" class="tw:mr-[0.25rem]" />
                    {{ t('traces.sessionDetail.openInTraceExplorer') }}
                  </OButton>
                </div>
              </div>
            </div>
          </div>

          <!-- empty state -->
          <div
            v-if="filteredTraces.length === 0"
            class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-[0.5rem] tw:py-[3rem] tw:text-[var(--o2-text-muted)]"
          >
            <OIcon name="search-off" size="lg" />
            <span class="tw:text-[0.8rem]">{{ t('traces.sessionDetail.noTurnsMatch') }}</span>
          </div>
        </div>

        <!-- Pretty (transcript) view — reuses ThreadView, rendered from the
             session's raw spans (fetched once on first switch). Natural height so
             it flows into the page scroll. -->
        <div v-if="viewMode === 'pretty'">
          <div
            v-if="sessionSpansLoading"
            class="tw:flex tw:flex-col tw:gap-[0.5rem] tw:p-[0.75rem]"
            data-test="session-pretty-skeleton"
          >
            <OSkeleton type="rect" animation="wave" class="tw:rounded tw:w-[30%] tw:h-[1.5rem]" />
            <OSkeleton type="rect" animation="wave" class="tw:rounded tw:w-[70%] tw:h-[3rem] tw:mt-[0.5rem]" />
            <OSkeleton type="rect" animation="wave" class="tw:rounded tw:w-[85%] tw:h-[4rem]" />
          </div>
          <ThreadView
            v-else
            :spans="sessionSpans"
            :show-summary="false"
            condense-turns
            @span-selected="onSpanSelected"
          />
        </div>
        </div>
      </div>
      </div>

      <!-- Right rail: hotspot cards. Sticks to the top of the page-scroll so the
           hotspots stay visible while the conversation scrolls. The three cards
           split the rail height EQUALLY (flex-1 thirds); each scrolls internally
           if its rows exceed its third. A card with fewer rows just shows them in
           its third. Definite height so the thirds distribute. -->
      <aside
        class="tw:sticky tw:top-0 tw:self-start tw:flex tw:flex-col tw:gap-[0.625rem] tw:h-[calc(100vh-2.6rem-68px-1.25rem)] tw:overflow-hidden tw:pb-[0.625rem]"
        data-test="session-rail"
      >
        <!-- Tool Hotspots (by time + calls; cost pending backend attribution) -->
        <div class="card-container tw:rounded-lg tw:border tw:border-[var(--o2-border-color)] tw:flex tw:flex-col tw:flex-1 tw:min-h-0 tw:overflow-hidden">
          <div class="tw:flex tw:items-center tw:gap-[0.4rem] tw:px-[0.75rem] tw:py-[0.5rem] tw:border-b tw:border-[var(--o2-border-color)] tw:flex-shrink-0">
            <OIcon name="build" size="xs" class="tw:text-[var(--o2-text-muted)]" />
            <span class="tw:text-[0.78rem] tw:font-semibold tw:text-[var(--o2-text-primary)]">
              {{ t('traces.sessionDetail.rail.toolHotspots') }}
            </span>
          </div>
          <div
            v-if="sessionSpansLoading"
            class="tw:flex tw:flex-col tw:gap-[0.4rem] tw:p-[0.625rem]"
          >
            <OSkeleton v-for="n in 3" :key="n" type="rect" animation="wave" class="tw:rounded tw:w-full tw:h-[1.1rem]" />
          </div>
          <div
            v-else-if="toolHotspots.length"
            class="tw:flex-1 tw:min-h-0 tw:overflow-y-auto tw:p-[0.375rem] tw:flex tw:flex-col tw:gap-[0.1rem]"
          >
            <span
              v-for="(row, i) in toolHotspots"
              :key="row.name"
              class="tw:contents"
            >
              <button
                class="tw:flex tw:items-center tw:gap-[0.5rem] tw:w-full tw:px-[0.4rem] tw:py-[0.35rem] tw:rounded-md tw:text-left tw:cursor-pointer hover:tw:bg-[color-mix(in_srgb,var(--o2-text-primary)_4%,transparent)]"
                @click="jumpToTurn(originalTurnIndex(row.topTraceId) + 1)"
              >
                <span class="tw:w-[1.25rem] tw:h-[1.25rem] tw:rounded-md tw:grid tw:place-items-center tw:text-[0.62rem] tw:font-bold tw:tabular-nums tw:flex-shrink-0 tw:bg-[color-mix(in_srgb,var(--o2-text-primary)_8%,transparent)] tw:text-[var(--o2-text-secondary)]">
                  {{ i + 1 }}
                </span>
                <span class="tw:text-[0.72rem] tw:font-semibold tw:text-[var(--o2-text-primary)] tw:flex-1 tw:min-w-0 tw:truncate" :title="row.name">
                  {{ row.name }}
                </span>
                <span class="tw:flex tw:items-center tw:gap-[0.3rem] tw:text-[0.7rem] tw:tabular-nums tw:flex-shrink-0">
                  <span class="tw:font-semibold tw:text-[var(--o2-text-secondary)]">
                    {{ formatDuration(row.duration) }}
                  </span>
                  <span class="tw:text-[var(--o2-text-muted)]">
                    · {{ t(row.calls === 1 ? 'traces.sessionDetail.rail.call' : 'traces.sessionDetail.rail.calls', { n: row.calls }) }}
                  </span>
                </span>
                <OIcon name="chevron-right" size="xs" class="tw:text-[var(--o2-text-muted)] tw:flex-shrink-0" />
              </button>
              <!-- Hover: which turns this (deduped) tool actually ran in. side="top"
                   matches the other rail hovers (TurnPreviewCard) so it pops above
                   the row instead of floating left over the conversation. -->
              <OTooltip side="top" :delay="120" max-width="220px" content-class="tw:p-0!">
                <template #content>
                  <div class="tw:w-[200px] tw:py-[9px] tw:px-3 tw:text-xs tw:text-[var(--o2-text-primary)]">
                    <div class="tw:font-bold tw:mb-[2px] tw:break-words">{{ row.name }}</div>
                    <div class="tw:text-[10px] tw:text-[var(--o2-text-muted)] tw:mb-[7px]">
                      {{ t(row.calls === 1 ? 'traces.sessionDetail.rail.call' : 'traces.sessionDetail.rail.calls', { n: row.calls }) }}
                    </div>
                    <div class="tw:text-[9.5px] tw:font-bold tw:tracking-[0.05em] tw:text-[var(--o2-text-muted)] tw:mb-1">
                      {{ t('traces.sessionDetail.rail.usedIn') }}
                    </div>
                    <div class="tw:flex tw:flex-wrap tw:gap-1">
                      <span
                        v-for="tn in row.turns"
                        :key="tn"
                        class="tw:inline-flex tw:items-center tw:px-[0.35rem] tw:h-[1.05rem] tw:rounded-[0.3rem] tw:border tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-card-bg)] tw:text-[10px] tw:font-semibold tw:tabular-nums"
                      >{{ t('traces.sessionDetail.turnLabel') }} {{ tn }}</span>
                    </div>
                  </div>
                </template>
              </OTooltip>
            </span>
          </div>
          <div v-else class="tw:px-[0.75rem] tw:py-[1.25rem] tw:text-center tw:text-[0.72rem] tw:text-[var(--o2-text-muted)]">
            {{ t('traces.sessionDetail.rail.noTools') }}
          </div>
        </div>

        <!-- Cost Hotspots -->
        <div class="card-container tw:rounded-lg tw:border tw:border-[var(--o2-border-color)] tw:flex tw:flex-col tw:flex-1 tw:min-h-0 tw:overflow-hidden">
          <div class="tw:flex tw:items-center tw:gap-[0.4rem] tw:px-[0.75rem] tw:py-[0.5rem] tw:border-b tw:border-[var(--o2-border-color)] tw:flex-shrink-0">
            <OIcon name="trending-up" size="xs" class="tw:text-[var(--o2-text-muted)]" />
            <span class="tw:text-[0.78rem] tw:font-semibold tw:text-[var(--o2-text-primary)]">
              {{ t('traces.sessionDetail.rail.costHotspots') }}
            </span>
          </div>
          <div class="tw:flex-1 tw:min-h-0 tw:overflow-y-auto tw:p-[0.375rem] tw:flex tw:flex-col tw:gap-[0.1rem]">
            <TurnPreviewCard
              v-for="(row, i) in costHotspots"
              :key="row.n"
              :turn="traces[row.n - 1]"
              :index="row.n - 1"
              :cache-pct="cacheRatio"
            >
              <button
                class="tw:flex tw:items-center tw:gap-[0.5rem] tw:w-full tw:px-[0.4rem] tw:py-[0.35rem] tw:rounded-md tw:text-left tw:cursor-pointer hover:tw:bg-[color-mix(in_srgb,var(--o2-text-primary)_4%,transparent)]"
                @click="jumpToTurn(row.n)"
              >
                <span class="tw:w-[1.25rem] tw:h-[1.25rem] tw:rounded-md tw:grid tw:place-items-center tw:text-[0.62rem] tw:font-bold tw:tabular-nums tw:flex-shrink-0 tw:bg-[color-mix(in_srgb,var(--o2-text-primary)_8%,transparent)] tw:text-[var(--o2-text-secondary)]">
                  {{ i + 1 }}
                </span>
                <span class="tw:text-[0.72rem] tw:font-semibold tw:text-[var(--o2-text-primary)] tw:w-[2.75rem] tw:flex-shrink-0">
                  {{ t('traces.sessionDetail.turnLabel') }} {{ row.n }}
                </span>
                <span class="tw:flex-1 tw:min-w-0">
                  <OProgressBar :value="ratio(row.cost, maxTurnCost)" size="xs" />
                </span>
                <span class="tw:flex tw:flex-col tw:items-end tw:min-w-[3.25rem]">
                  <span class="tw:text-[0.7rem] tw:font-semibold tw:tabular-nums tw:text-[var(--o2-text-secondary)]">
                    ${{ row.cost.toFixed(4) }}
                  </span>
                  <span v-if="detail && detail.cost > 0" class="tw:text-[0.6rem] tw:tabular-nums tw:text-[var(--o2-text-muted)]">
                    {{ ((row.cost / detail.cost) * 100).toFixed(1) }}%
                  </span>
                </span>
                <OIcon name="chevron-right" size="xs" class="tw:text-[var(--o2-text-muted)] tw:flex-shrink-0" />
              </button>
            </TurnPreviewCard>
          </div>
        </div>

        <!-- Slowest Turns -->
        <div class="card-container tw:rounded-lg tw:border tw:border-[var(--o2-border-color)] tw:flex tw:flex-col tw:flex-1 tw:min-h-0 tw:overflow-hidden">
          <div class="tw:flex tw:items-center tw:gap-[0.4rem] tw:px-[0.75rem] tw:py-[0.5rem] tw:border-b tw:border-[var(--o2-border-color)] tw:flex-shrink-0">
            <OIcon name="schedule" size="xs" class="tw:text-[var(--o2-text-muted)]" />
            <span class="tw:text-[0.78rem] tw:font-semibold tw:text-[var(--o2-text-primary)]">
              {{ t('traces.sessionDetail.rail.slowestTurns') }}
            </span>
          </div>
          <div class="tw:flex-1 tw:min-h-0 tw:overflow-y-auto tw:p-[0.375rem] tw:flex tw:flex-col tw:gap-[0.1rem]">
            <TurnPreviewCard
              v-for="(row, i) in slowestTurns"
              :key="row.n"
              :turn="traces[row.n - 1]"
              :index="row.n - 1"
              :cache-pct="cacheRatio"
            >
              <button
                class="tw:flex tw:items-center tw:gap-[0.5rem] tw:w-full tw:px-[0.4rem] tw:py-[0.35rem] tw:rounded-md tw:text-left tw:cursor-pointer hover:tw:bg-[color-mix(in_srgb,var(--o2-text-primary)_4%,transparent)]"
                @click="jumpToTurn(row.n)"
              >
                <span class="tw:w-[1.25rem] tw:h-[1.25rem] tw:rounded-md tw:grid tw:place-items-center tw:text-[0.62rem] tw:font-bold tw:tabular-nums tw:flex-shrink-0 tw:bg-[color-mix(in_srgb,var(--o2-text-primary)_8%,transparent)] tw:text-[var(--o2-text-secondary)]">
                  {{ i + 1 }}
                </span>
                <span class="tw:text-[0.72rem] tw:font-semibold tw:text-[var(--o2-text-primary)] tw:w-[2.75rem] tw:flex-shrink-0">
                  {{ t('traces.sessionDetail.turnLabel') }} {{ row.n }}
                </span>
                <span class="tw:flex-1 tw:min-w-0">
                  <OProgressBar :value="ratio(row.lat, maxTurnLat)" :variant="row.status === 'error' ? 'danger' : 'warning'" size="xs" />
                </span>
                <span class="tw:text-[0.7rem] tw:font-semibold tw:tabular-nums tw:text-[var(--o2-text-secondary)] tw:min-w-[2.75rem] tw:text-right">
                  {{ formatDuration(row.lat) }}
                </span>
                <OIcon name="chevron-right" size="xs" class="tw:text-[var(--o2-text-muted)] tw:flex-shrink-0" />
              </button>
            </TurnPreviewCard>
          </div>
        </div>
      </aside>
      </div>
    </template>
    </div>
  </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, reactive, onMounted, nextTick, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { copyToClipboard } from "@/utils/clipboard";
import { formatDate } from "@/utils/date";
import { useI18n } from "vue-i18n";
import {
  useSessions,
  type SessionDetail,
  type SessionTraceRow,
  type TurnDetail,
  type TurnMessage,
} from "./composables/useSessions";
import {
  messagesFromInput,
  messagesFromOutput,
  getModel,
} from "./threadView.utils";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import TurnPreviewCard from "./TurnPreviewCard.vue";
import SessionRibbon from "./SessionRibbon.vue";
import ThreadView from "./ThreadView.vue";
import ThreadToolCalls from "./ThreadToolCalls.vue";

import {
  splitNumberWithUnit,
  splitDuration,
  splitCost,
} from "./llmInsightsDashboard.utils";
import { Marked } from "marked";
import DOMPurify from "dompurify";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const store = useStore();

const { fetchSession, fetchSessionSpans } = useSessions();
const detail = ref<SessionDetail | null>(null);
const traces = ref<SessionTraceRow[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

// ──────────────────────────────────────────────────────────────────────────
// PLACEHOLDER — cached-token data is not exposed by the session-detail API yet
// (only total input tokens). Until it lands, the "Cache Saved" tile and the
// "% cached" sub-lines are derived from these two fixed constants so the tile
// isn't empty. Swap these for real per-request cache metrics when available.
// Tracked in designs/ui/llm-observability-ui/session-detail-redesign.md (§3, §7).
const CACHE_RATIO_PLACEHOLDER = 0.61; // fraction of input tokens assumed cached
const CACHE_SAVINGS_RATE = 0.0135; // $ saved per 1K cached tokens vs full input
// ──────────────────────────────────────────────────────────────────────────

const sessionId = computed(() =>
  typeof route.query.session_id === "string" ? route.query.session_id : "",
);
const streamName = computed(() =>
  typeof route.query.stream === "string" ? route.query.stream : "",
);
const startTime = computed(() =>
  typeof route.query.from === "string" ? Number(route.query.from) : 0,
);
const endTime = computed(() =>
  typeof route.query.to === "string" ? Number(route.query.to) : 0,
);

// Per-turn rollups used by the KPI sub-lines. All values are measured from the
// real trace rows — only the cache numbers are placeholders (see constants).
const sessionStats = computed(() => {
  const d = detail.value;
  const rows = traces.value;
  if (!d) return null;

  const errorTurnNums = rows
    .map((tr, i) => ({ tr, i }))
    .filter((x) => x.tr.status === "error")
    .map((x) => x.i + 1);
  const errors = errorTurnNums.length;
  const errRate = rows.length ? Math.round((errors / rows.length) * 100) : 0;

  const lats = rows.map((tr) => tr.durationNanos);
  const avgLat = lats.length ? lats.reduce((a, b) => a + b, 0) / lats.length : 0;
  // Per-session p95 over a handful of turns is statistically meaningless (it
  // collapses to the max), so we surface the slowest turn honestly instead.
  const slowestLat = lats.length ? Math.max(...lats) : 0;
  const slowestTurn =
    (lats.indexOf(slowestLat) >= 0 ? lats.indexOf(slowestLat) : 0) + 1;

  const costs = rows.map((tr) => tr.cost);
  const maxCost = costs.length ? Math.max(...costs) : 0;
  const peakTurn = (costs.indexOf(maxCost) >= 0 ? costs.indexOf(maxCost) : 0) + 1;

  const cachedTokens = Math.round(d.inputTokens * CACHE_RATIO_PLACEHOLDER);
  const cacheRatio = Math.round(CACHE_RATIO_PLACEHOLDER * 100);
  const cacheSaved = (cachedTokens / 1000) * CACHE_SAVINGS_RATE;

  return {
    errors,
    errRate,
    errorTurnNums,
    avgLat,
    slowestLat,
    slowestTurn,
    maxCost,
    peakTurn,
    cachedTokens,
    cacheRatio,
    cacheSaved,
  };
});

// Cache-hit % placeholder, surfaced to the template for the turn-preview chips.
const cacheRatio = computed(() => sessionStats.value?.cacheRatio ?? 0);

// KPI tile classes. Mirrors the `statusBadgeClass()` pattern this module already
// uses — a function returns the Tailwind class string for a given variant, so the
// (shared) card chrome + danger surface tint live in one place and the skeleton
// and real tiles stay in sync. Styling is Tailwind-only (no scoped CSS). Only
// Errors uses a variant (red when > 50% error rate); every other tile is neutral.
function kpiCardClass(variant?: "danger"): string {
  const base =
    "tw:flex tw:flex-col tw:justify-between tw:gap-1 tw:px-3.5 tw:py-2.5 tw:rounded-lg tw:border tw:transition-shadow hover:tw:shadow-[0_1px_6px_rgba(0,0,0,0.08)]";
  if (variant === "danger")
    return `${base} tw:bg-[color-mix(in_srgb,var(--o2-service-health-critical)_5%,var(--o2-card-bg))] tw:border-[color-mix(in_srgb,var(--o2-service-health-critical)_35%,var(--o2-border-color))]`;
  return `${base} tw:bg-[var(--o2-card-bg)] tw:border-[var(--o2-border-color)]`;
}

// Accent text colour for a variant's value; "" → use the neutral default.
function kpiAccentClass(variant?: "danger"): string {
  if (variant === "danger") return "tw:text-[var(--o2-service-health-critical)]";
  return "";
}

/** A turn reference inside a KPI sub-line — rendered as a hover-preview chip. */
interface TurnChip {
  n: number; // 1-based turn number
  label: string;
}

// Session-level KPI tiles. Each sub-line is split into `subLead` text, optional
// `subTurns` chips (hoverable turn references), and `subTail` text so individual
// turn numbers can carry the TurnPreviewCard tooltip. Value/unit use the same
// split helpers as the LLM Insights dashboard for identical formatting.
const kpiCards = computed<
  {
    key: string;
    label: string;
    value: string;
    unit: string;
    subLead: string;
    subTurns: TurnChip[];
    subTail: string;
    variant?: "danger";
    estimate?: boolean;
    /** Errors tile: show a "Filter Errors" button instead of per-turn chips
     *  when there are too many error turns to list as chips. */
    filterErrors?: boolean;
  }[]
>(() => {
  const d = detail.value;
  const s = sessionStats.value;
  if (!d || !s) return [];

  const dur = splitDuration(d.durationNanos / 1000);
  const lat = splitDuration(s.avgLat / 1000);
  const cost = splitCost(d.cost);
  const tokens = splitNumberWithUnit(d.tokens);
  const cacheSaved = splitCost(s.cacheSaved);
  const turnWord = t("traces.sessionDetail.turnLabel");

  return [
    {
      key: "turns",
      label: t("traces.sessionDetail.kpi.turns"),
      value: String(d.turns),
      unit: "",
      subLead: t("traces.sessionDetail.kpiSub.turns", {
        duration: `${dur.value}${dur.unit}`,
      }),
      subTurns: [],
      subTail: "",
    },
    {
      key: "errors",
      label: t("traces.sessionDetail.kpi.errors"),
      value: String(s.errRate),
      unit: "%",
      // Red only when the majority of turns failed (> 50% error rate); below
      // that the tile stays neutral so the colour means "this session broke".
      variant: s.errRate > 50 ? "danger" : undefined,
      // Up to 3 error turns → jump chips. More than that → a "Filter Errors"
      // button (chips would be an overwhelming wall of numbers).
      subLead: !s.errors
        ? t("traces.sessionDetail.kpiSub.errorsNone", { total: d.turns })
        : s.errors > 3
          ? t("traces.sessionDetail.kpiSub.errorsLeadMany", {
              errors: s.errors,
              total: d.turns,
            })
          : t("traces.sessionDetail.kpiSub.errorsLead", {
              errors: s.errors,
              total: d.turns,
            }),
      subTurns:
        s.errors > 3
          ? []
          : s.errorTurnNums.map((n) => ({ n, label: String(n) })),
      filterErrors: s.errors > 3,
      subTail: "",
    },
    {
      key: "latency",
      label: t("traces.sessionDetail.kpi.latency"),
      value: lat.value,
      unit: lat.unit,
      // Latency is never colour-flagged — "good" latency is too workload-
      // specific to threshold reliably, so the tile stays neutral.
      subLead: t("traces.sessionDetail.kpiSub.latencyLead", {
        slowest: formatDuration(s.slowestLat),
      }),
      subTurns: [{ n: s.slowestTurn, label: `${turnWord} ${s.slowestTurn}` }],
      subTail: "",
    },
    {
      key: "cost",
      label: t("traces.sessionDetail.kpi.cost"),
      value: cost.value,
      unit: cost.unit,
      subLead: t("traces.sessionDetail.kpiSub.costLead", {
        peak: usd4(s.maxCost),
      }),
      subTurns: [{ n: s.peakTurn, label: `${turnWord} ${s.peakTurn}` }],
      subTail: "",
    },
    {
      key: "tokens",
      label: t("traces.sessionDetail.kpi.tokens"),
      value: tokens.value,
      unit: tokens.unit,
      subLead: t("traces.sessionDetail.kpiSub.tokens", { ratio: s.cacheRatio }),
      subTurns: [],
      subTail: "",
    },
    {
      key: "cacheSaved",
      label: t("traces.sessionDetail.kpi.cacheSaved"),
      value: cacheSaved.value,
      unit: cacheSaved.unit,
      estimate: true,
      subLead: t("traces.sessionDetail.kpiSub.cacheSaved", {
        ratio: s.cacheRatio,
        tokens: formatTokens(s.cachedTokens),
      }),
      subTurns: [],
      subTail: "",
    },
  ];
});

// ── Conversation: filters, sort, expand (logic restored from the pre-redesign
// page; markup is rebuilt to the new design). All client-side over `traces`. ──
const searchText = ref("");
const statusFilter = ref<"all" | "ok" | "error">("all");
const modelFilter = ref<string>("all");

// Sort state is shared between the toolbar Sort dropdown and the clickable
// column headers (OTable-style). `sortKey` = which metric; `sortDir` = order.
type SortKey = "turn" | "latency" | "cost" | "tokens";
const sortKey = ref<SortKey>("turn");
const sortDir = ref<"asc" | "desc">("asc");

// The metric columns that have a sortable header (latency / cost / tokens).
const sortableColumns: { key: Extract<SortKey, "latency" | "cost" | "tokens">; label: string }[] = [
  { key: "latency", label: "traces.sessionDetail.kpi.latency" },
  { key: "cost", label: "traces.sessionDetail.kpi.cost" },
  { key: "tokens", label: "traces.sessionDetail.kpi.tokens" },
];

// Header click: cycle this column none → desc → asc → none (back to turn order).
function toggleSort(key: SortKey) {
  if (sortKey.value !== key) {
    sortKey.value = key;
    sortDir.value = "desc";
  } else if (sortDir.value === "desc") {
    sortDir.value = "asc";
  } else {
    sortKey.value = "turn";
    sortDir.value = "asc";
  }
}
// Which arrow a given column shows.
function sortIcon(key: SortKey): "asc" | "desc" | "none" {
  return sortKey.value === key ? sortDir.value : "none";
}
function sortIconName(key: SortKey): string {
  const s = sortIcon(key);
  return s === "asc"
    ? "arrow-upward"
    : s === "desc"
      ? "arrow-downward"
      : "unfold-more";
}

const statusOptions = computed(() => [
  { label: t("traces.sessionDetail.filters.all"), value: "all" },
  { label: t("traces.sessionDetail.statusOk"), value: "ok" },
  { label: t("traces.sessionDetail.statusError"), value: "error" },
]);
const modelOptions = computed(() => {
  const models = new Set<string>();
  traces.value.forEach((tr) => tr.models.forEach((m) => models.add(m)));
  return [
    { label: t("traces.sessionDetail.filters.all"), value: "all" },
    ...Array.from(models).map((m) => ({ label: m, value: m })),
  ];
});

const expandedTurns = reactive<Record<string, boolean>>({});

// Per-turn detail is DERIVED from the session spans we already fetch eagerly
// (`sessionSpans`) — the SAME single source that powers the Pretty view and the
// Tool Hotspots. This guarantees the collapsed turn body, the tool hotspots, and
// the transcript can never disagree. (Previously a separate per-turn query could
// come back empty while the spans clearly contained tools — so clicking a tool
// hotspot jumped to a turn that reported "0 tool calls".) Spans are grouped by
// `trace_id` and classified exactly like ThreadView / the old fetchTurnDetail.
const LLM_OPS = new Set([
  "chat",
  "text_completion",
  "generate_content",
  "embeddings",
]);

const turnDetailsByTrace = computed<Record<string, TurnDetail>>(() => {
  const byTrace: Record<string, any[]> = {};
  for (const s of sessionSpans.value) {
    const tid = String(s.trace_id || "");
    if (!tid) continue;
    (byTrace[tid] ||= []).push(s);
  }

  const out: Record<string, TurnDetail> = {};
  for (const tid of Object.keys(byTrace)) {
    const spans = byTrace[tid]
      .slice()
      .sort(
        (a, b) => (Number(a.start_time) || 0) - (Number(b.start_time) || 0),
      );

    let llmCalls = 0;
    let toolCalls = 0;
    let otherCalls = 0;
    const otherOps = new Set<string>();
    for (const sp of spans) {
      const op = String(sp.gen_ai_operation_name || "").toLowerCase();
      if (LLM_OPS.has(op)) llmCalls += 1;
      else if (op === "execute_tool") toolCalls += 1;
      else {
        otherCalls += 1;
        if (op) otherOps.add(op);
      }
    }

    // user question = last user-role entry of a span's full prompt; model = the
    // first span that carries one.
    let userMessage: TurnMessage | null = null;
    let model: string | null = null;
    for (const sp of spans) {
      if (!model) {
        const m = getModel(sp);
        if (m) model = m;
      }
      if (!userMessage) {
        const inputMsgs = messagesFromInput(sp.gen_ai_input_messages);
        for (let i = inputMsgs.length - 1; i >= 0; i--) {
          if (inputMsgs[i].role === "user" && inputMsgs[i].content) {
            userMessage = { role: "user", content: inputMsgs[i].content };
            break;
          }
        }
      }
      if (userMessage && model) break;
    }

    // assistant reply = final non-empty assistant message (walk newest → oldest).
    let assistantMessage: TurnMessage | null = null;
    for (let s = spans.length - 1; s >= 0; s--) {
      const outputMsgs = messagesFromOutput(spans[s].gen_ai_output_messages);
      let a: any = null;
      for (let i = outputMsgs.length - 1; i >= 0; i--) {
        if (outputMsgs[i].role === "assistant" && outputMsgs[i].content) {
          a = outputMsgs[i];
          break;
        }
      }
      if (a) {
        assistantMessage = { role: "assistant", content: a.content };
        break;
      }
    }

    out[tid] = {
      traceId: tid,
      userMessage,
      assistantMessage,
      model,
      llmCalls,
      toolCalls,
      otherCalls,
      otherOps: [...otherOps].sort(),
    };
  }
  return out;
});

const filteredTraces = computed(() => {
  const q = searchText.value.trim().toLowerCase();
  let rows = traces.value.filter((tr) => {
    if (statusFilter.value !== "all" && tr.status !== statusFilter.value)
      return false;
    if (modelFilter.value !== "all" && !tr.models.includes(modelFilter.value))
      return false;
    if (q) {
      const hay = [tr.traceId, tr.model || "", tr.turnUserMessage || ""]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) {
        const td = turnDetailsByTrace.value[tr.traceId];
        const msgHay = [
          td?.userMessage?.content || "",
          td?.assistantMessage?.content || "",
        ]
          .join(" ")
          .toLowerCase();
        if (!msgHay.includes(q)) return false;
      }
    }
    return true;
  });
  const dir = sortDir.value === "asc" ? 1 : -1;
  if (sortKey.value === "latency")
    rows = [...rows].sort((a, b) => (a.durationNanos - b.durationNanos) * dir);
  else if (sortKey.value === "cost")
    rows = [...rows].sort((a, b) => (a.cost - b.cost) * dir);
  else if (sortKey.value === "tokens")
    rows = [...rows].sort((a, b) => (a.tokens - b.tokens) * dir);
  else if (sortKey.value === "turn" && dir === -1)
    // "turn" asc is the natural (chronological) order; desc reverses it.
    rows = [...rows].reverse();
  return rows;
});

function originalTurnIndex(traceId: string): number {
  return traces.value.findIndex((tr) => tr.traceId === traceId);
}
function isExpanded(traceId: string): boolean {
  return !!expandedTurns[traceId];
}
function turnDetail(traceId: string): TurnDetail | undefined {
  return turnDetailsByTrace.value[traceId];
}

// Per-turn execute_tool spans (for the collapsed body's "Show calls" thread),
// grouped from the same sessionSpans + ordered chronologically.
const toolSpansByTrace = computed<Record<string, any[]>>(() => {
  const out: Record<string, any[]> = {};
  for (const s of sessionSpans.value) {
    if (String(s.gen_ai_operation_name || "").toLowerCase() !== "execute_tool")
      continue;
    const tid = String(s.trace_id || "");
    if (!tid) continue;
    (out[tid] ||= []).push(s);
  }
  for (const tid of Object.keys(out)) {
    out[tid].sort(
      (a, b) => (Number(a.start_time) || 0) - (Number(b.start_time) || 0),
    );
  }
  return out;
});
function toolCallsForTurn(traceId: string): any[] {
  return toolSpansByTrace.value[traceId] || [];
}

function toggleTurn(traceId: string) {
  expandedTurns[traceId] = !expandedTurns[traceId];
  // Detail is derived from sessionSpans; make sure those are (being) fetched.
  if (expandedTurns[traceId]) loadSessionSpans();
}

// ── View mode: Collapsed (turn list) vs Pretty (ThreadView transcript) ──
// Pretty reuses the existing ThreadView, which renders from raw spans — fetched
// once on first switch (all gen_ai spans across the session's traces).
const viewMode = ref<"collapsed" | "pretty">("collapsed");
const sessionSpans = ref<any[]>([]);
const sessionSpansLoading = ref(false);
const sessionSpansLoaded = ref(false);

async function loadSessionSpans() {
  if (sessionSpansLoaded.value || sessionSpansLoading.value) return;
  sessionSpansLoading.value = true;
  try {
    sessionSpans.value = await fetchSessionSpans(
      streamName.value,
      traces.value.map((tr) => tr.traceId),
      startTime.value,
      endTime.value,
    );
    sessionSpansLoaded.value = true;
  } catch (e: any) {
    console.error("Session spans fetch error:", e?.raw ?? e);
    sessionSpans.value = [];
  } finally {
    sessionSpansLoading.value = false;
  }
}

function setViewMode(mode: unknown) {
  if (mode !== "collapsed" && mode !== "pretty") return;
  viewMode.value = mode;
  if (mode === "pretty") loadSessionSpans();
}

// ThreadView emits the clicked span — open its trace in the trace explorer.
function onSpanSelected(spanId: string) {
  const span = sessionSpans.value.find((s) => s.span_id === spanId);
  if (span?.trace_id) openTrace(span.trace_id);
}

// ── Right-rail hotspots ────────────────────────────────────────────────────
// Slowest turns + cost hotspots come from `traces`. Tool hotspots come from the
// session spans (ranked by total duration + calls — tool spans carry no cost,
// pending a backend per-tool attribution; see redesign doc §3).
const slowestTurns = computed(() =>
  traces.value
    .map((t, i) => ({ n: i + 1, lat: t.durationNanos, status: t.status }))
    .sort((a, b) => b.lat - a.lat),
);
const costHotspots = computed(() =>
  traces.value
    .map((t, i) => ({ n: i + 1, cost: t.cost }))
    .sort((a, b) => b.cost - a.cost),
);
interface ToolHotspot {
  name: string;
  duration: number;
  calls: number;
  tokens: number;
  topTraceId: string;
  topDur: number;
  /** 1-based turn numbers this tool ran in (unique, sorted) — for the hover. */
  turns: number[];
}
const toolHotspots = computed<ToolHotspot[]>(() => {
  const agg: Record<
    string,
    Omit<ToolHotspot, "turns"> & { turnsSet: Set<number> }
  > = {};
  for (const s of sessionSpans.value) {
    if (String(s.gen_ai_operation_name || "").toLowerCase() !== "execute_tool")
      continue;
    const name = String(
      s.tool_name || s.gen_ai_tool_name || s.operation_name || "tool",
    );
    const dur = Number(s.duration) || 0;
    const tokens = Number(s.gen_ai_usage_total_tokens) || 0;
    const a =
      agg[name] ||
      (agg[name] = {
        name,
        duration: 0,
        calls: 0,
        tokens: 0,
        topTraceId: s.trace_id,
        topDur: -1,
        turnsSet: new Set<number>(),
      });
    a.duration += dur;
    a.calls += 1;
    a.tokens += tokens;
    const turnNum = originalTurnIndex(String(s.trace_id)) + 1;
    if (turnNum > 0) a.turnsSet.add(turnNum);
    if (dur > a.topDur) {
      a.topDur = dur;
      a.topTraceId = s.trace_id;
    }
  }
  // Rank by call count — tool span `duration` is unreliable (many report 0ms,
  // a backend gap), so calls is the meaningful hotspot signal; tie-break by the
  // summed duration. Attach the sorted list of turns each tool ran in.
  return Object.values(agg)
    .map(({ turnsSet, ...rest }) => ({
      ...rest,
      turns: [...turnsSet].sort((p, q) => p - q),
    }))
    .sort((x, y) => y.calls - x.calls || y.duration - x.duration);
});

// Jump to a turn (1-based): clear filters so it's visible, expand it, then
// scroll it into view and briefly flash it. Wired from the KPI chips, the
// ribbon bars, and the panel jump buttons.
const flashTurn = ref<number | null>(null);
function jumpToTurn(n: number) {
  searchText.value = "";
  statusFilter.value = "all";
  modelFilter.value = "all";
  sortKey.value = "turn";
  sortDir.value = "asc";
  const trace = traces.value[n - 1];
  if (!trace) return;
  expandedTurns[trace.traceId] = true;
  loadSessionSpans();
  nextTick(() => {
    const el = document.getElementById(`turn-${n}`);
    if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    flashTurn.value = n;
    setTimeout(() => {
      if (flashTurn.value === n) flashTurn.value = null;
    }, 1400);
  });
}

// "Filter Errors" (Errors KPI, > 3 errors): narrow the conversation to error
// turns and scroll the list into view instead of listing every error number.
function filterToErrors() {
  searchText.value = "";
  modelFilter.value = "all";
  sortKey.value = "turn";
  sortDir.value = "asc";
  statusFilter.value = "error";
  nextTick(() => {
    document
      .querySelector('[data-test="session-conversation-panel"]')
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
}

function openTrace(traceId: string) {
  router.push({
    name: "traceDetails",
    query: {
      stream: streamName.value,
      trace_id: traceId,
      from: startTime.value,
      to: endTime.value,
      org_identifier: store.state.selectedOrganization?.identifier,
    },
  });
}

function formatTime(nanos: number): string {
  if (!nanos) return "—";
  return formatDate(Math.floor(nanos / 1_000_000), "HH:mm:ss");
}

function trunc(s: string | null | undefined, n: number): string {
  if (!s) return "";
  return s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, "")}…` : s;
}

// Per-turn bar denominators (max across turns) for the latency/cost mini-bars.
const maxTurnCost = computed(() => sessionStats.value?.maxCost ?? 0);
const maxTurnLat = computed(() => sessionStats.value?.slowestLat ?? 0);
const maxTurnTokens = computed(() =>
  traces.value.reduce((m, tr) => Math.max(m, tr.tokens), 0),
);
function ratio(v: number, max: number): number {
  return max > 0 ? Math.min(1, v / max) : 0;
}

// Collapsed-row secondary line: the assistant reply once the turn is loaded,
// otherwise the error label / model / a hint to expand.
function secondaryLine(trace: SessionTraceRow): string {
  const td = turnDetailsByTrace.value[trace.traceId];
  if (td?.assistantMessage?.content) return trunc(td.assistantMessage.content, 90);
  if (trace.status === "error") return t("traces.sessionDetail.statusError");
  return trace.model || t("traces.sessionDetail.expandToView");
}

// Turn-row chrome: colored left accent by status + a transient ring on jump.
function turnRowClass(trace: SessionTraceRow): string {
  const n = originalTurnIndex(trace.traceId) + 1;
  const accent =
    trace.status === "error"
      ? "tw:border-l-[var(--o2-service-health-critical)]"
      : "tw:border-l-[var(--o2-service-health-healthy)]";
  const flash =
    flashTurn.value === n ? " tw:ring-2 tw:ring-[#3b82f6]" : "";
  return `tw:rounded-lg tw:border tw:border-[var(--o2-border-color)] tw:border-l-[3px] ${accent} tw:overflow-hidden tw:bg-[var(--o2-card-bg)]${flash}`;
}

async function load() {
  if (!sessionId.value || !streamName.value) {
    error.value = "Missing session id or stream in URL";
    return;
  }
  loading.value = true;
  error.value = null;
  try {
    const result = await fetchSession(
      streamName.value,
      sessionId.value,
      startTime.value,
      endTime.value,
    );
    detail.value = result.detail;
    traces.value = result.traces;
    // Fetch the session spans in the background — powers the rail's Tool
    // Hotspots and makes the Pretty view instant. Not awaited (the page is
    // usable from `traces` alone).
    loadSessionSpans();
  } catch (e: any) {
    error.value = e?.message || "Failed to load session";
    // Log both the parsed message and the raw envelope so we can see
    // DataFusion's actual complaint (e.g. unknown column, bad GROUP BY)
    // instead of the generic wrapper.
    console.error(
      "Session details fetch error:",
      e?.message,
      e?.raw?.content ?? e?.raw ?? e,
    );
  } finally {
    loading.value = false;
  }
}

function goBack() {
  // When opened from the AI/LLM Sessions page, return there (stays in the AI
  // menu) instead of dropping into the Traces sessions tab.
  if (route.name === "aiSessionDetails") {
    router.push({
      name: "aiSessions",
      query: {
        org_identifier: store.state.selectedOrganization?.identifier,
      },
    });
    return;
  }
  router.push({
    name: "traces",
    query: {
      tab: "sessions",
      stream: streamName.value,
      org_identifier: store.state.selectedOrganization?.identifier,
    },
  });
}

function copySessionId() {
  if (!detail.value) return;
  copyText(detail.value.sessionId);
}

function copyText(text: string | null | undefined) {
  if (!text) return;
  copyToClipboard(text, { successMessage: "Copied", timeout: 1000 });
}

function usd4(v: number): string {
  return `$${v.toFixed(4)}`;
}

function formatDuration(nanos: number): string {
  if (!nanos) return "—";
  const d = splitDuration(nanos / 1000);
  return `${d.value}${d.unit}`;
}

function formatTokens(n: number): string {
  if (!n) return "0";
  const tk = splitNumberWithUnit(n);
  return `${tk.value}${tk.unit}`;
}

// Markdown for the assistant message (it returns GFM — headings, tables, code,
// bold). Own Marked instance so we don't touch the app-wide `marked` config;
// DOMPurify sanitizes before v-html. Same approach as LLMContentRenderer.
const md = new Marked({ gfm: true, breaks: false });
function renderMarkdown(content: string | null | undefined): string {
  if (!content) return "";
  return DOMPurify.sanitize(md.parse(content) as string);
}

onMounted(load);
</script>

<style scoped lang="scss">
/* Markdown styling for the assistant message (v-html). Scoped CSS is the one
   sanctioned case (§5a): you can't target innerHTML-injected elements with
   Tailwind utility classes, so `:deep()` rules are used. All colours map to
   --o2-* tokens so it adapts to the theme. */
.markdown-body {
  line-height: 1.55;

  :deep(> *:first-child) {
    margin-top: 0;
  }
  :deep(> *:last-child) {
    margin-bottom: 0;
  }
  :deep(p) {
    margin: 0 0 0.5rem;
  }
  :deep(h1),
  :deep(h2),
  :deep(h3),
  :deep(h4) {
    font-weight: 650;
    margin: 0.75rem 0 0.35rem;
    line-height: 1.3;
  }
  :deep(h1) {
    font-size: 1.05rem;
  }
  :deep(h2) {
    font-size: 0.95rem;
  }
  :deep(h3) {
    font-size: 0.875rem;
  }
  :deep(h4) {
    font-size: 0.8rem;
  }
  :deep(ul),
  :deep(ol) {
    margin: 0.4rem 0;
    padding-left: 1.25rem;
  }
  :deep(li) {
    margin: 0.15rem 0;
  }
  :deep(a) {
    color: var(--o2-interactive-primary, #3b82f6);
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }
  :deep(code) {
    font-family: monospace;
    font-size: 0.72rem;
    background: color-mix(in srgb, var(--o2-text-primary) 8%, transparent);
    padding: 0.1rem 0.3rem;
    border-radius: 3px;
  }
  :deep(pre) {
    background: color-mix(in srgb, var(--o2-text-primary) 5%, transparent);
    border: 1px solid var(--o2-border-color);
    padding: 0.5rem 0.625rem;
    border-radius: 4px;
    overflow-x: auto;
    margin: 0.5rem 0;
  }
  :deep(pre code) {
    background: transparent;
    padding: 0;
  }
  :deep(blockquote) {
    border-left: 3px solid var(--o2-border-color);
    margin: 0.5rem 0;
    padding-left: 0.75rem;
    color: var(--o2-text-secondary);
  }
  :deep(table) {
    border-collapse: collapse;
    width: 100%;
    margin: 0.5rem 0;
    font-size: 0.72rem;
  }
  :deep(th),
  :deep(td) {
    border: 1px solid var(--o2-border-color);
    padding: 0.3rem 0.5rem;
    text-align: left;
  }
  :deep(th) {
    background: color-mix(in srgb, var(--o2-text-primary) 6%, transparent);
    font-weight: 600;
  }
  :deep(hr) {
    border: none;
    border-top: 1px solid var(--o2-border-color);
    margin: 0.625rem 0;
  }
}
</style>
