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
    class="session-details-page tw:h-[calc(100vh-2.6rem)] tw:px-[0.625rem] tw:py-[0.375rem]"
  >
  <div
    class="session-details card-container tw:h-full tw:flex tw:flex-col tw:px-[1rem] tw:py-[0.625rem] tw:overflow-y-auto"
  >
    <!-- Back nav -->
    <div class="tw:flex tw:items-center tw:gap-[0.5rem] tw:mb-[0.625rem]">
      <OButton variant="ghost-muted" size="icon" @click="goBack">
        <OIcon name="arrow-back" size="sm" />
        <OTooltip :content="t('traces.sessionDetail.backToSessions')" />
      </OButton>
      <span class="tw:text-[1rem] tw:font-semibold">{{ t('traces.sessionDetail.pageTitle') }}</span>
    </div>

    <!-- Loading -->
    <div
      v-if="loading"
      class="tw:flex tw:items-center tw:justify-center tw:flex-1"
    >
      <OSpinner size="md" />
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
      <!-- Toolbar: search + filters + count text -->
      <div
        class="tw:flex tw:items-center tw:gap-[0.5rem] tw:mb-[0.625rem] tw:flex-wrap"
      >
        <OSearchInput
          v-model="searchText"
          :placeholder="t('traces.sessionDetail.searchPlaceholder')"
          clearable
          :debounce="200"
          size="xs"
          class="no-border tw:w-[18rem]! tw:h-[36px]"
        />
        <OSelect
          v-model="statusFilter"
          :options="statusOptions"
          size="sm"
          class="tw:w-[10rem]"
        />
        <OSelect
          v-model="modelFilter"
          :options="modelOptions"
          size="sm"
          class="tw:w-[14rem]"
        />
        <span
          class="tw:ml-auto tw:text-[0.75rem] tw:text-[var(--o2-text-muted)]"
        >
          {{ t('traces.sessionDetail.turnsShown', { filtered: filteredTraces.length, total: traces.length, unit: traces.length === 1 ? t('traces.sessionDetail.turn') : t('traces.sessionDetail.turns') }) }}
        </span>
      </div>

      <!-- User + session id header -->
      <div
        class="tw:flex tw:items-center tw:justify-between tw:px-[1rem] tw:py-[0.75rem] tw:rounded tw:border tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-card-bg)] tw:mb-[0.625rem]"
      >
        <div class="tw:flex tw:items-center tw:gap-[0.75rem]">
          <span
            v-if="detail.userId || routeUserId"
            class="tw:inline-flex tw:items-center tw:justify-center tw:w-[36px] tw:h-[36px] tw:rounded-full tw:text-[12px] tw:font-semibold tw:text-white"
            :style="{ background: userAvatarColor(detail.userId || routeUserId) }"
          >
            {{ userInitials(detail.userId || routeUserId) }}
          </span>
          <div class="tw:flex tw:flex-col">
            <span
              class="tw:text-[0.95rem] tw:font-semibold tw:text-[var(--o2-text-primary)] tw:flex tw:items-center tw:gap-[0.5rem]"
            >
              {{ detail.userId || routeUserId || t('traces.sessionDetail.unknownUser') }}
              <span
                class="tw:text-[0.6rem] tw:font-semibold tw:px-[0.375rem] tw:py-[0.05rem] tw:rounded tw:bg-[var(--o2-tag-grey-1)] tw:text-[var(--o2-text-4)]"
              >
                {{ t('traces.sessionDetail.userBadge') }}
              </span>
            </span>
            <span
              class="tw:text-[0.75rem] tw:font-mono tw:text-[var(--o2-text-muted)] tw:flex tw:items-center tw:gap-[0.375rem]"
            >
              {{ t('traces.sessionDetail.sessionPrefix') }} {{ detail.sessionId }}
              <OTooltip :content="t('traces.sessionDetail.copySessionId')">
                <OIcon
                  name="content-copy"
                  size="xs"
                  class="tw:cursor-pointer tw:hover:text-[var(--o2-text-primary)]"
                  @click="copySessionId"
                />
              </OTooltip>
            </span>
          </div>
        </div>
        <OButton variant="outline" size="sm" @click="openInTraceExplorer">
          <OIcon name="open-in-new" size="xs" class="tw:mr-[0.25rem]" />
          {{ t('traces.sessionDetail.openInTraceExplorer') }}
        </OButton>
      </div>

      <!-- KPI strip (5 columns) -->
      <div class="kpi-strip tw:mb-[0.625rem]">
        <div class="kpi-cell">
          <div class="kpi-label">{{ t('traces.sessionDetail.kpi.turns') }}</div>
          <div class="kpi-value">{{ detail.turns }}</div>
        </div>
        <div class="kpi-cell">
          <div class="kpi-label">{{ t('traces.sessionDetail.kpi.duration') }}</div>
          <div class="kpi-value">
            {{ formatDuration(detail.durationNanos) }}
          </div>
        </div>
        <div class="kpi-cell">
          <div class="kpi-label">{{ t('traces.sessionDetail.kpi.inputTokens') }}</div>
          <div class="kpi-value">{{ formatTokens(detail.inputTokens) }}</div>
        </div>
        <div class="kpi-cell">
          <div class="kpi-label">{{ t('traces.sessionDetail.kpi.outputTokens') }}</div>
          <div class="kpi-value">{{ formatTokens(detail.outputTokens) }}</div>
        </div>
        <div class="kpi-cell">
          <div class="kpi-label">{{ t('traces.sessionDetail.kpi.cost') }}</div>
          <div class="kpi-value">${{ detail.cost.toFixed(2) }}</div>
        </div>
      </div>

      <!-- Conversation header -->
      <div class="tw:flex tw:items-center tw:gap-[0.5rem] tw:mb-[0.5rem]">
        <span
          class="tw:text-[0.85rem] tw:font-semibold tw:text-[var(--o2-text-primary)]"
        >
          {{ t('traces.sessionDetail.conversation') }}
        </span>
        <span class="tw:text-[0.7rem] tw:text-[var(--o2-text-muted)]">
          · {{ t('traces.sessionDetail.turnsShown', { filtered: filteredTraces.length, total: traces.length, unit: traces.length === 1 ? t('traces.sessionDetail.turn') : t('traces.sessionDetail.turns') }) }}
        </span>
      </div>

      <!-- Turns list -->
      <div class="tw:flex tw:flex-col tw:gap-[0.5rem] tw:pb-[1rem]">
        <div
          v-for="(trace, i) in filteredTraces"
          :key="trace.traceId"
          class="turn-card"
          :class="{
            'turn-card--error': trace.status === 'error',
            'turn-card--ok': trace.status === 'ok',
          }"
        >
          <!-- Row header (always visible, click to expand) -->
          <div
            class="turn-header"
            :data-test="`session-turn-row-${trace.traceId}`"
            @click="toggleTurn(trace.traceId)"
          >
            <OIcon
              :name="isExpanded(trace.traceId) ? 'expand-more' : 'chevron-right'"
              size="sm"
              class="tw:text-[var(--o2-text-muted)] tw:flex-shrink-0"
            />
            <span
              class="tw:text-[0.85rem] tw:font-semibold tw:text-[var(--o2-text-primary)]"
            >
              {{ t('traces.sessionDetail.turnLabel') }} {{ originalTurnIndex(trace.traceId) + 1 }}
            </span>
            <span
              class="tw:text-[0.75rem] tw:font-mono tw:text-[var(--o2-text-muted)]"
            >
              {{ formatTimestamp(trace.startTimeMicros) }}
            </span>
            <span class="tw:text-[0.75rem] tw:text-[var(--o2-text-muted)]">
              · {{ formatDuration(trace.durationNanos) }}
            </span>
            <span class="tw:text-[0.75rem] tw:text-[var(--o2-text-muted)]">
              · ${{ trace.cost.toFixed(4) }}
            </span>
            <span
              class="tw:rounded tw:px-[0.375rem] tw:py-[0.05rem] tw:text-[0.65rem] tw:font-semibold tw:capitalize tw:inline-flex tw:items-center tw:gap-[0.25rem]"
              :class="statusBadgeClass(trace.status)"
            >
              <OIcon
                :name="trace.status === 'error' ? 'close' : 'check'"
                size="xs"
              />
              {{ trace.status }}
            </span>
            <span
              v-if="trace.tokens"
              class="tw:text-[0.7rem] tw:text-[var(--o2-text-muted)] tw:tabular-nums"
            >
              {{ formatTokens(trace.inputTokens) }} → {{ formatTokens(trace.outputTokens) }} (Σ {{ formatTokens(trace.tokens) }})
            </span>
            <span class="tw:ml-auto tw:flex tw:items-center tw:gap-[0.25rem]">
              <span
                class="tw:text-[0.7rem] tw:font-mono tw:text-[var(--o2-text-muted)]"
              >
                {{ trace.traceId }}
              </span>
              <OButton
                variant="outline"
                size="icon"
                :title="t('traces.sessionDetail.openTrace')"
                @click.stop="openTrace(trace.traceId)"
              >
                <OIcon name="open-in-new" size="xs" />
              </OButton>
              <OButton
                v-if="isExpanded(trace.traceId) && !turnDetailLoading[trace.traceId]"
                variant="outline"
                size="icon"
                :title="t('traces.sessionDetail.fullscreen.expandTurn')"
                @click.stop="openFullscreen(trace.traceId)"
              >
                <OIcon name="fullscreen" size="xs" />
              </OButton>
            </span>
          </div>

          <!-- Expanded body -->
          <div v-if="isExpanded(trace.traceId)" class="turn-body">
            <!-- Skeleton while turn detail is loading -->
            <div v-if="turnDetailLoading[trace.traceId]" class="turn-grid">
              <!-- Messages skeleton -->
              <div class="turn-messages">
                <!-- User tw:block skeleton -->
                <div class="msg-block msg-block--user">
                  <div class="msg-block__header">
                    <OSkeleton type="rect" class="tw:rounded" style="width: 2.5rem; height: 0.7rem" />
                  </div>
                  <div class="msg-block__body tw:flex tw:flex-col tw:gap-[0.4rem]">
                    <OSkeleton type="rect" class="tw:rounded" style="width: 70%; height: 0.65rem" />
                    <OSkeleton type="rect" class="tw:rounded" style="width: 45%; height: 0.65rem" />
                  </div>
                </div>
                <!-- Assistant tw:block skeleton -->
                <div class="msg-block msg-block--assistant">
                  <div class="msg-block__header">
                    <OSkeleton type="rect" class="tw:rounded" style="width: 7rem; height: 0.7rem" />
                  </div>
                  <div class="msg-block__body tw:flex tw:flex-col tw:gap-[0.4rem]">
                    <OSkeleton type="rect" class="tw:rounded" style="width: 95%; height: 0.65rem" />
                    <OSkeleton type="rect" class="tw:rounded" style="width: 88%; height: 0.65rem" />
                    <OSkeleton type="rect" class="tw:rounded" style="width: 80%; height: 0.65rem" />
                    <OSkeleton type="rect" class="tw:rounded" style="width: 60%; height: 0.65rem" />
                  </div>
                </div>
              </div>
              <!-- Stats skeleton -->
              <div class="turn-stats">
                <!-- Status -->
                <div class="stat-section">
                  <OSkeleton type="rect" class="tw:rounded tw:mb-[0.375rem]" style="width: 3rem; height: 0.6rem" />
                  <OSkeleton type="rect" class="tw:rounded" style="width: 100%; height: 1.5rem" />
                </div>
                <!-- Tokens -->
                <div class="stat-section">
                  <OSkeleton type="rect" class="tw:rounded tw:mb-[0.375rem]" style="width: 3.5rem; height: 0.6rem" />
                  <div class="stat-rows">
                    <div v-for="n in 3" :key="n" class="stat-row">
                      <OSkeleton type="rect" class="tw:rounded" style="width: 3rem; height: 0.6rem" />
                      <OSkeleton type="rect" class="tw:rounded" style="width: 3.5rem; height: 0.6rem" />
                    </div>
                  </div>
                </div>
                <!-- Cost -->
                <div class="stat-section">
                  <OSkeleton type="rect" class="tw:rounded tw:mb-[0.375rem]" style="width: 2.5rem; height: 0.6rem" />
                  <OSkeleton type="rect" class="tw:rounded" style="width: 4rem; height: 0.75rem" />
                </div>
                <!-- Spans -->
                <div class="stat-section">
                  <OSkeleton type="rect" class="tw:rounded tw:mb-[0.375rem]" style="width: 3rem; height: 0.6rem" />
                  <div class="stat-rows">
                    <div class="stat-row">
                      <OSkeleton type="rect" class="tw:rounded" style="width: 3rem; height: 0.6rem" />
                      <OSkeleton type="rect" class="tw:rounded" style="width: 2rem; height: 0.6rem" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div v-else class="turn-grid">
              <!-- Messages column -->
              <div class="turn-messages">
                <!-- USER tw:block -->
                <div class="msg-block msg-block--user">
                  <div class="msg-block__header">
                    <span class="msg-block__role">{{ t('traces.sessionDetail.roles.user') }}</span>
                    <OIcon
                      v-if="turnDetail(trace.traceId)?.userMessage"
                      name="content-copy"
                      size="xs"
                      class="tw:cursor-pointer tw:opacity-60 tw:hover:opacity-100"
                      @click="copyText(turnDetail(trace.traceId)?.userMessage?.content)"
                    />
                  </div>
                  <div class="msg-block__body">
                    {{
                      turnDetail(trace.traceId)?.userMessage?.content ||
                      t('traces.sessionDetail.noUserMessage')
                    }}
                  </div>
                </div>

                <!-- ASSISTANT tw:block -->
                <div class="msg-block msg-block--assistant">
                  <div class="msg-block__header">
                    <span class="msg-block__role">
                      {{ t('traces.sessionDetail.roles.assistant') }}
                      <span
                        v-if="turnDetail(trace.traceId)?.model"
                        class="tw:text-[var(--o2-text-muted)] tw:ml-[0.25rem] tw:normal-case tw:font-normal"
                      >
                        · {{ turnDetail(trace.traceId)?.model }}
                      </span>
                    </span>
                    <OIcon
                      v-if="turnDetail(trace.traceId)?.assistantMessage"
                      name="content-copy"
                      size="xs"
                      class="tw:cursor-pointer tw:opacity-60 tw:hover:opacity-100"
                      @click="copyText(turnDetail(trace.traceId)?.assistantMessage?.content)"
                    />
                  </div>
                  <div class="msg-block__body">
                    {{
                      turnDetail(trace.traceId)?.assistantMessage?.content ||
                      t('traces.sessionDetail.noAssistantMessage')
                    }}
                  </div>
                </div>
              </div>

              <!-- Right-side stats column -->
              <div class="turn-stats">
                <div class="stat-section">
                  <div class="stat-label">{{ t('traces.sessionDetail.stats.status') }}</div>
                  <div
                    class="stat-value tw:inline-flex tw:items-center tw:gap-1 tw:rounded tw:px-2 tw:py-0.5 tw:text-[0.75rem] tw:font-semibold"
                    :class="statusBadgeClass(trace.status)"
                  >
                    <span
                      class="tw:inline-block tw:w-2 tw:h-2 tw:rounded-full tw:flex-shrink-0"
                      :class="statusDotClass(trace.status)"
                    />
                    {{ trace.status.charAt(0).toUpperCase() + trace.status.slice(1) }}
                  </div>
                </div>
                <div v-if="trace.model" class="stat-section">
                  <div class="stat-label">{{ t('traces.sessionDetail.stats.model') }}</div>
                  <div class="stat-value tw:font-mono tw:text-[0.75rem]!">
                    {{ trace.model }}
                  </div>
                </div>
                <div class="stat-section">
                  <div class="stat-label">{{ t('traces.sessionDetail.stats.tokens') }}</div>
                  <div class="stat-rows">
                    <div class="stat-row">
                      <span>{{ t('traces.sessionDetail.stats.input') }}</span>
                      <span class="tw:tabular-nums">{{ trace.inputTokens.toLocaleString() }}</span>
                    </div>
                    <div class="stat-row">
                      <span>{{ t('traces.sessionDetail.stats.output') }}</span>
                      <span class="tw:tabular-nums">{{ trace.outputTokens.toLocaleString() }}</span>
                    </div>
                    <div class="stat-row stat-row--total">
                      <span>{{ t('traces.sessionDetail.stats.total') }}</span>
                      <span class="tw:tabular-nums">{{ trace.tokens.toLocaleString() }}</span>
                    </div>
                  </div>
                </div>
                <div class="stat-section stat-section--inline">
                  <span class="stat-label">{{ t('traces.sessionDetail.stats.cost') }}</span>
                  <span class="stat-value tw:text-[0.8rem]!">${{ trace.cost.toFixed(4) }}</span>
                </div>
                <div class="stat-section">
                  <div class="stat-label">{{ t('traces.sessionDetail.stats.spans') }}</div>
                  <div class="stat-rows">
                    <div v-if="turnDetail(trace.traceId)?.llmCalls" class="stat-row">
                      <span>{{ t('traces.sessionDetail.stats.llmCalls') }}</span>
                      <span class="tw:tabular-nums">{{ turnDetail(trace.traceId)!.llmCalls }}</span>
                    </div>
                    <div v-if="turnDetail(trace.traceId)?.toolCalls" class="stat-row">
                      <span>{{ t('traces.sessionDetail.stats.toolCalls') }}</span>
                      <span class="tw:tabular-nums">{{ turnDetail(trace.traceId)!.toolCalls }}</span>
                    </div>
                    <div v-if="turnDetail(trace.traceId)?.otherCalls" class="stat-row">
                      <span class="tw:flex tw:items-center tw:gap-[0.25rem]">
                        {{ t('traces.sessionDetail.stats.otherCalls') }}
                        <OTooltip max-width="220px">
                          <OIcon name="info" size="xs" class="tw:text-[var(--o2-text-muted)] tw:cursor-default" />
                          <template #content>
                            {{ t('traces.sessionDetail.stats.otherCallsTooltip') }}<br />
                            <span class="tw:font-mono tw:text-[0.7rem]">{{ turnDetail(trace.traceId)!.otherOps.join(', ') }}</span>
                          </template>
                        </OTooltip>
                      </span>
                      <span class="tw:tabular-nums">{{ turnDetail(trace.traceId)!.otherCalls }}</span>
                    </div>
                    <div class="stat-row stat-row--total">
                      <span>{{ t('traces.sessionDetail.stats.total') }}</span>
                      <span class="tw:tabular-nums">{{
                        (turnDetail(trace.traceId)?.llmCalls ?? 0) +
                        (turnDetail(trace.traceId)?.toolCalls ?? 0) +
                        (turnDetail(trace.traceId)?.otherCalls ?? 0)
                      }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>

  <!-- Fullscreen turn dialog -->
  <ODialog v-model:open="fullscreenOpen" size="full" :show-close="false">
    <div class="fullscreen-turn-dialog" v-if="fullscreenTraceId && fullscreenTrace">
      <!-- Header — mirrors the tw:inline turn-header row -->
      <div
        class="fullscreen-turn-dialog__header"
        :class="{
          'fullscreen-turn-dialog__header--error': fullscreenTrace.status === 'error',
          'fullscreen-turn-dialog__header--ok': fullscreenTrace.status === 'ok',
        }"
      >
        <span class="tw:text-[0.85rem] tw:font-semibold tw:text-[var(--o2-text-primary)]">
          {{ t('traces.sessionDetail.turnLabel') }} {{ originalTurnIndex(fullscreenTraceId) + 1 }}
        </span>
        <span class="tw:text-[0.75rem] tw:font-mono tw:text-[var(--o2-text-muted)]">
          {{ formatTimestamp(fullscreenTrace.startTimeMicros) }}
        </span>
        <span class="tw:text-[0.75rem] tw:text-[var(--o2-text-muted)]">
          · {{ formatDuration(fullscreenTrace.durationNanos) }}
        </span>
        <span class="tw:text-[0.75rem] tw:text-[var(--o2-text-muted)]">
          · ${{ fullscreenTrace.cost.toFixed(4) }}
        </span>
        <span
          class="tw:rounded tw:px-[0.375rem] tw:py-[0.05rem] tw:text-[0.65rem] tw:font-semibold tw:capitalize tw:inline-flex tw:items-center tw:gap-[0.25rem]"
          :class="statusBadgeClass(fullscreenTrace.status)"
        >
          <OIcon
            :name="fullscreenTrace.status === 'error' ? 'close' : 'check'"
            size="xs"
          />
          {{ fullscreenTrace.status }}
        </span>
        <span
          v-if="fullscreenTrace.tokens"
          class="tw:text-[0.7rem] tw:text-[var(--o2-text-muted)] tw:tabular-nums"
        >
          {{ formatTokens(fullscreenTrace.inputTokens) }} → {{ formatTokens(fullscreenTrace.outputTokens) }} (Σ {{ formatTokens(fullscreenTrace.tokens) }})
        </span>
        <span class="tw:ml-auto tw:flex tw:items-center tw:gap-[0.375rem]">
          <span class="tw:text-[0.7rem] tw:font-mono tw:text-[var(--o2-text-muted)]">
            {{ fullscreenTraceId }}
          </span>
          <OButton
            variant="outline"
            size="icon"
            :title="t('traces.sessionDetail.openTrace')"
            @click="openTrace(fullscreenTraceId)"
          >
            <OIcon name="open-in-new" size="xs" />
          </OButton>
          <OButton
            variant="outline"
            size="icon"
            :title="t('traces.sessionDetail.fullscreen.close')"
            @click="fullscreenOpen = false"
          >
            <OIcon name="fullscreen-exit" size="sm" />
          </OButton>
        </span>
      </div>

      <!-- Two panels: user 50% / assistant 50% -->
      <div class="fullscreen-turn-dialog__body">
        <!-- User panel -->
        <div class="fullscreen-panel fullscreen-panel--user">
          <div class="fullscreen-panel__header">
            <span class="fullscreen-panel__role">{{ t('traces.sessionDetail.roles.user') }}</span>
            <OIcon
              v-if="turnDetail(fullscreenTraceId)?.userMessage"
              name="content-copy"
              size="xs"
              class="tw:cursor-pointer tw:opacity-60 tw:hover:opacity-100"
              @click="copyText(turnDetail(fullscreenTraceId)?.userMessage?.content)"
            />
          </div>
          <div class="fullscreen-panel__content">
            {{ turnDetail(fullscreenTraceId)?.userMessage?.content || t('traces.sessionDetail.noUserMessage') }}
          </div>
        </div>

        <!-- Assistant panel -->
        <div class="fullscreen-panel fullscreen-panel--assistant">
          <div class="fullscreen-panel__header">
            <span class="fullscreen-panel__role">
              {{ t('traces.sessionDetail.roles.assistant') }}
              <span
                v-if="turnDetail(fullscreenTraceId)?.model"
                class="tw:text-[var(--o2-text-muted)] tw:ml-[0.25rem] tw:normal-case tw:font-normal"
              >
                · {{ turnDetail(fullscreenTraceId)?.model }}
              </span>
            </span>
            <OIcon
              v-if="turnDetail(fullscreenTraceId)?.assistantMessage"
              name="content-copy"
              size="xs"
              class="tw:cursor-pointer tw:opacity-60 tw:hover:opacity-100"
              @click="copyText(turnDetail(fullscreenTraceId)?.assistantMessage?.content)"
            />
          </div>
          <div class="fullscreen-panel__content">
            {{ turnDetail(fullscreenTraceId)?.assistantMessage?.content || t('traces.sessionDetail.noAssistantMessage') }}
          </div>
        </div>
      </div>
    </div>
  </ODialog>
  </div>
