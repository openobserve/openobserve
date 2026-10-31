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
  <OContent class="text-text-body flex h-full flex-col gap-0 overflow-y-auto pt-2.5 pb-2.5">
    <!-- Header: refresh + time picker -->
    <div v-if="pageState !== 'forbidden'" class="mb-4 flex justify-end">
      <div class="flex items-center gap-2">
        <ORefreshButton
          :last-run-at="lastFetched ? lastFetched.getTime() : null"
          :loading="isLoading || overviewState.loading"
          :disabled="isLoading || overviewState.loading"
          @click="() => loadAll(true)"
        />
        <DateTime
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
      </div>
    </div>

    <p
      v-if="showOverviewCards && overview"
      class="text-text-secondary mb-2 text-xs"
      data-test="overview-freshness-note"
    >
      {{ t("overview.freshness", { time: generatedAtLabel }) }}
    </p>

    <OBanner
      v-if="showOverviewCards && overviewRefreshFailed"
      variant="warning"
      inline-actions
      class="mb-3"
      data-test="overview-stale-notice"
    >
      {{ t("overview.stale.message", { time: generatedAtLabel }) }}
      <template #actions>
        <OButton
          variant="outline"
          size="sm"
          icon-left="refresh"
          data-test="overview-stale-retry-btn"
          @click="() => loadOverview(true)"
        >
          {{ t("overview.stale.retry") }}
        </OButton>
      </template>
    </OBanner>

    <OverviewHeadlineStrip
      v-if="showOverviewCards"
      class="mb-5"
      :overview="overview"
      :pending="overviewPending"
      :failed="overviewFailed"
      :forbidden="overviewForbidden"
      :incidents-state="incidentsTile"
      :incidents-total="incidentsTotal"
      @select="onHeadlineSelect"
    />

    <!-- ACTIVE INCIDENTS (enterprise / cloud only) -->
    <section
      v-if="isIncidentsEnabled && incidents.length > 0"
      class="mb-5"
      data-test="overview-incidents-section"
    >
      <div class="mb-2 flex items-center justify-between ps-1">
        <div class="text-text-heading text-sm font-medium tracking-[0.01em]">
          {{ t("overview.activeIncidents") }}
          <OTag type="countChip" value="warning">{{ incidentsTotal }}</OTag>
          <span
            v-if="incidentsTotal > incidents.length"
            class="text-text-secondary ms-2 align-middle text-xs font-normal"
            >{{ t("overview.showingOf", { shown: incidents.length, total: incidentsTotal }) }}</span
          >
        </div>
        <button
          class="text-text-link cursor-pointer border-none bg-none p-0 text-xs font-medium whitespace-nowrap opacity-80 transition-opacity duration-150 hover:underline hover:opacity-100"
          @click="goToIncidentList"
        >
          {{ t("overview.viewAll") }} {{ "→" }}
        </button>
      </div>
      <div
        class="border-border-default rounded-default flex flex-col overflow-hidden border border-[0.0625em]"
      >
        <div
          v-for="inc in incidents"
          :key="inc.id"
          class="group bg-surface-base hover:bg-table-row-hover-bg border-b-border-default flex items-center gap-3 border-s-[0.1875em] border-b-[0.0625em] px-3.5 py-2.5 transition-[background] duration-150 last:border-b-0"
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
            <div class="text-text-heading flex flex-wrap items-center gap-1 text-sm font-medium">
              <OTag type="severity" :value="(inc.severity || 'p4').toLowerCase()" />
              {{ inc.title || t("overview.untitledIncident") }}
              <template v-if="inc.group_values && Object.keys(inc.group_values).length > 0">
                <ODimensionChip
                  v-for="[key, val] in sortedDimensions(inc.group_values)"
                  :key="key"
                  :dim-key="key"
                  :key-label="shortDimKey(key)"
                  :value="val"
                  :tooltip="true"
                />
              </template>
            </div>
          </div>
          <div class="flex w-48 shrink-0 items-center gap-[0.3rem] whitespace-nowrap">
            <span class="text-text-secondary min-w-[4.5rem] text-xs">{{
              relativeTime_(inc.first_alert_at)
            }}</span>
            <span class="text-text-secondary text-xs">·</span>
            <span class="text-text-secondary text-xs font-normal"
              >{{ inc.alert_count }} {{ t("overview.alertsSuffix") }}</span
            >
          </div>
          <span class="invisible shrink-0 whitespace-nowrap group-hover:visible max-md:visible">
            <OButton variant="ghost-primary" size="sm" @click="goToIncident(inc)">
              {{ t("overview.investigate") }}
            </OButton>
          </span>
        </div>
      </div>
    </section>
    <OverviewSkeleton
      v-else-if="isIncidentsEnabled && isSectionPending('incidents')"
      section="incidents"
    />
    <OverviewSectionError
      v-else-if="showSectionError('incidents')"
      section="incidents"
      :title="t('overview.activeIncidents')"
      @retry="() => loadAll(true)"
    />
    <OverviewSectionEmpty
      v-else-if="showSectionForbidden('incidents')"
      section="incidents"
      kind="forbidden"
      :title="t('overview.activeIncidents')"
    />

    <OverviewSectionEmpty
      v-else-if="showSectionEmpty('incidents')"
      section="incidents"
      kind="empty"
      :title="t('overview.activeIncidents')"
    />

    <div
      v-if="showOverviewCards"
      class="mb-5 grid grid-cols-2 gap-3 max-lg:grid-cols-1"
      data-test="overview-alerts-health-grid"
    >
      <OverviewAlertsCard
        :section="overview?.alerts"
        :pending="overviewPending"
        :failed="overviewFailed"
        :forbidden="overviewForbidden"
        :incidents-state="incidentsTile"
        :incidents-total="incidentsTotal"
        @retry="() => loadOverview(true)"
        @open="goToAlertList"
        @create="goToAddAlert"
      />
      <OverviewDataHealthCard
        class="self-start"
        :overview="overview"
        :pending="overviewPending"
        :failed="overviewFailed"
        :forbidden="overviewForbidden"
        @retry="() => loadOverview(true)"
        @open="onHealthOpen"
      />
    </div>

    <!-- the upsell sits below the alerts grid so it never outranks live alert state -->
    <section v-if="!incidentsAccess.allowed" class="mb-5" data-test="overview-incidents-locked">
      <div class="mb-2 flex items-center justify-between ps-1">
        <div class="text-text-heading text-sm font-medium tracking-[0.01em]">
          {{ t("overview.activeIncidents") }}
        </div>
      </div>
      <div
        class="border-border-default bg-surface-subtle rounded-default flex cursor-pointer items-center gap-3 border border-[0.0625em] px-4 py-5"
        @click="openUpgradeDialog"
      >
        <OIcon name="lock" size="md" class="text-warning-600 shrink-0" />
        <span class="text-text-secondary text-sm">{{ incidentsAccess.message }}</span>
      </div>
    </section>

    <!-- SERVICES (enterprise only — needs service graph data) -->
    <section
      v-if="incidentsAccess.allowed && services.length > 0"
      class="mb-5"
      data-test="overview-services-section"
    >
      <div class="mb-2 flex items-center justify-between ps-1">
        <div class="text-text-heading text-sm font-medium tracking-[0.01em]">
          {{ t("overview.services") }}
          <OTag type="countChip" value="warning">{{ services.length }}</OTag>
          <span
            v-if="servicePanelVisible && selectedService"
            class="text-text-secondary ms-1 text-xs font-normal"
          >
            {{ t("overview.viewingLabel") }}
            <strong class="text-text-body font-semibold">{{
              selectedService.label ?? selectedService.id
            }}</strong>
          </span>
        </div>
        <button
          class="text-text-link cursor-pointer border-none bg-none p-0 text-xs font-medium whitespace-nowrap opacity-80 transition-opacity duration-150 hover:underline hover:opacity-100"
          @click="goToServiceGraph"
        >
          {{ t("overview.viewAll") }} {{ "→" }}
        </button>
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
            class="rounded-default border-border-default bg-surface-base max-w-40 min-w-40 shrink-0 grow-0 basis-40 cursor-pointer border border-[0.0625em] px-3.5 py-3 transition-[background-color,box-shadow,outline-color] duration-150"
            :class="[
              serviceCardClass(svc),
              selectedService?.id === svc.id && servicePanelVisible
                ? 'outline-accent bg-surface-tint-accent shadow-primary-500/22 shadow-sm outline-[0.125em] outline-offset-[-0.0625em] outline-solid'
                : 'hover:bg-table-row-hover-bg',
            ]"
            @click="openServicePanel(svc)"
          >
            <div class="mb-2 flex items-center justify-between">
              <OTruncatedText
                class="text-text-heading block flex-1 cursor-default text-sm font-medium"
                >{{ svc.label }}</OTruncatedText
              >
              <span class="ms-1 inline-flex shrink-0 items-center">
                <OButton
                  variant="ghost-muted"
                  size="icon"
                  :title="t('traces.servicesCatalog.viewTraces')"
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
                <span class="text-2xs text-text-secondary font-semibold tracking-[0.04em]">{{
                  t("overview.colErrorRate")
                }}</span>
                <span
                  class="text-text-body text-sm font-medium"
                  :class="svc.errorFlag ? 'text-error-600' : ''"
                >
                  {{ svc.error_rate != null ? svc.error_rate.toFixed(1) + "%" : "—" }}
                </span>
              </div>
              <div class="flex items-baseline justify-between gap-2">
                <span class="text-2xs text-text-secondary font-semibold tracking-[0.04em]">{{
                  t("overview.colLatency")
                }}</span>
                <span
                  class="text-text-body text-sm font-medium"
                  :class="svc.latencyFlag ? 'text-warning-700' : ''"
                >
                  {{ svc.latencyMultiplier ? raw(svc.latencyMultiplier + "x") : raw("—") }}
                </span>
              </div>
              <div class="flex items-baseline justify-between gap-2">
                <span class="text-2xs text-text-secondary font-semibold tracking-[0.04em]">{{
                  t("overview.colReqs")
                }}</span>
                <span class="text-text-body text-sm font-medium">{{
                  formatReqRate(svc.requests)
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
      v-else-if="incidentsAccess.allowed && isSectionPending('services')"
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

    <!-- Locked: Services shares the Incidents license gate — same bundle, no
         separate upsell story of its own. -->
    <section v-else-if="!incidentsAccess.allowed" class="mb-5" data-test="overview-services-locked">
      <div class="mb-2 flex items-center justify-between ps-1">
        <div class="text-text-heading text-sm font-medium tracking-[0.01em]">
          {{ t("overview.services") }}
        </div>
      </div>
      <div
        class="border-border-default bg-surface-subtle rounded-default flex cursor-pointer items-center gap-3 border border-[0.0625em] px-4 py-5"
        @click="openUpgradeDialog"
      >
        <OIcon name="lock" size="md" class="text-warning-600 shrink-0" />
        <span class="text-text-secondary text-sm">{{ incidentsAccess.message }}</span>
      </div>
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

    <!-- ACTIVE ANOMALIES -->
    <section v-if="anomalies.length > 0" class="mb-5" data-test="overview-anomalies-section">
      <div class="mb-2 flex items-center justify-between ps-1">
        <div class="text-text-heading text-sm font-medium tracking-[0.01em]">
          {{ t("overview.activeAnomalies") }}
          <OTag type="countChip" value="warning">{{ anomalies.length }}</OTag>
        </div>
        <button
          class="text-text-link cursor-pointer border-none bg-none p-0 text-xs font-medium whitespace-nowrap opacity-80 transition-opacity duration-150 hover:underline hover:opacity-100"
          @click="goToAnomalies"
        >
          {{ t("overview.viewAll") }} {{ "→" }}
        </button>
      </div>
      <div class="flex flex-col gap-1.5">
        <div
          v-for="item in anomalies"
          :key="item.id"
          class="group rounded-default border-border-default bg-surface-base hover:bg-table-row-hover-bg flex items-center gap-3 border border-[0.0625em] px-3.5 py-2.5 transition-[background] duration-150"
          :class="severityRowClass(item.severity)"
        >
          <span class="flex shrink-0 items-center" :class="severityIconClass(item.severity)">
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
              class="text-text-heading flex flex-wrap items-center gap-1 [row-gap:0.25rem] text-sm font-medium"
            >
              {{ item.title }}
              <span class="text-text-secondary mx-[0.1rem] text-xs font-normal">·</span>
              <span class="text-text-secondary text-xs font-normal">{{ item.description }}</span>
            </div>
          </div>
          <span class="invisible shrink-0 whitespace-nowrap group-hover:visible max-md:visible">
            <OButton variant="ghost-primary" size="sm" @click="goToAlert(item)">
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

    <!-- RECENT EVENTS (alert firing feed) -->
    <section v-if="recentEvents.length > 0" class="mb-5" data-test="overview-recent-events-section">
      <div class="mb-2 flex items-center justify-between ps-1">
        <div class="text-text-heading text-sm font-medium tracking-[0.01em]">
          {{ t("overview.recentEvents") }}
          <OTag type="countChip" value="warning">{{ recentEvents.length }}</OTag>
        </div>
        <button
          class="text-text-link cursor-pointer border-none bg-none p-0 text-xs font-medium whitespace-nowrap opacity-80 transition-opacity duration-150 hover:underline hover:opacity-100"
          @click="goToAlertList"
        >
          {{ t("overview.viewAll") }} {{ "→" }}
        </button>
      </div>
      <div
        class="border-border-default rounded-default bg-surface-base flex flex-col gap-0 overflow-hidden border border-[0.0625em]"
      >
        <div
          v-for="ev in recentEvents"
          :key="ev.id"
          class="border-b-border-default text-compact hover:bg-table-row-hover-bg flex items-center gap-3 border-b border-b-[0.0625em] px-3.5 py-2 transition-[background] duration-150 last:border-b-0"
        >
          <OTag type="eventStatus" :value="ev.typeLabel" class="shrink-0" />
          <OTruncatedText class="text-text-heading max-w-[12.5em] min-w-[7.5em] font-medium">{{
            ev.service
          }}</OTruncatedText>
          <OTruncatedText class="text-text-secondary flex-1">{{ ev.description }}</OTruncatedText>
          <OTag
            v-if="ev.failCount > 1"
            type="countChip"
            value="error"
            class="shrink-0"
            :title="t('common.failedTimesInWindow', { count: ev.failCount })"
            >{{ t("overview.timesSymbol") }}{{ ev.failCount }}</OTag
          >
          <span class="text-text-secondary shrink-0 text-xs whitespace-nowrap">{{
            ev.timeAgo
          }}</span>
        </div>
      </div>
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

    <OverviewSignalCards
      v-if="showOverviewCards"
      class="mb-5"
      :section="overview?.streams"
      :pending="overviewPending"
      :failed="overviewFailed"
      :forbidden="overviewForbidden"
      @open="onSignalOpen"
    />

    <div
      v-if="showOverviewCards"
      class="mb-5 grid grid-cols-2 gap-3 max-lg:grid-cols-1"
      data-test="overview-streams-limit-grid"
    >
      <OverviewStreamsCard
        :section="overview?.streams"
        :pending="overviewPending"
        :failed="overviewFailed"
        :forbidden="overviewForbidden"
        @retry="() => loadOverview(true)"
        @open="goToStreams"
        @start-ingesting="goToIngestion"
      />
      <div class="flex flex-col gap-3 self-start">
        <OverviewLimitCard
          v-if="!isCloud"
          :section="overview?.limits"
          :pending="overviewPending"
          :failed="overviewFailed"
          :forbidden="overviewForbidden"
          @retry="() => loadOverview(true)"
          @unlock="openUpgradeDialog"
        />
        <OverviewStorageCard
          :section="overview?.streams"
          :pending="overviewPending"
          :failed="overviewFailed"
          :forbidden="overviewForbidden"
          @retry="() => loadOverview(true)"
        />
      </div>
    </div>

    <OEmptyState
      v-if="pageState === 'forbidden' || errorIsForbidden"
      preset="no-access"
      size="block"
      data-test="overview-no-access-empty-state"
    />
    <OEmptyState
      v-else-if="pageState === 'error'"
      preset="load-error"
      size="hero"
      data-test="overview-load-error-empty-state"
    >
      <template #actions>
        <EmptyStateActionCard
          icon="refresh"
          :label="t('emptyState.loadError.action')"
          :sublabel="t('emptyState.loadError.actionDesc')"
          data-test="overview-load-error-retry-card"
          @click="() => loadAll(true)"
        />
      </template>
    </OEmptyState>
    <OEmptyState
      v-else-if="pageState === 'not-monitored'"
      illustration="alert"
      size="hero"
      :hide-action="true"
      data-test="overview-not-monitored-empty-state"
    >
      <template #title>{{ t("overview.notMonitoredTitle") }}</template>
      <template #description>{{ t("overview.notMonitoredDesc") }}</template>
      <template #actions>
        <EmptyStateActionCard
          v-if="showAlertsCard"
          icon="notifications"
          :label="t('overview.notMonitoredAlert')"
          :sublabel="t('overview.notMonitoredAlertDesc')"
          data-test="overview-not-monitored-alert-card"
          @click="goToAddAlert"
        />
        <EmptyStateActionCard
          v-if="showAlertsCard && anomalyEnabled"
          icon="auto-awesome"
          :label="t('overview.notMonitoredAnomaly')"
          :sublabel="t('overview.notMonitoredAnomalyDesc')"
          data-test="overview-not-monitored-anomaly-card"
          @click="goToAnomalies"
        />
        <EmptyStateActionCard
          v-if="showLogsCard"
          icon="search"
          :label="t('overview.emptyActionLogs')"
          :sublabel="t('overview.emptyActionLogsDesc')"
          data-test="overview-not-monitored-logs-card"
          @click="goToLogs"
        />
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
  </OContent>
</template>

<script setup lang="ts">
import { alertHistoryQuery } from "@/services/alerts.queries";
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

import { raw, useI18nTyped } from "@/types/i18n";
import { b64EncodeUnicode } from "@/utils/zincutils";
import { isFiringOutcome, isErrorOutcome } from "@/utils/alerts/runOutcome";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import anomalyService from "@/services/anomaly_detection";
import DateTime from "@/components/DateTime.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OverviewSkeleton from "./OverviewSkeleton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import EmptyStateActionCard from "@/lib/core/EmptyState/EmptyStateActionCard.vue";
import OverviewSectionError from "./OverviewSectionError.vue";
import OverviewSectionEmpty from "./OverviewSectionEmpty.vue";
import HomeNoDataState from "./HomeNoDataState.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import OverviewHeadlineStrip, {
  type OverviewTarget,
  type IncidentsTile,
} from "./overview/OverviewHeadlineStrip.vue";
import OverviewAlertsCard from "./overview/OverviewAlertsCard.vue";
import OverviewDataHealthCard from "./overview/OverviewDataHealthCard.vue";
import OverviewStreamsCard from "./overview/OverviewStreamsCard.vue";
import config from "@/aws-exports";
import OverviewLimitCard from "./overview/OverviewLimitCard.vue";
import OverviewSignalCards from "./overview/OverviewSignalCards.vue";
import OverviewStorageCard from "./overview/OverviewStorageCard.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { OVERVIEW_TOP, orgOverviewQuery } from "@/services/overview.queries";
import { formatTimestampInTimezone } from "@/utils/date";
import { type OverviewDestination, type OverviewSignal } from "./overview/overviewFormat";
import { overviewKeys } from "@/services/overview.querykeys";
import type { OrgOverview } from "@/ts/interfaces/overview";
import ODimensionChip from "@/lib/core/Badge/ODimensionChip.vue";
import ServiceGraphNodeSidePanel from "@/plugins/traces/ServiceGraphNodeSidePanel.vue";
import { sqlEquals } from "@/utils/query/sqlFilterBuilder";
import { useLockedAffordance } from "@/composables/useLockedAffordance";
import { useEnterpriseUpgradeDialog } from "@/composables/useEnterpriseUpgradeDialog";

const AlertHistoryDrawer = defineAsyncComponent(
  () => import("@/components/alerts/AlertHistoryDrawer.vue"),
);

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();

// ── Feature flags ────────────────────────────────────────────────────────────
// Services shares this same gate — it's the service-graph half of the same
// enterprise/cloud bundle as Incidents, with no upsell story of its own.
const incidentsAccess = useLockedAffordance("incidents");
const { open: openUpgradeDialog } = useEnterpriseUpgradeDialog();
const isIncidentsEnabled = computed(
  () => incidentsAccess.value.allowed && store.state.zoConfig?.incidents_enabled === true,
);
const flagOn = computed(() => store.state.zoConfig?.restricted_routes_on_empty_data === true);
// a deployment with anomaly detection off answers 403 by design, which is no load failure
const anomalyEnabled = computed(() => store.state.zoConfig?.anomaly_detection_enabled === true);

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
const relativeTime = ref(saved?.relative ?? "15m");
const absoluteTime = ref(
  saved?.absolute ?? {
    startTime: (now - 15 * 60 * 1000) * 1000,
    endTime: now * 1000,
  },
);
const timeRange = ref(
  saved?.timeRange ?? {
    startTime: (now - 15 * 60 * 1000) * 1000,
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
  loadAll();
};

// ── State ────────────────────────────────────────────────────────────────────
const isLoading = ref(false);
const lastFetched = ref<Date | null>(null);
const anomalies = ref<any[]>([]);
const incidents = ref<any[]>([]);
const incidentsTotal = ref(0);
const services = ref<any[]>([]);
const recentEvents = ref<any[]>([]);

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
const isCloud = config.isCloud === "true";
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
  const zone = store.state.timezone || "UTC";
  const time = formatTimestampInTimezone(overview.value.generated_at, "YYYY-MM-DD HH:mm", zone);
  return `${time} (${zone})`;
});
const showOverviewCards = computed(
  () => !["forbidden", "no-data", "not-monitored"].includes(pageState.value),
);
const overviewPending = computed(
  () => overviewState.loading && (!overview.value || overviewFailed.value),
);
const alertCount = ref<number | null>(null);
const anomalyConfigCount = ref<number | null>(null);
// null keeps all clear: only answered lists prove an org empty, and only the flag-off page asks
const noUserStreams = ref<boolean | null>(null);
// a probe that failed for any reason but 403 leaves "no streams" unproven, so all clear may not show
const streamProbeFailed = ref(false);

