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
  <!-- sections sit on the page surface, split by hairlines; only the service tiles keep a frame -->
  <div
    class="text-text-body px-page-edge flex h-full min-w-0 flex-col overflow-y-auto pb-6"
    data-test="overview-canvas"
  >
    <!-- the range and refresh sit in the page header (R1, R5); alone, as in a spec, they stay here -->
    <Teleport :to="actionsTarget || 'body'" :disabled="!actionsTarget" defer>
      <ODateTimeRange
        v-if="pageState !== 'forbidden' && !errorIsForbidden"
        ref="dateTimeRef"
        auto-apply
        menu-align="end"
        :default-type="dateTimeType"
        :default-absolute-time="{
          startTime: absoluteTime.startTime,
          endTime: absoluteTime.endTime,
        }"
        :default-relative-time="relativeTime"
        @on:date-change="onDateChange"
      />
      <ORefreshButton
        v-if="pageState !== 'forbidden' && !errorIsForbidden"
        :last-run-at="lastFetched ? lastFetched.getTime() : null"
        :loading="isLoading || overviewState.loading"
        :disabled="isLoading || overviewState.loading"
        :tooltip="dataAsOf"
        @click="() => loadAll(true)"
      />
    </Teleport>

    <!-- every panel keeps its final height while it loads or fails, so nothing below it moves -->
    <div
      v-if="showOverviewCards && pageShowsSections"
      class="divide-border-default flex flex-col divide-y"
      data-test="overview-sections"
    >
      <section
        class="grid grid-cols-2 gap-x-8 gap-y-6 pt-2 pb-6 max-lg:grid-cols-1"
        data-test="overview-status-band"
      >
        <OverviewFiringNow
          :state="firingState"
          :rows="firingRows"
          :enabled-rules="enabledRules"
          :total-rules="alertRows.length"
          :locked-reason="alertsLocked ? alertsLock.lockedReason.value : undefined"
          :now="clock"
          @retry="() => firingRead.refetch()"
          @ask-ai="onAskAi"
        />
        <OverviewDataFreshness
          :state="freshnessState"
          :rows="freshness"
          :range="timeRange"
          :range-words="rangeWords"
          :now="clock"
          @retry="retryStreamLists"
        />
      </section>

      <OverviewGettingStarted
        v-if="showGettingStarted"
        class="py-6"
        :rows="freshness"
        :logs-locked="logsLock.locked.value"
        :alerts-locked="alertsLocked"
      />

      <OverviewHeadlineStrip
        class="py-6"
        :overview="overview"
        :pending="overviewPending"
        :failed="overviewFailed"
        :forbidden="overviewForbidden"
        :incidents-state="incidentsTile"
        :incidents-total="incidentsTotal"
        :delivery-failures="deliveryFailures"
        @select="onHeadlineSelect"
        @retry="() => loadOverview(true)"
        @ask-ai="onAskAi"
      >
        <template #aside>
          <OEmptyState
            v-if="summaryState === 'denied'"
            size="compact"
            kind="denied"
            :title="t('overview.summary.denied')"
            data-test="overview-summary-forbidden"
          />
          <OEmptyState
            v-else-if="overviewRefreshFailed"
            size="compact"
            kind="error"
            :title="t('overview.stale.message', { time: generatedAtLabel })"
            data-test="overview-stale-notice"
          >
            <template #actions>
              <OButton
                size="sm"
                data-test="overview-stale-retry-btn"
                @click="() => loadOverview(true)"
              >
                {{ t("overview.stale.retry") }}
              </OButton>
            </template>
          </OEmptyState>
        </template>
      </OverviewHeadlineStrip>

      <!-- the upsell sits below the strip so it never outranks live alert state -->
      <section
        v-if="!incidentsAccess.allowed || incidentsLicenseLocked"
        class="py-6"
        data-test="overview-incidents-locked"
      >
        <div class="mb-2 flex min-h-8 items-center">
          <OText variant="card-title" as="h2">{{ t("overview.activeIncidents") }}</OText>
        </div>
        <OverviewLockedNote
          :message="incidentsLicenseLocked ? incidentsLockedReason : incidentsAccess.message"
          :clickable="!incidentsLicenseLocked"
          @open="openUpgradeDialog()"
        />
      </section>

      <!-- the sections below swap in together once all have answered, so one landing early moves none -->
      <template v-if="legacySettled">
        <!-- ACTIVE INCIDENTS (enterprise / cloud only) -->
        <section
          v-if="isIncidentsEnabled && incidents.length > 0"
          class="py-6"
          data-test="overview-incidents-section"
        >
          <div class="mb-2 flex min-h-8 items-center gap-2">
            <OText variant="card-title" as="h2" class="flex flex-wrap items-center gap-1.5">
              {{ t("overview.activeIncidents") }}
              <OTag type="countChip" value="warning">{{ incidentsTotal }}</OTag>
              <OText
                v-if="incidentsTotal > incidents.length"
                variant="meta"
                class="text-text-secondary"
                >{{
                  t("overview.showingOf", { shown: incidents.length, total: incidentsTotal })
                }}</OText
              >
            </OText>
            <OButton
              variant="accent-ghost"
              size="sm"
              class="ms-auto -me-2.5"
              data-test="overview-incidents-view-all"
              @click="goToAllIncidents"
            >
              {{ t("overview.viewAll") }}
            </OButton>
          </div>
          <div class="divide-border-subtle flex flex-col divide-y">
            <div
              v-for="inc in incidents"
              :key="inc.id"
              class="group flex min-h-10 items-center gap-3 border-s-[0.1875em] py-1 ps-3"
              :class="incidentRowClass(inc.severity)"
            >
              <span class="flex shrink-0 items-center" :class="incidentIconClass(inc.severity)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" />
                  <path
                    d="M12 8v4m0 4h.01"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                  />
                </svg>
              </span>
              <div class="min-w-0 flex-1">
                <div class="text-text-body text-compact flex flex-wrap items-center gap-1">
                  <OTag type="severity" :value="(inc.severity || 'p4').toLowerCase()" />
                  {{ inc.title || t("overview.untitledIncident") }}
                  <template v-if="inc.group_values && Object.keys(inc.group_values).length > 0">
                    <ODimensionChip
                      v-for="dim in incidentDimensions(inc.group_values)"
                      :key="dim.key"
                      :dim-key="dim.key"
                      :key-label="dim.label"
                      :value="dim.value"
                      :tooltip="dim.rawTooltip"
                    />
                  </template>
                </div>
              </div>
              <div class="flex w-48 shrink-0 items-center gap-1.5 whitespace-nowrap">
                <span class="text-text-secondary min-w-18 text-xs">{{
                  relativeTime_(inc.first_alert_at)
                }}</span>
                <span class="text-text-secondary text-xs">·</span>
                <span class="text-text-secondary text-xs font-normal"
                  >{{ inc.alert_count }} {{ t("overview.alertsSuffix") }}</span
                >
              </div>
              <span
                class="shrink-0 whitespace-nowrap opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 max-md:opacity-100"
              >
                <OverviewAskAiButton
                  kind="incident"
                  :item-key="inc.id"
                  :label="inc.title || t('overview.untitledIncident')"
                  @ask="
                    onAskAi({
                      kind: 'incident',
                      incident: { ...inc, title: inc.title || t('overview.untitledIncident') },
                    })
                  "
                />
                <OButton variant="accent-ghost" @click="goToIncident(inc)">
                  {{ t("overview.investigate") }}
                </OButton>
              </span>
            </div>
          </div>
        </section>
        <OverviewSkeleton
          v-else-if="isIncidentsEnabled && isSectionPending('incidents')"
          class="py-6"
          section="incidents"
        />
        <OverviewSectionError
          v-else-if="showSectionError('incidents')"
          class="py-6"
          section="incidents"
          :title="t('overview.activeIncidents')"
          @retry="() => loadAll(true)"
        />
        <OverviewSectionEmpty
          v-else-if="showSectionForbidden('incidents')"
          class="py-6"
          section="incidents"
          kind="forbidden"
          :title="t('overview.activeIncidents')"
        />
        <OverviewSectionEmpty
          v-else-if="showSectionEmpty('incidents')"
          class="py-6"
          section="incidents"
          kind="empty"
          :title="t('overview.activeIncidents')"
        />

        <section class="flex flex-col gap-6 py-6" data-test="overview-time-range-group">
          <div
            v-if="showOverviewCards && pageShowsSections"
            class="-mb-3 flex flex-wrap items-baseline gap-x-1.5"
            data-test="overview-time-range-heading"
          >
            <h2 class="text-text-secondary text-xs font-medium">
              {{ t("overview.timeRange.heading") }}
            </h2>
            <OText
              v-if="rangeLabel"
              variant="meta"
              class="text-text-secondary"
              data-test="overview-time-range-label"
              >{{ rangeLabel }}</OText
            >
          </div>
          <OEmptyState
            v-if="groupFailed"
            size="compact"
            kind="error"
            :title="t('emptyState.loadError.title')"
            :text="t('emptyState.loadError.description')"
            data-test="overview-sections-load-error"
          >
            <template #actions>
              <OButton
                variant="secondary"
                size="sm"
                data-test="overview-sections-load-error-retry-btn"
                @click="() => loadAll(true)"
              >
                {{ t("emptyState.loadError.action") }}
              </OButton>
            </template>
          </OEmptyState>
          <!-- SERVICES (enterprise only — needs service graph data) -->
          <section
            v-if="incidentsAccess.allowed && services.length > 0"
            data-test="overview-services-section"
          >
            <div class="mb-2 flex min-h-8 items-center gap-2">
              <OText variant="card-title" as="h2" class="flex flex-wrap items-center gap-1.5">
                {{ t("overview.services") }}
                <OTag type="countChip" value="warning">{{ services.length }}</OTag>
                <OText
                  v-if="servicePanelVisible && selectedService"
                  variant="meta"
                  class="text-text-secondary"
                >
                  {{ t("overview.viewingLabel") }}
                  <strong class="text-text-body font-semibold">{{
                    selectedService.label ?? selectedService.id
                  }}</strong>
                </OText>
              </OText>
              <OTooltip
                :content="tracesLock.lockedReason.value"
                :disabled="!tracesLock.locked.value"
              >
                <OButton
                  variant="accent-ghost"
                  size="sm"
                  class="ms-auto -me-2.5"
                  :aria-disabled="tracesLock.locked.value || undefined"
                  data-test="overview-services-view-all"
                  @click="goToServiceGraph"
                >
                  <OIcon
                    v-if="tracesLock.locked.value"
                    name="lock"
                    class="text-icon-locked"
                    size="sm"
                    data-test="overview-services-view-all-lock"
                  />
                  {{ t("overview.viewAll") }}
                </OButton>
              </OTooltip>
            </div>
            <div class="relative">
              <!-- Left fade + floating scroll control (only present when scrollable) -->
              <div
                class="from-surface-base pointer-events-none absolute inset-y-0 left-0 z-10 flex items-center bg-linear-to-r to-transparent pe-8 transition-opacity duration-200"
                :class="svcScrollCanLeft ? 'opacity-100' : 'opacity-0'"
              >
                <button
                  class="border-border-default bg-surface-base text-text-secondary hover:bg-table-row-hover-bg hover:text-text-body pointer-events-auto flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border-[0.0625em] shadow-sm transition-all duration-150 hover:shadow-sm active:shadow-sm"
                  :tabindex="svcScrollCanLeft ? 0 : -1"
                  :aria-hidden="!svcScrollCanLeft"
                  :aria-label="t('overview.scrollLeft')"
                  @click="scrollServices(-1)"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M15 18l-6-6 6-6"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </button>
              </div>
              <div
                ref="svcGridRef"
                class="flex [scrollbar-width:none] flex-row gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden"
                @scroll="onSvcScroll"
              >
                <div
                  v-for="svc in services"
                  :key="svc.id"
                  :data-test="`overview-service-card-${svc.id}`"
                  class="rounded-default border-border-default bg-surface-panel focus-visible:ring-button-ghost-focus-ring max-w-40 min-w-40 shrink-0 grow-0 basis-40 cursor-pointer border border-[0.0625em] px-3.5 py-3 transition-[background-color,box-shadow,outline-color] duration-150 focus-visible:ring-3 focus-visible:outline-none"
                  tabindex="0"
                  :class="[
                    serviceCardClass(svc),
                    selectedService?.id === svc.id && servicePanelVisible
                      ? 'outline-accent bg-surface-tint-accent shadow-primary-500/22 shadow-sm outline-[0.125em] outline-offset-[-0.0625em] outline-solid'
                      : 'hover:bg-table-row-hover-bg',
                  ]"
                  @click="openServicePanel(svc)"
                  @keydown.enter.self="openServicePanel(svc)"
                  @keydown.space.self.prevent="openServicePanel(svc)"
                >
                  <div class="mb-2 flex items-center justify-between">
                    <OTruncatedText class="text-text-body block flex-1 text-sm">{{
                      svc.label
                    }}</OTruncatedText>
                    <OTooltip
                      v-if="tracesLock.locked.value"
                      :content="tracesLock.lockedReason.value"
                    >
                      <span class="ms-1 inline-flex shrink-0 items-center" @click.stop>
                        <OButton
                          icon-only
                          variant="ghost"
                          size="xs"
                          disabled
                          :aria-label="t('traces.servicesCatalog.viewTraces')"
                          data-test="overview-service-view-traces"
                        >
                          <OIcon
                            name="lock"
                            class="text-icon-locked"
                            size="sm"
                            data-test="overview-service-view-traces-lock"
                          />
                        </OButton>
                      </span>
                    </OTooltip>
                    <span v-else class="ms-1 inline-flex shrink-0 items-center">
                      <OButton
                        icon-only
                        variant="ghost"
                        size="xs"
                        :title="t('traces.servicesCatalog.viewTraces')"
                        data-test="overview-service-view-traces"
                        @click="goToService(svc, $event)"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" />
                          <path
                            d="M12 16v-4m0-4h.01"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                          />
                        </svg>
                      </OButton>
                    </span>
                  </div>
                  <div class="mt-2 flex flex-col gap-1">
                    <div class="flex items-baseline justify-between gap-2">
                      <span class="text-text-label text-xs">{{ t("overview.colErrorRate") }}</span>
                      <span
                        class="text-sm font-semibold tabular-nums"
                        :class="SERVICE_ERROR_RATE_TEXT[svc.health]"
                        :data-test="`overview-service-card-${svc.id}-error-rate`"
                      >
                        {{ svc.error_rate != null ? svc.error_rate.toFixed(1) + "%" : "—" }}
                      </span>
                    </div>
                    <div class="flex items-baseline justify-between gap-2">
                      <span class="text-text-label text-xs">{{ t("overview.colLatency") }}</span>
                      <span
                        class="text-sm font-semibold tabular-nums"
                        :class="svc.latencyFlag ? 'text-warning-700' : 'text-text-heading'"
                      >
                        {{ svc.latencyMultiplier ? raw(svc.latencyMultiplier + "x") : raw("—") }}
                      </span>
                    </div>
                    <div class="flex items-baseline justify-between gap-2">
                      <span class="text-text-label text-xs">{{ t("overview.colReqs") }}</span>
                      <span class="text-text-heading text-sm font-semibold tabular-nums">{{
                        raw(formatCompactCount(svc.requests ?? 0))
                      }}</span>
                    </div>
                  </div>
                </div>
              </div>
              <!-- Right fade + floating scroll control (only present when scrollable) -->
              <div
                class="from-surface-base pointer-events-none absolute inset-y-0 right-0 z-10 flex items-center justify-end bg-linear-to-l to-transparent ps-8 transition-opacity duration-200"
                :class="svcScrollCanRight ? 'opacity-100' : 'opacity-0'"
              >
                <button
                  class="border-border-default bg-surface-base text-text-secondary hover:bg-table-row-hover-bg hover:text-text-body pointer-events-auto flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border-[0.0625em] shadow-sm transition-all duration-150 hover:shadow-sm active:shadow-sm"
                  :tabindex="svcScrollCanRight ? 0 : -1"
                  :aria-hidden="!svcScrollCanRight"
                  :aria-label="t('overview.scrollRight')"
                  @click="scrollServices(1)"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M9 18l6-6-6-6"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </section>
          <OverviewSkeleton
            v-else-if="servicesEnabled && isSectionPending('services')"
            section="services"
          />
          <OverviewSectionError
            v-else-if="showSectionError('services')"
            section="services"
            :title="t('overview.services')"
            @retry="() => loadAll(true)"
          />
          <OverviewSectionEmpty
            v-else-if="showSectionForbidden('services')"
            section="services"
            kind="forbidden"
            :title="t('overview.services')"
          />

          <!-- Locked: Services shares the Incidents gate, and its data comes from traces, so a license without traces locks it too. -->
          <section
            v-else-if="!incidentsAccess.allowed || servicesLicenseLocked"
            data-test="overview-services-locked"
          >
            <div class="mb-2 flex min-h-8 items-center">
              <OText variant="card-title" as="h2">{{ t("overview.services") }}</OText>
            </div>
            <OverviewLockedNote
              :message="
                servicesLicenseLocked ? tracesLock.lockedReason.value : incidentsAccess.message
              "
              :clickable="!servicesLicenseLocked"
              @open="openUpgradeDialog()"
            />
          </section>

          <OverviewSectionEmpty
            v-else-if="showSectionEmpty('services')"
            section="services"
            kind="empty"
            :title="t('overview.services')"
          />

          <!-- Service node side panel (latency / RED charts) -->
          <template v-if="incidentsAccess.allowed && selectedService">
            <div
              v-if="servicePanelVisible"
              class="fixed inset-0 z-99 bg-transparent"
              @click="closeServicePanel"
            />
            <ServiceGraphNodeSidePanel
              :selected-node="selectedService"
              :graph-data="graphData"
              :time-range="timeRange"
              :visible="servicePanelVisible"
              :stream-filter="selectedService?.stream_name ?? graphStream"
              @close="closeServicePanel"
              @view-traces="goToService(selectedService)"
            />
          </template>

          <div
            :class="slimPair ? 'grid grid-cols-2 gap-x-8 gap-y-6 max-md:grid-cols-1' : 'contents'"
            data-test="overview-time-range-pair"
          >
            <!-- ACTIVE ANOMALIES -->
            <section v-if="anomalies.length > 0" data-test="overview-anomalies-section">
              <div class="mb-2 flex min-h-8 items-center gap-2">
                <OText variant="card-title" as="h2" class="flex flex-wrap items-center gap-1.5">
                  {{ t("overview.activeAnomalies") }}
                  <OTag type="countChip" value="warning">{{ anomalies.length }}</OTag>
                </OText>
                <OButton
                  variant="accent-ghost"
                  size="sm"
                  class="ms-auto -me-2.5"
                  data-test="overview-anomalies-view-all"
                  @click="goToAnomalies"
                >
                  {{ t("overview.viewAll") }}
                </OButton>
              </div>
              <div class="divide-border-subtle flex flex-col divide-y">
                <div
                  v-for="item in anomalies"
                  :key="item.id"
                  class="group flex min-h-10 items-center gap-3 py-1 ps-3"
                  :class="severityRowClass(item.severity)"
                >
                  <span
                    class="flex shrink-0 items-center"
                    :class="severityIconClass(item.severity)"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                    </svg>
                  </span>
                  <div class="min-w-0 flex-1">
                    <div
                      class="text-text-body text-compact flex flex-wrap items-center gap-1 [row-gap:0.25rem]"
                    >
                      {{ item.title }}
                      <span class="text-text-secondary mx-[0.1rem] text-xs font-normal">·</span>
                      <span class="text-text-secondary text-xs font-normal">{{
                        item.description
                      }}</span>
                    </div>
                  </div>
                  <span
                    class="shrink-0 whitespace-nowrap opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 max-md:opacity-100"
                  >
                    <OButton variant="accent-ghost" @click="goToAlert(item)">
                      {{ t("overview.investigate") }}
                    </OButton>
                  </span>
                </div>
              </div>
            </section>
            <OverviewSkeleton v-else-if="isSectionPending('anomalies')" section="anomalies" />
            <OverviewSectionError
              v-else-if="showSectionError('anomalies')"
              section="anomalies"
              :title="t('overview.activeAnomalies')"
              @retry="() => loadAll(true)"
            />
            <OverviewSectionEmpty
              v-else-if="showSectionForbidden('anomalies')"
              section="anomalies"
              kind="forbidden"
              :title="t('overview.activeAnomalies')"
            />
            <OverviewSectionEmpty
              v-else-if="showSectionEmpty('anomalies')"
              section="anomalies"
              kind="empty"
              :no-checks="anomalyConfigCount === 0"
              :title="t('overview.activeAnomalies')"
            />
            <section v-else-if="anomalyLocked" data-test="overview-anomalies-locked">
              <div class="mb-2 flex min-h-8 items-center">
                <OText variant="card-title" as="h2">{{ t("overview.activeAnomalies") }}</OText>
              </div>
              <OverviewLockedNote :message="anomalyLock.lockedReason.value" :clickable="false" />
            </section>

            <!-- RECENT EVENTS (alert firing feed) -->
            <section v-if="recentRows.length > 0" data-test="overview-recent-events-section">
              <div class="mb-2 flex min-h-8 items-center gap-2">
                <OText variant="card-title" as="h2">{{ t("overview.recentEvents") }}</OText>
                <OButton
                  variant="accent-ghost"
                  size="sm"
                  class="ms-auto -me-2.5"
                  data-test="overview-recent-events-view-all"
                  @click="() => openAlertList()"
                >
                  {{ t("overview.viewAll") }}
                </OButton>
              </div>
              <ul class="divide-border-subtle flex flex-col divide-y">
                <li
                  v-for="ev in recentRows"
                  :key="ev.id"
                  class="py-0.5"
                  data-test="overview-recent-events-row"
                >
                  <!-- a row opens its alert; a name two folders share opens none, so it stays plain text -->
                  <div class="-mx-3">
                    <component
                      :is="ev.alert ? OverviewRowButton : 'div'"
                      v-bind="
                        ev.alert
                          ? { to: alertDetailRoute(ev.alert) }
                          : {
                              class:
                                'h-control-md flex min-w-0 items-center justify-between gap-3 px-3',
                            }
                      "
                      data-test="overview-recent-events-link"
                    >
                      <span class="flex min-w-0 items-center gap-3">
                        <OTag
                          type="countChip"
                          :value="ev.tone"
                          class="min-w-16 shrink-0 justify-center"
                          data-test="overview-recent-events-kind"
                          >{{ ev.kindLabel }}</OTag
                        >
                        <OTruncatedText
                          class="text-text-body text-compact min-w-0 shrink font-medium"
                          data-test="overview-recent-events-name"
                          >{{ raw(ev.name) }}</OTruncatedText
                        >
                        <OTruncatedText
                          v-if="ev.alert?.stream_name"
                          class="text-text-secondary min-w-0 text-xs font-normal max-sm:hidden"
                          >{{ raw(ev.alert.stream_name) }}</OTruncatedText
                        >
                      </span>
                      <span class="flex shrink-0 items-center gap-2">
                        <OTag
                          v-if="ev.notifyFailed"
                          tone="warn"
                          icon="sync-problem"
                          size="sm"
                          :label="t('alerts.summaryDeliveryFailed')"
                          data-test="overview-recent-events-undelivered"
                        />
                        <OTag
                          v-if="ev.count > 1"
                          type="countChip"
                          value="neutral"
                          class="max-sm:hidden"
                          data-test="overview-recent-events-count"
                          >{{ t("overview.timesSymbol") }}{{ ev.count }}
                          <OTooltip
                            :content="
                              t('overview.events.timesInRange', { count: ev.count }, ev.count)
                            "
                        /></OTag>
                        <span
                          class="text-text-secondary text-xs font-normal whitespace-nowrap tabular-nums"
                          >{{ ev.timeAgo }}</span
                        >
                      </span>
                    </component>
                  </div>
                </li>
              </ul>
            </section>
            <OverviewSkeleton v-else-if="isSectionPending('recentEvents')" section="recentEvents" />
            <OverviewSectionError
              v-else-if="showSectionError('recentEvents')"
              section="recentEvents"
              :title="t('overview.recentEvents')"
              @retry="() => loadAll(true)"
            />
            <OverviewSectionEmpty
              v-else-if="showSectionForbidden('recentEvents')"
              section="recentEvents"
              kind="forbidden"
              :title="t('overview.recentEvents')"
            />
            <OverviewSectionEmpty
              v-else-if="showSectionEmpty('recentEvents')"
              section="recentEvents"
              kind="empty"
              :title="t('overview.recentEvents')"
            />
          </div>
        </section>
      </template>
      <template v-else>
        <OverviewSkeleton v-if="isIncidentsEnabled" class="py-6" section="incidents" />
        <section class="flex flex-col gap-6 py-6" data-test="overview-time-range-pending">
          <div
            v-if="showOverviewCards && pageShowsSections"
            class="-mb-3 flex flex-wrap items-baseline gap-x-1.5"
            data-test="overview-time-range-heading"
          >
            <h2 class="text-text-secondary text-xs font-medium">
              {{ t("overview.timeRange.heading") }}
            </h2>
            <OText
              v-if="rangeLabel"
              variant="meta"
              class="text-text-secondary"
              data-test="overview-time-range-label"
              >{{ rangeLabel }}</OText
            >
          </div>
          <OverviewSkeleton v-if="servicesEnabled" section="services" />
          <OverviewSkeleton v-if="anomalyEnabled" section="anomalies" />
          <OverviewSkeleton v-if="!alertsLocked" section="recentEvents" />
        </section>
      </template>
      <!-- below the time-range sections: a failed /overview drops these, and nothing under them moves -->
      <div
        v-if="showSummaryDetail && legacySettled"
        class="grid grid-cols-[2fr_1fr] gap-x-8 gap-y-6 py-6 max-lg:grid-cols-1"
        data-test="overview-streams-limit-grid"
      >
        <OverviewTopStreamsCard
          :section="overview?.streams"
          :pending="overviewPending"
          :failed="overviewFailed"
          :forbidden="overviewForbidden"
          @retry="() => loadOverview(true)"
          @open="goToStreams"
          @start-ingesting="goToIngestion"
        />
        <OverviewLimitCard
          :limits="overview?.limits"
          :streams="overview?.streams"
          :pending="overviewPending"
          :failed="overviewFailed"
          :forbidden="overviewForbidden"
          @retry="() => loadOverview(true)"
        />
      </div>

      <OverviewSignalCards
        v-if="showSummaryDetail && legacySettled"
        class="py-6"
        :section="overview?.streams"
        :pending="overviewPending"
        :failed="overviewFailed"
        :forbidden="overviewForbidden"
        :locked-reasons="signalLockedReasons"
        @open="onSignalOpen"
      />
    </div>
    <OEmptyState
      v-if="pageState === 'forbidden' || errorIsForbidden"
      kind="denied"
      :title="t('emptyState.noAccess.title')"
      :text="t('emptyState.noAccess.description')"
      data-test="overview-no-access-empty-state"
    />
    <OEmptyState
      v-else-if="pageState === 'error'"
      kind="error"
      :title="t('emptyState.loadError.title')"
      :text="t('emptyState.loadError.description')"
      data-test="overview-load-error-empty-state"
    >
      <template #actions>
        <OButton
          variant="secondary"
          data-test="overview-load-error-retry-card"
          @click="() => loadAll(true)"
        >
          {{ t("emptyState.loadError.action") }}
        </OButton>
      </template>
    </OEmptyState>
    <OEmptyState
      v-else-if="pageState === 'not-monitored'"
      icon="notifications"
      data-test="overview-not-monitored-empty-state"
      :title="t('overview.notMonitoredTitle')"
      :text="t('overview.notMonitoredDesc')"
    >
      <template #actions>
        <OButton
          v-if="showAlertsCard"
          variant="primary"
          :disabled-reason="alertsLocked ? alertsLock.lockedReason.value : undefined"
          :disabled="alertsLocked"
          data-test="overview-not-monitored-alert-card"
          @click="goToAddAlert"
        >
          {{ t("overview.notMonitoredAlert") }}
        </OButton>
        <OButton
          v-if="showAlertsCard && anomalyEnabled"
          data-test="overview-not-monitored-anomaly-card"
          @click="goToAnomalies"
        >
          {{ t("overview.notMonitoredAnomaly") }}
        </OButton>
        <OButton
          v-else-if="showLogsCard"
          :disabled-reason="logsLock.locked.value ? logsLock.lockedReason.value : undefined"
          :disabled="logsLock.locked.value"
          data-test="overview-not-monitored-logs-card"
          @click="goToLogs"
        >
          {{ t("overview.emptyActionLogs") }}
        </OButton>
      </template>
    </OEmptyState>

    <HomeNoDataState v-else-if="pageState === 'no-data'" tab="overview" flag-off />

    <!-- Alert History Drawer — opened from anomaly Investigate button -->
    <AlertHistoryDrawer
      v-model:open="showAlertHistoryDrawer"
      :alert-details="selectedAlertForHistory"
      :alert-id="selectedAlertIdForHistory"
      alert-type="anomaly_detection"
      data-test="overview-alert-history-drawer"
    />
  </div>