</template>

<script lang="ts" setup>
import { ref, onMounted, computed, reactive } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { formatDate } from "@/utils/date";
import { copyToClipboard } from "@/utils/clipboard";
import { useI18n } from "vue-i18n";
import {
  useSessions,
  type SessionDetail,
  type SessionTraceRow,
  type TurnDetail,
} from "./composables/useSessions";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { b64EncodeUnicode } from "@/utils/zincutils";
import useTraces from "@/composables/useTraces";

import {
  splitNumberWithUnit,
  splitDuration,
} from "./llmInsightsDashboard.utils";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const store = useStore();

const { fetchSession, fetchTurnDetail } = useSessions();
const { searchObj } = useTraces();
const detail = ref<SessionDetail | null>(null);
const traces = ref<SessionTraceRow[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

// Turn-detail lazy state — populated on first expand of a given turn.
const turnDetails = reactive<Record<string, TurnDetail>>({});
const turnDetailLoading = reactive<Record<string, boolean>>({});
const expandedTurns = reactive<Record<string, boolean>>({});

// Fullscreen turn viewer
const fullscreenOpen = ref(false);
const fullscreenTraceId = ref<string | null>(null);
const fullscreenTrace = computed(() =>
  fullscreenTraceId.value
    ? traces.value.find((t) => t.traceId === fullscreenTraceId.value) ?? null
    : null,
);

function openFullscreen(traceId: string) {
  fullscreenTraceId.value = traceId;
  fullscreenOpen.value = true;
}

// Toolbar filters (all client-side over the in-memory turn list).
const searchText = ref("");
const statusFilter = ref<"all" | "ok" | "error">("all");
const modelFilter = ref<string>("all");

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
// Passed from the sessions list so the header renders immediately
// without waiting for fetchSession to complete.
const routeUserId = computed(() =>
  typeof route.query.user_id === "string" ? route.query.user_id : "",
);

const statusOptions = [
  { label: "All statuses", value: "all" },
  { label: "OK", value: "ok" },
  { label: "Error", value: "error" },
];

const modelOptions = computed(() => {
  const models = new Set<string>();
  traces.value.forEach((t) => t.models.forEach((m) => models.add(m)));
  return [
    { label: "All models", value: "all" },
    ...Array.from(models).map((m) => ({ label: m, value: m })),
  ];
});

const filteredTraces = computed(() => {
  const q = searchText.value.trim().toLowerCase();
  return traces.value.filter((t) => {
    if (statusFilter.value !== "all" && t.status !== statusFilter.value)
      return false;
    if (modelFilter.value !== "all" && !t.models.includes(modelFilter.value))
      return false;
    if (q) {
      const hay = [t.traceId, t.model || ""].join(" ").toLowerCase();
      if (!hay.includes(q)) {
        // Also search inside loaded turn detail messages, if any.
        const td = turnDetails[t.traceId];
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
});

function originalTurnIndex(traceId: string): number {
  return traces.value.findIndex((t) => t.traceId === traceId);
}

function isExpanded(traceId: string): boolean {
  return !!expandedTurns[traceId];
}

function turnDetail(traceId: string): TurnDetail | undefined {
  return turnDetails[traceId];
}

async function toggleTurn(traceId: string) {
  if (expandedTurns[traceId]) {
    expandedTurns[traceId] = false;
    return;
  }
  expandedTurns[traceId] = true;
  if (turnDetails[traceId]) return;
  turnDetailLoading[traceId] = true;
  try {
    const td = await fetchTurnDetail(
      streamName.value,
      traceId,
      startTime.value,
      endTime.value,
    );
    turnDetails[traceId] = td;
  } catch (e: any) {
    console.error("Turn detail fetch error:", e?.raw ?? e);
    // Surface as an empty turn so the user sees the tw:block instead of a
    // forever-spinning loader — they can still inspect the trace.
    turnDetails[traceId] = {
      traceId,
      userMessage: null,
      assistantMessage: null,
      model: null,
      llmCalls: 0,
      toolCalls: 0,
      otherCalls: 0,
      otherOps: [],
    };
  } finally {
    turnDetailLoading[traceId] = false;
  }
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

function openInTraceExplorer() {
  // The traces page is kept-alive — its onMounted/query-param parser
  // doesn't re-run on a regular route change, so a `tab=traces`
  // query param alone wouldn't update `searchMode` (it'd stay on
  // `"sessions"`, where we came from). Set it directly here so the
  // page picks up the Traces sub-tab synchronously.
  searchObj.meta.searchMode = "traces";

  // Match the traces page's URL contract:
  //   query → base64-encoded SQL predicate. `b64EncodeUnicode` produces
  //           the `.`-padded URL-safe form the traces page expects.
  //   from / to → absolute window we were navigated with — preserves
  //           the exact time scope of the session.
  const safeId = sessionId.value.replace(/'/g, "''");
  const encodedQuery =
    b64EncodeUnicode(`gen_ai_conversation_id='${safeId}'`) ?? "";
  router.push({
    name: "traces",
    query: {
      stream: streamName.value,
      from: startTime.value,
      to: endTime.value,
      query: encodedQuery,
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

function formatTimestamp(micros: number): string {
  if (!micros) return "—";
  return formatDate(Math.floor(micros / 1000), "YYYY-MM-DD HH:mm:ss");
}

function shortId(id: string): string {
  if (!id) return "—";
  if (id.length <= 16) return id;
  return `${id.slice(0, 8)}…${id.slice(-5)}`;
}

function formatDuration(nanos: number): string {
  if (!nanos) return "—";
  const d = splitDuration(nanos / 1000);
  return `${d.value}${d.unit}`;
}

function formatTokens(n: number): string {
  if (!n) return "0";
  const t = splitNumberWithUnit(n);
  return `${t.value}${t.unit}`;
}

function userInitials(userId: string): string {
  const name = userId.split("@")[0] || userId;
  const parts = name.split(/[._-]/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (name[0] + (name[1] || "")).toUpperCase();
}

function userAvatarColor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) {
    h = (h << 5) - h + userId.charCodeAt(i);
    h |= 0;
  }
  const hue = Math.abs(h) % 360;
  return `hsl(${hue}, 55%, 55%)`;
}

function statusBadgeClass(s: SessionTraceRow["status"]): string {
  switch (s) {
    case "error":
      return "tw:bg-[color-mix(in_srgb,var(--o2-service-health-critical)_12%,transparent)] tw:text-[var(--o2-service-health-critical)]";
    default:
      return "tw:bg-[color-mix(in_srgb,var(--o2-service-health-healthy,#16a34a)_12%,transparent)] tw:text-[var(--o2-service-health-healthy,#16a34a)]";
  }
}

function statusDotClass(s: SessionTraceRow["status"]): string {
  switch (s) {
    case "error":
      return "tw:bg-[var(--o2-service-health-critical)]";
    default:
      return "tw:bg-[var(--o2-service-health-healthy,#16a34a)]";
  }
}

onMounted(load);
</script>

<style lang="scss" scoped>
.session-details {
  background: var(--o2-card-bg-solid);
}

.kpi-strip {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.5rem;

  @media (max-width: 900px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.kpi-cell {
  background: var(--o2-card-bg);
  border: 1px solid var(--o2-border-color);
  border-radius: 0.375rem;
  padding: 0.625rem 0.75rem;
}

.kpi-label {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--o2-text-muted);
  margin-bottom: 0.25rem;
}

.kpi-value {
  font-size: 1.3rem;
  font-weight: 600;
  color: var(--o2-text-primary);
}

.turn-card {
  border: 1px solid var(--o2-border-color);
  border-radius: 0.375rem;
  background: var(--o2-card-bg);
  overflow: hidden;
  transition: border-color 0.15s ease;

  &--error {
    border-left: 3px solid var(--o2-service-health-critical);
    background: color-mix(
      in srgb,
      var(--o2-service-health-critical) 4%,
      var(--o2-card-bg)
    );
  }

  &--ok {
    border-left: 3px solid var(--o2-service-health-healthy, #16a34a);
    background: color-mix(
      in srgb,
      var(--o2-service-health-healthy, #16a34a) 4%,
      var(--o2-card-bg)
    );
  }
}

.turn-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  cursor: pointer;

  &:hover {
    background: var(--o2-row-hover-bg, rgba(0, 0, 0, 0.03));
  }
}

.turn-body {
  border-top: 1px solid var(--o2-border-color);
  padding: 0.75rem;
  background: var(--o2-card-bg-solid);
}

// Two-column grid: messages on the left, stats on the right.
// `align-items: stretch` (flex default) makes the messages column
// match the stats column's natural height so the user-25 / assistant-75
// split has a real height to divide. `min-height: 0` on flex children
// is required for nested overflow scrolling to actually clip.
.turn-grid {
  display: flex;
  gap: 0.75rem;
  align-items: stretch;
  // Fixed cap so the expanded body doesn't push the next turn off
  // screen on very long messages — the stats column is short and the
  // messages column would otherwise grow with content.
  max-height: 28rem;
}

.turn-messages {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-height: 0;
}

.msg-block {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--o2-border-color);
  border-radius: 0.375rem;
  background: var(--o2-card-bg);
  overflow: hidden;
  min-height: 0;

  &--user {
    border-color: color-mix(in srgb, #0ea5e9 35%, transparent);
    flex-shrink: 0;

    .msg-block__body {
      // font-size 0.8rem × line-height 1.5 = 1.2rem per line; padding 0.625rem×2
      min-height: calc(1 * 1.2rem + 1.25rem); // 1 line always visible
      max-height: calc(3 * 1.2rem + 1.25rem); // 3 lines then scroll
    }
  }

  &--assistant {
    border-color: color-mix(in srgb, #16a34a 35%, transparent);
    flex: 1 1 0;
  }

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.375rem 0.625rem;
    border-bottom: 1px solid var(--o2-border-color);
    background: var(--o2-card-bg-solid);
    flex-shrink: 0;
  }

  &__role {
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--o2-text-primary);
  }

  &__body {
    padding: 0.625rem 0.75rem;
    font-size: 0.8rem;
    line-height: 1.5;
    color: var(--o2-text-primary);
    white-space: pre-wrap;
    word-break: break-word;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
}

.turn-stats {
  width: 13rem;
  flex-shrink: 0;
  border: 1px solid var(--o2-border-color);
  border-radius: 0.375rem;
  background: var(--o2-card-bg);
  padding: 0.5rem 0.625rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.stat-section + .stat-section {
  padding-top: 0.5rem;
  border-top: 1px solid var(--o2-border-color);
}

.stat-section--inline {
  display: flex;
  align-items: center;
  justify-content: space-between;

  .stat-label {
    margin-bottom: 0;
  }
}

.stat-label {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--o2-text-muted);
  margin-bottom: 0.25rem;
}

.stat-value {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--o2-text-primary);
  display: flex;
  align-items: center;
}

.stat-rows {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.stat-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.75rem;
  color: var(--o2-text-muted);

  &--total {
    color: var(--o2-text-primary);
    font-weight: 600;
    border-top: 1px dashed var(--o2-border-color);
    padding-top: 0.125rem;
    margin-top: 0.125rem;
  }
}

.fullscreen-turn-dialog {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--o2-card-bg-solid);

  &__header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--o2-border-color);
    background: var(--o2-card-bg);
    flex-shrink: 0;
    border-left: 3px solid transparent;

    &--ok {
      border-left-color: var(--o2-service-health-healthy, #16a34a);
      background: color-mix(
        in srgb,
        var(--o2-service-health-healthy, #16a34a) 4%,
        var(--o2-card-bg)
      );
    }

    &--error {
      border-left-color: var(--o2-service-health-critical);
      background: color-mix(
        in srgb,
        var(--o2-service-health-critical) 4%,
        var(--o2-card-bg)
      );
    }
  }

  &__body {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
}

.fullscreen-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;

  & + & {
    border-top: 1px solid var(--o2-border-color);
  }

  &--user {
    border-left: 3px solid color-mix(in srgb, #0ea5e9 60%, transparent);
  }

  &--assistant {
    border-left: 3px solid color-mix(in srgb, #16a34a 60%, transparent);
  }

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 1rem;
    border-bottom: 1px solid var(--o2-border-color);
    background: var(--o2-card-bg);
    flex-shrink: 0;
  }

  &__role {
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--o2-text-primary);
    text-transform: capitalize;
    display: flex;
    align-items: center;
  }

  &__content {
    flex: 1;
    overflow-y: auto;
    padding: 1rem 1.25rem;
    font-size: 0.875rem;
    line-height: 1.7;
    color: var(--o2-text-primary);
    white-space: pre-wrap;
    word-break: break-word;
  }
}
</style>
