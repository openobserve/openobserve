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
  <div class="session-details-page h-[calc(100vh-2.6rem)]">
    <OPageLayout
      class="session-details bg-card-glass-bg"
      data-test="session-detail-header"
      :title="t('traces.sessionDetail.pageTitle')"
      :back="{
        label: t('rum.sessions'),
        onClick: goBack,
        dataTest: 'session-detail-back-btn',
      }"
      bleed
    >
      <!-- Session id pill (primary-tinted, copyable) — shows the full id -->
      <template #title-trail>
        <span
          v-if="detail"
          class="font-semibold px-2 py-1 rounded-default inline-flex items-center gap-1.5 flex-shrink-0 text-status-info-text bg-status-info-bg"
          data-test="session-detail-title"
        >
          <span class="font-mono text-sm">{{ detail.sessionId }}</span>
          <OIcon
            name="content-copy"
            size="xs"
            class="cursor-pointer opacity-70 hover:opacity-100 flex-shrink-0"
            @click="copySessionId"
          />
        </span>
      </template>

      <!-- Scrollable body — owns its own scroll so the header above stays fixed.
         Pads itself horizontally (the card has no px) so focus rings on edge
         controls aren't clipped by the scroll container's overflow. -->
      <div class="flex-1 flex flex-col min-h-0 overflow-y-auto px-page-edge pt-2.5">
        <!-- Loading — full-page skeleton mirroring the real layout (standard O2 wave
         shimmer) so nothing jumps when data lands. -->
        <div
          v-if="loading"
          class="flex flex-col flex-1 min-h-0 overflow-hidden"
          data-test="session-detail-skeleton"
        >
          <!-- Shape row: KPI tiles + ribbon -->
          <div class="grid grid-cols-2 gap-2.5 mb-2.5 flex-shrink-0">
            <div class="grid grid-cols-3 gap-2.5">
              <div v-for="n in 6" :key="n" :class="kpiCardClass()">
                <OSkeleton type="rect" animation="wave" class="rounded-default w-12 h-[0.7rem]" />
                <OSkeleton
                  type="rect"
                  animation="wave"
                  class="rounded-default w-[4.5rem] h-[1.3rem] mt-[0.3rem]"
                />
                <OSkeleton
                  type="rect"
                  animation="wave"
                  class="rounded-default w-[6.5rem] h-[0.6rem] mt-[0.4rem]"
                />
              </div>
            </div>
            <div
              class="bg-card-glass-bg rounded-default border border-border-default pt-4 px-4 pb-2.5 flex flex-col"
            >
              <OSkeleton
                type="rect"
                animation="wave"
                class="rounded-default w-32 h-[0.85rem] flex-shrink-0"
              />
              <!-- Fill the panel height (it stretches to the 6-tile block on the left)
               so the skeleton matches the real ribbon and leaves no gap below. -->
              <OSkeleton
                type="rect"
                animation="wave"
                class="rounded-default w-full flex-1 min-h-0 mt-3"
              />
            </div>
          </div>

          <!-- Lower: conversation (left) + rail (right) -->
          <div class="grid grid-cols-[minmax(0,1fr)_340px] gap-2.5 flex-1 min-h-0">
            <!-- Conversation column: toolbar + panel -->
            <div class="flex flex-col min-w-0 min-h-0">
              <div class="flex items-center gap-2 mb-2.5 flex-shrink-0">
                <OSkeleton type="rect" animation="wave" class="rounded-default flex-1 h-9" />
                <OSkeleton
                  v-for="n in 3"
                  :key="n"
                  type="rect"
                  animation="wave"
                  class="rounded-default w-32 h-9"
                />
              </div>
              <div
                class="bg-card-glass-bg rounded-default border border-border-default flex flex-col overflow-hidden"
              >
                <div
                  class="flex items-center gap-2.5 px-4 py-3 border-b border-border-default flex-shrink-0"
                >
                  <OSkeleton type="rect" animation="wave" class="rounded-default w-28 h-4" />
                </div>
                <div class="flex flex-col gap-2 p-2 flex-1 min-h-0 overflow-hidden">
                  <OSkeleton
                    v-for="n in 14"
                    :key="n"
                    type="rect"
                    animation="wave"
                    class="rounded-default w-full h-12 flex-shrink-0"
                  />
                </div>
              </div>
            </div>

            <!-- Rail: 3 hotspot card skeletons (share the rail height) -->
            <div class="flex flex-col gap-2.5 min-h-0">
              <div
                v-for="c in 3"
                :key="c"
                class="bg-card-glass-bg rounded-default border border-border-default flex flex-col overflow-hidden"
              >
                <div class="px-3 py-2 border-b border-border-default flex-shrink-0">
                  <OSkeleton type="rect" animation="wave" class="rounded-default w-24 h-[0.8rem]" />
                </div>
                <div class="flex flex-col gap-[0.4rem] p-2 flex-1 min-h-0 overflow-hidden">
                  <OSkeleton
                    v-for="r in 8"
                    :key="r"
                    type="rect"
                    animation="wave"
                    class="rounded-default w-full h-5 flex-shrink-0"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Error -->
        <div v-else-if="error" class="flex flex-col items-center justify-center flex-1 text-center">
          <OIcon name="error-outline" size="xl" class="mb-3 text-error-600" />
          <div class="text-base text-text-heading mb-2">
            {{ t("traces.sessionDetail.failedToLoad") }}
          </div>
          <div class="text-sm text-text-muted mb-3 max-w-[30rem]">
            {{ error }}
          </div>
          <OButton variant="outline" size="sm" @click="load">{{
            t("traces.sessionDetail.retry")
          }}</OButton>
        </div>

        <!-- Not found -->
        <div
          v-else-if="!detail"
          class="flex flex-col items-center justify-center flex-1 text-center"
        >
          <OIcon name="search-off" size="xl" class="mb-3 text-text-muted" />
          <div class="text-base text-text-heading mb-2">
            {{ t("traces.sessionDetail.sessionNotFound") }}
          </div>
          <div class="text-sm text-text-muted max-w-[30rem]">
            {{ t("traces.sessionDetail.noSpansFound", { id: sessionId }) }}
          </div>
        </div>

        <!-- Content -->
        <template v-else>
          <!-- Shape row: KPI tiles (left) + session ribbon (right), always two
           equal columns side by side (matches the mockup's 1fr 1fr). -->
          <div class="grid grid-cols-2 gap-2.5 mb-2.5 flex-shrink-0">
            <!-- KPI strip — six session-level metric tiles. Card chrome + danger
           variant are Tailwind utilities (see kpiCardClass / kpiAccentClass),
           matching the LLM Insights dashboard so the AI module stays consistent. -->
            <div
              class="grid grid-cols-3 grid-rows-2 h-full gap-2.5"
              data-test="session-detail-kpis"
            >
              <div
                v-for="card in kpiCards"
                :key="card.key"
                :class="kpiCardClass(card.variant)"
                :data-test="`session-detail-kpi-${card.key}`"
              >
                <!-- Title row: label on the left, a metric icon in a soft rounded-default
               tile on the right (KPI-card convention). The tile gives the icon
               room to render crisply and anchors each metric without crowding
               the label/value text. -->
                <div class="flex items-center justify-between gap-2">
                  <div
                    class="text-2xs leading-normal font-semibold text-text-secondary min-w-0 truncate"
                  >
                    {{ card.label }}
                  </div>
                  <span
                    class="inline-flex items-center justify-center shrink-0 w-6 h-6 rounded-default bg-surface-subtle text-text-secondary"
                  >
                    <OIcon :name="card.icon" size="sm" />
                  </span>
                </div>
                <div class="flex items-baseline gap-[0.2rem]">
                  <span
                    :class="[
                      'text-2xl font-bold leading-none tabular-nums',
                      kpiAccentClass(card.variant) || 'text-text-secondary',
                    ]"
                  >
                    {{ card.value }}
                  </span>
                  <span v-if="card.unit" class="text-compact font-semibold text-text-secondary">
                    {{ card.unit }}
                  </span>
                  <template v-if="card.estimate">
                    <OIcon
                      name="info"
                      size="xs"
                      class="ml-[0.15rem] cursor-default text-text-muted"
                    />
                    <OTooltip max-width="280px">
                      <template #content>
                        <div class="flex flex-col gap-2 min-w-57.5">
                          <div class="text-xs font-semibold text-text-heading">
                            {{ t("traces.sessionDetail.kpiSub.cacheImpactTooltipTitle") }}
                          </div>
                          <div class="flex flex-col gap-1">
                            <div
                              v-for="row in card.tooltipRows || []"
                              :key="row.label"
                              class="flex items-center justify-between gap-3 text-2xs"
                            >
                              <span class="text-text-secondary">{{ row.label }}</span>
                              <span class="font-semibold tabular-nums text-text-body">{{
                                row.value
                              }}</span>
                            </div>
                          </div>
                          <div class="text-2xs leading-snug text-text-secondary">
                            {{ t("traces.sessionDetail.kpiSub.cacheEstimate") }}
                          </div>
                        </div>
                      </template>
                    </OTooltip>
                  </template>
                </div>
                <div
                  class="flex items-center flex-wrap gap-1 text-3xs leading-normal font-medium text-text-secondary"
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
                        class="inline-flex items-center justify-center min-w-4 h-[1.05rem] px-[0.3rem] rounded-default border border-border-default bg-surface-base text-text-body text-2xs font-bold leading-none cursor-pointer transition-colors hover:bg-[color-mix(in_srgb,var(--color-text-heading)_8%,var(--color-surface-base))] hover:border-[color-mix(in_srgb,var(--color-text-heading)_25%,var(--color-border-default))]"
                        @click="jumpToTurn(chip.n)"
                        >{{ chip.label }}</span
                      >
                    </TurnPreviewCard>
                  </template>
                  <OButton
                    v-if="card.filterErrors && !errorsFiltered"
                    variant="outline-destructive"
                    size="xs"
                    data-test="session-detail-filter-errors"
                    @click="filterToErrors"
                  >
                    {{ t("traces.sessionDetail.kpiSub.filterErrors") }}
                  </OButton>
                  <OButton
                    v-else-if="card.filterErrors && errorsFiltered"
                    variant="outline"
                    size="xs"
                    data-test="session-detail-reset-errors"
                    @click="resetErrorFilter"
                  >
                    {{ t("traces.sessionDetail.kpiSub.resetFilters") }}
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
          <div class="grid grid-cols-[minmax(0,1fr)_340px] gap-2.5 items-start">
            <!-- Conversation column: toolbar + panel -->
            <div class="flex flex-col min-w-0 min-h-0">
              <!-- Conversation toolbar: search (fills width) + status + model filters.
           Sorting lives on the Collapsed view's metric column headers. -->
              <div class="flex items-center gap-2 mb-2.5 flex-shrink-0">
                <OSearchInput
                  v-model="searchText"
                  :placeholder="t('traces.sessionDetail.searchPlaceholder')"
                  clearable
                  :debounce="200"
                  size="xs"
                  class="no-border flex-1! h-9"
                />
                <div class="w-36 flex-shrink-0">
                  <OSelect
                    v-model="statusFilter"
                    :label="t('traces.sessionDetail.filters.status')"
                    label-position="inside"
                    :options="statusOptions"
                  />
                </div>
                <div class="w-48 flex-shrink-0">
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
                class="bg-card-glass-bg rounded-default border border-border-default mb-2.5 flex flex-col overflow-hidden"
                data-test="session-conversation-panel"
              >
                <!-- panel header: title + count chip + jump buttons -->
                <div
                  class="flex items-center gap-2.5 px-4 py-3 border-b border-border-default flex-shrink-0"
                >
                  <span class="text-base font-semibold text-text-heading">
                    {{ t("traces.sessionDetail.conversation") }}
                  </span>
                  <OTag type="countChip" value="neutral">
                    {{
                      t("traces.sessionDetail.turnCount", {
                        count: filteredTraces.length,
                        unit:
                          filteredTraces.length === 1
                            ? t("traces.sessionDetail.turn")
                            : t("traces.sessionDetail.turns"),
                      })
                    }}
                  </OTag>
                  <OToggleGroup :model-value="viewMode" @update:model-value="setViewMode">
                    <OToggleGroupItem value="collapsed" size="sm">
                      {{ t("traces.sessionDetail.viewCollapsed") }}
                    </OToggleGroupItem>
                    <OToggleGroupItem value="pretty" size="sm">
                      {{ t("traces.sessionDetail.viewPretty") }}
                    </OToggleGroupItem>
                  </OToggleGroup>
                </div>

                <!-- Conversation body — natural height; the page scrolls, not this. -->
                <div>
                  <!-- turn list (Collapsed view) -->
                  <div v-show="viewMode === 'collapsed'" class="flex flex-col gap-2 p-2">
                    <!-- column headers — clickable sort controls for the three metric bars
               (OTable-style arrows). Aligned to the same grid template as each
               turn row, sticky so they persist on scroll. -->
                    <div
                      v-if="filteredTraces.length"
                      class="sticky top-0 z-[5] grid grid-cols-[auto_auto_minmax(0,1fr)_5rem_5rem_5rem] items-center gap-3 px-3 py-[0.4rem] bg-surface-base border-b border-border-default text-xs font-medium text-text-label"
                      data-test="session-turn-columns"
                    >
                      <span></span>
                      <span></span>
                      <span></span>
                      <button
                        v-for="col in sortableColumns"
                        :key="col.key"
                        type="button"
                        class="flex items-center justify-end gap-[0.15rem] cursor-pointer select-none hover:text-text-body"
                        :data-test="`session-turn-sort-${col.key}`"
                        @click="toggleSort(col.key)"
                      >
                        {{ t(col.label) }}
                        <OIcon
                          :name="sortIconName(col.key)"
                          size="xs"
                          :class="
                            sortIcon(col.key) === 'none'
                              ? 'opacity-40'
                              : 'text-table-sort-icon-active'
                          "
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
                        class="grid grid-cols-[auto_auto_minmax(0,1fr)_5rem_5rem_5rem] items-center gap-3 px-3 py-[0.6rem] cursor-pointer hover:bg-[color-mix(in_srgb,var(--color-text-heading)_3%,var(--color-surface-base))]"
                        :data-test="`session-turn-header-${trace.traceId}`"
                        @click="toggleTurn(trace.traceId)"
                      >
                        <OIcon
                          :name="isExpanded(trace.traceId) ? 'expand-more' : 'chevron-right'"
                          size="sm"
                          class="text-text-muted flex-shrink-0"
                        />
                        <span
                          class="inline-flex items-center justify-center w-6 h-6 rounded-full text-2xs font-bold tabular-nums flex-shrink-0"
                          :class="
                            trace.status === 'error'
                              ? 'bg-[color-mix(in_srgb,var(--color-error-500)_15%,transparent)] text-error-500'
                              : 'bg-[color-mix(in_srgb,var(--color-success-500)_15%,transparent)] text-status-success-text'
                          "
                        >
                          {{ originalTurnIndex(trace.traceId) + 1 }}
                        </span>
                        <div class="min-w-0 flex flex-col gap-[0.15rem]">
                          <div class="text-compact font-semibold text-text-heading truncate">
                            {{ trace.turnUserMessage || "—" }}
                          </div>
                          <div
                            class="text-xs truncate"
                            :class="
                              trace.status === 'error' ? 'text-error-500' : 'text-text-secondary'
                            "
                          >
                            {{ secondaryLine(trace) }}
                          </div>
                        </div>
                        <div class="flex flex-col gap-[0.2rem] min-w-0">
                          <span
                            class="text-xs font-semibold tabular-nums text-right text-text-secondary"
                          >
                            {{ formatDuration(trace.durationNanos) }}
                          </span>
                          <OProgressBar
                            :value="ratio(trace.durationNanos, maxTurnLat)"
                            :variant="trace.durationNanos >= 5e9 ? 'warning' : 'default'"
                            size="xs"
                          />
                        </div>
                        <div class="flex flex-col gap-[0.2rem] min-w-0">
                          <span
                            class="text-xs font-semibold tabular-nums text-right text-text-secondary"
                          >
                            ${{ trace.cost.toFixed(4) }}
                          </span>
                          <OProgressBar :value="ratio(trace.cost, maxTurnCost)" size="xs" />
                        </div>
                        <div class="flex flex-col gap-[0.2rem] min-w-0">
                          <span
                            class="text-xs font-semibold tabular-nums text-right text-text-secondary"
                          >
                            {{ formatTokens(trace.tokens) }}
                          </span>
                          <OProgressBar :value="ratio(trace.tokens, maxTurnTokens)" size="xs" />
                        </div>
                      </div>

                      <!-- expanded body (basic messages + stats; full Ledger is S6) -->
                      <div
                        v-if="isExpanded(trace.traceId)"
                        class="border-t border-border-default bg-surface-base p-3"
                        :data-test="`session-turn-body-${trace.traceId}`"
                      >
                        <!-- loading skeleton -->
                        <div v-if="sessionSpansLoading" class="flex flex-col gap-[0.4rem]">
                          <OSkeleton
                            type="rect"
                            animation="wave"
                            class="rounded-default w-[40%] h-[0.7rem]"
                          />
                          <OSkeleton
                            type="rect"
                            animation="wave"
                            class="rounded-default w-[90%] h-[0.65rem]"
                          />
                          <OSkeleton
                            type="rect"
                            animation="wave"
                            class="rounded-default w-[80%] h-[0.65rem]"
                          />
                          <OSkeleton
                            type="rect"
                            animation="wave"
                            class="rounded-default w-[60%] h-[0.65rem]"
                          />
                        </div>

                        <div v-else class="flex flex-col gap-2.5">
                          <!-- user block -->
                          <div
                            class="rounded-default border border-border-default bg-surface-base overflow-hidden"
                          >
                            <div
                              class="flex items-center justify-between px-2.5 py-1.5 border-b border-border-default"
                            >
                              <span class="text-xs font-bold text-text-heading">
                                {{ t("traces.sessionDetail.roles.user") }}
                              </span>
                              <OIcon
                                v-if="turnDetail(trace.traceId)?.userMessage"
                                name="content-copy"
                                size="xs"
                                class="cursor-pointer text-text-muted hover:text-text-body"
                                @click="copyText(turnDetail(trace.traceId)?.userMessage?.content)"
                              />
                            </div>
                            <div
                              class="px-3 py-2.5 text-compact leading-relaxed text-text-body whitespace-pre-wrap break-words max-h-48 overflow-y-auto"
                            >
                              {{
                                turnDetail(trace.traceId)?.userMessage?.content ||
                                t("traces.sessionDetail.noUserMessage")
                              }}
                            </div>
                          </div>

                          <!-- tool calls — between user input and assistant output, same
                     "Show calls" thread used by the Pretty view (ThreadView) -->
                          <ThreadToolCalls
                            :tool-calls="toolCallsForTurn(trace.traceId)"
                            @span-selected="onSpanSelected"
                          />

                          <!-- assistant block -->
                          <div
                            class="rounded-default border border-border-default bg-surface-base overflow-hidden"
                          >
                            <div
                              class="flex items-center justify-between px-2.5 py-1.5 border-b border-border-default"
                            >
                              <span
                                class="flex items-center gap-1.5 text-xs font-bold text-text-heading"
                              >
                                {{ t("traces.sessionDetail.roles.assistant") }}
                                <OTag
                                  v-if="turnDetail(trace.traceId)?.model"
                                  variant="purple-soft"
                                  size="sm"
                                >
                                  {{ turnDetail(trace.traceId)?.model }}
                                </OTag>
                              </span>
                              <OIcon
                                v-if="turnDetail(trace.traceId)?.assistantMessage"
                                name="content-copy"
                                size="xs"
                                class="cursor-pointer text-text-muted hover:text-text-body"
                                @click="
                                  copyText(turnDetail(trace.traceId)?.assistantMessage?.content)
                                "
                              />
                            </div>
                            <!-- assistant content rendered as markdown (headings, tables,
                       code, bold). v-html is sanitized in renderMarkdown(). -->
                            <div
                              v-if="turnDetail(trace.traceId)?.assistantMessage?.content"
                              class="markdown-body px-3 py-2.5 text-compact text-text-body break-words max-h-64 overflow-auto"
                              v-html="
                                renderMarkdown(turnDetail(trace.traceId)?.assistantMessage?.content)
                              "
                            />
                            <div v-else class="px-3 py-2.5 text-compact text-text-muted">
                              {{ t("traces.sessionDetail.noAssistantMessage") }}
                            </div>
                          </div>

                          <!-- compact stats footer -->
                          <div
                            class="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-text-secondary tabular-nums"
                          >
                            <span>{{ formatTime(trace.startTimeMicros) }}</span>
                            <span>· {{ formatDuration(trace.durationNanos) }}</span>
                            <span>· ${{ trace.cost.toFixed(4) }}</span>
                            <span
                              >· {{ formatTokens(trace.inputTokens) }} →
                              {{ formatTokens(trace.outputTokens) }}</span
                            >
                            <span v-if="turnDetail(trace.traceId)">
                              · {{ turnDetail(trace.traceId)!.llmCalls }}
                              {{ t("traces.sessionDetail.stats.llmCalls") }} ·
                              {{ turnDetail(trace.traceId)!.toolCalls }}
                              {{ t("traces.sessionDetail.stats.toolCalls") }}
                            </span>
                            <div class="flex-1"></div>
                            <OButton variant="outline" size="sm" @click="openTrace(trace.traceId)">
                              <OIcon name="open-in-new" size="xs" class="mr-1" />
                              {{ t("traces.sessionDetail.openInTraceExplorer") }}
                            </OButton>
                          </div>
                        </div>
                      </div>
                    </div>

                    <!-- empty state -->
                    <div
                      v-if="filteredTraces.length === 0"
                      class="flex flex-col items-center justify-center gap-2 py-12 text-text-muted"
                    >
                      <OIcon name="search-off" size="lg" />
                      <span class="text-compact">{{ t("traces.sessionDetail.noTurnsMatch") }}</span>
                    </div>
                  </div>

                  <!-- Pretty (transcript) view — reuses ThreadView, rendered from the
             session's raw spans (fetched once on first switch). Natural height so
             it flows into the page scroll. -->
                  <div v-if="viewMode === 'pretty'">
                    <div
                      v-if="sessionSpansLoading"
                      class="flex flex-col gap-2 p-3"
                      data-test="session-pretty-skeleton"
                    >
                      <OSkeleton type="rect" animation="wave" class="rounded-default w-[30%] h-6" />
                      <OSkeleton
                        type="rect"
                        animation="wave"
                        class="rounded-default w-[70%] h-12 mt-2"
                      />
                      <OSkeleton
                        type="rect"
                        animation="wave"
                        class="rounded-default w-[85%] h-16"
                      />
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
           Cards size to their CONTENT (not forced-equal thirds), so a session
           with few tools/turns shows compact cards with no dead space and no
           internal scroll. Each card caps its list at a max-height and only
           scrolls internally when it genuinely overflows. The rail sticks to the
           top and never exceeds the viewport. -->
            <aside
              class="sticky top-0 self-start flex flex-col gap-2.5 max-h-[calc(100vh-2.6rem-68px-1.25rem)] overflow-y-auto pb-2.5"
              data-test="session-rail"
            >
              <!-- Tool Hotspots (by time + calls; cost pending backend attribution) -->
              <div
                class="bg-card-glass-bg rounded-default border border-border-default flex flex-col overflow-hidden"
              >
                <div
                  class="flex items-center gap-[0.4rem] px-3 py-2 border-b border-border-default flex-shrink-0"
                >
                  <OIcon name="build" size="xs" class="text-text-muted" />
                  <span class="text-xs font-semibold text-text-heading">
                    {{ t("traces.sessionDetail.rail.toolHotspots") }}
                  </span>
                </div>
                <div v-if="sessionSpansLoading" class="flex flex-col gap-[0.4rem] p-2.5">
                  <OSkeleton
                    v-for="n in 3"
                    :key="n"
                    type="rect"
                    animation="wave"
                    class="rounded-default w-full h-[1.1rem]"
                  />
                </div>
                <div
                  v-else-if="toolHotspots.length"
                  class="max-h-60 overflow-y-auto p-1.5 flex flex-col gap-[0.1rem]"
                >
                  <span v-for="(row, i) in toolHotspots" :key="row.name" class="contents">
                    <button
                      class="flex items-center gap-2 w-full px-[0.4rem] py-[0.35rem] rounded-default text-left cursor-pointer hover:bg-[color-mix(in_srgb,var(--color-text-heading)_4%,transparent)]"
                      @click="jumpToTurn(originalTurnIndex(row.topTraceId) + 1)"
                    >
                      <span
                        class="w-5 h-5 rounded-default grid place-items-center text-3xs font-bold tabular-nums flex-shrink-0 bg-[color-mix(in_srgb,var(--color-text-heading)_8%,transparent)] text-text-secondary"
                      >
                        {{ i + 1 }}
                      </span>
                      <span
                        class="text-xs font-semibold text-text-heading flex-1 min-w-0 truncate"
                        :title="row.name"
                      >
                        {{ row.name }}
                      </span>
                      <span
                        class="flex items-center gap-[0.3rem] text-2xs tabular-nums flex-shrink-0"
                      >
                        <span class="font-semibold text-text-secondary">
                          {{ formatDuration(row.duration) }}
                        </span>
                        <span class="text-text-muted">
                          ·
                          {{
                            t(
                              row.calls === 1
                                ? "traces.sessionDetail.rail.call"
                                : "traces.sessionDetail.rail.calls",
                              { n: row.calls },
                            )
                          }}
                        </span>
                      </span>
                      <OIcon name="chevron-right" size="xs" class="text-text-muted flex-shrink-0" />
                    </button>
                    <!-- Hover: which turns this (deduped) tool actually ran in. side="left"
                   (like the Cost/Slowest hovers) so it opens to the side instead of
                   covering the rows above it. -->
                    <OTooltip side="left" :delay="120" max-width="220px" content-class="p-0!">
                      <template #content>
                        <div class="w-50 py-2.25 px-3 text-xs text-text-body">
                          <div class="font-bold mb-0.5 break-words">{{ row.name }}</div>
                          <div class="text-3xs text-text-muted mb-1.75">
                            {{
                              t(
                                row.calls === 1
                                  ? "traces.sessionDetail.rail.call"
                                  : "traces.sessionDetail.rail.calls",
                                { n: row.calls },
                              )
                            }}
                          </div>
                          <div
                            class="text-3xs font-bold tracking-[0.05em] text-text-secondary mb-1"
                          >
                            {{ t("traces.sessionDetail.rail.usedIn") }}
                          </div>
                          <div class="flex flex-wrap gap-1">
                            <span
                              v-for="tn in row.turns"
                              :key="tn"
                              class="inline-flex items-center px-[0.35rem] h-[1.05rem] rounded-default border border-border-default bg-surface-base text-3xs font-semibold tabular-nums"
                              >{{ t("traces.sessionDetail.turnLabel") }} {{ tn }}</span
                            >
                          </div>
                        </div>
                      </template>
                    </OTooltip>
                  </span>
                </div>
                <div v-else class="px-3 py-5 text-center text-xs text-text-muted">
                  {{ t("traces.sessionDetail.rail.noTools") }}
                </div>
              </div>

              <!-- Cost Hotspots -->
              <div
                class="bg-card-glass-bg rounded-default border border-border-default flex flex-col overflow-hidden"
              >
                <div
                  class="flex items-center gap-[0.4rem] px-3 py-2 border-b border-border-default flex-shrink-0"
                >
                  <OIcon name="trending-up" size="xs" class="text-text-muted" />
                  <span class="text-xs font-semibold text-text-heading">
                    {{ t("traces.sessionDetail.rail.costHotspots") }}
                  </span>
                </div>
                <div class="max-h-60 overflow-y-auto p-1.5 flex flex-col gap-[0.1rem]">
                  <TurnPreviewCard
                    v-for="(row, i) in costHotspots"
                    :key="row.n"
                    :turn="traces[row.n - 1]"
                    :index="row.n - 1"
                    :cache-pct="cacheRatio"
                    side="right"
                  >
                    <button
                      class="flex items-center gap-2 w-full px-[0.4rem] py-[0.35rem] rounded-default text-left cursor-pointer hover:bg-[color-mix(in_srgb,var(--color-text-heading)_4%,transparent)]"
                      @click="jumpToTurn(row.n)"
                    >
                      <span
                        class="w-5 h-5 rounded-default grid place-items-center text-3xs font-bold tabular-nums flex-shrink-0 bg-[color-mix(in_srgb,var(--color-text-heading)_8%,transparent)] text-text-secondary"
                      >
                        {{ i + 1 }}
                      </span>
                      <span class="text-xs font-semibold text-text-heading w-11 flex-shrink-0">
                        {{ t("traces.sessionDetail.turnLabel") }} {{ row.n }}
                      </span>
                      <span class="flex-1 min-w-0">
                        <OProgressBar :value="ratio(row.cost, maxTurnCost)" size="xs" />
                      </span>
                      <span class="flex flex-col items-end min-w-[3.25rem]">
                        <span class="text-2xs font-semibold tabular-nums text-text-secondary">
                          ${{ row.cost.toFixed(4) }}
                        </span>
                        <span
                          v-if="detail && detail.cost > 0"
                          class="text-3xs tabular-nums text-text-muted"
                        >
                          {{ ((row.cost / detail.cost) * 100).toFixed(1) }}%
                        </span>
                      </span>
                      <OIcon name="chevron-right" size="xs" class="text-text-muted flex-shrink-0" />
                    </button>
                  </TurnPreviewCard>
                </div>
              </div>

              <!-- Slowest Turns -->
              <div
                class="bg-card-glass-bg rounded-default border border-border-default flex flex-col overflow-hidden"
              >
                <div
                  class="flex items-center gap-[0.4rem] px-3 py-2 border-b border-border-default flex-shrink-0"
                >
                  <OIcon name="schedule" size="xs" class="text-text-muted" />
                  <span class="text-xs font-semibold text-text-heading">
                    {{ t("traces.sessionDetail.rail.slowestTurns") }}
                  </span>
                </div>
                <div class="max-h-60 overflow-y-auto p-1.5 flex flex-col gap-[0.1rem]">
                  <TurnPreviewCard
                    v-for="(row, i) in slowestTurns"
                    :key="row.n"
                    :turn="traces[row.n - 1]"
                    :index="row.n - 1"
                    :cache-pct="cacheRatio"
                    side="right"
                  >
                    <button
                      class="flex items-center gap-2 w-full px-[0.4rem] py-[0.35rem] rounded-default text-left cursor-pointer hover:bg-[color-mix(in_srgb,var(--color-text-heading)_4%,transparent)]"
                      @click="jumpToTurn(row.n)"
                    >
                      <span
                        class="w-5 h-5 rounded-default grid place-items-center text-3xs font-bold tabular-nums flex-shrink-0 bg-[color-mix(in_srgb,var(--color-text-heading)_8%,transparent)] text-text-secondary"
                      >
                        {{ i + 1 }}
                      </span>
                      <span class="text-xs font-semibold text-text-heading w-11 flex-shrink-0">
                        {{ t("traces.sessionDetail.turnLabel") }} {{ row.n }}
                      </span>
                      <span class="flex-1 min-w-0">
                        <OProgressBar
                          :value="ratio(row.lat, maxTurnLat)"
                          :variant="row.status === 'error' ? 'danger' : 'warning'"
                          size="xs"
                        />
                      </span>
                      <span
                        class="text-2xs font-semibold tabular-nums text-text-secondary min-w-11 text-right"
                      >
                        {{ formatDuration(row.lat) }}
                      </span>
                      <OIcon name="chevron-right" size="xs" class="text-text-muted flex-shrink-0" />
                    </button>
                  </TurnPreviewCard>
                </div>
              </div>
            </aside>
          </div>
        </template>
      </div>
    </OPageLayout>
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
import { messagesFromInput, messagesFromOutput, getModel } from "./threadView.utils";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
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