</template>

<script setup lang="ts">
import { alertHistoryQuery, firingAlertsQuery } from "@/services/alerts.queries";
import { useQuery } from "@tanstack/vue-query";
import { refreshUserStreamLists, useOrgHasUserData } from "@/composables/useOrgHasUserData";
import { incidentsQuery } from "@/services/incidents.queries";
import { serviceTopologyQuery } from "@/services/service_graph.queries";
import { queryClient } from "@/composables/query/queryClient";
import { anomalyConfigsQuery } from "@/services/anomaly_detection.queries";
import { anomalyHistoryQuery } from "@/services/anomaly_detection.queries";
import { orgSummaryQuery } from "@/services/organizations.queries";
import { STREAM_PROBE_PAGE, streamPageQuery, streamProbeQuery } from "@/services/stream.queries";
import { readFirstDataRecord } from "@/composables/firstEvent/useFirstDataNotice";
import { USER_DATA_STREAM_TYPES, userDataStreams } from "@/utils/internalStreams";
import { ref, reactive, computed, defineAsyncComponent, onMounted, watch, nextTick } from "vue";

import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { b64EncodeUnicode } from "@/utils/zincutils";
import { formatCompactCount } from "@/utils/formatters";
import { useOverviewTime } from "./overview/useOverviewTime";
import { isFiringOutcome, isErrorOutcome, isNotifyFailedOutcome } from "@/utils/alerts/runOutcome";
import { useStore } from "vuex";
import { useSampleDataSession } from "@/composables/sampleData/useSampleDataSession";
import { useRouter } from "vue-router";
import anomalyService from "@/services/anomaly_detection";
import ODateTimeRange from "@/lib/forms/DateTimeRange/ODateTimeRange.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OverviewSkeleton from "./OverviewSkeleton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OverviewSectionError from "./OverviewSectionError.vue";
import OverviewSectionEmpty from "./OverviewSectionEmpty.vue";
import HomeNoDataState from "./HomeNoDataState.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OverviewHeadlineStrip, { type OverviewTarget } from "./overview/OverviewHeadlineStrip.vue";
import OverviewFiringNow, { type FiringNowState } from "./overview/OverviewFiringNow.vue";
import OverviewDataFreshness, {
  type DataFreshnessState,
} from "./overview/OverviewDataFreshness.vue";
import OverviewGettingStarted from "./overview/OverviewGettingStarted.vue";
import {
  alertsByName,
  firingLevel,
  firingNow,
  undeliveredCount,
  type FiringLevel,
  type HomeAlertRow,
} from "./overview/overviewFiring";
import { freshnessRows, noDataEver } from "./overview/overviewFreshness";
import OverviewTopStreamsCard from "./overview/OverviewTopStreamsCard.vue";
import OverviewLimitCard from "./overview/OverviewLimitCard.vue";
import OverviewSignalCards from "./overview/OverviewSignalCards.vue";
import OverviewAskAiButton from "./overview/OverviewAskAiButton.vue";
import OverviewLockedNote from "./overview/OverviewLockedNote.vue";
import { buildOverviewAskAi, type OverviewAskAiTarget } from "./overview/overviewAskAi";
import { OVERVIEW_TOP, orgOverviewQuery } from "@/services/overview.queries";
import { formatTimestampInTimezone } from "@/utils/date";
import { safeTimezone } from "@/utils/dashboard/calendarPeriods";
import { resolveBrowserTimezone } from "@/utils/timezone";
import type { OverviewSignal } from "./overview/overviewFormat";
import OverviewRowButton from "./overview/OverviewRowButton.vue";
import { overviewKeys } from "@/services/overview.querykeys";
import type { IncidentsTile, OrgOverview } from "@/ts/interfaces/overview";
import ODimensionChip from "@/lib/core/Badge/ODimensionChip.vue";
import ServiceGraphNodeSidePanel from "@/plugins/traces/ServiceGraphNodeSidePanel.vue";
import { buildViewTracesFilter } from "@/plugins/traces/viewTracesHandoff";
import { serviceHealthFromErrorRate, type ServiceHealthStatus } from "@/utils/traces/serviceHealth";
import { useLockedAffordance } from "@/composables/useLockedAffordance";
import { useEnterpriseUpgradeDialog } from "@/composables/useEnterpriseUpgradeDialog";
import { useLicenseLock } from "@/composables/useFeatureLock";
import analytics from "@/services/product_analytics";
import { chipDimensionKeys, dimensionDisplay } from "@/utils/incidents/findingDimensions";
import { ALERT_LIST_ALL_FOLDERS, ALERT_LIST_ALL_STATES } from "@/utils/alerts/alertListLink";
import type { AiChatHandoff } from "@/plugins/traces/utils/traceAiPayload";