const isForbidden = (err: unknown) => {
  const e = err as { status?: number; response?: { status?: number } } | null;
  return e?.status === 403 || e?.response?.status === 403;
};
const attemptedSections = computed<SectionKey[]>(() => {
  const keys: SectionKey[] = ["recentEvents"];
  if (anomalyEnabled.value) keys.push("anomalies");
  if (isIncidentsEnabled.value) keys.push("incidents");
  if (incidentsAccess.value.allowed) keys.push("services");
  return keys;
});
const isFailed = (key: SectionKey) =>
  !!sectionFailure[key] && attemptedSections.value.includes(key);
const allFailed = computed(() => attemptedSections.value.every(isFailed));

type PageState =
  "content" | "partial" | "forbidden" | "error" | "not-monitored" | "no-data" | "all-clear";
const pageState = computed<PageState>(() => {
  if (isLoading.value || hasAnyData.value) return "content";
  if (allFailed.value) {
    const allForbidden = attemptedSections.value.every((k) => isForbidden(sectionFailure[k]));
    if (flagOn.value && allForbidden) return "forbidden";
    // the cards loaded, so the failed sections keep their own inline Retry
    return overview.value && !overviewFailed.value && !overviewForbidden.value
      ? "partial"
      : "error";
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
// an edition without the service graph refuses it with 403, which is no outage
const isDenied = (key: SectionKey) => isForbidden(sectionFailure[key]);
const showSectionError = (key: SectionKey) =>
  isFailed(key) && !isDenied(key) && pageShowsSections.value;
const showSectionForbidden = (key: SectionKey) =>
  isFailed(key) && isDenied(key) && pageShowsSections.value;
const sectionApplies = (key: SectionKey) => {
  if (key === "incidents") return isIncidentsEnabled.value;
  if (key === "anomalies") return anomalyEnabled.value;
  if (key === "services") return incidentsAccess.value.allowed;
  return true;
};
// an empty message needs a settled, successful, applicable section on a page that shows the cards
const showSectionEmpty = (key: SectionKey) =>
  showOverviewCards.value &&
  pageShowsSections.value &&
  sectionState[key].loaded &&
  !isFailed(key) &&
  sectionApplies(key);

/* Wraps a loader with its section's state. The loaders swallow their own errors,
   and `finally` also covers the early `return` in the enterprise-gated ones, so
   a section can never be left stuck pending. */
const runSection = async (key: SectionKey, load: (current: () => boolean) => Promise<void>) => {
  const seq = ++sectionSeq[key];
  const current = () => seq === sectionSeq[key];
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
  graphData.value = { nodes: [], edges: [] };
  selectedService.value = null;
  servicePanelVisible.value = false;
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

// `force` comes from the Refresh button. A mount or a tab switch reads the
// cache instead, which is what stops every tab switch re-requesting.
const loadAll = async (force = false) => {
  if (!orgId.value) return;
  isLoading.value = true;
  // outside allSettled: a slow or failed /overview must never hold the page states
  void loadOverview(force);
  await Promise.allSettled([
    runSection("recentEvents", (current) => loadHistoryAndSplit(force, current)),
    runSection("anomalies", (current) => loadAnomalies(force, current)),
    runSection("incidents", (current) => loadIncidents(force, current)),
    runSection("services", (current) => loadServiceGraph(force, current)),
    loadAlertCount(force),
  ]);
  await loadUserStreams(force);
  isLoading.value = false;
  // the refresh button keeps the last good run, so a fresh dot never sits beside the error
  if (!allFailed.value && pageState.value !== "error") lastFetched.value = new Date();
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
  if (!incidentsAccess.value.allowed) return "locked";
  if (!isIncidentsEnabled.value) return "unavailable";
  if (isSectionPending("incidents")) return "loading";
  if (isDenied("incidents") && isFailed("incidents")) return "forbidden";
  if (isFailed("incidents")) return "error";
  return "ok";
});

// only the flag-on page tells "nothing is watched" apart from "all clear"
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

// Refresh and Retry re-read only while the hero waits or a probe failed; an org the notice saw data in asks nothing
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

// Alert trigger history feeds recentEvents only
const loadHistoryAndSplit = async (force = false, current: () => boolean = () => true) => {
  sectionFailure.recentEvents = null;
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

    // Recent events: firing shown per-occurrence; failed deduped by alert_name with count.
    // This previously filtered on the literal strings ["firing", "error"], neither
    // of which the backend ever produced — so it silently matched nothing. The
    // shared classifier covers both the current and the legacy vocabulary.
    const firingHits = hits
      .filter((h) => isFiringOutcome(h.status))
      .slice(0, 5)
      .map((h, idx) => ({
        id: h.id ?? `ev-${idx}`,
        typeLabel: formatStatus(h.status),
        service: h.stream_name ?? "—",
        description: h.alert_name ?? "",
        timeAgo: relativeTime_(h.timestamp),
        // Firing rows need a sort key too — without rawTs they scored 0 and
        // always sorted beneath every failure row regardless of timestamp.
        rawTs: h.timestamp,
        failCount: 0,
      }));

    // Dedup failed: one row per alert_name, most recent timestamp, total count
    const failedMap = new Map<string, any>();
    hits
      .filter((h) => isErrorOutcome(h.status))
      .forEach((h) => {
        const key = h.alert_name ?? h.id ?? "unknown";
        const existing = failedMap.get(key);
        if (!existing || h.timestamp > existing.rawTs) {
          failedMap.set(key, {
            id: `fail-${key}`,
            // English for the same reason as formatStatus() — this is the OTag
            // `eventStatus` lookup value, not free display copy.
            typeLabel: raw("Failed"),
            service: h.stream_name ?? "—",
            description: h.alert_name ?? "",
            timeAgo: relativeTime_(h.timestamp),
            rawTs: h.timestamp,
            failCount: (existing?.failCount ?? 0) + 1,
          });
        } else {
          existing.failCount += 1;
        }
      });

    recentEvents.value = [...firingHits, ...Array.from(failedMap.values())]
      .sort((a, b) => (b.rawTs ?? 0) - (a.rawTs ?? 0))
      .slice(0, 5);
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
  if (!incidentsAccess.value.allowed) return;
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

    services.value = nodes
      .map((node) => {
        const latInfo = latencyByNode.get(node.id);
        const errorFlag = (node.error_rate ?? 0) >= 1;
        const latencyFlag = !!latInfo;
        return {
          ...node,
          errorFlag,
          latencyFlag,
          latencyMultiplier: latInfo ? latInfo.multiplier.toFixed(1) : null,
        };
      })
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
    await nextTick();
    onSvcScroll();
  } catch (err) {
    if (!current()) return;
    services.value = [];
    sectionFailure.services = err;
  }
};

// ── Helpers ──────────────────────────────────────────────────────────────────
// Deliberately English: the result feeds <OTag type="eventStatus" :value>, and
// OTag normalises that value (lower-cased, separators stripped) to pick the
// badge variant from the `eventStatus` group in badgeGroups.ts. A translated
// value would miss `failed`/`firing`/`error` and lose the red/amber colouring.
const formatStatus = (status: string) => {
  if (!status) return raw("Event");
  const map: Record<string, string> = {
    firing: "Firing",
    error: "Error",
    failed: "Failed",
    anomaly: "Anomaly",
  };
  return raw(map[status.toLowerCase()] ?? status.charAt(0).toUpperCase() + status.slice(1));
};

const relativeTime_ = (tsMicros: number): string => {
  if (!tsMicros) return "—";
  const diffMs = Date.now() - Math.floor(tsMicros / 1000);
  if (diffMs < 60_000) return t("overview.secondsAgo", { count: Math.round(diffMs / 1000) });
  if (diffMs < 3_600_000) return t("overview.minutesAgo", { count: Math.round(diffMs / 60_000) });
  if (diffMs < 86_400_000) return t("overview.hoursAgo", { count: Math.round(diffMs / 3_600_000) });
  return t("overview.daysAgo", { count: Math.round(diffMs / 86_400_000) });
};

const formatReqRate = (reqs: number) => {
  if (!reqs && reqs !== 0) return "—";
  if (reqs >= 1000) return `${(reqs / 1000).toFixed(1)}k`;
  return String(reqs);
};

const sortedDimensions = (dims: Record<string, string>): [string, string][] =>
  Object.keys(dims)
    .sort()
    .map((k) => [k, dims[k]]);

// Shorten verbose k8s-style keys for display: "k8s-namespace" → "namespace"
const shortDimKey = (key: string): string =>
  key.replace(/^k8s-/, "").replace(/^kubernetes[_-]/, "");

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

const serviceCardClass = (svc: any) => {
  if (svc.errorFlag && svc.error_rate >= 5) return "border-s-[0.1875em] border-s-error-600";
  if (svc.errorFlag || svc.latencyFlag) return "border-s-[0.1875em] border-s-warning-600";
  return "border-s-[0.1875em] border-s-status-positive";
};

// ── Navigation ───────────────────────────────────────────────────────────────
const goToAlert = (item: any) => {
  selectedAlertForHistory.value = item.alertConfig ?? { name: item.alertName };
  selectedAlertIdForHistory.value = item.alertId ?? "";
  showAlertHistoryDrawer.value = true;
};

const goToService = (svc: any, e?: MouseEvent) => {
  // Fired from the per-card info-icon button — stop it bubbling to the card
  // click (which opens the latency/info side panel).
  e?.stopPropagation();
  let filter = sqlEquals("service_name", svc.label ?? svc.id);
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
};

const closeServicePanel = () => {
  servicePanelVisible.value = false;
  selectedService.value = null;
};

const goToIncident = (inc: any) => {
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

const goToAlertList = () => {
  router.push({ name: "alertList", query: { org_identifier: orgId.value } });
};

const goToAddAlert = () => {
  router.push({ name: "addAlert", query: { org_identifier: orgId.value } });
};

const goToPipelines = () => {
  router.push({ name: "pipelines", query: { org_identifier: orgId.value } });
};

const goToStreams = () => {
  router.push({ name: "logstreams", query: { org_identifier: orgId.value } });
};

const goToIngestion = () => {
  router.push({ name: "ingestion", query: { org_identifier: orgId.value } });
};

const onHealthOpen = (destination: OverviewDestination) => {
  if (destination === "alerts") goToAlertList();
  else if (destination === "pipelines") goToPipelines();
  else goToStreams();
};

const onSignalOpen = (signal: OverviewSignal) => {
  router.push({ name: signal, query: { org_identifier: orgId.value } });
};

const onHeadlineSelect = (target: OverviewTarget) => {
  if (target === "firing" || target === "failing") goToAlertList();
  else if (target === "pipelines") goToPipelines();
  else if (target === "streams" || target === "quiet") goToStreams();
  else if (incidentsTile.value === "locked") openUpgradeDialog();
  else if (incidentsTile.value !== "unavailable" && incidentsTile.value !== "forbidden") {
    goToIncidentList();
  }
};

const goToIncidentList = () => {
  router.push({ name: "incidentList", query: { org_identifier: orgId.value, status: "open" } });
};

const goToAnomalies = () => {
  router.push({
    name: "alertList",
    query: { org_identifier: orgId.value, tab: "anomalyDetection" },
  });
};

const goToLogs = () => {
  router.push({ name: "logs", query: { org_identifier: orgId.value } });
};

const goToServiceGraph = () => {
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

// zoConfig loads asynchronously after mount — retry incidents when it becomes available
watch(isIncidentsEnabled, (enabled) => {
  if (!enabled || incidents.value.length > 0) return;
  // the earlier pass returned early and marked the section loaded, so re-arm its skeleton
  sectionState.incidents.loaded = false;
  void runSection("incidents", (current) => loadIncidents(false, current));
});
</script>