import { splitNumberWithUnit, splitDuration } from "./llmInsightsDashboard.utils";
import { renderMarkdown } from "./markdown";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const store = useStore();

const { fetchSession, fetchSessionSpans } = useSessions();
const detail = ref<SessionDetail | null>(null);
const traces = ref<SessionTraceRow[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

const sessionId = computed(() =>
  typeof route.query.session_id === "string" ? route.query.session_id : "",
);
const streamName = computed(() =>
  typeof route.query.stream === "string" ? route.query.stream : "",
);
const startTime = computed(() =>
  typeof route.query.from === "string" ? Number(route.query.from) : 0,
);
const endTime = computed(() => (typeof route.query.to === "string" ? Number(route.query.to) : 0));

// Per-turn rollups used by the KPI sub-lines. All values are measured from the
// real trace rows returned by the session-detail API.
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
  const slowestTurn = (lats.indexOf(slowestLat) >= 0 ? lats.indexOf(slowestLat) : 0) + 1;

  const costs = rows.map((tr) => tr.cost);
  const maxCost = costs.length ? Math.max(...costs) : 0;
  const peakTurn = (costs.indexOf(maxCost) >= 0 ? costs.indexOf(maxCost) : 0) + 1;

  const cachedTokens = d.cacheReadInputTokens;
  const cacheDenominator = cacheInputDenominator(d);
  const cacheRatio = cacheDenominator ? Math.round((cachedTokens / cacheDenominator) * 100) : 0;
  const hasNetCacheImpact = d.estimatedCostWithoutCache > 0 || d.netCacheImpact !== 0;
  const cacheImpact = hasNetCacheImpact ? d.netCacheImpact : d.cacheReadSavings;

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
    cacheImpact,
  };
});