const AlertHistoryDrawer = defineAsyncComponent(
  () => import("@/components/alerts/AlertHistoryDrawer.vue"),
);

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();

defineProps<{
  /** Selector of the page header's actions slot; the range and refresh render there. */
  actionsTarget?: string;
}>();

const emit = defineEmits<{ sendToAiChat: [payload: AiChatHandoff] }>();

// ── Feature flags ────────────────────────────────────────────────────────────
// Services shares this same gate — it's the service-graph half of the same
// enterprise/cloud bundle as Incidents, with no upsell story of its own.
const incidentsAccess = useLockedAffordance("incidents");
const { open: openUpgradeDialog } = useEnterpriseUpgradeDialog();
const alertsLock = useLicenseLock("alerts");
const alertsLocked = alertsLock.locked;
const { locked: incidentsFeatureLocked, lockedReason: incidentsLockedReason } =
  useLicenseLock("incidents");
const incidentsLicenseLocked = computed(
  () => incidentsAccess.value.allowed && incidentsFeatureLocked.value,
);
const anomalyLock = useLicenseLock("anomaly_detection");
const anomalyLocked = anomalyLock.locked;
const logsLock = useLicenseLock("logs");
const tracesLock = useLicenseLock("traces");
// Services reads the trace topology, so a license without traces locks it
const servicesLicenseLocked = computed(
  () => incidentsAccess.value.allowed && tracesLock.locked.value,
);
const servicesEnabled = computed(() => incidentsAccess.value.allowed && !tracesLock.locked.value);
const isIncidentsEnabled = computed(
  () =>
    incidentsAccess.value.allowed &&
    !incidentsFeatureLocked.value &&
    store.state.zoConfig?.incidents_enabled === true,
);
const flagOn = computed(() => store.state.zoConfig?.restricted_routes_on_empty_data === true);
// a deployment with anomaly detection off answers 403 by design, which is no load failure
const anomalyEnabled = computed(
  () => store.state.zoConfig?.anomaly_detection_enabled === true && !anomalyLocked.value,
);
// a license-locked signal shows its reason instead of stats, and its page is never opened
const signalLockedReasons = computed(() => ({
  ...(logsLock.locked.value ? { logs: logsLock.lockedReason.value } : {}),
  ...(tracesLock.locked.value ? { traces: tracesLock.lockedReason.value } : {}),
}));

