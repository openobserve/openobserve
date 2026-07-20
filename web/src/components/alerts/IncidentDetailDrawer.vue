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
  <div class="rounded-md p-0" data-test="incident-detail-page">
    <div class="w-full h-full flex flex-col">
    <!-- Header — shared AppPageHeader: back button in the icon-tile spot, the
         incident name as the title (with its status badges trailing), and the
         section label "Incident" as the muted subtitle. -->
    <AppPageHeader
      :back="{
        onClick: close,
        label: t('alerts.incidents.goBack'),
        dataTest: 'incident-detail-back-btn',
      }"
      :subtitle="t('alerts.incidents.incident')"
      class="shrink-0 px-4 border-b border-border-default"
    >
      <template #title>
        <!-- Incident name (inline-editable) -->
        <input
          v-if="incidentDetails && isEditingTitle"
          v-model="editableTitle"
          ref="titleInputRef"
          :class="[
            'font-bold px-2 py-1 rounded-md outline-none border-2',
            store.state.theme === 'dark'
              ? 'text-blue-400 bg-blue-900/50 border-blue-500'
              : 'text-blue-600 bg-blue-50 border-blue-400'
          ]"
          style="min-width: 300px; max-width: 500px;"
        />
        <span
          v-else-if="incidentDetails"
          data-test="incident-detail-title"
          :title="incidentDetails.title"
        >
          {{ incidentDetails.title }}
          <OTooltip v-if="incidentDetails && incidentDetails.title.length > 35" :content="incidentDetails.title" />
        </span>
      </template>

      <!-- Status, Severity, Alerts badges — trail immediately after the title
           (soft dot-badge variant used in the Incident list). -->
      <template #title-trail>
        <template v-if="incidentDetails && !isEditingTitle">
          <span class="inline-flex cursor-default">
            <OTag type="incidentStatus" :value="incidentDetails.status" />
            <OTooltip :content="t('alerts.incidents.status') + ': ' + getStatusLabel(incidentDetails.status)" />
          </span>

          <span class="inline-flex cursor-default">
            <OTag type="severity" :value="incidentDetails.severity" />
            <OTooltip :content="t('alerts.incidents.severity') + ': ' + incidentDetails.severity" />
          </span>

          <span class="inline-flex cursor-default">
            <OTag type="countChip" value="alerts">{{ triggers.length }} Alerts</OTag>
            <OTooltip :content="t('alerts.incidents.alertCount') + ': ' + triggers.length + ' correlated alerts'" />
          </span>
        </template>
      </template>

      <template #actions>
        <!-- Save/Cancel when editing the title -->
        <template v-if="incidentDetails && isEditingTitle">
          <OButton
            variant="outline"
            size="sm-action"
            @click="cancelTitleEdit"
          >{{ t('alerts.cancel') }}</OButton>
          <OButton
            variant="primary"
            size="sm-action"
            @click="saveTitleEdit"
          >{{ t('alerts.save') }}</OButton>
        </template>

        <!-- Incident actions otherwise -->
        <template v-else-if="incidentDetails">
          <OButton
            v-if="incidentDetails.status === 'open'"
            variant="outline"
            size="sm"
            :loading="updating"
            @click="acknowledgeIncident"
          ><OIcon name="visibility" size="sm"/>{{ t("alerts.incidents.acknowledge") }}<OTooltip :delay="500" :content="t('alerts.incidents.markAsAcknowledgedTooltip')" /></OButton>
          <OButton
            v-if="incidentDetails.status !== 'resolved'"
            variant="outline"
            size="sm"
            :loading="updating"
            @click="resolveIncident"
          ><OIcon name="task-alt" size="sm"/>{{ t("alerts.incidents.resolve") }}<OTooltip :delay="500" :content="t('alerts.incidents.markAsResolvedTooltip')" /></OButton>
          <OButton
            v-if="incidentDetails.status === 'resolved'"
            variant="outline"
            size="sm"
            :loading="updating"
            @click="reopenIncident"
          ><OIcon name="refresh" size="sm"/>{{ t("alerts.incidents.reopen") }}<OTooltip :delay="500" :content="t('alerts.incidents.reopenIncidentTooltip')" /></OButton>

          <!-- Edit Title Button -->
          <OButton
            variant="outline"
            size="sm"
            @click="startTitleEdit"
          ><OIcon name="edit" size="sm"/>{{ t("alerts.edit") }}<OTooltip :delay="500" :content="t('alerts.incidents.editIncidentTitleTooltip')" /></OButton>
        </template>
      </template>
    </AppPageHeader>

    <!-- Content -->
    <div v-if="!loading && incidentDetails" class="card-container flex flex-col overflow-hidden flex-1 min-h-0">
      <div class="flex-shrink-0 px-2 border-b border-border-default">
        <OTabs
          v-model="activeTab"
          align="left"
          class="flex-1"
          mobile-arrows
          :breakpoint="0"
        >
          <OTab
            name="overview"
            label="Overview"
            data-test="incident-overview-tab"
          />
          <OTab
            name="activity"
            label="Activity"
            data-test="incident-activity-tab"
          />
          <OTab
            name="incidentAnalysis"
            :label="t('alerts.incidents.incidentAnalysis')"
            data-test="incident-analysis-tab"
          />
          <OTab
            name="serviceGraph"
            label="Alert Graph"
            data-test="incident-alert-graph-tab"
          />
          <OTab
            name="alertTriggers"
            data-test="incident-alert-triggers-tab"
          >
            <template #default>
              <div class="flex items-center gap-1.5">
                <span>{{ t('alerts.incidents.alertTriggers') }}</span>
                <OTag type="countChip" value="neutral">{{ triggers.length }}</OTag>
              </div>
            </template>
          </OTab>

          <!-- Telemetry tabs always inline -->
          <OTab
            name="logs"
            :label="t('common.logs')"
            data-test="incident-logs-tab"
          />
          <OTab
            name="metrics"
            :label="t('search.metrics')"
            data-test="incident-metrics-tab"
          />
          <OTab
            name="traces"
            :label="t('menu.traces')"
            data-test="incident-traces-tab"
          />
        </OTabs>
      </div>

      <!-- Tab Content Container -->
      <div class="flex flex-1 overflow-hidden">
      <!-- Left Column: Incident Details (only show on Incident Analysis tab, HIDDEN for Overview) -->
      <div v-if="activeTab === 'incidentAnalysis'" class="w-[400px] min-w-[400px] max-w-[400px] flex-shrink-0 flex flex-col h-full" style="order: 1;">

        <!-- Table of Contents (only on Incident Analysis) -->
        <IncidentTableOfContents
          :table-of-contents="tableOfContents"
          :expanded-sections="expandedSections"
          :is-dark-mode="isDarkMode"
          @scroll-to-section="scrollToSection"
          @toggle-section="toggleSection"
        />
      </div>

      <!-- Right Column: Content -->
      <div class="flex-1 min-w-0 flex flex-col overflow-hidden" style="order: 2;">
        <!-- Tab Content Area -->
        <div class="flex-1 flex flex-col px-2 pt-4 pb-2 overflow-hidden relative">

        <!-- Overview Tab Content - REDESIGNED -->
        <div v-if="activeTab === 'overview'" class="flex flex-col flex-1 overflow-hidden">
          <!-- SECTION 1: Hero Metrics (100px height) -->
          <div class="flex gap-3 mb-3" style="height: 100px;">
            <!-- 1. Total Alerts Card -->
            <div
              class="flex-1 flex flex-col justify-between el-border el-border-radius bg-(--o2-card-bg) transition-all duration-200 cursor-pointer p-3"
            >
              <!-- Top: Title and Icon -->
              <div class="flex justify-between items-start">
                <div :class="'text-text-secondary'" class="text-sm font-medium">
                  Total Alerts
                </div>
                <div class="w-8 h-8 rounded-lg flex items-center justify-center" :class="store.state.theme === 'dark' ? 'bg-amber-500/10' : 'bg-amber-50'">
                  <OIcon name="bolt" size="sm" :class="store.state.theme === 'dark' ? 'text-amber-400' : 'text-amber-600'" style="font-size: 20px;" />
                </div>
              </div>

              <!-- Bottom: Large Number -->
              <div :class="'text-text-primary'" class="text-3xl font-semibold leading-none">
                {{ triggers.length }}
              </div>
            </div>

            <!-- 2. Unique Alerts Card -->
            <div
              class="flex-1 flex flex-col justify-between el-border el-border-radius bg-(--o2-card-bg) transition-all duration-200 cursor-pointer p-3"
            >
              <!-- Top: Title and Icon -->
              <div class="flex justify-between items-start">
                <div :class="'text-text-secondary'" class="text-sm font-medium">
                  {{ t('alerts.incidents.uniqueAlerts') }}
                </div>
                <div class="w-8 h-8 rounded-lg flex items-center justify-center" :class="store.state.theme === 'dark' ? 'bg-blue-500/10' : 'bg-blue-50'">
                  <OIcon name="notifications-active" size="sm" :class="store.state.theme === 'dark' ? 'text-blue-400' : 'text-blue-600'" style="font-size: 20px;" />
                </div>
              </div>

              <!-- Bottom: Large Number -->
              <div :class="'text-text-primary'" class="text-3xl font-semibold leading-none">
                {{ uniqueAlertsCount }}
              </div>
            </div>

            <!-- 3. Affected Services Card -->
            <div
              class="flex-1 flex flex-col justify-between el-border el-border-radius bg-(--o2-card-bg) transition-all duration-200 cursor-pointer p-3"
            >
              <!-- Top: Title and Icon -->
              <div class="flex justify-between items-start">
                <div :class="'text-text-secondary'" class="text-sm font-medium">
                  Affected Services
                </div>
                <div class="w-8 h-8 rounded-lg flex items-center justify-center" :class="store.state.theme === 'dark' ? 'bg-purple-500/10' : 'bg-purple-50'">
                  <OIcon name="dns" size="sm" :class="store.state.theme === 'dark' ? 'text-purple-400' : 'text-purple-600'" style="font-size: 20px;" />
                </div>
              </div>

              <!-- Bottom: Large Number -->
              <div :class="'text-text-primary'" class="text-3xl font-semibold leading-none">
                {{ affectedServicesCount }}
              </div>
            </div>

            <!-- 4. Active Duration Card -->
            <div
              class="flex-1 flex flex-col justify-between el-border el-border-radius bg-(--o2-card-bg) transition-all duration-200 cursor-pointer p-3"
            >
              <!-- Top: Title and Icon -->
              <div class="flex justify-between items-start">
                <div :class="'text-text-secondary'" class="text-sm font-medium">
                  Active Duration
                </div>
                <div class="w-8 h-8 rounded-lg flex items-center justify-center" :class="store.state.theme === 'dark' ? 'bg-green-500/10' : 'bg-green-50'">
                  <OIcon name="schedule" size="sm" :class="store.state.theme === 'dark' ? 'text-green-400' : 'text-green-600'" style="font-size: 20px;" />
                </div>
              </div>

              <!-- Bottom: Large Number -->
              <div :class="'text-text-primary'" class="text-2xl font-semibold leading-none">
                {{ incidentDetails?.first_alert_at && incidentDetails?.last_alert_at
                   ? calculateDuration(incidentDetails.first_alert_at, incidentDetails.last_alert_at)
                   : 'N/A' }}
              </div>
            </div>

            <!-- 5. Alert Frequency Card -->
            <div
              class="flex-1 flex flex-col justify-between el-border el-border-radius bg-(--o2-card-bg) transition-all duration-200 cursor-pointer p-3"
            >
              <!-- Top: Title and Icon -->
              <div class="flex justify-between items-start">
                <div :class="'text-text-secondary'" class="text-sm font-medium">
                  Alert Frequency
                </div>
                <div class="w-8 h-8 rounded-lg flex items-center justify-center" :class="store.state.theme === 'dark' ? 'bg-rose-500/10' : 'bg-rose-50'">
                  <OIcon name="show-chart" size="sm" :class="store.state.theme === 'dark' ? 'text-rose-400' : 'text-rose-600'" style="font-size: 20px;" />
                </div>
              </div>

              <!-- Bottom: Large Text -->
              <div :class="'text-text-primary'" class="text-lg font-semibold leading-tight">
                {{ alertFrequency }}
              </div>
            </div>
          </div>

          <!-- SECTION 2: Main Content (2:1 Ratio Layout) with calc(100vh - 236px) height (was 276px) -->
          <div class="flex gap-3 flex-1" style="height: calc(100vh - 380px);">
            <!-- PART 1: Primary Content (66.67% width) -->
            <div class="flex flex-col gap-3" style="width: 66.67%;">
                <!-- 2.1A: Top Row - Incident Details (2/3) + Incident Timeline (1/3) -->
              <div class="flex gap-3" style="height: 50%;">
                               <!-- Incident Timeline (33.33% width) -->
                <div
                  class="el-border el-border-radius bg-(--o2-card-bg) flex flex-col overflow-hidden"
                  :style="{
                    width: '33.33%'
                  }"
                >
                  <!-- Header -->
                  <div class="flex items-center justify-between px-4 py-3">
                    <div :class="'text-text-primary'" class="text-sm font-semibold">
                      {{ t('alerts.incidents.incidentTimeline') }}
                    </div>
                    <div
                      class="px-2 py-0.5 rounded text-xs font-medium"
                      :style="{
                        backgroundColor: 'var(--color-surface-panel)',
                        color: store.state.theme === 'dark' ? '#9CA3AF' : '#6B7280'
                      }"
                    >
                      UTC
                    </div>
                  </div>

                  <!-- Content with vertical timeline -->
                  <div class="flex flex-col gap-6 px-4 py-2 overflow-y-auto relative">
                    <!-- Vertical line -->
                    <div
                      class="absolute w-0.5"
                      :style="{
                        left: '21px',
                        top: '21px',
                        bottom: '21px',
                        backgroundColor: 'var(--color-surface-panel)'
                      }"
                    ></div>

                    <!-- First Alert Received -->
                    <div class="flex items-start gap-3 relative">
                      <div
                        class="w-2.5 h-2.5 rounded-full flex-shrink-0 z-10 mt-2"
                        :style="{
                          backgroundColor: '#10B981'
                        }"
                      ></div>
                      <div class="flex-1">
                        <div :class="'text-text-primary'" class="text-sm font-medium mb-1">
                          First Alert Received
                        </div>
                        <div :class="'text-text-secondary'" class="text-xs">
                          {{ incidentDetails?.first_alert_at ? formatTimestampUTC(incidentDetails.first_alert_at) : 'N/A' }}
                          <span :class="'text-text-muted'" class="mx-1.5">|</span>
                          <span>{{ t('alerts.incidents.initialTrigger') }}</span>
                        </div>
                      </div>
                    </div>

                    <!-- Peak Activity (if available) -->
                    <div v-if="peakActivity" class="flex items-start gap-3 relative">
                      <div
                        class="w-2.5 h-2.5 rounded-full flex-shrink-0 z-10 mt-2"
                        :style="{
                          backgroundColor: '#F59E0B'
                        }"
                      ></div>
                      <div class="flex-1">
                        <div :class="'text-text-primary'" class="text-sm font-medium mb-1">
                          Peak Activity
                        </div>
                        <div :class="'text-text-secondary'" class="text-xs">
                          {{ peakActivity.timestamp ? formatTimestampUTC(peakActivity.timestamp) : 'N/A' }}
                          <span :class="'text-text-muted'" class="mx-1.5">|</span>
                          <span>{{ peakActivity.count }} alerts in 5 mins</span>
                        </div>
                      </div>
                    </div>

                    <!-- Latest Alert -->
                    <div class="flex items-start gap-3 relative">
                      <div
                        class="w-2.5 h-2.5 rounded-full flex-shrink-0 z-10 mt-2"
                        :style="{
                          backgroundColor: incidentDetails?.status === 'resolved' ? '#10B981' : '#EF4444'
                        }"
                      ></div>
                      <div class="flex-1">
                        <div :class="'text-text-primary'" class="text-sm font-medium mb-1">
                          Latest Alert
                        </div>
                        <div :class="'text-text-secondary'" class="text-xs">
                          {{ incidentDetails?.last_alert_at ? formatTimestampUTC(incidentDetails.last_alert_at) : 'N/A' }}
                          <span :class="'text-text-muted'" class="mx-1.5">|</span>
                          <span>{{ incidentDetails?.status === 'resolved' ? 'Resolved' : 'Still ongoing' }}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Show Full Activity Button -->
                  <div class="border-t border-gray-200 dark:border-gray-700 p-2 flex justify-end">
                    <OButton
                      variant="ghost-primary"
                      size="sm"
                      @click="activeTab = 'activity'"
                      data-test="incident-timeline-show-full-activity"
                    ><span class="text-xs">Show Full Activity</span></OButton>
                  </div>
                </div>
                <!-- Incident Details (66.67% width) -->
                <div
                  class="el-border el-border-radius bg-(--o2-card-bg) flex flex-col overflow-hidden"
                  :style="{
                    width: '66.67%'
                  }"
                >
                  <!-- Header -->
                  <div class="px-4 pt-2 pb-1">
                    <div :class="'text-text-primary'" class="text-sm font-semibold">
                      {{ t('alerts.incidents.incidentDetails') }}
                    </div>
                  </div>

                  <!-- Content -->
                  <div class="flex flex-col gap-3 p-4 overflow-y-auto">
                    <!-- Incident ID -->
                    <div class="grid gap-2" style="grid-template-columns: 120px 1fr;">
                      <div :class="'text-text-secondary'" class="text-xs font-medium">
                        {{ t('alerts.incidents.incidentId') }}
                      </div>
                      <div
                        class="flex items-center gap-2 px-2.5 py-1 rounded border text-xs font-mono min-w-0"
                        :style="{
                          backgroundColor: 'var(--color-surface-panel)',
                          borderColor: store.state.theme === 'dark' ? '#444444' : '#E7EAEE',
                          color: store.state.theme === 'dark' ? '#E5E7EB' : '#374151'
                        }"
                      >
                        <span class="truncate flex-1 min-w-0">{{ incidentDetails?.id || 'N/A' }}</span>
                        <OIcon
                          :name="copiedField === 'incident_id' ? 'check' : 'content-copy'" size="sm"
                          :class="copiedField === 'incident_id' ? 'text-green-500' : 'opacity-60 hover:opacity-100 hover:text-blue-500'"
                          class="cursor-pointer transition-all flex-shrink-0"
                          style="font-size: 14px; cursor: pointer;"
                          @click="copyToClipboard(incidentDetails?.id, 'incident_id')"
                        />
                      </div>
                    </div>

                    <!-- Incident Name -->
                    <div class="grid gap-2" style="grid-template-columns: 120px 1fr;">
                      <div :class="'text-text-secondary'" class="text-xs font-medium">
                        {{ t('alerts.incidents.incidentName') }}
                      </div>
                      <div
                        class="flex items-center gap-2 px-2.5 py-1 rounded border text-xs min-w-0"
                        :style="{
                          backgroundColor: 'var(--color-surface-panel)',
                          borderColor: store.state.theme === 'dark' ? '#444444' : '#E7EAEE',
                          color: store.state.theme === 'dark' ? '#E5E7EB' : '#374151'
                        }"
                      >
                        <span class="truncate flex-1 min-w-0">{{ incidentDetails?.title || 'N/A' }}</span>
                        <OIcon
                          :name="copiedField === 'incident_title' ? 'check' : 'content-copy'" size="sm"
                          :class="copiedField === 'incident_title' ? 'text-green-500' : 'opacity-60 hover:opacity-100 hover:text-blue-500'"
                          class="cursor-pointer transition-all flex-shrink-0"
                          style="font-size: 14px; cursor: pointer;"
                          @click="copyToClipboard(incidentDetails?.title, 'incident_title')"
                        />
                      </div>
                    </div>

                    <!-- Correlated By -->
                    <div class="grid gap-2" style="grid-template-columns: 120px 1fr;">
                      <div :class="'text-text-secondary'" class="text-xs font-medium">
                        Correlated By
                      </div>
                      <div
                        class="flex items-center gap-2 px-2.5 py-1 rounded border text-xs min-w-0"
                        :style="{
                          backgroundColor: 'var(--color-surface-panel)',
                          borderColor: store.state.theme === 'dark' ? '#444444' : '#E7EAEE',
                          color: store.state.theme === 'dark' ? '#E5E7EB' : '#374151'
                        }"
                      >
                        <span class="truncate flex-1 min-w-0">{{ getCorrelationMethodLabel(incidentDetails?.key_type) }}</span>
                        <OIcon
                          :name="copiedField === 'key_type' ? 'check' : 'content-copy'" size="sm"
                          :class="copiedField === 'key_type' ? 'text-green-500' : 'opacity-60 hover:opacity-100 hover:text-blue-500'"
                          class="cursor-pointer transition-all flex-shrink-0"
                          style="font-size: 14px; cursor: pointer;"
                          @click="copyToClipboard(getCorrelationMethodLabel(incidentDetails?.key_type), 'key_type')"
                        />
                      </div>
                    </div>

                    <!-- Created At -->
                    <div class="grid gap-2" style="grid-template-columns: 120px 1fr;">
                      <div :class="'text-text-secondary'" class="text-xs font-medium">
                        Created At
                      </div>
                      <div :class="'text-text-primary'" class="text-sm">
                        {{ incidentDetails?.created_at ? formatTimestamp(incidentDetails.created_at) : 'N/A' }}
                      </div>
                    </div>

                    <!-- Updated At -->
                    <div class="grid gap-2" style="grid-template-columns: 120px 1fr;">
                      <div :class="'text-text-secondary'" class="text-xs font-medium">
                        Updated At
                      </div>
                      <div :class="'text-text-primary'" class="text-sm">
                        {{ incidentDetails?.updated_at ? formatTimestamp(incidentDetails.updated_at) : 'N/A' }}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
                <!-- alert activity -->
               <!-- 2.1B: Alert Activity Chart (50% height, full width) -->
              <div
                class="el-border el-border-radius bg-(--o2-card-bg) flex flex-col overflow-hidden"
                :style="{
                  height: '50%'
                }"
              >
                <!-- Header -->
                <div class="px-4 pt-2 pb-1">
                  <div
                    :class="'text-text-primary'"
                    class="text-sm font-semibold"
                  >
                    Alert Activity
                  </div>
                </div>

                <!-- Chart Content -->
                <div class="flex-1 overflow-hidden p-2">
                  <CustomChartRenderer
                    v-if="alertActivityChartData"
                    :data="alertActivityChartData"
                    class="w-full h-full"
                  />
                </div>
              </div>

            </div>

            <!-- PART 2: Sidebar Content (33.33% width) - 3 sections -->
            <div class="flex flex-col gap-2" style="width: 33.33%; height: 100%;">
              <!-- 2.2A: Manage Panel (40% of available height after gaps) -->
              <div
                class="el-border el-border-radius bg-(--o2-card-bg) flex flex-col overflow-hidden"
                :style="{
                  height: 'calc(35% - 6.4px)'
                }"
              >
                <!-- Header -->
                <div class="px-4 pt-2 pb-1">
                  <div
                    :class="'text-text-primary'"
                    class="text-sm font-semibold"
                  >
                    Manage
                  </div>
                </div>

                <!-- Content -->
                <div class="flex flex-col gap-3 p-3 overflow-y-auto">
                  <!-- Status Section -->
                  <div class="flex flex-col gap-2">
                    <div
                      :class="'text-text-secondary'"
                      class="text-xs font-semibold"
                    >
                      Status
                    </div>
                    <div class="flex gap-2 flex-wrap">
                      <button
                        v-for="option in statusOptions"
                        :key="option.value"
                        type="button"
                        @click="editableStatus !== option.value && handleStatusChange(option.value as 'open' | 'acknowledged' | 'resolved')"
                        class="rounded-full outline-none"
                        :class="editableStatus === option.value ? 'cursor-default' : 'cursor-pointer'"
                        :data-test="`incident-manage-status-${option.value}`"
                      >
                        <OTag
                          :type="editableStatus === option.value ? 'incidentStatus' : 'countChip'"
                          :value="editableStatus === option.value ? option.value : 'neutral'"
                          dot
                        >{{ option.label }}</OTag>
                      </button>
                    </div>
                  </div>

                  <!-- Severity Section -->
                  <div class="flex flex-col gap-2">
                    <div
                      :class="'text-text-secondary'"
                      class="text-xs font-semibold"
                    >
                      Severity
                    </div>
                    <div class="flex gap-2 flex-wrap">
                      <button
                        v-for="option in severityOptions"
                        :key="option.value"
                        type="button"
                        @click="editableSeverity !== option.value && handleSeverityChange(option.value as 'P1' | 'P2' | 'P3' | 'P4')"
                        class="rounded-full outline-none"
                        :class="editableSeverity === option.value ? 'cursor-default' : 'cursor-pointer'"
                        :data-test="`incident-manage-severity-${option.value}`"
                      >
                        <!-- Selected → semantic severity colour; unselected → neutral grey. -->
                        <OTag
                          :type="editableSeverity === option.value ? 'severity' : 'countChip'"
                          :value="editableSeverity === option.value ? option.value : 'neutral'"
                          dot
                        >{{ option.label }}</OTag>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 2.2B: Dimensions Panel (35% when Alert Flow present, 60% when absent, or when no triggers) -->
              <div
                class="el-border el-border-radius bg-(--o2-card-bg) flex flex-col overflow-hidden"
                :style="{
                  height: (sortedAlertsByTriggerCount?.length)
                    ? 'calc(35% - 5.6px)'
                    : 'calc(65% - 2px)',
                  minHeight: 0,
                  flexShrink: 0
                }"
              >
                <!-- Header -->
                <div class="px-4 pt-2 pb-1">
                  <div
                    :class="'text-text-primary'"
                    class="text-sm font-semibold"
                  >
                    Dimensions
                  </div>
                </div>

                <!-- Content -->
                <div class="flex flex-col p-3 overflow-y-auto gap-0 flex-1" style="min-height: 0;">
                  <div
                    v-if="incidentDetails?.group_values && Object.keys(incidentDetails.group_values).length > 0"
                    class="flex flex-col"
                  >
                    <div
                      v-for="(value, key) in incidentDetails.group_values"
                      :key="key"
                      class="py-2.5 border-b flex gap-2"
                      :style="{
                        borderColor: store.state.theme === 'dark' ? '#444444' : '#E7EAEE'
                      }"
                      :class="{ 'border-b-0': key === Object.keys(incidentDetails.group_values)[Object.keys(incidentDetails.group_values).length - 1] }"
                    >
                      <div
                        :class="'text-text-secondary'"
                        class="text-xs font-medium capitalize min-w-fit"
                      >
                        {{ getSemanticGroupDisplayName(key) }}:
                      </div>
                      <div
                        :class="'text-text-primary'"
                        class="text-xs break-words flex-1"
                      >
                        {{ value }}
                      </div>
                    </div>
                  </div>
                  <div
                    v-else
                    :class="'text-text-muted'"
                    class="text-sm italic text-center py-4"
                  >
                    {{ t('alerts.incidents.noDimensionsAvailable') }}
                  </div>
                </div>
              </div>

              <!-- 2.2C: Alert Flow Panel (25% of available height after gaps) - Conditional -->
              <div
                v-if="sortedAlertsByTriggerCount?.length"
                class="el-border el-border-radius bg-(--o2-card-bg) flex flex-col overflow-hidden"
                :style="{
                  height: 'calc(30% - 4px)'
                }"
              >
                <!-- Header -->
                <div class="px-4 pt-2 pb-1">
                  <div
                    :class="'text-text-primary'"
                    class="text-sm font-semibold"
                  >
                    {{ t('alerts.incidents.relatedAlerts') }}
                  </div>
                </div>

                <!-- Content - Vertical list -->
                <div class="px-3 pb-3 overflow-y-auto flex-1" style="min-height: 0;">
                  <div class="flex flex-col gap-0">
                    <div
                      v-for="(alert, index) in sortedAlertsByTriggerCount"
                      :key="alert.id"
                      class="py-2.5 border-b"
                      :style="{
                        borderColor: store.state.theme === 'dark' ? '#444444' : '#E7EAEE'
                      }"
                      :class="{ 'border-b-0': index === sortedAlertsByTriggerCount.length - 1 }"
                    >
                      <div
                        :class="'text-text-primary'"
                        class="text-xs flex gap-2 items-center"
                      >
                        <span
                          :class="'text-text-muted'"
                          class="font-medium flex-shrink-0"
                        >
                          {{ index + 1 }}.
                        </span>
                        <div class="flex-1 min-w-0">
                          <OTooltip v-if="alert.name.length > 30" :content="alert.name" />
                          <span class="font-medium truncate block">
                            {{ alert.name.length > 30 ? alert.name.substring(0, 30) + '...' : alert.name }}
                          </span>
                        </div>
                        <div class="flex-shrink-0" style="width: 120px;">
                          <span
                            :class="'text-text-secondary'"
                          >
                            {{ t('alerts.incidents.firedTimes', { count: alert.count }) }}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Activity Tab Content -->
        <IncidentTimeline
          v-if="activeTab === 'activity'"
          :org-id="store.state.selectedOrganization.identifier"
          :incident-id="incidentDetails?.id || ''"
          :visible="activeTab === 'activity'"
          :refresh-trigger="timelineRefreshTrigger"
        />

        <!-- Incident Analysis Tab Content -->
        <IncidentRCAAnalysis
          v-if="activeTab === 'incidentAnalysis'"
          :has-existing-rca="hasExistingRca"
          :rca-loading="rcaLoading"
          :rca-stream-content="rcaStreamContent"
          :formatted-rca-content="formattedRcaContent"
          :is-dark-mode="isDarkMode"
          :analysis-in-flight="analysisInFlight"
          @trigger-rca="triggerRca"
        />

        <!-- Service Graph Tab Content -->
        <div v-if="activeTab === 'serviceGraph'" class="absolute inset-0">
          <IncidentServiceGraph
            v-if="incidentDetails"
            :topology-context="incidentDetails.topology_context"
          />
        </div>

        <!-- Alert Triggers Tab Content -->
        <div v-if="activeTab === 'alertTriggers'" class="flex flex-1 overflow-hidden">
          <!-- Left Section: Alert Triggers Table -->
          <div class="flex-1 flex flex-col overflow-hidden pr-2 pt-4">
            <div
              :class="[
                'border border-[var(--o2-border-color)] rounded-md overflow-hidden flex flex-col flex-1'
              ]"
            >
              <IncidentAlertTriggersTable
                :triggers="triggers"
                :isDarkMode="isDarkMode"
                @row-click="handleTriggerRowClick"
              />
            </div>
          </div>

          <!-- Right Section: Trigger Details -->
          <div class="w-[400px] flex-shrink-0 flex flex-col pt-4">
            <div
              :class="[
                'border border-[var(--o2-border-color)] rounded-md overflow-hidden flex flex-col flex-1'
              ]"
            >
              <!-- Header -->
              <div
                :class="[
                  '!bg-[var(--o2-table-header-bg)] px-3 py-2 flex items-center gap-2 border-b flex-shrink-0',
                  store.state.theme === 'dark'
                    ? 'border-gray-700'
                    : 'border-gray-200'
                ]"
              >
                <OIcon name="info" size="sm" class="opacity-80" />
                <span :class="'text-text-secondary'" class="text-sm font-semibold">
                  Alert Details
                </span>
              </div>
              <!-- Content -->
              <div class="p-3 flex-1 overflow-auto">
                <!-- No alerts available -->
                <div v-if="!alerts || alerts.length === 0" :class="'text-text-muted'" class="text-sm italic">
                  {{ t('alerts.incidents.noAlertDetailsAvailable') }}
                </div>

                <!-- No trigger selected -->
                <div v-else-if="selectedAlertIndex === -1" :class="'text-text-muted'" class="text-sm italic text-center mt-8">
                  {{ t('alerts.incidents.clickOnTriggerToViewDetails') }}
                </div>

                <!-- Alert details -->
                <div v-else class="flex flex-col gap-3">
                  <!-- Alert Configuration Section -->
                  <div class="space-y-2">
                      <!-- Alert Name -->
                      <div class="flex flex-col gap-0.5">
                        <span :class="'text-text-secondary'" class="text-[10px] uppercase tracking-wide">
                          Alert Name
                        </span>
                        <span :class="'text-text-primary'" class="text-sm font-medium">
                          {{ alerts[selectedAlertIndex]?.name || 'N/A' }}
                        </span>
                      </div>

                      <!-- Stream Type & Name -->
                      <div class="grid grid-cols-2 gap-2">
                        <div class="flex flex-col gap-0.5">
                          <span :class="'text-text-secondary'" class="text-[10px] uppercase tracking-wide">
                            Stream Type
                          </span>
                          <OTag
                            type="streamType"
                            :value="alerts[selectedAlertIndex]?.stream_type || 'N/A'"
                            class="w-fit"
                          />
                        </div>
                        <div class="flex flex-col gap-0.5">
                          <span :class="'text-text-secondary'" class="text-[10px] uppercase tracking-wide">
                            Stream Name
                          </span>
                          <span :class="'text-text-primary'" class="text-sm font-medium truncate">
                            {{ alerts[selectedAlertIndex]?.stream_name || 'N/A' }}
                          </span>
                        </div>
                      </div>

                      <!-- Threshold & Period -->
                      <div class="grid grid-cols-2 gap-2">
                        <div class="flex flex-col gap-0.5">
                          <span :class="'text-text-secondary'" class="text-[10px] uppercase tracking-wide">
                            Threshold
                          </span>
                          <span :class="'text-text-primary'" class="text-sm font-medium">
                            {{ alerts[selectedAlertIndex]?.trigger_condition?.operator || '' }} {{ alerts[selectedAlertIndex]?.trigger_condition?.threshold || 'N/A' }}
                          </span>
                        </div>
                        <div class="flex flex-col gap-0.5">
                          <span :class="'text-text-secondary'" class="text-[10px] uppercase tracking-wide">
                            Period
                          </span>
                          <span :class="'text-text-primary'" class="text-sm font-medium">
                            {{ formatPeriod(alerts[selectedAlertIndex]?.trigger_condition?.period) }}
                          </span>
                        </div>
                      </div>

                      <!-- Frequency & Silence -->
                      <div class="grid grid-cols-2 gap-2">
                        <div class="flex flex-col gap-0.5">
                          <span :class="'text-text-secondary'" class="text-[10px] uppercase tracking-wide">
                            Frequency
                          </span>
                          <span :class="'text-text-primary'" class="text-sm font-medium">
                            {{ alerts[selectedAlertIndex]?.trigger_condition?.frequency || 'N/A' }} {{ alerts[selectedAlertIndex]?.trigger_condition?.frequency_type || 'min' }}
                          </span>
                        </div>
                        <div class="flex flex-col gap-0.5">
                          <span :class="'text-text-secondary'" class="text-[10px] uppercase tracking-wide">
                            Silence
                          </span>
                          <span :class="'text-text-primary'" class="text-sm font-medium">
                            {{ alerts[selectedAlertIndex]?.trigger_condition?.silence || 'N/A' }} min
                          </span>
                        </div>
                      </div>
                  </div>

                  <!-- Alert Conditions Section -->
                  <div :class="['rounded border flex flex-col border-[var(--o2-border-color)] rounded-md',]" class="overflow-hidden" style="height: 392px;">
                    <div :class="['!bg-[var(--o2-table-header-bg)] px-2.5 py-1.5 border-b flex items-center justify-between flex-shrink-0', store.state.theme === 'dark' ? 'border-gray-700' : 'border-gray-200']">
                      <span :class="'text-text-secondary'" class="text-[11px] font-semibold uppercase tracking-wide">
                        {{ alerts[selectedAlertIndex]?.query_condition?.type === 'sql' ? 'SQL Query' : alerts[selectedAlertIndex]?.query_condition?.type === 'promql' ? 'PromQL Query' : 'Conditions' }}
                      </span>
                    </div>
                    <div class="p-2.5 overflow-y-auto flex-1">
                      <!-- SQL Query -->
                      <div v-if="alerts[selectedAlertIndex]?.query_condition?.sql">
                        <pre :class="['text-[0.8rem] overflow-x-auto whitespace-pre-wrap break-words', store.state.theme === 'dark' ? 'text-gray-300' : 'text-gray-800']">{{ alerts[selectedAlertIndex]?.query_condition?.sql }}</pre>
                      </div>

                      <!-- PromQL Query -->
                      <div v-else-if="alerts[selectedAlertIndex]?.query_condition?.promql">
                        <pre :class="['text-[0.8rem] overflow-x-auto whitespace-pre-wrap break-words', store.state.theme === 'dark' ? 'text-gray-300' : 'text-gray-800']">{{ alerts[selectedAlertIndex]?.query_condition?.promql }}</pre>
                      </div>

                      <!-- Custom Conditions -->
                      <div v-else-if="alerts[selectedAlertIndex]?.query_condition?.conditions">
                        <pre :class="['text-[0.8rem] overflow-x-auto whitespace-pre-wrap break-words', store.state.theme === 'dark' ? 'text-gray-300' : 'text-gray-800']">if {{ formatCustomConditions(alerts[selectedAlertIndex]?.query_condition?.conditions) }}</pre>
                      </div>

                      <!-- No conditions -->
                      <div v-else :class="'text-text-muted'" class="text-sm italic">
                        No conditions defined
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Logs Tab Content -->
        <div v-if="activeTab === 'logs'" class="flex flex-col flex-1 overflow-hidden h-full">
          <!-- Loading State -->
          <div v-if="correlationLoading" class="flex flex-col items-center justify-center flex-1 h-[70vh]">
            <OSpinner size="lg" class="mb-4" data-test="incident-telemetry-loading-indicator" />
          </div>

          <!-- Error/No Data State -->
          <div v-else-if="correlationError || !hasCorrelatedData || !hasAnyStreams" class="flex flex-1 flex-col items-center justify-center gap-2 h-full">
            <OIcon
              :name="correlationError ? (correlationError.includes('disambiguation fields') ? 'warning' : 'error-outline') : 'info-outline'"
              :class="['w-16 h-16', correlationError ? (correlationError.includes('disambiguation fields') ? 'text-[var(--o2-warning)]' : 'text-[var(--o2-negative)]') : 'text-gray-400']" />
            <div class="text-xl font-semibold mt-3">
              {{ correlationError || 'No correlated logs found' }}
            </div>
            <div v-if="correlationError && correlationError.includes('disambiguation fields')" class="text-sm text-gray-400 mt-2" style="max-width: 500px; text-align: center;">
              The service discovery configuration (disambiguation fields) was changed after this incident was created.
            </div>
            <OButton
              v-if="correlationError && !correlationError.includes('disambiguation fields')"
              variant="outline"
              size="md"
              @click="refreshCorrelation"
              class="mt-3"
            ><OIcon name="refresh" size="sm" class="mr-1" />Retry</OButton>
          </div>

          <!-- Success State - CorrelatedLogsTable -->
          <div v-else-if="hasCorrelatedData && correlationData" class="flex-1 overflow-hidden h-full">
            <CorrelatedLogsTable
              :service-name="correlationData.serviceName"
              :matched-dimensions="actualMatchedDimensions"
              :additional-dimensions="{}"
              :log-streams="correlationData.logStreams"
              :source-stream="'incidents'"
              :source-type="'incidents'"
              :available-dimensions="availableDimensions"
              :fts-fields="ftsFields"
              :time-range="telemetryTimeRange"
              :hide-view-related-button="true"
              :hide-search-term-actions="true"
              :hide-dimension-filters="true"
              :hide-reset-filters-button="true"
              @sendToAiChat="handleSendToAiChat"
            />
          </div>
        </div>

        <!-- Metrics Tab Content -->
        <div v-if="activeTab === 'metrics'" class="flex flex-col flex-1 overflow-hidden h-full">
          <!-- Loading State -->
          <div v-if="correlationLoading" class="flex flex-col items-center justify-center flex-1 h-full">
            <OSpinner size="lg" class="mb-4" data-test="incident-telemetry-loading-indicator" />
            <div class="text-base">Loading correlated metrics...</div>
          </div>

          <!-- Error/No Data State -->
          <div v-else-if="correlationError || !hasCorrelatedData || !hasAnyStreams" class="flex flex-1 flex-col items-center justify-center gap-2 h-full">
            <OIcon
              :name="correlationError ? (correlationError.includes('disambiguation fields') ? 'warning' : 'error-outline') : 'info-outline'"
              :class="['w-16 h-16', correlationError ? (correlationError.includes('disambiguation fields') ? 'text-[var(--o2-warning)]' : 'text-[var(--o2-negative)]') : 'text-gray-400']" />
            <div class="text-xl font-semibold mt-3">
              {{ correlationError || 'No correlated metrics found' }}
            </div>
            <div v-if="correlationError && correlationError.includes('disambiguation fields')" class="text-sm text-gray-400 mt-2" style="max-width: 500px; text-align: center;">
              The service discovery configuration (disambiguation fields) was changed after this incident was created.
            </div>
            <OButton
              v-if="correlationError && !correlationError.includes('disambiguation fields')"
              variant="outline"
              size="md"
              @click="refreshCorrelation"
              class="mt-3"
            ><OIcon name="refresh" size="sm" class="mr-1" />Retry</OButton>
          </div>

          <!-- Success State - TelemetryCorrelationDashboard -->
          <div v-else-if="hasCorrelatedData && correlationData" class="flex-1 overflow-hidden">
            <TelemetryCorrelationDashboard
              mode="embedded-tabs"
              :externalActiveTab="'metrics'"
              :serviceName="correlationData.serviceName"
              :matchedDimensions="correlationData.matchedDimensions"
              :additionalDimensions="correlationData.additionalDimensions"
              :matched-set-id="correlationMatchedSetId"
              :chip-dimensions="correlationChipDimensions"
              :logStreams="correlationData.logStreams"
              :metricStreams="correlationData.metricStreams"
              :traceStreams="correlationData.traceStreams"
              :timeRange="telemetryTimeRange"
              :hideDimensionFilters="true"
            />
          </div>
        </div>

        <!-- Traces Tab Content -->
        <div v-if="activeTab === 'traces'" class="flex flex-col flex-1 overflow-hidden h-full">
          <!-- Refresh Button (shown when traces data is loaded) -->
          <div v-if="hasCorrelatedData && !correlationLoading && correlationData?.traceStreams?.length > 0" class="px-4 py-2 border-b border-solid border-[var(--o2-border-color)] flex items-center gap-2">
            <span class="text-xs">{{ t('alerts.incidents.showingCorrelatedTraces') }}</span>
            <OButton
              variant="ghost"
              size="icon-sm"
              :disabled="correlationLoading"
              @click="refreshCorrelation"
            ><OIcon name="refresh" size="sm" /><OTooltip :content="t('alerts.incidents.refreshCorrelatedData')" /></OButton>
          </div>

          <!-- Loading State -->
          <div v-if="correlationLoading" class="flex flex-col items-center justify-center flex-1 h-full">
            <OSpinner size="lg" class="mb-4" data-test="incident-telemetry-loading-indicator" />
            <div class="text-base">Loading correlated traces...</div>
          </div>

          <!-- Error/No Data State -->
          <div v-else-if="correlationError || !hasCorrelatedData || !hasAnyStreams" class="flex flex-1 flex-col items-center justify-center gap-2 h-full">
            <OIcon
              :name="correlationError ? (correlationError.includes('disambiguation fields') ? 'warning' : 'error-outline') : 'info-outline'"
              :class="['w-16 h-16', correlationError ? (correlationError.includes('disambiguation fields') ? 'text-[var(--o2-warning)]' : 'text-[var(--o2-negative)]') : 'text-gray-400']" />
            <div class="text-xl font-semibold mt-3">
              {{ correlationError || 'No correlated traces found' }}
            </div>
            <div v-if="correlationError && correlationError.includes('disambiguation fields')" class="text-sm text-gray-400 mt-2" style="max-width: 500px; text-align: center;">
              The service discovery configuration (disambiguation fields) was changed after this incident was created.
            </div>
            <OButton
              v-if="correlationError && !correlationError.includes('disambiguation fields')"
              variant="outline"
              size="md"
              @click="refreshCorrelation"
              class="mt-3"
            ><OIcon name="refresh" size="sm" class="mr-1" />Retry</OButton>
          </div>

          <!-- Success State - TelemetryCorrelationDashboard -->
          <div v-else-if="hasCorrelatedData && correlationData" class="flex-1 overflow-hidden">
            <TelemetryCorrelationDashboard
              mode="embedded-tabs"
              :externalActiveTab="'traces'"
              :serviceName="correlationData.serviceName"
              :matchedDimensions="correlationData.matchedDimensions"
              :additionalDimensions="correlationData.additionalDimensions"
              :logStreams="correlationData.logStreams"
              :metricStreams="correlationData.metricStreams"
              :traceStreams="correlationData.traceStreams"
              :timeRange="telemetryTimeRange"
              :hideDimensionFilters="true"
            />
          </div>
        </div>
        </div>
      </div>
      </div>
    </div>

    <!-- Loading state -->
    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <OSpinner size="md" />
    </div>
  </div>
  </div>