// Session-level cache reuse %, surfaced to turn-preview chips and ribbon hovers.
const cacheRatio = computed(() => sessionStats.value?.cacheRatio ?? 0);

function cacheInputDenominator(d: SessionDetail): number {
  const promptTokensFromTotal = Math.max(0, d.tokens - d.outputTokens);
  let denominator = Math.max(promptTokensFromTotal, d.inputTokens);
  const separateCacheTokens = d.cacheReadInputTokens + d.cacheCreationInputTokens;

  if (separateCacheTokens > denominator) {
    denominator = d.inputTokens + separateCacheTokens;
  }

  return denominator;
}

// KPI tile classes. Mirrors the `statusBadgeClass()` pattern this module already
// uses — a function returns the Tailwind class string for a given variant, so the
// (shared) card chrome + danger surface tint live in one place and the skeleton
// and real tiles stay in sync. Styling is Tailwind-only (no scoped CSS). Only
// Errors uses a variant (red when > 50% error rate); every other tile is neutral.
function kpiCardClass(variant?: "danger"): string {
  const base =
    "flex flex-col justify-center gap-1 px-3.5 py-2.5 rounded-default border transition-shadow hover:shadow-[0_1px_6px_rgba(0,0,0,0.08)]";
  if (variant === "danger")
    return `${base} bg-[color-mix(in_srgb,var(--color-error-500)_5%,var(--color-surface-base))] border-[color-mix(in_srgb,var(--color-error-500)_35%,var(--color-border-default))]`;
  return `${base} bg-surface-base border-border-default`;
}