// ── Date / time picker ───────────────────────────────────────────────────────
const LS_TIME_KEY = "o2_overview_time";

function loadSavedTime() {
  try {
    const raw = localStorage.getItem(LS_TIME_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore: corrupt/absent saved time falls back to null */
  }
  return null;
}

const saved = loadSavedTime();
const now = Date.now();
const dateTimeRef = ref<any>(null);
const dateTimeType = ref(saved?.type ?? "relative");
// an overview opens on the last day (R10, F8); a range the user picked is kept
const DEFAULT_RANGE_MS = 24 * 60 * 60 * 1000;
const relativeTime = ref(saved?.relative ?? "24h");
const absoluteTime = ref(
  saved?.absolute ?? {
    startTime: (now - DEFAULT_RANGE_MS) * 1000,
    endTime: now * 1000,
  },
);
const timeRange = ref(
  saved?.timeRange ?? {
    startTime: (now - DEFAULT_RANGE_MS) * 1000,
    endTime: now * 1000,
  },
);

const onDateChange = (value: any) => {
  timeRange.value = {
    startTime: value.startTime,
    endTime: value.endTime,
  };
  if (value.relativeTimePeriod) {
    dateTimeType.value = "relative";
    relativeTime.value = value.relativeTimePeriod;
  } else {
    dateTimeType.value = "absolute";
    absoluteTime.value = { startTime: value.startTime, endTime: value.endTime };
  }
  localStorage.setItem(
    LS_TIME_KEY,
    JSON.stringify({
      type: dateTimeType.value,
      relative: relativeTime.value,
      absolute: absoluteTime.value,
      timeRange: timeRange.value,
    }),
  );
  if (value.userChangedValue) {
    analytics.track("home_time_range_changed", { type: dateTimeType.value });
  }
  loadAll();
};

interface ServiceCard {
  id: string;
  label: string;
  requests: number;
  error_rate: number;
  stream_name?: string;
  health: ServiceHealthStatus;
  errorFlag: boolean;
  latencyFlag: boolean;
  latencyMultiplier: string | null;
}

// ── State ────────────────────────────────────────────────────────────────────
const isLoading = ref(false);
const lastFetched = ref<Date | null>(null);
const anomalies = ref<any[]>([]);
const incidents = ref<any[]>([]);
const incidentsTotal = ref(0);
const services = ref<ServiceCard[]>([]);
const recentEvents = ref<RecentEvent[]>([]);

// True once any section has something to show. Gates the skeleton and the empty
// state so the three are mutually exclusive with the content: the skeleton is a
// first-load placeholder, not a refresh indicator (ORefreshButton already spins
// via :loading). Without this, refreshing with data on screen appends the
// skeleton *below* the rows instead of standing in for them.
const hasAnyData = computed(
  () =>
    anomalies.value.length > 0 ||
    incidents.value.length > 0 ||
    services.value.length > 0 ||
    recentEvents.value.length > 0,
);

/* Per-section load state. The four datasets are fetched concurrently and land at
   different times, so a single `isLoading` can't gate their placeholders: the
   first dataset to arrive would clear the skeleton for the three still in
   flight, and those would then pop in with no placeholder. Each section tracks
   its own request instead.

   `loaded` (has completed at least once) is what separates a first load from a
   refresh. A section shows its skeleton only while `loading && !loaded`, so:
     - first load  -> each section holds its own placeholder until ITS data lands
     - refresh     -> nothing flashes; ORefreshButton carries the loading state
     - empty result-> `loaded` stays true, so it never re-skeletons */
type SectionKey = "incidents" | "services" | "anomalies" | "recentEvents";
const sectionState = reactive<Record<SectionKey, { loading: boolean; loaded: boolean }>>({
  incidents: { loading: false, loaded: false },
  services: { loading: false, loaded: false },
  anomalies: { loading: false, loaded: false },
  recentEvents: { loading: false, loaded: false },
});

let alertCountSeq = 0;
const sectionSeq: Record<SectionKey, number> = {
  incidents: 0,
  services: 0,
  anomalies: 0,
  recentEvents: 0,
};

const isSectionPending = (key: SectionKey) =>
  sectionState[key].loading && !sectionState[key].loaded;

// each loader keeps its empty-list fallback, so the error it swallowed is the only failure signal
const sectionFailure = reactive<Record<SectionKey, unknown>>({
  incidents: null,
  services: null,
  anomalies: null,
  recentEvents: null,
});
const overview = ref<OrgOverview | null>(null);
const overviewFailed = ref(false);
const overviewState = reactive({ loading: false });
let overviewSeq = 0;
let overviewOrg = "";
const overviewForbidden = ref(false);
// a failed refresh keeps the last good snapshot on screen instead of blanking every card
const overviewRefreshFailed = ref(false);
const generatedAtLabel = computed(() => {
  if (!overview.value) return "";
  const zone = safeTimezone(resolveBrowserTimezone(store.state.timezone || "UTC"));
  const time = formatTimestampInTimezone(overview.value.generated_at, "YYYY-MM-DD HH:mm", zone);
  return `${time} (${zone})`;
});
const dataAsOf = computed(() =>
  overview.value ? t("overview.dataAsOf", { time: generatedAtLabel.value }) : undefined,
);
// the picker owns its label, so the heading names the range in the same words the picker shows
const rangeLabel = computed(() => raw(dateTimeRef.value?.triggerLabel ?? ""));
const showOverviewCards = computed(
  () => !["forbidden", "no-data", "not-monitored"].includes(pageState.value),
);
const overviewPending = computed(
  () => overviewState.loading && (!overview.value || overviewFailed.value),
);
const alertCount = ref<number | null>(null);
const anomalyConfigCount = ref<number | null>(null);
// null leaves no-data undecided: only answered lists prove an org empty, and only the flag-off page asks
const noUserStreams = ref<boolean | null>(null);
// a probe that failed for any reason but 403 leaves "no streams" unproven, so the first-data hero may not show
const streamProbeFailed = ref(false);

const isForbidden = (err: unknown) => {
  const e = err as { status?: number; response?: { status?: number } } | null;
  return e?.status === 403 || e?.response?.status === 403;
};
const attemptedSections = computed<SectionKey[]>(() => {
  const keys: SectionKey[] = [];
  if (!alertsLocked.value) keys.push("recentEvents");
  if (anomalyEnabled.value) keys.push("anomalies");
  if (isIncidentsEnabled.value) keys.push("incidents");
  if (servicesEnabled.value) keys.push("services");
  return keys;
});
const isFailed = (key: SectionKey) =>
  !!sectionFailure[key] && attemptedSections.value.includes(key);
const allFailed = computed(
  () => attemptedSections.value.length > 0 && attemptedSections.value.every(isFailed),
);

type PageState =
  "content" | "partial" | "forbidden" | "error" | "not-monitored" | "no-data" | "all-clear";
// no /overview answer yet leaves the heroes undecided, since each one weighs whether the cards loaded
const overviewUnanswered = computed(
  () =>
    overviewState.loading && !overview.value && !overviewFailed.value && !overviewForbidden.value,
);
const pageState = computed<PageState>(() => {
  if (isLoading.value || hasAnyData.value || overviewUnanswered.value) return "content";
  if (allFailed.value) {
    const allForbidden = attemptedSections.value.every((k) => isForbidden(sectionFailure[k]));
    const cardsLoaded = !!overview.value && !overviewFailed.value && !overviewForbidden.value;
    if (flagOn.value && allForbidden && !cardsLoaded) return "forbidden";
    // anything that loaded keeps the panels, each failed one with its own Retry (R3)
    return cardsLoaded || !bandFailed.value ? "partial" : "error";
  }
  if (attemptedSections.value.some(isFailed)) return "partial";
  if (!flagOn.value && noUserStreams.value === true) return "no-data";
  // a failed summary leaves alertCount null, so the page never claims nothing is watched
  if (flagOn.value && alertCount.value === 0 && (anomalyConfigCount.value ?? 0) === 0) {
    return "not-monitored";
  }
  return "all-clear";
});
// every attempted call was refused, so "could not load" would contradict the No access cards
const errorIsForbidden = computed(
  () =>
    pageState.value === "error" &&
    overviewForbidden.value &&
    attemptedSections.value.every((k) => !isFailed(k) || isDenied(k)),
);
const pageShowsSections = computed(
  () => pageState.value !== "error" && pageState.value !== "forbidden",
);
// one /overview answer feeds every summary panel, so a failure of it is one state, not ten
const summaryState = computed<"ok" | "error" | "denied">(() => {
  if (overviewForbidden.value && !overview.value) return "denied";
  return overviewFailed.value ? "error" : "ok";
});
// the detail panels read the same answer, so a failure drops them and the strip says it once
const showSummaryDetail = computed(() => summaryState.value === "ok");
// a retry after a failure re-arms its section, so the group waits for that answer too
const legacySettled = computed(() =>
  (Object.keys(sectionState) as SectionKey[])
    .filter(sectionApplies)
    .every((key) => sectionState[key].loaded),
);
// an edition without the service graph refuses it with 403, which is no outage
const isDenied = (key: SectionKey) => isForbidden(sectionFailure[key]);
// when every section failed, one error for the group says it, not one per panel
const groupFailed = computed(
  () =>
    pageShowsSections.value &&
    attemptedSections.value.length > 1 &&
    allFailed.value &&
    attemptedSections.value.every((k) => !isDenied(k)),
);
const showSectionError = (key: SectionKey) =>
  isFailed(key) && !isDenied(key) && pageShowsSections.value && !groupFailed.value;
const showSectionForbidden = (key: SectionKey) =>
  isFailed(key) && isDenied(key) && pageShowsSections.value;
const sectionApplies = (key: SectionKey) => {
  if (key === "incidents") return isIncidentsEnabled.value;
  if (key === "anomalies") return anomalyEnabled.value;
  if (key === "services") return servicesEnabled.value;
  return !alertsLocked.value;
};
// an empty message needs a settled, successful, applicable section on a page that shows the cards
const showSectionEmpty = (key: SectionKey) =>
  showOverviewCards.value &&
  pageShowsSections.value &&
  sectionState[key].loaded &&
  !isFailed(key) &&
  sectionApplies(key);

// two one-line messages share a row instead of stacking as two full-width boxes
const rendersSlim = (key: "anomalies" | "recentEvents") => {
  const rows = key === "anomalies" ? anomalies.value : recentEvents.value;
  if (rows.length > 0 || isSectionPending(key) || showSectionError(key)) return false;
  return showSectionForbidden(key) || showSectionEmpty(key);
};
const slimPair = computed(() => rendersSlim("anomalies") && rendersSlim("recentEvents"));

/* Wraps a loader with its section's state. The loaders swallow their own errors,
   and `finally` also covers the early `return` in the enterprise-gated ones, so
   a section can never be left stuck pending. */
const runSection = async (key: SectionKey, load: (current: () => boolean) => Promise<void>) => {
  const seq = ++sectionSeq[key];
  const current = () => seq === sectionSeq[key];
  // a retry after a failure has no valid answer on screen, so it takes the first-load placeholder again
  if (sectionFailure[key]) sectionState[key].loaded = false;
  sectionState[key].loading = true;
  try {
    await load(current);
  } finally {
    // a superseded call must not mark the newer call's section as settled
    if (current()) {
      sectionState[key].loading = false;
      sectionState[key].loaded = true;
    }
  }
};

// bumping every sequence makes responses still in flight for the previous org discard themselves
const resetLegacySections = () => {
  anomalies.value = [];
  incidents.value = [];
  incidentsTotal.value = 0;
  services.value = [];
  recentEvents.value = [];
  alertCount.value = null;
  alertCountSeq++;
  lastFetched.value = null;
  graphData.value = { nodes: [], edges: [] };
  selectedService.value = null;
  servicePanelVisible.value = false;
  showAlertHistoryDrawer.value = false;
  selectedAlertForHistory.value = null;
  selectedAlertIdForHistory.value = "";
  for (const key of Object.keys(sectionState) as SectionKey[]) {
    sectionSeq[key]++;
    sectionState[key].loading = false;
    sectionState[key].loaded = false;
    sectionFailure[key] = null;
  }
};

// Alert history drawer state
const showAlertHistoryDrawer = ref(false);
const selectedAlertForHistory = ref<any>(null);
const selectedAlertIdForHistory = ref("");

// Service grid scroll
const svcGridRef = ref<HTMLElement | null>(null);
const svcScrollCanLeft = ref(false);
const svcScrollCanRight = ref(false);

const onSvcScroll = () => {
  const el = svcGridRef.value;
  if (!el) return;
  svcScrollCanLeft.value = el.scrollLeft > 0;
  svcScrollCanRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
};

const scrollServices = (dir: 1 | -1) => {
  const el = svcGridRef.value;
  if (!el) return;
  el.scrollBy({ left: dir * (11 * 16 + 8), behavior: "smooth" });
};

// Service graph raw data + panel state
const graphData = ref<{ nodes: any[]; edges: any[] }>({ nodes: [], edges: [] });
const graphStream = ref(localStorage.getItem("serviceGraph_streamFilter") || "");
const selectedService = ref<any>(null);
const servicePanelVisible = ref(false);

// ── Data loading ─────────────────────────────────────────────────────────────
const orgId = computed(() => store.state.selectedOrganization?.identifier);

// ── Status band: firing now and data health ─────────────────────────────────
// The Firing view's own read, so the band answers even when /overview is slow or failing.
const firingRead = useQuery(() => ({
  ...firingAlertsQuery(orgId.value ?? ""),
  enabled: !!orgId.value && !alertsLocked.value,
}));
const alertRows = computed<HomeAlertRow[]>(() => firingRead.data.value?.list ?? []);
const firingRows = computed(() => firingNow(alertRows.value));
// the alert list already says what /overview would, so a failed summary can still show it
const deliveryFailures = computed(() =>
  firingState.value === "ok" ? undeliveredCount(alertRows.value) : null,
);
const enabledRules = computed(() => alertRows.value.filter((a) => a.enabled !== false).length);
const firingState = computed<FiringNowState>(() => {
  if (alertsLocked.value) return "locked";
  const page = firingRead.data.value;
  if (page) return page.status_unavailable ? "unavailable" : "ok";
  if (!firingRead.isError.value) return "loading";
  return isForbidden(firingRead.error.value) ? "denied" : "error";
});

// the header's data probe already holds every stream list, so data health asks for nothing new
const { lists: streamLists, listFailed: streamListFailed } = useOrgHasUserData(
  () => orgId.value ?? "",
);
const streamsSettled = computed(() =>
  streamLists.value.every((list, i) => list !== undefined || streamListFailed.value[i]),
);
const freshness = computed(() =>
  freshnessRows(streamLists.value, timeRange.value.startTime, streamListFailed.value),
);
const freshnessState = computed<DataFreshnessState>(() => {
  if (!streamsSettled.value) return "loading";
  return streamListFailed.value.every(Boolean) ? "error" : "ok";
});
const retryStreamLists = () => refreshUserStreamLists(orgId.value ?? "");
const { formatRangeWords } = useOverviewTime();
const rangeWords = computed(() =>
  formatRangeWords((timeRange.value.endTime - timeRange.value.startTime) / 1e6),
);
// firing alerts prove the org is live, so first steps never sit beside them
const showGettingStarted = computed(
  () =>
    freshnessState.value === "ok" && noDataEver(freshness.value) && alertRows.value.length === 0,
);
// data health reads the app's cached stream lists, so only the firing read can make the whole page fail
const bandFailed = computed(() => firingState.value !== "ok" && firingState.value !== "loading");
// ages are read against the time the data arrived, so they move only on a refresh
const clock = ref(Date.now());
watch([() => firingRead.dataUpdatedAt.value, lastFetched], () => (clock.value = Date.now()));

// `force` comes from the Refresh button. A mount or a tab switch reads the
// cache instead, which is what stops every tab switch re-requesting.
const loadAll = async (force = false) => {
  if (!orgId.value) return;
  isLoading.value = true;
  if (force) {
    if (!alertsLocked.value) void firingRead.refetch();
    void refreshUserStreamLists(orgId.value);
  }
  // the full-page heroes weigh whether the cards loaded, so they wait for /overview too
  await Promise.allSettled([
    loadOverview(force),
    runSection("recentEvents", (current) => loadHistoryAndSplit(force, current)),
    runSection("anomalies", (current) => loadAnomalies(force, current)),
    runSection("incidents", (current) => loadIncidents(force, current)),
    runSection("services", (current) => loadServiceGraph(force, current)),
    loadAlertCount(force),
  ]);
  await loadUserStreams(force);
  isLoading.value = false;
  // only a full-page hero means nothing loaded; loaded cards beside failed sections are still a run
  if (pageShowsSections.value) lastFetched.value = new Date();
};

// only the latest call may set the result or clear loading
const loadOverview = async (force = false) => {
  const org = orgId.value;
  const seq = ++overviewSeq;
  if (org !== overviewOrg) {
    overviewOrg = org;
    overview.value = null;
    overviewFailed.value = false;
    overviewForbidden.value = false;
    overviewRefreshFailed.value = false;
    resetLegacySections();
  }
  overviewState.loading = true;
  try {
    const key = overviewKeys.data(org, OVERVIEW_TOP);
    if (force) {
      // an in-flight read would be shared and never send refresh=true
      await queryClient.cancelQueries({ queryKey: key, exact: true });
      await queryClient.invalidateQueries({ queryKey: key, exact: true, refetchType: "none" });
    }
    const res = await queryClient.fetchQuery(orgOverviewQuery(org, { refresh: force }));
    if (seq !== overviewSeq) return;
    overview.value = res;
    overviewFailed.value = false;
    overviewForbidden.value = false;
    overviewRefreshFailed.value = false;
  } catch (err) {
    if (seq !== overviewSeq) return;
    overviewForbidden.value = isForbidden(err);
    if (overview.value && !overviewForbidden.value) {
      overviewRefreshFailed.value = true;
      return;
    }
    overview.value = null;
    overviewRefreshFailed.value = false;
    overviewFailed.value = !overviewForbidden.value;
  } finally {
    if (seq === overviewSeq) {
      overviewState.loading = false;
    }
  }
};

const incidentsTile = computed<IncidentsTile>(() => {
  if (!incidentsAccess.value.allowed || incidentsFeatureLocked.value) return "locked";
  if (!isIncidentsEnabled.value) return "unavailable";
  if (isSectionPending("incidents")) return "loading";
  if (isDenied("incidents") && isFailed("incidents")) return "forbidden";
  if (isFailed("incidents")) return "error";
  return "ok";
});

// only the flag-on page can tell that nothing is watched
const loadAlertCount = async (force = false) => {
  if (!flagOn.value) return;
  const org = orgId.value;
  const seq = ++alertCountSeq;
  try {
    const options = orgSummaryQuery(orgId.value);
    if (force) {
      await queryClient.invalidateQueries({
        queryKey: options.queryKey,
        exact: true,
        refetchType: "none",
      });
    }
    const summary: any = await queryClient.fetchQuery(options);
    if (seq !== alertCountSeq || org !== orgId.value) return;
    alertCount.value = (summary?.alerts?.num_realtime ?? 0) + (summary?.alerts?.num_scheduled ?? 0);
  } catch {
    if (seq !== alertCountSeq || org !== orgId.value) return;
    alertCount.value = null;
  }
};

// the flag-off first-data notice already probed each type at load, so its cached answers serve; null means unknown
const typeHasUserStream = async (org: string, type: string, reread: boolean) => {
  const probe = streamProbeQuery(org, type);
  const cached = reread ? undefined : queryClient.getQueryData(probe.queryKey);
  const head = cached ?? (await queryClient.fetchQuery(probe));
  if (head.total === 0) return false;
  if (userDataStreams(head.list).length > 0) return true;
  const options = streamPageQuery(org, type, { offset: 0, limit: STREAM_PROBE_PAGE });
  if (reread) {
    await queryClient.invalidateQueries({
      queryKey: options.queryKey,
      exact: true,
      refetchType: "none",
    });
  }
  const page = await queryClient.fetchQuery(options);
  if (userDataStreams(page.list).length > 0) return true;
  return page.list.length >= head.total ? false : null;
};

// Refresh and Retry re-read only while the first-data hero waits or a probe failed; an org the notice saw data in asks nothing
const loadUserStreams = async (force = false) => {
  const org = orgId.value;
  const reread = force && (noUserStreams.value === true || streamProbeFailed.value);
  streamProbeFailed.value = false;
  if (!org || flagOn.value || hasAnyData.value || attemptedSections.value.some(isFailed)) {
    noUserStreams.value = null;
    return;
  }
  if (readFirstDataRecord(org)?.hadData) {
    noUserStreams.value = false;
    return;
  }
  let failed = false;
  const found = await Promise.all(
    USER_DATA_STREAM_TYPES.map((type) =>
      typeHasUserStream(org, type, reread).catch((err: unknown) => {
        failed ||= !isForbidden(err);
        return null;
      }),
    ),
  );
  if (org !== orgId.value) return;
  streamProbeFailed.value = failed && !found.includes(true);
  if (found.includes(true)) noUserStreams.value = false;
  else noUserStreams.value = found.includes(null) ? null : true;
};

// Dedicated anomaly loader — uses anomaly_detection service for reliable results
const loadAnomalies = async (force = false, current: () => boolean = () => true) => {
  sectionFailure.anomalies = null;
  // the OSS build does not register the anomaly routes, and their 401 would end the session
  if (!anomalyEnabled.value) {
    anomalies.value = [];
    anomalyConfigCount.value = null;
    return;
  }
  try {
    const org = orgId.value;
    const { startTime, endTime } = timeRange.value;

    let rawHits: Array<{ cfg: any; hits: any[] }>;

    // `force` bypasses staleTime; the options object is the same either way.
    const read = <T,>(options: any): Promise<T> => {
      if (force) {
        void queryClient.invalidateQueries({
          queryKey: options.queryKey,
          exact: true,
          refetchType: "none",
        });
      }
      return queryClient.fetchQuery(options);
    };
    const readConfigs = (org: string) => read<any[]>(anomalyConfigsQuery(org));
    const readHistory = (org: string, limit: number) => read<any>(anomalyHistoryQuery(org, limit));

    // Fire list first; only fetch history if configs exist
    try {
      const configs: any[] = await readConfigs(org);
      if (!current()) return;
      anomalyConfigCount.value = configs.length;
      if (!configs.length) {
        anomalies.value = [];
        return;
      }
      const configById = new Map(configs.map((c: any) => [c.id ?? c.anomaly_id, c]));
      const bulkRes = await readHistory(org, 20);
      if (!current()) return;
      const bulkConfigs: any[] = bulkRes?.configs ?? [];
      // Merge bulk history hits with config metadata
      rawHits = bulkConfigs.map((entry: any) => ({
        cfg: configById.get(entry.cfg?.id) ?? entry.cfg,
        hits: entry.hits ?? [],
      }));
    } catch {
      // Bulk endpoint not available — fall back to per-config requests
      const configs: any[] = await readConfigs(org);
      if (!current()) return;
      anomalyConfigCount.value = configs.length;
      if (!configs.length) {
        anomalies.value = [];
        return;
      }
      const limitPerConfig = Math.min(20, Math.ceil(500 / configs.length));
      const results = await Promise.allSettled(
        configs.map((c) => anomalyService.getHistory(org, c.id ?? c.anomaly_id, limitPerConfig)),
      );
      if (!current()) return;
      rawHits = configs.map((cfg, idx) => ({
        cfg,
        hits:
          results[idx].status === "fulfilled"
            ? ((results[idx] as PromiseFulfilledResult<any>).value.data ?? [])
            : [],
      }));
    }

    const found: any[] = [];
    rawHits.forEach(({ cfg, hits }: { cfg: any; hits: any[] }) => {
      hits.forEach((h: any) => {
        const tsMs = h.timestamp ? Math.floor(h.timestamp / 1000) : 0;
        if (tsMs && (tsMs < startTime / 1000 || tsMs > endTime / 1000)) return;
        if ((h.anomaly_count ?? 0) > 0) {
          found.push({
            id: h.id ?? `anm-${cfg?.id}-${tsMs}`,
            title: t("overview.anomalyDetectedTitle", {
              name: cfg?.name ?? cfg?.alert_name ?? h.alert_name ?? "unknown",
            }),
            description: t("overview.anomalyDetectedDescription", {
              stream: cfg?.stream_name ?? h.stream_name ?? "unknown",
              count: h.anomaly_count,
            }),
            severity: "warning",
            alertName: cfg?.name ?? cfg?.alert_name ?? h.alert_name,
            streamName: cfg?.stream_name ?? h.stream_name,
            ts: tsMs,
            alertId: cfg?.id ?? cfg?.anomaly_id ?? h.anomaly_id ?? "",
            alertConfig: cfg ?? null,
          });
        }
      });
    });

    // Dedup by alertName, keep most recent, sort newest first
    const deduped = new Map<string, any>();
    found.forEach((a) => {
      const key = a.alertName ?? a.id;
      const ex = deduped.get(key);
      if (!ex || a.ts > ex.ts) deduped.set(key, a);
    });
    const result = Array.from(deduped.values())
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 3);

    anomalies.value = result;
  } catch (err) {
    if (!current()) return;
    anomalies.value = [];
    anomalyConfigCount.value = null;
    sectionFailure.anomalies = err;
  }
};