</template>

<script lang="ts">
import OTabs from '@/lib/navigation/Tabs/OTabs.vue'
import OTab from '@/lib/navigation/Tabs/OTab.vue'
import { defineComponent, ref, watch, computed, PropType, nextTick, onMounted, onBeforeUnmount, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { formatToReadable } from "@/utils/date";
import incidentsService, {
  Incident,
  IncidentWithAlerts,
  IncidentAlert,
  IncidentCorrelatedStreams,
} from "@/services/incidents";
import streamService from "@/services/stream";
import serviceStreamsApi, {
  buildChipDimensionsFromFilters,
} from "@/services/service_streams";
import { getImageURL } from "@/utils/zincutils";
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { buildConditionsString } from "@/utils/alerts/conditionsFormatter";
import TelemetryCorrelationDashboard from "@/plugins/correlation/TelemetryCorrelationDashboard.vue";
import CorrelatedLogsTable from "@/plugins/correlation/CorrelatedLogsTable.vue";
import IncidentServiceGraph from "./IncidentServiceGraph.vue";
import IncidentTableOfContents from "./IncidentTableOfContents.vue";
import IncidentRCAAnalysis from "./IncidentRCAAnalysis.vue";
import IncidentTimeline from "./IncidentTimeline.vue";
import IncidentAlertTriggersTable from "./IncidentAlertTriggersTable.vue";
import CustomChartRenderer from "@/components/dashboards/panels/CustomChartRenderer.vue";
import { contextRegistry, createIncidentsContextProvider } from '@/composables/contextProviders';
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { copyToClipboard as copyToClipboardUtil } from "@/utils/clipboard";
import { useConfirmDialog } from "@/composables/useConfirmDialog";

export default defineComponent({
  name: "IncidentDetailDrawer",
  components: {
    AppPageHeader,
    OTabs,
    OTab,
    TelemetryCorrelationDashboard,
    CorrelatedLogsTable,
    IncidentServiceGraph,
    IncidentAlertTriggersTable,
    IncidentTableOfContents,
    IncidentRCAAnalysis,
    IncidentTimeline,
    CustomChartRenderer,
    OButton,
    OSpinner,
    OTooltip,
    OIcon,
    OTag,
},
  emits: ['close', 'status-updated', 'sendToAiChat'],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();
    const router = useRouter();
    const { confirm } = useConfirmDialog();

    // Copy to clipboard state
    const copiedField = ref<string | null>(null);

    // Copy to clipboard function with visual feedback
    const copyToClipboard = (text: string, fieldName: string) => {
      if (!text) return;

      copyToClipboardUtil(text, {
        successMessage: "Copied to clipboard",
        errorMessage: "Failed to copy to clipboard",
      }).then((success) => {
        if (success) {
          copiedField.value = fieldName;
          // Reset the icon after 2 seconds
          setTimeout(() => {
            copiedField.value = null;
          }, 2000);
        }
      });
    };

    const loading = ref(false);
    const updating = ref(false);
    const incidentDetails = ref<IncidentWithAlerts | null>(null);
    const triggers = ref<IncidentAlert[]>([]);
    const alerts = ref<any[]>([]);

    // Title editing
    const isEditingTitle = ref(false);
    const editableTitle = ref("");
    const titleInputRef = ref<HTMLInputElement | null>(null);
    const rcaLoading = ref(false);
    const rcaStreamContent = ref("");

    // Tab management
    const activeTab = ref("overview");

    // Counter to trigger timeline refresh (prop-based approach)
    const timelineRefreshTrigger = ref(0);

    // Alert Triggers tab - selected alert for detail view
    const selectedAlertIndex = ref(-1);

    // Computed property to process alerts with formatted conditions upfront
    // Editable status and severity for Overview tab
    const editableStatus = ref<"open" | "acknowledged" | "resolved">("open");
    const editableSeverity = ref<"P1" | "P2" | "P3" | "P4">("P3");

    // Status and Severity options
    const statusOptions = [
      { label: "Open", value: "open" },
      { label: "Acknowledged", value: "acknowledged" },
      { label: "Resolved", value: "resolved" },
    ];

    const severityOptions = [
      { label: "P1 - Critical", value: "P1" },
      { label: "P2 - High", value: "P2" },
      { label: "P3 - Medium", value: "P3" },
      { label: "P4 - Low", value: "P4" },
    ];

    // Table of Contents
    interface TocItem {
      id: string;
      text: string;
      level: number;
      children: TocItem[];
      expanded: boolean;
    }
    const tableOfContents = ref<TocItem[]>([]);
    const expandedSections = ref<Record<string, boolean>>({});

    // Telemetry correlation state
    const correlationData = ref<IncidentCorrelatedStreams | null>(null);
    const correlationLoading = ref(false);
    const correlationError = ref<string | null>(null);

    // Semantic groups for display name mapping
    const semanticGroups = ref<Array<{ id: string; display: string; group?: string; fields: string[] }>>([]);

    // Computed to check if analysis already exists
    const hasExistingRca = computed(() => {
      return !!incidentDetails.value?.topology_context?.suggested_root_cause;
    });

    // Create a lookup map for semantic group ID to display name
    const semanticGroupDisplayMap = computed(() => {
      const map = new Map<string, string>();
      for (const group of semanticGroups.value) {
        map.set(group.id, group.display);
      }
      return map;
    });

    // Helper function to get display name for a semantic group ID
    const getSemanticGroupDisplayName = (id: string): string => {
      return semanticGroupDisplayMap.value.get(id) || id;
    };

    // Identity set + chip dimensions powering the "View by" subject tabs in the
    // embedded TelemetryCorrelationDashboard (metrics tab). Without matchedSetId
    // the dashboard cannot build subject chips, so the toggle never renders.
    // Both derive from the correlate API response; chip dimensions stay reactive
    // to semanticGroups (used only for dedup) so they refresh if groups load late.
    const correlationMatchedSetId = computed(
      () => correlationData.value?.correlationData?.matched_set_id ?? undefined,
    );
    const correlationChipDimensions = computed<Record<string, string>>(() => {
      const resp = correlationData.value?.correlationData;
      return resp ? buildChipDimensionsFromFilters(resp, semanticGroups.value) : {};
    });

    // True when a background AI analysis run has started but not yet completed.
    // Updated whenever events are fetched (load, tab switch, reopen, etc.) — no polling.
    const analysisInFlight = ref(false);

    const checkAnalysisInFlight = async (incidentId: string) => {
      try {
        const org = store.state.selectedOrganization.identifier;
        const response = await incidentsService.getEvents(org, incidentId);
        const events: any[] = response.data?.events || [];
        let lastBegin = -1;
        let lastComplete = -1;
        for (const ev of events) {
          if (ev.type === "ai_analysis_begin") lastBegin = ev.timestamp;
          if (ev.type === "ai_analysis_complete" || ev.type === "ai_analysis_failed") lastComplete = ev.timestamp;
        }
        const nowInFlight = lastBegin > lastComplete;

        // Transition: banner was showing and analysis just finished — reload to pick up new report
        if (analysisInFlight.value && !nowInFlight) {
          analysisInFlight.value = false;
          await loadDetails(incidentId);
          timelineRefreshTrigger.value++;
        } else {
          analysisInFlight.value = nowInFlight;
        }
      } catch {
        analysisInFlight.value = false;
      }
    };

    // Check if dark mode is active
    const isDarkMode = computed(() => {
      return store.state.theme === "dark";
    });

    // Computed properties for statistics
    const affectedServicesCount = computed(() => {
      if (!incidentDetails.value?.topology_context?.nodes) return 0;
      return incidentDetails.value.topology_context.nodes.length;
    });

    const alertFrequency = computed(() => {
      if (!incidentDetails.value || triggers.value.length === 0) return "N/A";

      const durationMs = (incidentDetails.value.last_alert_at - incidentDetails.value.first_alert_at) / 1000;
      const durationSeconds = Math.floor(durationMs / 1000);

      if (durationSeconds === 0) return "Immediate";

      const frequency = triggers.value.length / (durationSeconds / 60); // alerts per minute

      if (frequency >= 1) {
        return `${frequency.toFixed(1)} per minute`;
      } else if (frequency >= 1/60) {
        const perHour = frequency * 60;
        return `${perHour.toFixed(1)} per hour`;
      } else {
        const minutesBetween = Math.floor(durationSeconds / triggers.value.length / 60);
        return `1 Per ${minutesBetween} Mins`;
      }
    });

    // Helper: Get actual trigger count for a specific alert_id
    const getTriggerCountForAlert = (alertId: string) => {
      if (!triggers.value) return 0;
      return triggers.value.filter(t => t.alert_id === alertId).length;
    };

    // Computed property to extract unique alerts and their fire counts from triggers
    const uniqueAlertsMap = computed(() => {
      if (!triggers.value || triggers.value.length === 0) {
        return new Map<string, number>();
      }

      const alertMap = new Map<string, number>();

      triggers.value.forEach(trigger => {
        const alertId = trigger.alert_id;
        alertMap.set(alertId, (alertMap.get(alertId) || 0) + 1);
      });

      return alertMap;
    });

    // Computed property for unique alerts count
    const uniqueAlertsCount = computed(() => {
      return uniqueAlertsMap.value.size;
    });

    // Computed: Alerts sorted by trigger count (descending) - derived from triggers
    const sortedAlertsByTriggerCount = computed(() => {
      if (!triggers.value || triggers.value.length === 0) return [];

      // Group triggers by alert_id to get unique alerts with their counts
      const alertsMap = new Map<string, { id: string; name: string; count: number }>();

      triggers.value.forEach(trigger => {
        const alertId = trigger.alert_id;
        const alertName = trigger.alert_name || 'Unknown';

        if (alertsMap.has(alertId)) {
          alertsMap.get(alertId)!.count++;
        } else {
          alertsMap.set(alertId, {
            id: alertId,
            name: alertName,
            count: 1
          });
        }
      });

      // Convert map to array and sort by count (descending)
      return Array.from(alertsMap.values()).sort((a, b) => b.count - a.count);
    });

    // Peak Alert Rate - find the highest concentration of alerts
    const peakAlertRate = computed(() => {
      if (!incidentDetails.value || triggers.value.length === 0) return "N/A";

      // Sort triggers by timestamp
      const sortedTriggers = [...triggers.value].sort((a, b) => a.alert_fired_at - b.alert_fired_at);

      // Use a sliding window of 5 minutes to find peak
      const windowMs = 5 * 60 * 1000 * 1000; // 5 minutes in microseconds
      let maxCount = 0;

      for (let i = 0; i < sortedTriggers.length; i++) {
        const windowStart = sortedTriggers[i].alert_fired_at;
        const windowEnd = windowStart + windowMs;

        // Count alerts in this window
        let count = 0;
        for (let j = i; j < sortedTriggers.length && sortedTriggers[j].alert_fired_at < windowEnd; j++) {
          count++;
        }

        maxCount = Math.max(maxCount, count);
      }

      return maxCount > 1 ? `${maxCount} alerts in 5 min` : "1 alert";
    });

    // Peak activity details for timeline
    const peakActivity = computed(() => {
      if (!incidentDetails.value || triggers.value.length <= 1) return null;

      // Sort triggers by timestamp
      const sortedTriggers = [...triggers.value].sort((a, b) => a.alert_fired_at - b.alert_fired_at);

      // Use a sliding window of 5 minutes to find peak
      const windowMs = 5 * 60 * 1000 * 1000; // 5 minutes in microseconds
      let maxCount = 0;
      let peakTimestamp = null;

      for (let i = 0; i < sortedTriggers.length; i++) {
        const windowStart = sortedTriggers[i].alert_fired_at;
        const windowEnd = windowStart + windowMs;

        // Count alerts in this window
        let count = 0;
        for (let j = i; j < sortedTriggers.length && sortedTriggers[j].alert_fired_at < windowEnd; j++) {
          count++;
        }

        if (count > maxCount) {
          maxCount = count;
          peakTimestamp = windowStart;
        }
      }

      // Only show peak activity if there are at least 2 alerts in a 5-minute window
      if (maxCount > 1) {
        return {
          count: maxCount,
          timestamp: peakTimestamp
        };
      }

      return null;
    });

    // Correlation Type
    const correlationType = computed(() => {
      if (!incidentDetails.value?.correlation_reason) return "Unknown";

      // The correlation_reason field contains the type
      const reason = incidentDetails.value.correlation_reason.toLowerCase();
      if (reason.includes("temporal")) {
        return "Temporal";
      } else if (reason.includes("spatial")) {
        return "Spatial";
      }
      return incidentDetails.value.correlation_reason;
    });

    const correlationTooltip = computed(() => {
      const type = correlationType.value;
      if (type === "Temporal") {
        return "Alerts correlated by time - they occurred close together";
      } else if (type === "Spatial") {
        return "Alerts correlated by common dimensions (same service, host, etc.)";
      }
      return "Correlation type for this incident";
    });

    // Fetch correlated telemetry streams
    const fetchCorrelatedStreams = async (force: boolean = false) => {
      if (!incidentDetails.value) return;

      // Skip if already loaded and not forcing refresh
      if (!force && correlationData.value) return;

      correlationLoading.value = true;
      correlationError.value = null;

      try {
        const org = store.state.selectedOrganization.identifier;
        correlationData.value = await incidentsService.getCorrelatedStreams(
          org,
          incidentDetails.value
        );

        // Check if correlation failed (null response or no data) — try fallback
        if (!correlationData.value?.correlationData &&
            (!correlationData.value?.logStreams?.length &&
             !correlationData.value?.metricStreams?.length &&
             !correlationData.value?.traceStreams?.length)) {
          // No correlation data found - try building fallback correlation
          await buildFallbackCorrelation(org, incidentDetails.value);
        }
      } catch (error: any) {
        console.error("Failed to load correlated streams:", error);
        correlationError.value =
          error?.response?.data?.message ||
          error?.message ||
          t("correlation.failedToLoad");
      } finally {
        correlationLoading.value = false;
      }
    };

    // Build fallback correlation using first alert's stream schema
    const buildFallbackCorrelation = async (org: string, incident: Incident) => {
      try {
        // Get first alert to determine source stream
        const firstAlert = alerts.value?.[0];
        if (!firstAlert) {
          console.warn("[Fallback Correlation] No alerts found in incident");
          return;
        }

        // Use actual stream type and name from the alert
        const streamType = firstAlert.stream_type || "logs";
        const streamName = firstAlert.stream_name || "default";

        // Step 1: Get stream schema (like logs page does)
        const schemaResponse = await streamService.schema(org, streamName, streamType);
        const schema = schemaResponse.data;

        // Step 2: Extract schema fields (like logs page does)
        // CRITICAL FIX: Use uds_schema (user-defined schema) if available!
        // The logs page shows uds_schema fields in the left pane, NOT all schema fields
        // uds_schema is the curated list of fields the user cares about
        const schemaFieldsArray = (schema.uds_schema && schema.uds_schema.length > 0)
          ? schema.uds_schema
          : (schema.schema || schema.fields || []);
        const schemaFields = new Set(schemaFieldsArray.map((f: any) => f.name));

        // Step 3: Get semantic groups to resolve dimension names to field patterns
        const semanticGroupsResponse = await serviceStreamsApi.getSemanticGroups(org);
        const semanticGroups = semanticGroupsResponse.data;

        const filters: Record<string, string> = {};

        // Step 4: For each dimension, find the matching schema field
        for (const [dimId, dimValue] of Object.entries(incident.group_values)) {
          let matchedField = null;

          // Get semantic group
          const group = semanticGroups.find((g: any) => g.id === dimId);

          if (group && group.fields && group.fields.length > 0) {
            // Check each field from semantic group
            for (const fieldName of group.fields) {
              const existsInSchema = schemaFields.has(fieldName);
              if (existsInSchema && !matchedField) {
                matchedField = fieldName;
                // Don't break - keep logging all fields for debugging
              }
            }
          } else {
            console.warn(`[Fallback Correlation] No semantic group found for: ${dimId}`);
          }

          // Fallback: If semantic group didn't work, scan schema directly by pattern
          if (!matchedField) {
            console.warn(`[Fallback Correlation] Semantic group failed, scanning schema fields directly...`);
            const dimParts = dimId.split('-');
            
            const schemaFieldsArray = Array.from(schemaFields).filter(f => !f.startsWith('_'));
            for (const schemaField of schemaFieldsArray) {
              const fieldLower = schemaField.toLowerCase();
              const allPartsMatch = dimParts.every(part => fieldLower.includes(part.toLowerCase()));

              if (allPartsMatch) {
                matchedField = schemaField;
                break;
              }
            }
          }

          if (matchedField) {
            filters[matchedField] = dimValue;
          }
        }

        if (Object.keys(filters).length === 0) {
          console.warn("[Fallback Correlation] No dimensions could be mapped to stream fields");
          return;
        }
        // Build StreamInfo object
        const streamInfo = {
          stream_name: streamName,
          stream_type: streamType === 'logs' ? 'Logs' : streamType === 'metrics' ? 'Metrics' : 'Traces',
          filters
        };

        // Build correlation response with only the source stream type
        correlationData.value = {
          serviceName: `dimension-match-${incident.group_values.service || 'unknown'}`,
          matchedDimensions: incident.group_values,
          additionalDimensions: {},
          logStreams: streamType === 'logs' ? [streamInfo] : [],
          metricStreams: streamType === 'metrics' ? [streamInfo] : [],
          traceStreams: streamType === 'traces' ? [streamInfo] : [],
          correlationData: {
            service_name: `dimension-match-${incident.group_values.service || 'unknown'}`,
            matched_dimensions: incident.group_values,
            additional_dimensions: {},
            related_streams: {
              logs: streamType === 'logs' ? [streamInfo] : [],
              metrics: streamType === 'metrics' ? [streamInfo] : [],
              traces: streamType === 'traces' ? [streamInfo] : [],
            },
            correlation_method: "frontend-fallback"
          }
        };
      } catch (fallbackError) {
        console.error("[Fallback Correlation] Failed to build fallback:", fallbackError);
        // Don't set error - let tabs show "No correlated X found"
      }
    };

    // Refresh correlation data
    const refreshCorrelation = () => {
      fetchCorrelatedStreams(true);
    };

    // Lazy load correlation when user clicks telemetry tab for the first time
    watch(activeTab, (newTab) => {
      if (
        (newTab === "logs" || newTab === "metrics" || newTab === "traces") &&
        !correlationData.value &&
        !correlationLoading.value &&
        !correlationError.value
      ) {
        fetchCorrelatedStreams();
      }
      // Switching to the Analysis tab re-checks in-flight state without polling
      if (newTab === "incidentAnalysis" && incidentDetails.value?.id) {
        checkAnalysisInFlight(incidentDetails.value.id);
      }
    });

    // Computed property for SRE chat incident context
    const incidentContextData = computed(() => {
      if (!incidentDetails.value) return null;

      return {
        id: incidentDetails.value.id,
        title: incidentDetails.value.title,
        status: incidentDetails.value.status,
        severity: incidentDetails.value.severity,
        alert_count: incidentDetails.value.alert_count,
        first_alert_at: incidentDetails.value.first_alert_at,
        last_alert_at: incidentDetails.value.last_alert_at,
        group_values: incidentDetails.value.group_values,
        topology_context: incidentDetails.value.topology_context,
        triggers: triggers.value,
        rca_analysis: hasExistingRca.value
          ? incidentDetails.value?.topology_context?.suggested_root_cause
          : rcaStreamContent.value,
      };
    });

    // Computed properties for TelemetryCorrelationDashboard
    const telemetryTimeRange = computed(() => {
      if (!incidentDetails.value) {
        return { startTime: 0, endTime: 0 };
      }

      // Expand time range to ensure we capture relevant telemetry
      // If first_alert_at == last_alert_at (single alert), expand ±15 minutes
      const FIFTEEN_MINUTES_MICROS = 15 * 60 * 1000000;
      const startTime = incidentDetails.value.first_alert_at - FIFTEEN_MINUTES_MICROS;
      const endTime = incidentDetails.value.last_alert_at + FIFTEEN_MINUTES_MICROS;

      return {
        startTime,
        endTime,
      };
    });

    const hasCorrelatedData = computed(() => {
      return !!correlationData.value;
    });

    const hasAnyStreams = computed(() => {
      if (!correlationData.value) return false;
      return (
        correlationData.value.logStreams.length > 0 ||
        correlationData.value.metricStreams.length > 0 ||
        correlationData.value.traceStreams.length > 0
      );
    });

    // Computed properties for CorrelatedLogsTable
    // Extract actual field names from logStreams filters
    // The filters contain the correct field name mappings (e.g., k8s_namespace_name)
    // instead of semantic dimension names (e.g., k8s-namespace)
    const actualMatchedDimensions = computed(() => {
      if (!correlationData.value?.logStreams?.[0]?.filters) {
        return correlationData.value?.matchedDimensions || {};
      }
      // Use the filters from the first log stream as they contain the actual field names
      return correlationData.value.logStreams[0].filters;
    });

    const availableDimensions = computed(() => {
      if (!correlationData.value?.logStreams?.[0]?.filters) {
        return {};
      }
      // Use the filters from the first log stream as they contain the actual field names
      return correlationData.value.logStreams[0].filters;
    });

    const ftsFields = computed(() => {
      // FTS fields can be empty for now, as the log streams will determine this
      return [];
    });

    // Computed property for formatted RCA content
    const formattedRcaContent = computed(() => {
      const content = rcaLoading.value && rcaStreamContent.value
        ? rcaStreamContent.value
        : hasExistingRca.value
        ? incidentDetails.value?.topology_context?.suggested_root_cause || ''
        : '';

      if (!content) return '';

      return formatRcaContent(content);
    });

    // Alert Activity Chart Data - groups triggers by day and creates a bar chart
    const alertActivityChartData = computed(() => {
      if (!triggers.value || triggers.value.length === 0) {
        return {
          chartType: "custom_chart",
          title: {
            text: t("alerts.incidents.noAlertActivityData"),
            left: "center",
            top: "center",
            textStyle: {
              fontSize: 14,
              fontWeight: "normal",
              color: store.state.theme === 'dark' ? '#B7B7B7' : '#72777B'
            }
          }
        };
      }

      // Group triggers by day
      const triggersByDay: Record<string, { total: number; byAlert: Record<string, number> }> = {};

      triggers.value.forEach(trigger => {
        // Convert microseconds to milliseconds then to Date
        const triggerDate = new Date(trigger.alert_fired_at / 1000);
        const dayKey = triggerDate.toISOString().split('T')[0]; // YYYY-MM-DD format

        if (!triggersByDay[dayKey]) {
          triggersByDay[dayKey] = { total: 0, byAlert: {} };
        }

        triggersByDay[dayKey].total++;

        const alertName = trigger.alert_name || 'Unknown';
        triggersByDay[dayKey].byAlert[alertName] = (triggersByDay[dayKey].byAlert[alertName] || 0) + 1;
      });

      // Sort dates chronologically
      const sortedDates = Object.keys(triggersByDay).sort();

      // Get unique alert names for the legend
      const alertNames = new Set<string>();
      Object.values(triggersByDay).forEach(day => {
        Object.keys(day.byAlert).forEach(name => alertNames.add(name));
      });

      // Create series data for each alert type
      const seriesData = Array.from(alertNames).map((alertName, index) => {
        const colors = ['#5470C6', '#91CC75', '#FAC858', '#EE6666', '#73C0DE', '#3BA272', '#FC8452', '#9A60B4', '#EA7CCC'];
        return {
          name: alertName,
          type: 'bar',
          stack: 'total',
          emphasis: {
            focus: 'series'
          },
          data: sortedDates.map(date => triggersByDay[date].byAlert[alertName] || 0),
          itemStyle: {
            color: colors[index % colors.length]
          }
        };
      });

      // Format dates for display (show only day/month if within same year, otherwise show year too)
      const formatDate = (dateStr: string) => {
        const d = new Date(dateStr);
        const now = new Date();
        if (d.getFullYear() === now.getFullYear()) {
          return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }
        return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
      };

      return {
        chartType: "custom_chart",
        tooltip: {
          trigger: 'axis',
          axisPointer: {
            type: 'shadow'
          },
          backgroundColor: store.state.theme === 'dark' ? '#2B2C2D' : '#ffffff',
          borderColor: store.state.theme === 'dark' ? '#444444' : '#E7EAEE',
          textStyle: {
            color: store.state.theme === 'dark' ? '#DCDCDC' : '#232323'
          }
        },
        legend: {
          type: 'scroll',
          orient: 'horizontal',
          bottom: 0,
          data: Array.from(alertNames),
          textStyle: {
            color: store.state.theme === 'dark' ? '#DCDCDC' : '#232323'
          },
          pageButtonItemGap: 5,
          pageButtonGap: 20,
          pageIconColor: store.state.theme === 'dark' ? '#DCDCDC' : '#232323',
          pageIconInactiveColor: store.state.theme === 'dark' ? '#666666' : '#CCCCCC',
          pageTextStyle: {
            color: store.state.theme === 'dark' ? '#DCDCDC' : '#232323'
          }
        },
        grid: {
          left: '3%',
          right: '4%',
          bottom: '50',
          top: '40',
          containLabel: true
        },
        xAxis: {
          type: 'category',
          data: sortedDates.map(formatDate),
          axisLabel: {
            color: store.state.theme === 'dark' ? '#B7B7B7' : '#72777B',
            rotate: sortedDates.length > 10 ? 45 : 0
          },
          axisLine: {
            lineStyle: {
              color: store.state.theme === 'dark' ? '#444444' : '#E7EAEE'
            }
          }
        },
        yAxis: {
          type: 'value',
          name: 'Alert Count',
          nameTextStyle: {
            color: store.state.theme === 'dark' ? '#B7B7B7' : '#72777B'
          },
          axisLabel: {
            color: store.state.theme === 'dark' ? '#B7B7B7' : '#72777B'
          },
          axisLine: {
            lineStyle: {
              color: store.state.theme === 'dark' ? '#444444' : '#E7EAEE'
            }
          },
          splitLine: {
            lineStyle: {
              color: store.state.theme === 'dark' ? '#3A3A3A' : '#F0F0F0'
            }
          }
        },
        series: seriesData
      };
    });

    const loadDetails = async (incidentId: string) => {
      loading.value = true;

      // Reset correlation state when loading new incident
      correlationData.value = null;
      correlationError.value = null;

      try {
        const org = store.state.selectedOrganization.identifier;
        const response = await incidentsService.get(org, incidentId);

        incidentDetails.value = response.data;
        triggers.value = (response.data as any).triggers || [];
        alerts.value = response.data.alerts || [];

        // Initialize editable status and severity from incident data
        editableStatus.value = response.data.status;
        editableSeverity.value = response.data.severity;

        // Load semantic groups for display name mapping
        try {
          const semanticGroupsResponse = await serviceStreamsApi.getSemanticGroups(org);
          semanticGroups.value = semanticGroupsResponse.data || [];
        } catch (semanticError) {
          console.warn("Failed to load semantic groups:", semanticError);
          semanticGroups.value = [];
        }

        // Check if a background AI analysis is already running
        await checkAnalysisInFlight(incidentId);
      } catch (error) {
        console.error("Failed to load incident details:", error);
        toast({
          variant: "error",
          message: "Failed to load incident details",
        });
      } finally {
        loading.value = false;
      }
    };

    // Watch for URL route parameter
    watch(
      () => router.currentRoute.value.params.id,
      (incidentIdFromUrl) => {
        if (incidentIdFromUrl && typeof incidentIdFromUrl === 'string') {
          // Load incident from URL route parameter
          // Validate incident ID format (e.g., UUID validation)
          if (incidentIdFromUrl.trim().length > 0) {
            loadDetails(incidentIdFromUrl);
          } else {
            console.warn('Invalid incident ID in URL');
            correlationData.value = null;
            correlationError.value = null;
          }
        } else {
          // Clear correlation data when drawer closes
          correlationData.value = null;
          correlationError.value = null;
        }
      },
      { immediate: true }
    );

    // Watch incident context and automatically register it for AI chat
    watch(
      incidentContextData,
      (contextData) => {
        if (contextData) {
          const incidentProvider = createIncidentsContextProvider(contextData, store);
          contextRegistry.register('incidents', incidentProvider);
          contextRegistry.setActive('incidents');
        } else {
          contextRegistry.setActive('');
        }
      },
      { immediate: true }
    );

    // Clean up incident context when component unmounts (user navigates away)
    onUnmounted(() => {
      contextRegistry.setActive('');
      contextRegistry.unregister('incidents');
    });

    const close = () => {
      // Clear correlation data when closing
      correlationData.value = null;
      correlationError.value = null;

      // Clear incident context when explicitly closing
      contextRegistry.setActive('');
      contextRegistry.unregister('incidents');

      // Navigate back to incident list
      router.push({
        name: "incidentList",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    };

    // Handle ESC key to close incident detail
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Esc') {
        // Don't close if user is editing title
        if (isEditingTitle.value) {
          return;
        }
        close();
      }
    };

    // Add keyboard event listener on mount
    onMounted(() => {
      window.addEventListener('keydown', handleEscapeKey);
    });

    // Remove keyboard event listener on unmount
    onBeforeUnmount(() => {
      window.removeEventListener('keydown', handleEscapeKey);
    });

    const handleSendToAiChat = (value: any, append: boolean = true) => {
      emit('sendToAiChat', value, append);
    };

    const updateStatus = async (newStatus: "open" | "acknowledged" | "resolved") => {
      if (!incidentDetails.value) return;
      updating.value = true;
      try {
        const org = store.state.selectedOrganization.identifier;
        const response = await incidentsService.updateStatus(
          org,
          incidentDetails.value.id,
          newStatus
        );
        // Update local state with the actual status from the API response
        incidentDetails.value.status = response.data.status;
        incidentDetails.value.updated_at = response.data.updated_at || Date.now() * 1000;
        editableStatus.value = response.data.status;
        toast({
          variant: "success",
          message: t("alerts.incidents.statusUpdated"),
        });
        // Mark data as stale so incident list will refresh when navigating back
        store.dispatch('incidents/setShouldRefresh', true);
        emit("status-updated");

        // Refresh events in timeline if Activity tab is active
        if (activeTab.value === 'activity') {
          timelineRefreshTrigger.value++;
        }

        // Reopening may trigger a background RCA reanalysis — check immediately
        if (newStatus === 'open' && incidentDetails.value?.id) {
          await checkAnalysisInFlight(incidentDetails.value.id);
        }
      } catch (error) {
        console.error("[UPDATE STATUS] Failed to update status:", error);
        toast({
          variant: "error",
          message: t("alerts.incidents.statusUpdateFailed"),
        });
      } finally {
        updating.value = false;
      }
    };

    const acknowledgeIncident = () => updateStatus("acknowledged");
    const resolveIncident = () => updateStatus("resolved");
    const reopenIncident = () => updateStatus("open");

    // Title editing functions
    const startTitleEdit = () => {
      if (!incidentDetails.value) return;
      editableTitle.value = incidentDetails.value.title;
      isEditingTitle.value = true;
      nextTick(() => {
        titleInputRef.value?.focus();
        titleInputRef.value?.select();
      });
    };

    const cancelTitleEdit = () => {
      isEditingTitle.value = false;
      editableTitle.value = "";
    };

    const saveTitleEdit = async () => {
      if (!incidentDetails.value || !editableTitle.value.trim()) {
        cancelTitleEdit();
        return;
      }

      if (editableTitle.value.trim() === incidentDetails.value.title) {
        cancelTitleEdit();
        return;
      }

      try {
        const org = store.state.selectedOrganization.identifier;
        const response = await incidentsService.updateIncident(
          org,
          incidentDetails.value.id,
          {
            title: editableTitle.value.trim(),
          }
        );

        // Update local state with the actual title from the API response
        incidentDetails.value.title = response.data.title;
        isEditingTitle.value = false;

        toast({
          variant: "success",
          message: t("alerts.incidents.incidentTitleUpdatedSuccess"),
        });
        // Mark data as stale so incident list will refresh
        store.dispatch('incidents/setShouldRefresh', true);

        // Refresh events in timeline if Activity tab is active
        if (activeTab.value === 'activity') {
          timelineRefreshTrigger.value++;
        }
      } catch (error: any) {
        console.error("Failed to update title:", error);
        toast({
          variant: "error",
          message: error?.response?.data?.message || "Failed to update incident title",
        });
        cancelTitleEdit();
      }
    };

    const getStatusLabel = (status: string) => {
      switch (status) {
        case "open":
          return t("alerts.incidents.statusOpen");
        case "acknowledged":
          return t("alerts.incidents.statusAcknowledged");
        case "resolved":
          return t("alerts.incidents.statusResolved");
        default:
          return status;
      }
    };

    const getSeverityColorHex = (severity: string) => {
      switch (severity) {
        case "P1":
          return "#b91c1c"; // red-700
        case "P2":
          return "#c2410c"; // orange-700
        case "P3":
          return "#d97706"; // amber-600
        case "P4":
          return "#6b7280"; // gray-500
        default:
          return "#6b7280"; // gray-500
      }
    };

    const formatPeriod = (periodInSeconds: number | undefined) => {
      if (!periodInSeconds) return 'N/A';

      // Convert seconds to minutes
      if (periodInSeconds >= 60) {
        const minutes = Math.floor(periodInSeconds / 60);
        const seconds = periodInSeconds % 60;
        if (seconds === 0) {
          return `${minutes} min`;
        }
        return `${minutes} min ${seconds} sec`;
      }

      return `${periodInSeconds} sec`;
    };

    // Transform V1 format conditions (or/and structure) to readable expression
    function transformToExpression(data: any, wrap = true): any {
      if (!data) return null;

      const keys = Object.keys(data);
      if (keys.length !== 1) return null;

      const label = keys[0].toUpperCase(); // AND or OR
      const itemsArray = data[label.toLowerCase()];

      const parts = itemsArray.map((item: any) => {
        if (item.and || item.or) {
          return transformToExpression(item, true); // wrap nested groups
        } else {
          const column = item.column;
          const operator = item.operator;
          const value = typeof item.value === 'string' ? `'${item.value}'` : item.value;
          return `${column} ${operator} ${value}`;
        }
      });

      const joined = parts.join(` ${label} `);
      return wrap ? `(${joined})` : joined;
    }

    // Transform V2 format conditions (filterType/logicalOperator structure) to readable expression
    function transformV2ToExpression(group: any, isRoot = true): string {
      const result = buildConditionsString(group, {
        sqlMode: false,        // Display format (lowercase operators)
        addWherePrefix: false,
        formatValues: false,   // Simple display without type-aware formatting
      });

      // Wrap in parentheses if it's the root level and has content
      return isRoot && result ? `(${result})` : result;
    }

    // Convert custom conditions to display string based on version
    const formatCustomConditions = (conditionData: any) => {
      if (!conditionData || Object.keys(conditionData).length === 0) {
        return '--';
      }

      // Detect format by structure
      if (conditionData?.filterType === 'group') {
        // V2 format: {filterType: "group", logicalOperator: "AND", conditions: [...]}
        return transformV2ToExpression(conditionData);
      } else if (conditionData?.version === 2 && conditionData?.conditions) {
        // V2 format with version wrapper: {version: 2, conditions: {filterType: "group", ...}}
        return transformV2ToExpression(conditionData.conditions);
      } else if (conditionData?.or || conditionData?.and) {
        // V1 format: {or: [...]} or {and: [...]}
        return transformToExpression(conditionData);
      } else if (Array.isArray(conditionData) && conditionData.length > 0) {
        // V0 format (legacy): flat array [{column, operator, value}, ...]
        const parts = conditionData.map((item: any) => {
          const column = item.column || 'field';
          const operator = item.operator || '=';
          const value = typeof item.value === 'string' ? `'${item.value}'` : item.value;
          return `${column} ${operator} ${value}`;
        });
        return parts.length > 0 ? `(${parts.join(' AND ')})` : '--';
      }

      return typeof conditionData === 'string' ? conditionData : '--';
    };

    // Handle status change from dropdown
    const handleStatusChange = async (newStatus: "open" | "acknowledged" | "resolved") => {
      if (!incidentDetails.value || updating.value) return;

      updating.value = true;
      try {
        const org = store.state.selectedOrganization.identifier;
        const response = await incidentsService.updateStatus(
          org,
          incidentDetails.value.id,
          newStatus
        );

        // Update local state with the actual status from the API response
        incidentDetails.value.status = response.data.status;
        editableStatus.value = response.data.status;

        toast({
          variant: "success",
          message: `Incident status updated to ${response.data.status}`,
        });
        // Mark data as stale so incident list will refresh
        store.dispatch('incidents/setShouldRefresh', true);

        // Refresh events in timeline if Activity tab is active
        if (activeTab.value === 'activity') {
          timelineRefreshTrigger.value++;
        }
      } catch (error: any) {
        console.error("Failed to update status:", error);
        toast({
          variant: "error",
          message: error?.response?.data?.message || "Failed to update incident status",
        });
        // Revert on error
        editableStatus.value = incidentDetails.value.status;
      } finally {
        updating.value = false;
      }
    };

    // Handle trigger row click - find the alert index by name
    const handleTriggerRowClick = (alertName: string) => {
      const index = alerts.value.findIndex((alert: any) => alert.name === alertName);
      if (index !== -1) {
        selectedAlertIndex.value = index;
      }
    };

    // Handle severity change from dropdown
    const handleSeverityChange = async (newSeverity: "P1" | "P2" | "P3" | "P4") => {
      if (!incidentDetails.value || updating.value) return;

      updating.value = true;
      try {
        const org = store.state.selectedOrganization.identifier;
        const incidentId = incidentDetails.value.id;
        const response = await incidentsService.updateIncident(
          org,
          incidentId,
          { severity: newSeverity }
        );

        const data = response.data;

        // Update local state with the actual severity from the API response
        incidentDetails.value.severity = data.severity;
        editableSeverity.value = data.severity;

        toast({
          variant: "success",
          message: `Incident severity updated to ${data.severity}`,
        });
        // Mark data as stale so incident list will refresh
        store.dispatch('incidents/setShouldRefresh', true);

        // Handle reanalysis prompt based on in-flight state
        if ('analysis_in_flight' in data) {
          analysisInFlight.value = !!data.analysis_in_flight;
          if (data.analysis_in_flight) {
            toast({
              variant: "info",
              message: "AI analysis is already running for this incident",
            });
          } else {
            const ok = await confirm({
              title: "Re-run AI Analysis?",
              message: "Severity has changed. Would you like AI to re-analyze this incident?",
              confirmLabel: "Re-run AI analysis",
              cancelLabel: "No thanks",
              persistent: false,
            });
            if (ok) {
              try {
                await incidentsService.triggerRca(org, incidentId, { reanalysis: true });
                toast({
                  variant: "success",
                  message: "AI reanalysis started",
                });
                await loadDetails(incidentId);
              } catch (e: any) {
                toast({
                  variant: "error",
                  message: e?.response?.data?.message || "Failed to start reanalysis",
                });
              }
            }
          }
        }
      } catch (error: any) {
        console.error("Failed to update severity:", error);
        toast({
          variant: "error",
          message: error?.response?.data?.message || "Failed to update incident severity",
        });
        // Revert on error
        editableSeverity.value = incidentDetails.value.severity;
      } finally {
        updating.value = false;
      }
    };

    const formatTimestamp = (timestamp: number) => {
      // Backend sends microseconds
      return formatToReadable(timestamp);
    };

    const formatTimestampUTC = (timestamp: number) => {
      // Backend sends microseconds, format in UTC
      const d = new Date(timestamp / 1000);
      const year = d.getUTCFullYear();
      const month = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      const hours = String(d.getUTCHours()).padStart(2, '0');
      const minutes = String(d.getUTCMinutes()).padStart(2, '0');
      const seconds = String(d.getUTCSeconds()).padStart(2, '0');
      return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    };

    const calculateDuration = (startTimestamp: number, endTimestamp: number) => {
      // Backend sends microseconds, convert to milliseconds
      const durationMs = (endTimestamp - startTimestamp) / 1000;

      const seconds = Math.floor(durationMs / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);

      if (days > 0) {
        const remainingHours = hours % 24;
        return `${days}d ${remainingHours}h`;
      } else if (hours > 0) {
        const remainingMinutes = minutes % 60;
        return `${hours}h ${remainingMinutes}m`;
      } else if (minutes > 0) {
        const remainingSeconds = seconds % 60;
        return `${minutes}m ${remainingSeconds}s`;
      } else {
        return `${seconds}s`;
      }
    };

    // Extract headings from markdown content to build table of contents
    const extractTableOfContents = (content: string): TocItem[] => {
      // Handle both actual newlines and escaped \n in JSON strings
      const normalizedContent = content.replace(/\\n/g, '\n');
      const lines = normalizedContent.split('\n');
      const toc: TocItem[] = [];
      const stack: TocItem[] = [];
      let inCodeBlock = false;

      lines.forEach((line) => {
        // Check for code block delimiters (````)
        if (line.trim().startsWith('```')) {
          inCodeBlock = !inCodeBlock;
          return;
        }

        // Skip lines inside code blocks
        if (inCodeBlock) {
          return;
        }

        const match = line.match(/^(#{1,3})\s+(.+)$/);
        if (match) {
          const level = match[1].length;
          const text = match[2].trim();
          const id = 'section-' + text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

          // Skip h1 headings (document title) - only show h2 and h3 in TOC
          if (level === 1) {
            return;
          }

          const tocItem: TocItem = {
            id,
            text,
            level,
            children: [],
            expanded: true // Changed from false to true to expand by default
          };

          // Set expanded state to true for all sections by default, but only if not already set
          if (expandedSections.value[id] === undefined) {
            expandedSections.value[id] = true;
          }

          // Adjust level for display (h2 becomes level 1, h3 becomes level 2)
          const displayLevel = level - 1;

          // Find the correct parent based on adjusted level
          while (stack.length > 0 && stack[stack.length - 1].level >= displayLevel) {
            stack.pop();
          }

          // Update the item with display level
          tocItem.level = displayLevel;

          if (stack.length === 0) {
            // Top level item
            toc.push(tocItem);
          } else {
            // Child item
            stack[stack.length - 1].children.push(tocItem);
          }

          stack.push(tocItem);
        }
      });

      return toc;
    };

    // Scroll to a section in the RCA report
    const scrollToSection = (id: string) => {
      // Use setTimeout to ensure DOM is ready
      setTimeout(() => {
        // Only search within RCA content areas (not left sidebar)
        const rcaContainers = Array.from(document.querySelectorAll('.rca-container'));
        let element: HTMLElement | null = null;
        let scrollContainer: Element | null = null;

        // Search for the element only within RCA containers
        for (const container of rcaContainers) {
          const foundElement = container.querySelector(`#${id}`) as HTMLElement;
          if (foundElement) {
            element = foundElement;
            scrollContainer = container;
            break;
          }
        }

        if (element && scrollContainer) {
          // Get the element's position relative to the scroll container
          const containerRect = scrollContainer.getBoundingClientRect();
          const elementRect = element.getBoundingClientRect();
          const relativeTop = elementRect.top - containerRect.top;
          const offsetPosition = scrollContainer.scrollTop + relativeTop - 20;

          // Scroll within the container with offset
          scrollContainer.scrollTo({
            top: offsetPosition,
            behavior: 'smooth'
          });
        }
      }, 50);
    };

    // Toggle section expansion in TOC
    const toggleSection = (item: TocItem, event?: Event) => {
      if (event) {
        event.stopPropagation();
      }
      // Create a new object to avoid triggering reactive updates during render
      expandedSections.value = {
        ...expandedSections.value,
        [item.id]: !expandedSections.value[item.id]
      };
    };

    const convertKeyValueListsToTables = (content: string): string => {
      // Pattern: Lists where items follow "**Key**: Value" or "- **Key**: Value" format
      // Convert these to markdown tables for better readability
      const lines = content.split('\n');
      const result: string[] = [];
      let i = 0;

      while (i < lines.length) {
        const line = lines[i];

        // Check if this line starts a key-value list pattern
        const isKeyValueItem = /^-\s+\*\*([^*]+)\*\*:\s*(.+)$/.test(line.trim());

        if (isKeyValueItem) {
          // Found a key-value list, collect all consecutive items
          const tableRows: Array<{ key: string; value: string }> = [];
          let j = i;

          while (j < lines.length) {
            const currentLine = lines[j].trim();
            const match = currentLine.match(/^-\s+\*\*([^*]+)\*\*:\s*(.+)$/);

            if (match) {
              tableRows.push({ key: match[1], value: match[2] });
              j++;
            } else if (currentLine === '' && j < lines.length - 1) {
              // Allow one blank line within the list
              const nextLine = lines[j + 1]?.trim();
              if (/^-\s+\*\*([^*]+)\*\*:\s*(.+)$/.test(nextLine)) {
                j++; // Skip the blank line
                continue;
              } else {
                break;
              }
            } else {
              break;
            }
          }

          // Convert to table if we have 3 or more items
          if (tableRows.length >= 3) {
            result.push(''); // Add blank line before table
            result.push('| Field | Value |');
            result.push('|-------|-------|');
            tableRows.forEach(row => {
              result.push(`| ${row.key} | ${row.value} |`);
            });
            result.push(''); // Add blank line after table
            i = j;
          } else {
            // Not enough items for a table, keep as list
            result.push(line);
            i++;
          }
        } else {
          result.push(line);
          i++;
        }
      }

      return result.join('\n');
    };

    const formatRcaContent = (content: string) => {
      // First, extract table of contents - only update if content changed
      const newToc = extractTableOfContents(content);
      if (JSON.stringify(newToc) !== JSON.stringify(tableOfContents.value)) {
        tableOfContents.value = newToc;
      }

      // Convert key-value lists to tables
      const processedContent = convertKeyValueListsToTables(content);

      // Configure marked with custom renderer using marked.use() extension API
      marked.use({
        renderer: {
          heading({ tokens, depth, text }: any) {
            // Parse inline tokens to get the heading text
            const parsedText = this.parser.parseInline(tokens);

            // Generate ID for heading - extract raw text from tokens first
            let rawText = '';
            if (tokens && Array.isArray(tokens)) {
              rawText = tokens.map((t: any) => {
                // Handle different token types
                if (t.type === 'text' && t.text) return t.text;
                if (t.raw) return t.raw;
                if (t.text) return t.text;
                return '';
              }).join('').trim();
            }

            // Fallback: extract plain text from parsed HTML using DOM
            if (!rawText) {
              const tempDiv = document.createElement('div');
              tempDiv.innerHTML = parsedText || '';
              rawText = (tempDiv.textContent || tempDiv.innerText || '').trim();
            }

            const id = 'section-' + rawText.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

            const classes = [
              'rca-h1 font-bold text-lg text-center mb-4 pb-2 border-b-2',
              // TODO: Discuss with team - h2 section separators with background and left border
              // Remove 'rca-section-bg px-4 py-3 rounded border-l-4 border-blue-600' if not approved
              'rca-h2 font-bold text-lg mt-5 mb-3 text-blue-600 rca-section-bg px-4 py-3 rounded border-l-4 border-blue-600',
              'rca-h3 font-semibold text-base mt-4 mb-2',
              'rca-h4 font-semibold text-sm mt-3 mb-2 text-gray-700',
            ];
            return `<div id="${id}" class="${classes[depth - 1] || ''}">${parsedText}</div>`;
          },
          code({ text }: any) {
            return `<div class="rca-code-block bg-gray-100 border border-gray-300 rounded p-3 my-3 overflow-x-auto"><pre class="text-sm font-mono whitespace-pre m-0"><code>${text}</code></pre></div>`;
          },
          codespan({ text }: any) {
            return `<code class="rca-inline-code bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono">${text}</code>`;
          },
          list(token: any) {
            const body = token.items.map((item: any) => this.listitem(item)).join('');
            const tag = token.ordered ? 'ol' : 'ul';
            const classes = token.ordered ? 'rca-ol pl-5 my-3 space-y-1.5 list-decimal' : 'rca-ul pl-5 my-3 space-y-1.5 list-disc';
            return `<${tag} class="${classes}">${body}</${tag}>`;
          },
          listitem(item: any) {
            const text = this.parser.parse(item.tokens);
            return `<li class="rca-list-item">${text}</li>`;
          },
          table(token: any) {
            let header = '<tr>';
            for (let i = 0; i < token.header.length; i++) {
              const cell = token.header[i];
              const content = this.parser.parseInline(cell.tokens);
              const cellClass = i === 0 ? 'rca-first-cell' : '';
              header += `<th class="px-3 py-2 text-left font-semibold text-sm text-[var(--color-table-header-text)] border-b border-[var(--color-table-header-border)] ${cellClass}">${content}</th>`;
            }
            header += '</tr>';

            let body = '';
            for (const row of token.rows) {
              body += '<tr class="hover:bg-[var(--color-table-row-hover-bg)]">';
              for (let i = 0; i < row.length; i++) {
                const cell = row[i];
                const content = this.parser.parseInline(cell.tokens);
                const cellClass = i === 0 ? 'rca-first-cell' : '';
                body += `<td class="px-3 py-2 text-sm border-b border-[var(--color-table-row-divider)] ${cellClass}">${content}</td>`;
              }
              body += '</tr>';
            }

            return `<div class="rca-table-wrapper my-4 overflow-x-auto"><table class="rca-table w-full border border-[var(--color-table-header-border)] rounded"><thead class="bg-[var(--color-table-header-bg)]">${header}</thead><tbody>${body}</tbody></table></div>`;
          },
          blockquote({ tokens }: any) {
            const text = this.parser.parse(tokens);
            return `<blockquote class="rca-blockquote border-l-4 border-blue-500 pl-4 py-2 my-3 bg-blue-50 italic">${text}</blockquote>`;
          },
          paragraph({ tokens }: any) {
            const text = this.parser.parseInline(tokens);
            return `<p class="mb-3">${text}</p>`;
          },
          strong({ tokens }: any) {
            const text = this.parser.parseInline(tokens);
            return `<strong class="font-semibold">${text}</strong>`;
          },
          em({ tokens }: any) {
            const text = this.parser.parseInline(tokens);
            return `<em class="italic">${text}</em>`;
          },
          hr() {
            return `<hr class="my-4 border-t border-gray-300" />`;
          },
        }
      });

      
      // Configure marked options
      marked.setOptions({
        gfm: true,
        breaks: false,
      });

      // Parse markdown
      const html = marked.parse(processedContent) as string;

      // Sanitize HTML to prevent XSS
      const sanitized = DOMPurify.sanitize(html, {
        ALLOWED_TAGS: ['h1', 'h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'strong', 'em', 'code', 'pre', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'blockquote', 'hr', 'div', 'span'],
        ALLOWED_ATTR: ['class', 'value', 'style', 'id'],
        ADD_ATTR: ['id'],
        KEEP_CONTENT: true,
        RETURN_TRUSTED_TYPE: false
      });

      // Wrap in container
      return `<div class="rca-report-content">${sanitized}</div>`;
    };

    const triggerRca = async () => {
      if (!incidentDetails.value) return;

      rcaLoading.value = true;
      rcaStreamContent.value = "";

      const org = store.state.selectedOrganization.identifier;

      try {
        const response = await incidentsService.triggerRca(org, incidentDetails.value.id);

        // Set the RCA content immediately
        rcaStreamContent.value = response.data.rca_content;

        toast({
          variant: "success",
          message: t("alerts.incidents.rcaCompleted"),
        });

        // Reload incident to get the saved RCA in topology context
        await loadDetails(incidentDetails.value.id);
      } catch (error: any) {
        console.error("Failed to trigger RCA:", error);
        rcaStreamContent.value = "";
        toast({
          variant: "error",
          message: error?.response?.data?.message || error?.message || "Failed to perform RCA analysis",
        });
      } finally {
        rcaLoading.value = false;
      }
    };

    // Humanize key_type for display
    const getCorrelationMethodLabel = (keyType: string) => {
      switch (keyType?.toLowerCase()) {
        case "primary":
          return t("alerts.incidents.correlatedByServiceDiscovery");
        case "secondary":
          return t("alerts.incidents.correlatedBySemanticGroups");
        case "alert_id":
          return t("alerts.incidents.correlatedByAlertId");
        default:
          return keyType || "Unknown";
      }
    };

    return {
      t,
      store,
      loading,
      updating,
      incidentDetails,
      triggers,
      alerts,
      selectedAlertIndex,
      rcaLoading,
      rcaStreamContent,
      hasExistingRca,
      analysisInFlight,
      isDarkMode,
      activeTab,
      timelineRefreshTrigger,
      tableOfContents,
      expandedSections,
      formattedRcaContent,
      correlationData,
      correlationMatchedSetId,
      correlationChipDimensions,
      correlationLoading,
      correlationError,
      hasCorrelatedData,
      hasAnyStreams,
      telemetryTimeRange,
      actualMatchedDimensions,
      availableDimensions,
      ftsFields,
      incidentContextData,
      affectedServicesCount,
      alertFrequency,
      getTriggerCountForAlert,
      uniqueAlertsMap,
      uniqueAlertsCount,
      sortedAlertsByTriggerCount,
      peakAlertRate,
      peakActivity,
      correlationType,
      correlationTooltip,
      alertActivityChartData,
      getSemanticGroupDisplayName,
      refreshCorrelation,
      close,
      handleSendToAiChat,
      acknowledgeIncident,
      resolveIncident,
      reopenIncident,
      isEditingTitle,
      editableTitle,
      titleInputRef,
      startTitleEdit,
      cancelTitleEdit,
      saveTitleEdit,
      triggerRca,
      scrollToSection,
      toggleSection,
      editableStatus,
      editableSeverity,
      statusOptions,
      severityOptions,
      handleStatusChange,
      handleSeverityChange,
      handleTriggerRowClick,
      getStatusLabel,
      getSeverityColorHex,
      formatPeriod,
      formatCustomConditions,
      formatTimestamp,
      formatTimestampUTC,
      getCorrelationMethodLabel,
      copyToClipboard,
      copiedField,
      calculateDuration,
      formatRcaContent,
      checkAnalysisInFlight,
      updateSeverity: handleSeverityChange,
    };
  },
});
</script>

<style>
/* Responsive scrolling */
.incident-details-column::-webkit-scrollbar,
.tabs-content-column .overflow-auto::-webkit-scrollbar {
  width: 6px;
}

.incident-details-column::-webkit-scrollbar-track,
.tabs-content-column .overflow-auto::-webkit-scrollbar-track {
  background: transparent;
}

.incident-details-column::-webkit-scrollbar-thumb,
.tabs-content-column .overflow-auto::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 3px;
}

body.body--dark .incident-details-column::-webkit-scrollbar-thumb,
body.body--dark .tabs-content-column .overflow-auto::-webkit-scrollbar-thumb {
  background: #475569;
}
</style>