// Accent text colour for a variant's value; "" → use the neutral default.
function kpiAccentClass(variant?: "danger"): string {
  if (variant === "danger") return "text-error-500";
  return "";
}

/** A turn reference inside a KPI sub-line — rendered as a hover-preview chip. */
interface TurnChip {
  n: number; // 1-based turn number
  label: string;
}

// Session-level KPI tiles. Each sub-line is split into `subLead` text, optional
// `subTurns` chips (hoverable turn references), and `subTail` text so individual
// turn numbers can carry the TurnPreviewCard tooltip. Session costs stay at
// four decimal places because LLM sessions are usually sub-cent values.
const kpiCards = computed<
  {
    key: string;
    label: string;
    /** Material-symbol icon name (OIcon) shown next to the tile label. */
    icon: string;
    value: string;
    unit: string;
    subLead: string;
    subTurns: TurnChip[];
    subTail: string;
    variant?: "danger";
    estimate?: boolean;
    tooltipRows?: { label: string; value: string }[];
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
  const cost = { value: usd4(d.cost), unit: "" };
  const tokens = splitNumberWithUnit(d.tokens);
  const turnWord = t("traces.sessionDetail.turnLabel");

  return [
    {
      key: "turns",
      icon: "forum",
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
      icon: "error",
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
      subTurns: s.errors > 3 ? [] : s.errorTurnNums.map((n) => ({ n, label: String(n) })),
      filterErrors: s.errors > 3,
      subTail: "",
    },
    {
      key: "latency",
      icon: "schedule",
      label: t("traces.sessionDetail.kpi.duration"),
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
      icon: "payments",
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
      icon: "tag",
      label: t("traces.sessionDetail.kpi.tokens"),
      value: tokens.value,
      unit: tokens.unit,
      subLead: t("traces.sessionDetail.kpiSub.tokens", { ratio: s.cacheRatio }),
      subTurns: [],
      subTail: "",
    },
    {
      key: "cacheImpact",
      icon: "bolt",
      label: t("traces.sessionDetail.kpi.cacheImpact"),
      value: signedUsd4(s.cacheImpact),
      unit: "",
      variant: s.cacheImpact < 0 ? "danger" : undefined,
      estimate: true,
      tooltipRows: [
        {
          label: t("traces.sessionDetail.kpiSub.actualCost"),
          value: usd4(d.cost),
        },
        {
          label: t("traces.sessionDetail.kpiSub.estimatedWithoutCache"),
          value: usd4(d.estimatedCostWithoutCache),
        },
        {
          label: t("traces.sessionDetail.kpiSub.grossCacheReadSavings"),
          value: usd4(d.cacheReadSavings),
        },
        {
          label: t("traces.sessionDetail.kpiSub.cacheCreationCost"),
          value: usd4(d.cacheCreationInputCost),
        },
        {
          label: t("traces.sessionDetail.kpiSub.netCacheImpact"),
          value: signedUsd4(s.cacheImpact),
        },
      ],
      subLead: t("traces.sessionDetail.kpiSub.cacheImpact", {
        ratio: s.cacheRatio,
        tokens: formatTokens(s.cachedTokens),
      }),
      subTurns: [],
      subTail: "",
    },
  ];
});