interface RecentEvent {
  id: string;
  name: string;
  kind: "firing" | "failed";
  level: FiringLevel;
  // the newest firing could not notify; it stays a firing, with delivery as a second fact (X6)
  notifyFailed: boolean;
  count: number;
  rawTs: number;
}

// one row per alert and outcome, newest first, so a rule that fires every minute is one row with a count
const summarizeHistory = (hits: any[]): RecentEvent[] => {
  const byKey = new Map<string, RecentEvent>();
  for (const h of hits) {
    const kind = isFiringOutcome(h.status) ? "firing" : isErrorOutcome(h.status) ? "failed" : null;
    if (!kind) continue;
    const name = String(h.alert_name ?? "");
    const key = `${kind}:${name}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
      if (h.timestamp <= existing.rawTs) continue;
    }
    byKey.set(key, {
      id: key,
      name,
      kind,
      level: firingLevel({ level: h.level } as HomeAlertRow),
      notifyFailed: isNotifyFailedOutcome(h.status),
      count: existing?.count ?? 1,
      rawTs: h.timestamp ?? 0,
    });
  }
  return [...byKey.values()].sort((a, b) => b.rawTs - a.rawTs).slice(0, 5);
};

const EVENT_TONE: Record<FiringLevel, string> = {
  critical: "error",
  warning: "warning",
  other: "neutral",
};

const alertLookup = computed(() => alertsByName(alertRows.value));
const recentRows = computed(() =>
  recentEvents.value.map((ev) => ({
    ...ev,
    alert: alertLookup.value.get(ev.name),
    tone: ev.kind === "failed" ? "warning" : EVENT_TONE[ev.level],
    kindLabel: eventKindLabel(ev),
    timeAgo: relativeTime_(ev.rawTs),
  })),
);

const eventKindLabel = (ev: RecentEvent): I18nText => {
  if (ev.kind === "failed") return t("overview.events.runFailed");
  if (ev.level === "critical") return t("overview.level.critical");
  return ev.level === "warning" ? t("overview.level.warning") : t("overview.level.okFiring");
};

const alertDetailRoute = (row: HomeAlertRow) => ({
  name: "alertDetail",
  params: { alert_id: row.alert_id },
  query: { org_identifier: orgId.value ?? "", folder: row.folder_id || "default" },
});

// Alert trigger history feeds recentEvents only
const loadHistoryAndSplit = async (force = false, current: () => boolean = () => true) => {
  sectionFailure.recentEvents = null;
  if (alertsLocked.value) {
    recentEvents.value = [];
    return;
  }
  try {
    // Exact bounds: `alertHistoryQuery` rounds only its key, so the newest minutes still reach the server.
    const historyOptions = alertHistoryQuery(orgId.value, {
      start_time: timeRange.value.startTime,
      end_time: timeRange.value.endTime,
      from: 0,
      size: 500,
      sort_by: "timestamp",
      sort_order: "desc",
    });
    if (force) {
      await queryClient.invalidateQueries({
        queryKey: historyOptions.queryKey,
        exact: true,
        refetchType: "none",
      });
    }
    const res: any = await queryClient.fetchQuery(historyOptions);
    if (!current()) return;
    const hits: any[] = res?.hits ?? [];
    recentEvents.value = summarizeHistory(hits);
  } catch (err) {
    if (!current()) return;
    recentEvents.value = [];
    sectionFailure.recentEvents = err;
  }
};

const loadIncidents = async (force = false, current: () => boolean = () => true) => {
  if (!isIncidentsEnabled.value) return;
  sectionFailure.incidents = null;
  try {
    const incidentOptions = incidentsQuery(orgId.value, "open", 4, 0);
    if (force) {
      await queryClient.invalidateQueries({
        queryKey: incidentOptions.queryKey,
        exact: true,
        refetchType: "none",
      });
    }
    const res: any = await queryClient.fetchQuery(incidentOptions);
    if (!current()) return;
    incidents.value = res?.incidents ?? [];
    incidentsTotal.value = res?.total ?? incidents.value.length;
  } catch (err) {
    if (!current()) return;
    incidents.value = [];
    incidentsTotal.value = 0;
    sectionFailure.incidents = err;
  }
};

const loadServiceGraph = async (force = false, current: () => boolean = () => true) => {
  if (!servicesEnabled.value) return;
  sectionFailure.services = null;
  try {
    graphStream.value = "all";

    const topologyOptions = serviceTopologyQuery(orgId.value, {
      startTime: timeRange.value.startTime,
      endTime: timeRange.value.endTime,
    });
    if (force) {
      await queryClient.invalidateQueries({
        queryKey: topologyOptions.queryKey,
        exact: true,
        refetchType: "none",
      });
    }
    const res: any = await queryClient.fetchQuery(topologyOptions);
    if (!current()) return;
    const nodes: any[] = res?.nodes ?? [];
    const edges: any[] = res?.edges ?? [];
    graphData.value = { nodes, edges };

    // Build per-node latency flag from incoming edges that have a baseline
    // Flag if p99 > 2x baseline_p99 (meaningful degradation, not noise)
    const latencyByNode = new Map<string, { multiplier: number }>();
    for (const edge of edges) {
      const baseline = edge.baseline_p99_latency_ns;
      const current = edge.p99_latency_ns;
      if (baseline && baseline > 0 && current > 0) {
        const mult = current / baseline;
        if (mult >= 2) {
          const existing = latencyByNode.get(edge.to);
          if (!existing || mult > existing.multiplier) {
            latencyByNode.set(edge.to, { multiplier: mult });
          }
        }
      }
    }

    const cards = nodes.map((node) => {
      const latInfo = latencyByNode.get(node.id);
      const health = serviceHealthFromErrorRate(node.error_rate ?? 0);
      const errorFlag = health !== "healthy";
      const latencyFlag = !!latInfo;
      return {
        ...node,
        health,
        errorFlag,
        latencyFlag,
        latencyMultiplier: latInfo ? latInfo.multiplier.toFixed(1) : null,
      };
    });
    services.value = cards
      // Show only services with at least one flag, then healthy ones after
      .sort((a, b) => {
        const aScore = (a.errorFlag ? 2 : 0) + (a.latencyFlag ? 1 : 0);
        const bScore = (b.errorFlag ? 2 : 0) + (b.latencyFlag ? 1 : 0);
        if (bScore !== aScore) return bScore - aScore;
        const errDiff = (b.error_rate ?? 0) - (a.error_rate ?? 0);
        if (errDiff !== 0) return errDiff;
        return a.id.localeCompare(b.id);
      })
      .slice(0, 12);
    // The open side panel reads the selected card's numbers, so it must follow the refreshed card.
    const selectedId = selectedService.value?.id;
    if (selectedId) {
      const refreshed = cards.find((c) => c.id === selectedId);
      if (refreshed) selectedService.value = refreshed;
      else closeServicePanel();
    }
    await nextTick();
    onSvcScroll();
  } catch (err) {
    if (!current()) return;
    services.value = [];
    sectionFailure.services = err;
  }
};

// ── Helpers ──────────────────────────────────────────────────────────────────
const relativeTime_ = (tsMicros: number): string => {
  if (!tsMicros) return "—";
  const diffMs = Date.now() - Math.floor(tsMicros / 1000);
  if (diffMs < 60_000) return t("overview.secondsAgo", { count: Math.round(diffMs / 1000) });
  if (diffMs < 3_600_000) return t("overview.minutesAgo", { count: Math.round(diffMs / 60_000) });
  if (diffMs < 86_400_000) return t("overview.hoursAgo", { count: Math.round(diffMs / 3_600_000) });
  return t("overview.daysAgo", { count: Math.round(diffMs / 86_400_000) });
};

const sortedDimensions = (dims: Record<string, string>): [string, string][] =>
  chipDimensionKeys(dims).map((k) => [k, dims[k]]);

// Shorten verbose k8s-style keys for display: "k8s-namespace" → "namespace"
const shortDimKey = (key: string): string =>
  key.replace(/^k8s-/, "").replace(/^kubernetes[_-]/, "");

// A shortened key keeps the full key in its tooltip; a finding's words need none.
const incidentDimensions = (dims: Record<string, string>) =>
  sortedDimensions(dims).map(([key, val]) => {
    const shown = dimensionDisplay(t, dims, key, val);
    return {
      key,
      label: shown.label ?? shortDimKey(key),
      value: shown.value,
      rawTooltip: !shown.label,
    };
  });

const severityRowClass = (severity: string) =>
  severity === "critical"
    ? "border-s-[0.1875em] border-s-error-600"
    : "border-s-[0.1875em] border-s-warning-600";

const severityIconClass = (severity: string) =>
  severity === "critical" ? "text-error-600" : "text-warning-600";

const incidentRowClass = (severity: string) => {
  const s = (severity ?? "").toLowerCase();
  if (s === "p1") return "border-s-error-600";
  if (s === "p2") return "border-s-warning-600";
  return "border-s-status-info-text";
};

const incidentIconClass = (severity: string) => {
  const s = (severity ?? "").toLowerCase();
  if (s === "p1") return "text-error-600";
  if (s === "p2") return "text-warning-600";
  return "text-status-info-text";
};

const SERVICE_CARD_BORDER: Record<ServiceHealthStatus, string> = {
  critical: "border-s-[0.1875em] border-s-service-health-critical",
  warning: "border-s-[0.1875em] border-s-service-health-warning",
  degraded: "border-s-[0.1875em] border-s-service-health-degraded",
  healthy: "border-s-[0.1875em] border-s-service-health-healthy",
};

const SERVICE_ERROR_RATE_TEXT: Record<ServiceHealthStatus, string> = {
  critical: "text-service-health-critical",
  warning: "text-service-health-warning",
  degraded: "text-service-health-degraded",
  healthy: "text-text-heading",
};

const serviceCardClass = (svc: { health: ServiceHealthStatus; latencyFlag: boolean }) =>
  SERVICE_CARD_BORDER[svc.health === "healthy" && svc.latencyFlag ? "degraded" : svc.health];

// ── Navigation ───────────────────────────────────────────────────────────────
const trackDrilldown = (target: string, properties?: object) =>
  analytics.track("home_overview_drilldown_clicked", { target, ...properties });

const goToAlert = (item: any) => {
  trackDrilldown("alert_history");
  selectedAlertForHistory.value = item.alertConfig ?? { name: item.alertName };
  selectedAlertIdForHistory.value = item.alertId ?? "";
  showAlertHistoryDrawer.value = true;
};

// Gen-AI node names live in gen_ai_* fields, and their streams may lack infer_service_name (a 400).
const INFER_NAME_SERVICE_TYPES = new Set(["database", "queue", "rpc", "external"]);

const goToService = (svc: any, e?: MouseEvent) => {
  // Fired from the per-card info-icon button — stop it bubbling to the card
  // click (which opens the latency/info side panel).
  e?.stopPropagation();
  // the service panel's View traces emits here too, outside this file's lock markup
  if (tracesLock.locked.value) return;
  trackDrilldown("service_traces");
  let filter = buildViewTracesFilter({
    serviceName: svc.label ?? svc.id,
    serviceType: INFER_NAME_SERVICE_TYPES.has(svc.service_type) ? svc.service_type : undefined,
  });
  if (svc.errorFlag) filter += ` AND span_status = 'ERROR'`;

  const query: Record<string, string> = {
    org_identifier: orgId.value ?? "",
    tab: "spans",
    query: b64EncodeUnicode(filter) ?? "",
    stream: svc.stream_name ?? graphStream.value,
  };

  if (dateTimeType.value === "relative") {
    query.period = relativeTime.value;
  } else {
    query.from = timeRange.value.startTime.toString();
    query.to = timeRange.value.endTime.toString();
  }

  router.push({ name: "traces", query });
};

const openServicePanel = (svc: any) => {
  // The card's own click handler (behaviour swapped with the info icon):
  // clicking the card body opens the latency/info side panel.
  selectedService.value = svc;
  servicePanelVisible.value = true;
  trackDrilldown("service_panel");
};

const closeServicePanel = () => {
  servicePanelVisible.value = false;
  selectedService.value = null;
};

const goToIncident = (inc: any) => {
  trackDrilldown("incident");
  router.push({
    name: "incidentDetail",
    params: { id: inc.id },
    query: { org_identifier: orgId.value },
  });
};

// Reuses the same signal the left-nav flyout uses to decide whether a section
// is reachable at all (navGroups.ts) — a route only exists on the router when
// its feature/RBAC gate allows it, so `hasRoute` keeps this empty state from
// ever offering a card the user has no way to actually land on.
const showAlertsCard = computed(() => router.hasRoute("alertList"));
const showLogsCard = computed(() => router.hasRoute("logs"));

// The bare "View all" promises every alert behind the org-wide counts, not only what fires.
const openAlertList = (filter: Record<string, string> = ALERT_LIST_FILTERS.all) => {
  if (alertsLocked.value) return;
  trackDrilldown("alerts");
  router.push({ name: "alertList", query: { org_identifier: orgId.value, ...filter } });
};

// Each filter yields exactly the rows its count tallies; the counts are org-wide, so the list opens on every folder.
const all_folders = ALERT_LIST_ALL_FOLDERS;
const ALERT_LIST_FILTERS = {
  all: { state: ALERT_LIST_ALL_STATES, all_folders },
  firing: { state: "firing", all_folders },
  failing: { state: "error", all_folders },
  delivery: { state: "notify_failed", all_folders },
  critical: { state: "firing", level: "critical", all_folders },
  warning: { state: "firing", level: "warning", all_folders },
} as const;

const goToAddAlert = () => {
  if (alertsLocked.value) return;
  trackDrilldown("add_alert");
  router.push({ name: "addAlert", query: { org_identifier: orgId.value } });
};

const goToPipelines = (state?: "errored") => {
  trackDrilldown("pipelines");
  router.push({
    name: "pipelines",
    query: { org_identifier: orgId.value, ...(state && { state }) },
  });
};

const goToStreams = () => {
  trackDrilldown("streams");
  router.push({ name: "logstreams", query: { org_identifier: orgId.value } });
};

const goToIngestion = () => {
  trackDrilldown("ingestion");
  router.push({ name: "ingestion", query: { org_identifier: orgId.value } });
};

const onSignalOpen = (signal: OverviewSignal) => {
  if (signal in signalLockedReasons.value) return;
  trackDrilldown("signal", { signal });
  router.push({ name: signal, query: { org_identifier: orgId.value } });
};

const onHeadlineSelect = (target: OverviewTarget) => {
  if (target in ALERT_LIST_FILTERS)
    openAlertList(ALERT_LIST_FILTERS[target as keyof typeof ALERT_LIST_FILTERS]);
  else if (target === "pipelines") goToPipelines("errored");
  else if (target === "quiet") goToStreams();
  else if (incidentsLicenseLocked.value) return;
  else if (incidentsTile.value === "locked") openUpgradeDialog();
  else if (incidentsTile.value !== "unavailable" && incidentsTile.value !== "forbidden") {
    goToIncidentList();
  }
};

const onAskAi = (target: OverviewAskAiTarget) => {
  emit(
    "sendToAiChat",
    buildOverviewAskAi(
      target,
      {
        orgId: orgId.value ?? "",
        startTime: timeRange.value.startTime,
        endTime: timeRange.value.endTime,
        rangeLabel: rangeLabel.value,
        generatedAt: overview.value?.generated_at,
      },
      t,
    ),
  );
};

const goToIncidentList = () => {
  trackDrilldown("incidents");
  router.push({ name: "incidentList", query: { org_identifier: orgId.value, status: "open" } });
};

const goToAllIncidents = () => {
  trackDrilldown("incidents");
  router.push({ name: "incidentList", query: { org_identifier: orgId.value } });
};

const goToAnomalies = () => {
  trackDrilldown("anomalies");
  router.push({
    name: "alertList",
    query: { org_identifier: orgId.value, tab: "anomalyDetection" },
  });
};

const goToLogs = () => {
  if (logsLock.locked.value) return;
  trackDrilldown("logs");
  router.push({ name: "logs", query: { org_identifier: orgId.value } });
};

const goToServiceGraph = () => {
  if (tracesLock.locked.value) return;
  trackDrilldown("service_graph");
  const query: Record<string, string> = {
    org_identifier: orgId.value,
    tab: "service-graph",
  };
  if (dateTimeType.value === "relative") {
    query.period = relativeTime.value;
  } else {
    query.from = timeRange.value.startTime.toString();
    query.to = timeRange.value.endTime.toString();
  }
  router.push({ name: "traces", query });
};

// ── Lifecycle ────────────────────────────────────────────────────────────────
onMounted(loadAll);

watch(
  () => store.state.selectedOrganization?.identifier,
  (val, old) => {
    if (val && val !== old) {
      // The org-switch purge in MainLayout drops the previous org's entries.
      loadAll();
    }
  },
);

// A sample load or removal that ends while Home is open must re-check the org, not wait for a reload
const sampleSession = useSampleDataSession();
watch(sampleSession.status, (now, was) => {
  if (was === "loading" && now !== "idle" && sampleSession.loadingOrg.value === orgId.value)
    loadAll(true);
});
watch(sampleSession.removals, ({ org }) => {
  if (org === orgId.value) loadAll(true);
});

// zoConfig loads asynchronously after mount — retry incidents when it becomes available
watch(isIncidentsEnabled, (enabled) => {
  if (!enabled || incidents.value.length > 0) return;
  // the earlier pass returned early and marked the section loaded, so re-arm its skeleton
  sectionState.incidents.loaded = false;
  void runSection("incidents", (current) => loadIncidents(false, current));
});
// a failed config fetch is retried after mount, so the flag can turn on once the first pass has skipped the section
watch(anomalyEnabled, (enabled) => {
  if (!enabled) return;
  sectionState.anomalies.loaded = false;
  void runSection("anomalies", (current) => loadAnomalies(false, current));
});
</script>