// ── Conversation: filters, sort, expand. All client-side over `traces`. ──
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
  { key: "latency", label: "traces.sessionDetail.kpi.duration" },
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
  return s === "asc" ? "arrow-upward" : s === "desc" ? "arrow-downward" : "unfold-more";
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
// the transcript can never disagree. Spans are grouped by `trace_id` and
// classified exactly like ThreadView.
const LLM_OPS = new Set(["chat", "text_completion", "generate_content", "embeddings"]);

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
      .sort((a, b) => (Number(a.start_time) || 0) - (Number(b.start_time) || 0));

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
    if (statusFilter.value !== "all" && tr.status !== statusFilter.value) return false;
    if (modelFilter.value !== "all" && !tr.models.includes(modelFilter.value)) return false;
    if (q) {
      const hay = [tr.traceId, tr.model || "", tr.turnUserMessage || ""].join(" ").toLowerCase();
      if (!hay.includes(q)) {
        const td = turnDetailsByTrace.value[tr.traceId];
        const msgHay = [td?.userMessage?.content || "", td?.assistantMessage?.content || ""]
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
  else if (sortKey.value === "cost") rows = [...rows].sort((a, b) => (a.cost - b.cost) * dir);
  else if (sortKey.value === "tokens") rows = [...rows].sort((a, b) => (a.tokens - b.tokens) * dir);
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
    if (String(s.gen_ai_operation_name || "").toLowerCase() !== "execute_tool") continue;
    const tid = String(s.trace_id || "");
    if (!tid) continue;
    (out[tid] ||= []).push(s);
  }
  for (const tid of Object.keys(out)) {
    out[tid].sort((a, b) => (Number(a.start_time) || 0) - (Number(b.start_time) || 0));
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
// pending a backend per-tool attribution).
const slowestTurns = computed(() =>
  traces.value
    .map((t, i) => ({ n: i + 1, lat: t.durationNanos, status: t.status }))
    .sort((a, b) => b.lat - a.lat),
);
const costHotspots = computed(() =>
  traces.value.map((t, i) => ({ n: i + 1, cost: t.cost })).sort((a, b) => b.cost - a.cost),
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
  const agg: Record<string, Omit<ToolHotspot, "turns"> & { turnsSet: Set<number> }> = {};
  for (const s of sessionSpans.value) {
    if (String(s.gen_ai_operation_name || "").toLowerCase() !== "execute_tool") continue;
    const name = String(s.tool_name || s.gen_ai_tool_name || s.operation_name || "tool");
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
// True once the error filter is applied, so the KPI button flips to "Reset".
const errorsFiltered = computed(() => statusFilter.value === "error");
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

// "Reset Filters" (shown in place of "Filter Errors" once errors are filtered):
// clear the status filter so the full conversation is visible again.
function resetErrorFilter() {
  searchText.value = "";
  statusFilter.value = "all";
  modelFilter.value = "all";
  sortKey.value = "turn";
  sortDir.value = "asc";
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
const maxTurnTokens = computed(() => traces.value.reduce((m, tr) => Math.max(m, tr.tokens), 0));
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

// Turn-row chrome: status surface tint + a transient ring on jump.
function turnRowClass(trace: SessionTraceRow): string {
  const n = originalTurnIndex(trace.traceId) + 1;
  // Status is conveyed by a subtle surface tint (red for errors) instead of a
  // coloured left border — keeps the row chrome flat, matching the KPI tiles.
  const surface =
    trace.status === "error"
      ? "bg-[color-mix(in_srgb,var(--color-error-500)_5%,var(--color-surface-base))]"
      : "bg-surface-base";
  const flash = flashTurn.value === n ? " ring-2 ring-primary-500" : "";
  return `rounded-default border border-border-default ${surface} overflow-hidden${flash}`;
}

async function load() {
  if (!sessionId.value || !streamName.value) {
    error.value = t("traces.sessionDetails.missingSessionInfo");
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
    error.value = e?.message || t("traces.sessionDetails.failedToLoadSession");
    // Log both the parsed message and the raw envelope so we can see
    // DataFusion's actual complaint (e.g. unknown column, bad GROUP BY)
    // instead of the generic wrapper.
    console.error("Session details fetch error:", e?.message, e?.raw?.content ?? e?.raw ?? e);
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
  copyToClipboard(text, { successMessage: t("traces.sessionDetails.copied"), timeout: 1000 });
}

function usd4(v: number): string {
  return `$${v.toFixed(4)}`;
}

function signedUsd4(v: number): string {
  return v < 0 ? `-$${Math.abs(v).toFixed(4)}` : usd4(v);
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

onMounted(load);
</script>

<style scoped lang="scss">
/* keep(generated-content): markdown styling for the assistant message injected
   with v-html. Those nodes carry no scope attribute and no classes of their own,
   so :deep() element selectors are the only expressible form — a Tailwind
   utility cannot reach them. All colours map to --color-* tokens, so this one
   rule set covers light and dark. */
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
    font-size: var(--text-base);
  }
  :deep(h2) {
    font-size: var(--text-base);
  }
  :deep(h3) {
    font-size: var(--text-sm);
  }
  :deep(h4) {
    font-size: var(--text-compact);
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
    color: var(--color-text-link);
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }
  :deep(code) {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    background: color-mix(in srgb, var(--color-text-heading) 8%, transparent);
    padding: 0.1rem 0.3rem;
    border-radius: 0.1875rem;
  }
  :deep(pre) {
    background: color-mix(in srgb, var(--color-text-heading) 5%, transparent);
    border: 1px solid var(--color-border-default);
    padding: 0.5rem 0.625rem;
    border-radius: var(--radius-default);
    overflow-x: auto;
    margin: 0.5rem 0;
  }
  :deep(pre code) {
    background: transparent;
    padding: 0;
  }
  :deep(blockquote) {
    border-left: 0.1875rem solid var(--color-border-default);
    margin: 0.5rem 0;
    padding-left: 0.75rem;
    color: var(--color-text-secondary);
  }
  :deep(table) {
    border-collapse: collapse;
    width: 100%;
    margin: 0.5rem 0;
    font-size: var(--text-xs);
  }
  :deep(th),
  :deep(td) {
    border: 1px solid var(--color-border-default);
    padding: 0.3rem 0.5rem;
    text-align: left;
  }
  :deep(th) {
    background: color-mix(in srgb, var(--color-text-heading) 6%, transparent);
    font-weight: 600;
  }
  :deep(hr) {
    border: none;
    border-top: 1px solid var(--color-border-default);
    margin: 0.625rem 0;
  }
}
</style>
