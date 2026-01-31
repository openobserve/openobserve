<!-- Copyright 2025 OpenObserve Inc.

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
  <q-page data-test="incident-detail-page" class="q-pa-none" style="height: calc(100vh - 50px); overflow: hidden;">
    <div class="tw:w-full tw:h-full tw:px-[0.625rem] q-mt-xs tw:pb-[0.625rem]">
    <!-- Header -->
    <div class="row items-center no-wrap card-container tw:py-[0.675rem] tw:h-[68px] tw:px-[0.675rem] tw:mb-[0.675rem]">
      <div class="flex items-center tw:gap-3 tw:flex-1">
        <div
          data-test="incident-detail-back-btn"
          class="flex justify-center items-center q-mr-md cursor-pointer"
          style="
            border: 1.5px solid;
            border-radius: 50%;
            width: 22px;
            height: 22px;
          "
          title="Go Back"
          @click="close"
        >
          <q-icon name="arrow_back_ios_new" size="14px" />
        </div>
        <div class="text-h6">
          Incident
        </div>
        <!-- Incident name with colored indicator -->
        <input
          v-if="incidentDetails && isEditingTitle"
          v-model="editableTitle"
          ref="titleInputRef"
          :class="[
            'tw:font-bold tw:px-2 tw:py-1 tw:rounded-md tw:outline-none tw:border-2',
            store.state.theme === 'dark'
              ? 'tw:text-blue-400 tw:bg-blue-900/50 tw:border-blue-500'
              : 'tw:text-blue-600 tw:bg-blue-50 tw:border-blue-400'
          ]"
          style="min-width: 300px; max-width: 500px;"
        />
        <span
          v-else-if="incidentDetails"
          :class="[
            'tw:font-bold tw:px-2 tw:py-1 tw:rounded-md tw:max-w-xs tw:truncate tw:inline-block',
            store.state.theme === 'dark'
              ? 'tw:text-blue-400 tw:bg-blue-900/50'
              : 'tw:text-blue-600 tw:bg-blue-50'
          ]"
          data-test="incident-detail-title"
        >
          {{ incidentDetails.title }}
          <q-tooltip v-if="incidentDetails && incidentDetails.title.length > 35" class="tw:text-sm">
            {{ incidentDetails.title }}
          </q-tooltip>
        </span>
      </div>

      <!-- Compact Status, Severity, Alerts badges at extreme right -->
      <div v-if="incidentDetails && !isEditingTitle" class="tw:flex tw:items-center tw:gap-2 tw:ml-auto">
        <!-- Status Badge -->
        <q-badge
          :color="getStatusColor(incidentDetails.status)"
          class="tw:px-2.5 tw:py-1.5 tw:cursor-default"
          style="height: 33px;"
          outline
        >
          <div class="tw:flex tw:items-center tw:gap-1.5">
            <q-icon name="info" size="14px" />
            <span>{{ getStatusLabel(incidentDetails.status) }}</span>
          </div>
          <q-tooltip :delay="200" class="tw:text-sm">
            {{ t("alerts.incidents.status") }}: {{ getStatusLabel(incidentDetails.status) }}
          </q-tooltip>
        </q-badge>

        <!-- Severity Badge -->
        <q-badge
          :style="{ color: getSeverityColorHex(incidentDetails.severity), height: '33px' }"
          class="tw:px-2.5 tw:py-1.5 tw:cursor-default"
          outline
        >
          <div class="tw:flex tw:items-center tw:gap-1.5">
            <q-icon name="warning" size="14px" />
            <span>{{ incidentDetails.severity }}</span>
          </div>
          <q-tooltip :delay="200" class="tw:text-sm">
            {{ t("alerts.incidents.severity") }}: {{ incidentDetails.severity }}
          </q-tooltip>
        </q-badge>

        <!-- Alert Count Badge -->
        <q-badge
          color="primary"
          class="tw:px-2.5 tw:py-1.5 tw:cursor-default"
          style="height: 33px;"
          outline
        >
          <div class="tw:flex tw:items-center tw:gap-1.5">
            <q-icon name="notifications_active" size="14px" />
            <span>{{ triggers.length }} Alerts</span>
          </div>
          <q-tooltip :delay="200" class="tw:text-sm">
            {{ t("alerts.incidents.alertCount") }}: {{ triggers.length }} correlated alerts
          </q-tooltip>
        </q-badge>
      </div>

      <!-- Save/Cancel buttons when editing -->
      <div v-if="incidentDetails && isEditingTitle" class="tw:flex tw:items-center tw:gap-2 tw:ml-auto">
         <q-btn
          no-caps
          @click="cancelTitleEdit"
          class="o2-secondary-button"
        >
          <span>Cancel</span>
        </q-btn>
        <q-btn
          no-caps
          @click="saveTitleEdit"
          class="o2-primary-button"
        >
          <span>Save</span>
        </q-btn>
      </div>

      <!-- Vertical Separator -->
      <div
        v-if="incidentDetails && !isEditingTitle"
        :class="[
          'tw:h-8 tw:w-px tw:mx-2',
          store.state.theme === 'dark' ? 'tw:bg-gray-600' : 'tw:bg-gray-300'
        ]"
      ></div>

      <!-- Action buttons at extreme right of header -->
      <div v-if="incidentDetails && !isEditingTitle" class="tw:flex tw:gap-2 tw:items-center">
        <q-btn
          v-if="incidentDetails.status === 'open'"
          no-caps
          unelevated
          @click="acknowledgeIncident"
          :loading="updating"
          class="o2-secondary-button"
        >
          <span>{{ t("alerts.incidents.acknowledge") }}</span>
          <q-tooltip :delay="500">Mark incident as acknowledged and being worked on</q-tooltip>
        </q-btn>
        <q-btn
          v-if="incidentDetails.status !== 'resolved'"
          no-caps
          unelevated
          @click="resolveIncident"
          :loading="updating"
          class="o2-secondary-button"
        >
          <span>{{ t("alerts.incidents.resolve") }}</span>
          <q-tooltip :delay="500">Mark incident as resolved and close it</q-tooltip>
        </q-btn>
        <q-btn
          v-if="incidentDetails.status === 'resolved'"
          no-caps
          unelevated
          @click="reopenIncident"
          :loading="updating"
          class="o2-secondary-button"
        >
          <q-icon name="refresh" size="16px" class="tw:mr-1" />
          <span>{{ t("alerts.incidents.reopen") }}</span>
          <q-tooltip :delay="500">Reopen this resolved incident</q-tooltip>
        </q-btn>

        <!-- Edit Title Button -->
        <q-btn
          no-caps
          flat
          @click="startTitleEdit"
          class="o2-secondary-button"
        >
          <span>Edit</span>
          <q-tooltip :delay="500">Edit incident title</q-tooltip>
        </q-btn>
      </div>
    </div>

    <!-- Content -->
    <div v-if="!loading && incidentDetails" class="card-container tw:flex tw:flex-col tw:overflow-hidden" style="height: calc(100vh - 130px);">
      <!-- Tabs (moved to top level) -->
      <div class="tw:flex-shrink-0 tw:px-4 tw:pt-3">
        <q-tabs
          v-model="activeTab"
          inline-label
          dense
          no-caps
          align="left"
          class="tw:flex-1"
          mobile-arrows
          outside-arrows
          :breakpoint="0"
        >
          <q-tab
            name="overview"
            label="Overview"
          />
          <q-tab
            name="incidentAnalysis"
            label="Incident Analysis"
          />
          <q-tab
            name="serviceGraph"
            label="Alert Graph"
          />
          <q-tab
            name="alertTriggers"
          >
            <template #default>
              <div class="tw:flex tw:items-center tw:gap-1.5">
                <span>Alert Triggers</span>
                <span class="tw:text-sm tw:opacity-70">({{ triggers.length }})</span>
              </div>
            </template>
          </q-tab>

          <!-- Telemetry tabs always inline -->
          <q-tab
            name="logs"
            :label="t('common.logs')"
          />
          <q-tab
            name="metrics"
            :label="t('search.metrics')"
          />
          <q-tab
            name="traces"
            :label="t('menu.traces')"
          />
        </q-tabs>
      </div>

      <!-- Tab Content Container -->
      <div class="tw:flex tw:flex-1 tw:overflow-hidden">
      <!-- Left Column: Incident Details (only show on Incident Analysis tab, HIDDEN for Overview) -->
      <div v-if="activeTab === 'incidentAnalysis'" class="incident-details-column tw:w-[400px] tw:flex-shrink-0 tw:flex tw:flex-col tw:h-full" style="order: 1;">

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
      <div class="tabs-content-column tw:flex-1 tw:flex tw:flex-col tw:overflow-hidden" style="order: 2;">
        <!-- Tab Content Area -->
        <div class="tw:flex-1 tw:flex tw:flex-col tw:px-2 tw:pt-4 tw:pb-2 tw:overflow-hidden tw:relative">

        <!-- Overview Tab Content - REDESIGNED -->
        <div v-if="activeTab === 'overview'" class="tw:flex tw:flex-col tw:flex-1 tw:overflow-hidden">
          <!-- SECTION 1: Hero Metrics (100px height) -->
          <div class="tw:flex tw:gap-3 tw:mb-3" style="height: 100px;">
            <!-- 1. Total Alerts Card -->
            <div
              class="tw:flex-1 tw:flex tw:flex-col tw:justify-between el-border el-border-radius o2-incident-card-bg tw:transition-all tw:duration-200 tw:cursor-pointer tw:p-3"
            >
              <!-- Top: Title and Icon -->
              <div class="tw:flex tw:justify-between tw:items-start">
                <div :class="store.state.theme === 'dark' ? 'tw:text-gray-300' : 'tw:text-gray-700'" class="tw:text-sm tw:font-medium">
                  Total Alerts
                </div>
                <div class="tw:w-8 tw:h-8 tw:rounded-lg tw:flex tw:items-center tw:justify-center" :class="store.state.theme === 'dark' ? 'tw:bg-amber-500/10' : 'tw:bg-amber-50'">
                  <q-icon name="bolt" :class="store.state.theme === 'dark' ? 'tw:text-amber-400' : 'tw:text-amber-600'" style="font-size: 20px;" />
                </div>
              </div>

              <!-- Bottom: Large Number -->
              <div :class="store.state.theme === 'dark' ? 'tw:text-white' : 'tw:text-gray-900'" class="tw:text-3xl tw:font-semibold tw:leading-none">
                {{ triggers.length }}
              </div>
            </div>

            <!-- 2. Unique Alerts Card -->
            <div
              class="tw:flex-1 tw:flex tw:flex-col tw:justify-between el-border el-border-radius o2-incident-card-bg tw:transition-all tw:duration-200 tw:cursor-pointer tw:p-3"
            >
              <!-- Top: Title and Icon -->
              <div class="tw:flex tw:justify-between tw:items-start">
                <div :class="store.state.theme === 'dark' ? 'tw:text-gray-300' : 'tw:text-gray-700'" class="tw:text-sm tw:font-medium">
                  Unique Alerts
                </div>
                <div class="tw:w-8 tw:h-8 tw:rounded-lg tw:flex tw:items-center tw:justify-center" :class="store.state.theme === 'dark' ? 'tw:bg-blue-500/10' : 'tw:bg-blue-50'">
                  <q-icon name="notifications_active" :class="store.state.theme === 'dark' ? 'tw:text-blue-400' : 'tw:text-blue-600'" style="font-size: 20px;" />
                </div>
              </div>

              <!-- Bottom: Large Number -->
              <div :class="store.state.theme === 'dark' ? 'tw:text-white' : 'tw:text-gray-900'" class="tw:text-3xl tw:font-semibold tw:leading-none">
                {{ incidentDetails?.alerts?.length || 0 }}
              </div>
            </div>

            <!-- 3. Affected Services Card -->
            <div
              class="tw:flex-1 tw:flex tw:flex-col tw:justify-between el-border el-border-radius o2-incident-card-bg tw:transition-all tw:duration-200 tw:cursor-pointer tw:p-3"
            >
              <!-- Top: Title and Icon -->
              <div class="tw:flex tw:justify-between tw:items-start">
                <div :class="store.state.theme === 'dark' ? 'tw:text-gray-300' : 'tw:text-gray-700'" class="tw:text-sm tw:font-medium">
                  Affected Services
                </div>
                <div class="tw:w-8 tw:h-8 tw:rounded-lg tw:flex tw:items-center tw:justify-center" :class="store.state.theme === 'dark' ? 'tw:bg-purple-500/10' : 'tw:bg-purple-50'">
                  <q-icon name="dns" :class="store.state.theme === 'dark' ? 'tw:text-purple-400' : 'tw:text-purple-600'" style="font-size: 20px;" />
                </div>
              </div>

              <!-- Bottom: Large Number -->
              <div :class="store.state.theme === 'dark' ? 'tw:text-white' : 'tw:text-gray-900'" class="tw:text-3xl tw:font-semibold tw:leading-none">
                {{ affectedServicesCount }}
              </div>
            </div>

            <!-- 4. Active Duration Card -->
            <div
              class="tw:flex-1 tw:flex tw:flex-col tw:justify-between el-border el-border-radius o2-incident-card-bg tw:transition-all tw:duration-200 tw:cursor-pointer tw:p-3"
            >
              <!-- Top: Title and Icon -->
              <div class="tw:flex tw:justify-between tw:items-start">
                <div :class="store.state.theme === 'dark' ? 'tw:text-gray-300' : 'tw:text-gray-700'" class="tw:text-sm tw:font-medium">
                  Active Duration
                </div>
                <div class="tw:w-8 tw:h-8 tw:rounded-lg tw:flex tw:items-center tw:justify-center" :class="store.state.theme === 'dark' ? 'tw:bg-green-500/10' : 'tw:bg-green-50'">
                  <q-icon name="schedule" :class="store.state.theme === 'dark' ? 'tw:text-green-400' : 'tw:text-green-600'" style="font-size: 20px;" />
                </div>
              </div>

              <!-- Bottom: Large Number -->
              <div :class="store.state.theme === 'dark' ? 'tw:text-white' : 'tw:text-gray-900'" class="tw:text-2xl tw:font-semibold tw:leading-none">
                {{ incidentDetails?.first_alert_at && incidentDetails?.last_alert_at
                   ? calculateDuration(incidentDetails.first_alert_at, incidentDetails.last_alert_at)
                   : 'N/A' }}
              </div>
            </div>

            <!-- 5. Alert Frequency Card -->
            <div
              class="tw:flex-1 tw:flex tw:flex-col tw:justify-between el-border el-border-radius o2-incident-card-bg tw:transition-all tw:duration-200 tw:cursor-pointer tw:p-3"
            >
              <!-- Top: Title and Icon -->
              <div class="tw:flex tw:justify-between tw:items-start">
                <div :class="store.state.theme === 'dark' ? 'tw:text-gray-300' : 'tw:text-gray-700'" class="tw:text-sm tw:font-medium">
                  Alert Frequency
                </div>
                <div class="tw:w-8 tw:h-8 tw:rounded-lg tw:flex tw:items-center tw:justify-center" :class="store.state.theme === 'dark' ? 'tw:bg-rose-500/10' : 'tw:bg-rose-50'">
                  <q-icon name="show_chart" :class="store.state.theme === 'dark' ? 'tw:text-rose-400' : 'tw:text-rose-600'" style="font-size: 20px;" />
                </div>
              </div>

              <!-- Bottom: Large Text -->
              <div :class="store.state.theme === 'dark' ? 'tw:text-white' : 'tw:text-gray-900'" class="tw:text-lg tw:font-semibold tw:leading-tight">
                {{ alertFrequency }}
              </div>
            </div>
          </div>

          <!-- SECTION 2: Main Content (2:1 Ratio Layout) with calc(100vh - 236px) height (was 276px) -->
          <div class="tw:flex tw:gap-3 tw:flex-1" style="height: calc(100vh - 380px);">
            <!-- PART 1: Primary Content (66.67% width) -->
            <div class="tw:flex tw:flex-col tw:gap-3" style="width: 66.67%;">
                <!-- 2.1A: Top Row - Incident Details (2/3) + Incident Timeline (1/3) -->
              <div class="tw:flex tw:gap-3" style="height: 50%;">
                               <!-- Incident Timeline (33.33% width) -->
                <div
                  class="el-border el-border-radius o2-incident-card-bg tw:flex tw:flex-col tw:overflow-hidden"
                  :style="{
                    width: '33.33%'
                  }"
                >
                  <!-- Header -->
                  <div class="tw:flex tw:items-center tw:justify-between tw:px-4 tw:py-3">
                    <div :class="store.state.theme === 'dark' ? 'tw:text-gray-200' : 'tw:text-gray-900'" class="tw:text-sm tw:font-semibold">
                      Incident Timeline
                    </div>
                    <div
                      class="tw:px-2 tw:py-0.5 tw:rounded tw:text-xs tw:font-medium"
                      :style="{
                        backgroundColor: store.state.theme === 'dark' ? '#3A3B3C' : '#E5E7EB',
                        color: store.state.theme === 'dark' ? '#9CA3AF' : '#6B7280'
                      }"
                    >
                      UTC
                    </div>
                  </div>

                  <!-- Content with vertical timeline -->
                  <div class="tw:flex tw:flex-col tw:gap-6 tw:p-4 tw:overflow-y-auto tw:relative">
                    <!-- Vertical line -->
                    <div
                      class="tw:absolute tw:w-0.5"
                      :style="{
                        left: '21px',
                        top: '21px',
                        bottom: '21px',
                        backgroundColor: store.state.theme === 'dark' ? '#444444' : '#E7EAEE'
                      }"
                    ></div>

                    <!-- First Alert Received -->
                    <div class="tw:flex tw:items-start tw:gap-3 tw:relative">
                      <div
                        class="tw:w-2.5 tw:h-2.5 tw:rounded-full tw:flex-shrink-0 tw:z-10 tw:mt-2"
                        :style="{
                          backgroundColor: '#10B981'
                        }"
                      ></div>
                      <div class="tw:flex-1">
                        <div :class="store.state.theme === 'dark' ? 'tw:text-gray-200' : 'tw:text-gray-900'" class="tw:text-sm tw:font-medium tw:mb-1">
                          First Alert Received
                        </div>
                        <div :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-600'" class="tw:text-xs">
                          {{ incidentDetails?.first_alert_at ? formatTimestampUTC(incidentDetails.first_alert_at) : 'N/A' }}
                          <span :class="store.state.theme === 'dark' ? 'tw:text-gray-500' : 'tw:text-gray-400'" class="tw:mx-1.5">|</span>
                          <span>Initial trigger</span>
                        </div>
                      </div>
                    </div>

                    <!-- Peak Activity (if available) -->
                    <div v-if="peakActivity" class="tw:flex tw:items-start tw:gap-3 tw:relative">
                      <div
                        class="tw:w-2.5 tw:h-2.5 tw:rounded-full tw:flex-shrink-0 tw:z-10 tw:mt-2"
                        :style="{
                          backgroundColor: '#F59E0B'
                        }"
                      ></div>
                      <div class="tw:flex-1">
                        <div :class="store.state.theme === 'dark' ? 'tw:text-gray-200' : 'tw:text-gray-900'" class="tw:text-sm tw:font-medium tw:mb-1">
                          Peak Activity
                        </div>
                        <div :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-600'" class="tw:text-xs">
                          {{ peakActivity.timestamp ? formatTimestampUTC(peakActivity.timestamp) : 'N/A' }}
                          <span :class="store.state.theme === 'dark' ? 'tw:text-gray-500' : 'tw:text-gray-400'" class="tw:mx-1.5">|</span>
                          <span>{{ peakActivity.count }} alerts in 5 mins</span>
                        </div>
                      </div>
                    </div>

                    <!-- Latest Alert -->
                    <div class="tw:flex tw:items-start tw:gap-3 tw:relative">
                      <div
                        class="tw:w-2.5 tw:h-2.5 tw:rounded-full tw:flex-shrink-0 tw:z-10 tw:mt-2"
                        :style="{
                          backgroundColor: incidentDetails?.status === 'resolved' ? '#10B981' : '#EF4444'
                        }"
                      ></div>
                      <div class="tw:flex-1">
                        <div :class="store.state.theme === 'dark' ? 'tw:text-gray-200' : 'tw:text-gray-900'" class="tw:text-sm tw:font-medium tw:mb-1">
                          Latest Alert
                        </div>
                        <div :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-600'" class="tw:text-xs">
                          {{ incidentDetails?.last_alert_at ? formatTimestampUTC(incidentDetails.last_alert_at) : 'N/A' }}
                          <span :class="store.state.theme === 'dark' ? 'tw:text-gray-500' : 'tw:text-gray-400'" class="tw:mx-1.5">|</span>
                          <span>{{ incidentDetails?.status === 'resolved' ? 'Resolved' : 'Still ongoing' }}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <!-- Incident Details (66.67% width) -->
                <div
                  class="el-border el-border-radius o2-incident-card-bg tw:flex tw:flex-col tw:overflow-hidden"
                  :style="{
                    width: '66.67%'
                  }"
                >
                  <!-- Header -->
                  <div class="tw:px-4 tw:pt-2 tw:pb-1">
                    <div :class="store.state.theme === 'dark' ? 'tw:text-gray-200' : 'tw:text-gray-900'" class="tw:text-sm tw:font-semibold">
                      Incident Details
                    </div>
                  </div>

                  <!-- Content -->
                  <div class="tw:flex tw:flex-col tw:gap-3 tw:p-4 tw:overflow-y-auto">
                    <!-- Incident ID -->
                    <div class="tw:grid tw:gap-2" style="grid-template-columns: 120px 1fr;">
                      <div :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-600'" class="tw:text-xs tw:font-medium">
                        Incident ID
                      </div>
                      <div
                        class="tw:flex tw:items-center tw:gap-2 tw:px-2.5 tw:py-1 tw:rounded tw:border tw:text-xs tw:font-mono tw:min-w-0"
                        :style="{
                          backgroundColor: store.state.theme === 'dark' ? '#1F2021' : '#F9FAFB',
                          borderColor: store.state.theme === 'dark' ? '#444444' : '#E7EAEE',
                          color: store.state.theme === 'dark' ? '#E5E7EB' : '#374151'
                        }"
                      >
                        <span class="tw:truncate tw:flex-1 tw:min-w-0">{{ incidentDetails?.id || 'N/A' }}</span>
                        <q-icon
                          :name="copiedField === 'incident_id' ? 'check' : 'content_copy'"
                          :class="copiedField === 'incident_id' ? 'tw:text-green-500' : 'tw:opacity-60 hover:tw:opacity-100 hover:tw:text-blue-500'"
                          class="tw:cursor-pointer tw:transition-all tw:flex-shrink-0"
                          style="font-size: 14px; cursor: pointer;"
                          @click="copyToClipboard(incidentDetails?.id, 'incident_id')"
                        />
                      </div>
                    </div>

                    <!-- Incident Name -->
                    <div class="tw:grid tw:gap-2" style="grid-template-columns: 120px 1fr;">
                      <div :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-600'" class="tw:text-xs tw:font-medium">
                        Incident Name
                      </div>
                      <div
                        class="tw:flex tw:items-center tw:gap-2 tw:px-2.5 tw:py-1 tw:rounded tw:border tw:text-xs tw:min-w-0"
                        :style="{
                          backgroundColor: store.state.theme === 'dark' ? '#1F2021' : '#F9FAFB',
                          borderColor: store.state.theme === 'dark' ? '#444444' : '#E7EAEE',
                          color: store.state.theme === 'dark' ? '#E5E7EB' : '#374151'
                        }"
                      >
                        <span class="tw:truncate tw:flex-1 tw:min-w-0">{{ incidentDetails?.title || 'N/A' }}</span>
                        <q-icon
                          :name="copiedField === 'incident_title' ? 'check' : 'content_copy'"
                          :class="copiedField === 'incident_title' ? 'tw:text-green-500' : 'tw:opacity-60 hover:tw:opacity-100 hover:tw:text-blue-500'"
                          class="tw:cursor-pointer tw:transition-all tw:flex-shrink-0"
                          style="font-size: 14px; cursor: pointer;"
                          @click="copyToClipboard(incidentDetails?.title, 'incident_title')"
                        />
                      </div>
                    </div>

                    <!-- Correlation Key -->
                    <div class="tw:grid tw:gap-2" style="grid-template-columns: 120px 1fr;">
                      <div :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-600'" class="tw:text-xs tw:font-medium">
                        Correlation Key
                      </div>
                      <div
                        class="tw:flex tw:items-center tw:gap-2 tw:px-2.5 tw:py-1 tw:rounded tw:border tw:text-xs tw:font-mono tw:min-w-0"
                        :style="{
                          backgroundColor: store.state.theme === 'dark' ? '#1F2021' : '#F9FAFB',
                          borderColor: store.state.theme === 'dark' ? '#444444' : '#E7EAEE',
                          color: store.state.theme === 'dark' ? '#E5E7EB' : '#374151'
                        }"
                      >
                        <span class="tw:truncate tw:flex-1 tw:min-w-0">{{ incidentDetails?.correlation_key || 'N/A' }}</span>
                        <q-icon
                          :name="copiedField === 'correlation_key' ? 'check' : 'content_copy'"
                          :class="copiedField === 'correlation_key' ? 'tw:text-green-500' : 'tw:opacity-60 hover:tw:opacity-100 hover:tw:text-blue-500'"
                          class="tw:cursor-pointer tw:transition-all tw:flex-shrink-0"
                          style="font-size: 14px; cursor: pointer;"
                          @click="copyToClipboard(incidentDetails?.correlation_key, 'correlation_key')"
                        />
                      </div>
                    </div>

                    <!-- Created At -->
                    <div class="tw:grid tw:gap-2" style="grid-template-columns: 120px 1fr;">
                      <div :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-600'" class="tw:text-xs tw:font-medium">
                        Created At
                      </div>
                      <div :class="store.state.theme === 'dark' ? 'tw:text-gray-200' : 'tw:text-gray-900'" class="tw:text-sm">
                        {{ incidentDetails?.created_at ? formatTimestamp(incidentDetails.created_at) : 'N/A' }}
                      </div>
                    </div>

                    <!-- Updated At -->
                    <div class="tw:grid tw:gap-2" style="grid-template-columns: 120px 1fr;">
                      <div :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-600'" class="tw:text-xs tw:font-medium">
                        Updated At
                      </div>
                      <div :class="store.state.theme === 'dark' ? 'tw:text-gray-200' : 'tw:text-gray-900'" class="tw:text-sm">
                        {{ incidentDetails?.updated_at ? formatTimestamp(incidentDetails.updated_at) : 'N/A' }}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
                <!-- alert activity -->
               <!-- 2.1B: Alert Activity Chart (50% height, full width) -->
              <div
                class="el-border el-border-radius o2-incident-card-bg tw:flex tw:flex-col tw:overflow-hidden"
                :style="{
                  height: '50%'
                }"
              >
                <!-- Header -->
                <div class="tw:px-4 tw:pt-2 tw:pb-1">
                  <div
                    :class="store.state.theme === 'dark' ? 'tw:text-gray-200' : 'tw:text-gray-900'"
                    class="tw:text-sm tw:font-semibold"
                  >
                    Alert Activity
                  </div>
                </div>

                <!-- Chart Content -->
                <div class="tw:flex-1 tw:overflow-hidden tw:p-2">
                  <CustomChartRenderer
                    v-if="alertActivityChartData"
                    :data="alertActivityChartData"
                    class="tw:w-full tw:h-full"
                  />
                </div>
              </div>

            </div>

            <!-- PART 2: Sidebar Content (33.33% width) - 3 sections -->
            <div class="tw:flex tw:flex-col tw:gap-2" style="width: 33.33%; height: 100%;">
              <!-- 2.2A: Manage Panel (40% of available height after gaps) -->
              <div
                class="el-border el-border-radius o2-incident-card-bg tw:flex tw:flex-col tw:overflow-hidden"
                :style="{
                  height: 'calc(35% - 6.4px)'
                }"
              >
                <!-- Header -->
                <div class="tw:px-4 tw:pt-2 tw:pb-1">
                  <div
                    :class="store.state.theme === 'dark' ? 'tw:text-gray-200' : 'tw:text-gray-900'"
                    class="tw:text-sm tw:font-semibold"
                  >
                    Manage
                  </div>
                </div>

                <!-- Content -->
                <div class="tw:flex tw:flex-col tw:gap-3 tw:p-3 tw:overflow-y-auto">
                  <!-- Status Section -->
                  <div class="tw:flex tw:flex-col tw:gap-2">
                    <div
                      :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-600'"
                      class="tw:text-xs tw:font-semibold"
                    >
                      Status
                    </div>
                    <div class="tw:flex tw:gap-2 tw:flex-wrap">
                      <div
                        v-for="option in statusOptions"
                        :key="option.value"
                        @click="editableStatus !== option.value && handleStatusChange(option.value as 'open' | 'acknowledged' | 'resolved')"
                        class="tw:px-3 tw:py-1.5 tw:rounded-md tw:text-xs tw:font-medium tw:transition-all tw:border"
                        :class="editableStatus === option.value ? '' : 'tw:cursor-pointer'"
                        :style="{
                          backgroundColor: editableStatus === option.value
                            ? (option.value === 'open' ? 'rgba(239, 68, 68, 0.1)' : option.value === 'acknowledged' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(16, 185, 129, 0.1)')
                            : (store.state.theme === 'dark' ? '#2A2B2C' : '#FFFFFF'),
                          color: editableStatus === option.value
                            ? (option.value === 'open' ? '#EF4444' : option.value === 'acknowledged' ? '#F59E0B' : '#10B981')
                            : (store.state.theme === 'dark' ? '#E5E7EB' : '#111827'),
                          borderColor: editableStatus === option.value
                            ? (option.value === 'open' ? '#EF4444' : option.value === 'acknowledged' ? '#F59E0B' : '#10B981')
                            : (store.state.theme === 'dark' ? '#444444' : '#D1D5DB')
                        }"
                      >
                        {{ option.label }}
                      </div>
                    </div>
                  </div>

                  <!-- Severity Section -->
                  <div class="tw:flex tw:flex-col tw:gap-2">
                    <div
                      :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-600'"
                      class="tw:text-xs tw:font-semibold"
                    >
                      Severity
                    </div>
                    <div class="tw:flex tw:gap-2 tw:flex-wrap">
                      <div
                        v-for="option in severityOptions"
                        :key="option.value"
                        @click="editableSeverity !== option.value && handleSeverityChange(option.value as 'P1' | 'P2' | 'P3' | 'P4')"
                        class="tw:px-3 tw:py-1.5 tw:rounded-md tw:text-xs tw:font-medium tw:transition-all tw:border"
                        :class="editableSeverity === option.value ? '' : 'tw:cursor-pointer'"
                        :style="{
                          backgroundColor: editableSeverity === option.value
                            ? (option.value === 'P1' ? 'rgba(220, 38, 38, 0.1)' : option.value === 'P2' ? 'rgba(249, 115, 22, 0.1)' : option.value === 'P3' ? 'rgba(251, 146, 60, 0.1)' : 'rgba(59, 130, 246, 0.1)')
                            : (store.state.theme === 'dark' ? '#2A2B2C' : '#FFFFFF'),
                          color: editableSeverity === option.value
                            ? (option.value === 'P1' ? '#DC2626' : option.value === 'P2' ? '#F97316' : option.value === 'P3' ? '#FB923C' : '#3B82F6')
                            : (store.state.theme === 'dark' ? '#E5E7EB' : '#111827'),
                          borderColor: editableSeverity === option.value
                            ? (option.value === 'P1' ? '#DC2626' : option.value === 'P2' ? '#F97316' : option.value === 'P3' ? '#FB923C' : '#3B82F6')
                            : (store.state.theme === 'dark' ? '#444444' : '#D1D5DB')
                        }"
                      >
                        {{ option.label }}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 2.2B: Dimensions Panel (35% when Alert Flow present, 60% when absent) -->
              <div
                class="el-border el-border-radius o2-incident-card-bg tw:flex tw:flex-col tw:overflow-hidden"
                :style="{
                  height: incidentDetails?.topology_context?.nodes?.length
                    ? 'calc(35% - 5.6px)'
                    : 'calc(65% - 8px)',
                  minHeight: 0,
                  flexShrink: 0
                }"
              >
                <!-- Header -->
                <div class="tw:px-4 tw:pt-2 tw:pb-1">
                  <div
                    :class="store.state.theme === 'dark' ? 'tw:text-gray-200' : 'tw:text-gray-900'"
                    class="tw:text-sm tw:font-semibold"
                  >
                    Dimensions
                  </div>
                </div>

                <!-- Content -->
                <div class="tw:flex tw:flex-col tw:p-3 tw:overflow-y-auto tw:gap-0 tw:flex-1" style="min-height: 0;">
                  <div
                    v-if="incidentDetails?.stable_dimensions && Object.keys(incidentDetails.stable_dimensions).length > 0"
                    class="tw:flex tw:flex-col"
                  >
                    <div
                      v-for="(value, key) in incidentDetails.stable_dimensions"
                      :key="key"
                      class="tw:py-2.5 tw:border-b tw:flex tw:gap-2"
                      :style="{
                        borderColor: store.state.theme === 'dark' ? '#444444' : '#E7EAEE'
                      }"
                      :class="{ 'tw:border-b-0': key === Object.keys(incidentDetails.stable_dimensions)[Object.keys(incidentDetails.stable_dimensions).length - 1] }"
                    >
                      <div
                        :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-600'"
                        class="tw:text-xs tw:font-medium tw:capitalize tw:min-w-fit"
                      >
                        {{ key }}:
                      </div>
                      <div
                        :class="store.state.theme === 'dark' ? 'tw:text-gray-200' : 'tw:text-gray-900'"
                        class="tw:text-xs tw:break-words tw:flex-1"
                      >
                        {{ value }}
                      </div>
                    </div>
                  </div>
                  <div
                    v-else
                    :class="store.state.theme === 'dark' ? 'tw:text-gray-500' : 'tw:text-gray-400'"
                    class="tw:text-sm tw:italic tw:text-center tw:py-4"
                  >
                    No dimensions available
                  </div>
                </div>
              </div>

              <!-- 2.2C: Alert Flow Panel (25% of available height after gaps) - Conditional -->
              <div
                v-if="sortedAlertsByTriggerCount?.length"
                class="el-border el-border-radius o2-incident-card-bg tw:flex tw:flex-col tw:overflow-hidden"
                :style="{
                  height: 'calc(30% - 4px)'
                }"
              >
                <!-- Header -->
                <div class="tw:px-4 tw:pt-2 tw:pb-1">
                  <div
                    :class="store.state.theme === 'dark' ? 'tw:text-gray-200' : 'tw:text-gray-900'"
                    class="tw:text-sm tw:font-semibold"
                  >
                    Related Alerts
                  </div>
                </div>

                <!-- Content - Vertical list -->
                <div class="tw:px-3 tw:pb-3 tw:overflow-y-auto tw:flex-1" style="min-height: 0;">
                  <div class="tw:flex tw:flex-col tw:gap-0">
                    <div
                      v-for="(alert, index) in sortedAlertsByTriggerCount"
                      :key="alert.id"
                      class="tw:py-2.5 tw:border-b"
                      :style="{
                        borderColor: store.state.theme === 'dark' ? '#444444' : '#E7EAEE'
                      }"
                      :class="{ 'tw:border-b-0': index === sortedAlertsByTriggerCount.length - 1 }"
                    >
                      <div
                        :class="store.state.theme === 'dark' ? 'tw:text-gray-200' : 'tw:text-gray-900'"
                        class="tw:text-sm tw:flex tw:gap-2 tw:items-center"
                      >
                        <span
                          :class="store.state.theme === 'dark' ? 'tw:text-gray-500' : 'tw:text-gray-400'"
                          class="tw:font-medium tw:flex-shrink-0"
                        >
                          {{ index + 1 }}.
                        </span>
                        <div class="tw:flex-1 tw:min-w-0">
                          <q-tooltip v-if="alert.name.length > 30">
                            {{ alert.name }}
                          </q-tooltip>
                          <span class="tw:font-medium tw:truncate tw:block">
                            {{ alert.name.length > 30 ? alert.name.substring(0, 30) + '...' : alert.name }}
                          </span>
                        </div>
                        <div class="tw:flex-shrink-0" style="width: 120px;">
                          <span
                            :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-600'"
                          >
                            Fired {{ getTriggerCountForAlert(alert.id) }} time(s)
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

        <!-- Incident Analysis Tab Content -->
        <IncidentRCAAnalysis
          v-if="activeTab === 'incidentAnalysis'"
          :has-existing-rca="hasExistingRca"
          :rca-loading="rcaLoading"
          :rca-stream-content="rcaStreamContent"
          :formatted-rca-content="formattedRcaContent"
          :is-dark-mode="isDarkMode"
          @trigger-rca="triggerRca"
        />

        <!-- Service Graph Tab Content -->
        <div v-if="activeTab === 'serviceGraph'" class="tw:absolute tw:inset-0">
          <IncidentServiceGraph
            v-if="incidentDetails"
            :topology-context="incidentDetails.topology_context"
          />
        </div>

        <!-- Alert Triggers Tab Content -->
        <div v-if="activeTab === 'alertTriggers'" class="tw:flex tw:flex-1 tw:overflow-hidden">
          <!-- Left Section: Alert Triggers Table -->
          <div class="tw:flex-1 tw:flex tw:flex-col tw:overflow-hidden tw:pr-2 tw:pt-4">
            <div
              :class="[
                'section-container tw:overflow-hidden tw:flex tw:flex-col tw:flex-1'
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
          <div class="tw:w-[400px] tw:flex-shrink-0 tw:flex tw:flex-col tw:pt-4">
            <div
              :class="[
                'section-container tw:overflow-hidden tw:flex tw:flex-col tw:flex-1'
              ]"
            >
              <!-- Header -->
              <div
                :class="[
                  'section-header-bg tw:px-3 tw:py-2 tw:flex tw:items-center tw:gap-2 tw:border-b tw:flex-shrink-0',
                  store.state.theme === 'dark'
                    ? 'tw:border-gray-700'
                    : 'tw:border-gray-200'
                ]"
              >
                <q-icon name="info" size="16px" class="tw:opacity-80" />
                <span :class="store.state.theme === 'dark' ? 'tw:text-gray-300' : 'tw:text-gray-700'" class="tw:text-sm tw:font-semibold">
                  Alert Details
                </span>
              </div>
              <!-- Content -->
              <div class="tw:p-3 tw:flex-1 tw:overflow-auto">
                <!-- No alerts available -->
                <div v-if="!alerts || alerts.length === 0" :class="store.state.theme === 'dark' ? 'tw:text-gray-500' : 'tw:text-gray-400'" class="tw:text-sm tw:italic">
                  No alert details available
                </div>

                <!-- No trigger selected -->
                <div v-else-if="selectedAlertIndex === -1" :class="store.state.theme === 'dark' ? 'tw:text-gray-500' : 'tw:text-gray-400'" class="tw:text-sm tw:italic tw:text-center tw:mt-8">
                  Click on a trigger in the table to view details
                </div>

                <!-- Alert details -->
                <div v-else class="tw:flex tw:flex-col tw:gap-3">
                  <!-- Alert Configuration Section -->
                  <div class="tw:space-y-2">
                      <!-- Alert Name -->
                      <div class="tw:flex tw:flex-col tw:gap-0.5">
                        <span :class="store.state.theme === 'dark' ? 'tw:text-gray-500' : 'tw:text-gray-500'" class="tw:text-[10px] tw:uppercase tw:tracking-wide">
                          Alert Name
                        </span>
                        <span :class="store.state.theme === 'dark' ? 'tw:text-gray-200' : 'tw:text-gray-800'" class="tw:text-sm tw:font-medium">
                          {{ alerts[selectedAlertIndex]?.name || 'N/A' }}
                        </span>
                      </div>

                      <!-- Stream Type & Name -->
                      <div class="tw:grid tw:grid-cols-2 tw:gap-2">
                        <div class="tw:flex tw:flex-col tw:gap-0.5">
                          <span :class="store.state.theme === 'dark' ? 'tw:text-gray-500' : 'tw:text-gray-500'" class="tw:text-[10px] tw:uppercase tw:tracking-wide">
                            Stream Type
                          </span>
                          <q-badge :color="alerts[selectedAlertIndex]?.stream_type === 'logs' ? 'blue' : alerts[selectedAlertIndex]?.stream_type === 'metrics' ? 'purple' : 'teal'" outline class="tw:w-fit">
                            <span class="tw:text-[10px]">{{ alerts[selectedAlertIndex]?.stream_type || 'N/A' }}</span>
                          </q-badge>
                        </div>
                        <div class="tw:flex tw:flex-col tw:gap-0.5">
                          <span :class="store.state.theme === 'dark' ? 'tw:text-gray-500' : 'tw:text-gray-500'" class="tw:text-[10px] tw:uppercase tw:tracking-wide">
                            Stream Name
                          </span>
                          <span :class="store.state.theme === 'dark' ? 'tw:text-gray-200' : 'tw:text-gray-800'" class="tw:text-sm tw:font-medium tw:truncate">
                            {{ alerts[selectedAlertIndex]?.stream_name || 'N/A' }}
                          </span>
                        </div>
                      </div>

                      <!-- Threshold & Period -->
                      <div class="tw:grid tw:grid-cols-2 tw:gap-2">
                        <div class="tw:flex tw:flex-col tw:gap-0.5">
                          <span :class="store.state.theme === 'dark' ? 'tw:text-gray-500' : 'tw:text-gray-500'" class="tw:text-[10px] tw:uppercase tw:tracking-wide">
                            Threshold
                          </span>
                          <span :class="store.state.theme === 'dark' ? 'tw:text-gray-200' : 'tw:text-gray-800'" class="tw:text-sm tw:font-medium">
                            {{ alerts[selectedAlertIndex]?.trigger_condition?.operator || '' }} {{ alerts[selectedAlertIndex]?.trigger_condition?.threshold || 'N/A' }}
                          </span>
                        </div>
                        <div class="tw:flex tw:flex-col tw:gap-0.5">
                          <span :class="store.state.theme === 'dark' ? 'tw:text-gray-500' : 'tw:text-gray-500'" class="tw:text-[10px] tw:uppercase tw:tracking-wide">
                            Period
                          </span>
                          <span :class="store.state.theme === 'dark' ? 'tw:text-gray-200' : 'tw:text-gray-800'" class="tw:text-sm tw:font-medium">
                            {{ formatPeriod(alerts[selectedAlertIndex]?.trigger_condition?.period) }}
                          </span>
                        </div>
                      </div>

                      <!-- Frequency & Silence -->
                      <div class="tw:grid tw:grid-cols-2 tw:gap-2">
                        <div class="tw:flex tw:flex-col tw:gap-0.5">
                          <span :class="store.state.theme === 'dark' ? 'tw:text-gray-500' : 'tw:text-gray-500'" class="tw:text-[10px] tw:uppercase tw:tracking-wide">
                            Frequency
                          </span>
                          <span :class="store.state.theme === 'dark' ? 'tw:text-gray-200' : 'tw:text-gray-800'" class="tw:text-sm tw:font-medium">
                            {{ alerts[selectedAlertIndex]?.trigger_condition?.frequency || 'N/A' }} {{ alerts[selectedAlertIndex]?.trigger_condition?.frequency_type || 'min' }}
                          </span>
                        </div>
                        <div class="tw:flex tw:flex-col tw:gap-0.5">
                          <span :class="store.state.theme === 'dark' ? 'tw:text-gray-500' : 'tw:text-gray-500'" class="tw:text-[10px] tw:uppercase tw:tracking-wide">
                            Silence
                          </span>
                          <span :class="store.state.theme === 'dark' ? 'tw:text-gray-200' : 'tw:text-gray-800'" class="tw:text-sm tw:font-medium">
                            {{ alerts[selectedAlertIndex]?.trigger_condition?.silence || 'N/A' }} min
                          </span>
                        </div>
                      </div>
                  </div>

                  <!-- Alert Conditions Section -->
                  <div :class="['tw:rounded tw:border tw:flex tw:flex-col section-container',]" class="tw:overflow-hidden" style="height: 392px;">
                    <div :class="['section-header-bg tw:px-2.5 tw:py-1.5 tw:border-b tw:flex tw:items-center tw:justify-between tw:flex-shrink-0', store.state.theme === 'dark' ? 'tw:border-gray-700' : 'tw:border-gray-200']">
                      <span :class="store.state.theme === 'dark' ? 'tw:text-gray-300' : 'tw:text-gray-700'" class="tw:text-[11px] tw:font-semibold tw:uppercase tw:tracking-wide">
                        {{ alerts[selectedAlertIndex]?.query_condition?.type === 'sql' ? 'SQL Query' : alerts[selectedAlertIndex]?.query_condition?.type === 'promql' ? 'PromQL Query' : 'Conditions' }}
                      </span>
                    </div>
                    <div class="tw:p-2.5 tw:overflow-y-auto tw:flex-1">
                      <!-- SQL Query -->
                      <div v-if="alerts[selectedAlertIndex]?.query_condition?.sql">
                        <pre :class="['tw:text-[10px] tw:overflow-x-auto tw:whitespace-pre-wrap tw:break-words', store.state.theme === 'dark' ? 'tw:text-gray-300' : 'tw:text-gray-800']">{{ alerts[selectedAlertIndex]?.query_condition?.sql }}</pre>
                      </div>

                      <!-- PromQL Query -->
                      <div v-else-if="alerts[selectedAlertIndex]?.query_condition?.promql">
                        <pre :class="['tw:text-[10px] tw:overflow-x-auto tw:whitespace-pre-wrap tw:break-words', store.state.theme === 'dark' ? 'tw:text-gray-300' : 'tw:text-gray-800']">{{ alerts[selectedAlertIndex]?.query_condition?.promql }}</pre>
                      </div>

                      <!-- Custom Conditions -->
                      <div v-else-if="alerts[selectedAlertIndex]?.query_condition?.conditions">
                        <pre :class="['tw:text-[10px] tw:overflow-x-auto tw:whitespace-pre-wrap tw:break-words', store.state.theme === 'dark' ? 'tw:text-gray-300' : 'tw:text-gray-800']">if {{ formatCustomConditions(alerts[selectedAlertIndex]?.query_condition?.conditions) }}</pre>
                      </div>

                      <!-- No conditions -->
                      <div v-else :class="store.state.theme === 'dark' ? 'tw:text-gray-500' : 'tw:text-gray-400'" class="tw:text-sm tw:italic">
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
        <div v-if="activeTab === 'logs'" class="tw-flex tw-flex-col tw-flex-1 tw-overflow-hidden">
          <!-- Refresh Button (shown when data is loaded) -->
          <div v-if="hasCorrelatedData && !correlationLoading" class="tw-px-4 tw-py-2 tw-border-b tw-border-solid tw-border-[var(--o2-border-color)] tw-flex tw-items-center tw-justify-between">
            <span class="tw-text-xs tw-text-gray-500">Showing correlated logs from incident timeframe</span>
            <q-btn
              flat
              dense
              size="sm"
              icon="refresh"
              color="primary"
              @click="refreshCorrelation"
              :disable="correlationLoading"
            >
              <q-tooltip>Refresh correlated data</q-tooltip>
            </q-btn>
          </div>

          <!-- Loading State -->
          <div v-if="correlationLoading" class="tw-flex tw-flex-col tw-items-center tw-justify-center tw-flex-1 tw-py-20">
            <q-spinner-hourglass color="primary" size="3rem" class="tw-mb-4" />
            <div class="tw-text-base">Loading correlated logs...</div>
          </div>

          <!-- Error State -->
          <div v-else-if="correlationError" class="tw-flex tw-flex-col tw-items-center tw-justify-center tw-flex-1 tw-p-4">
            <q-icon name="error_outline" size="3rem" color="negative" class="tw-mb-4" />
            <div class="tw-text-base tw-mb-2">Failed to load correlated logs</div>
            <div class="tw-text-sm tw-text-gray-500 tw-mb-4">{{ correlationError }}</div>
            <q-btn
              color="primary"
              outline
              size="sm"
              @click="refreshCorrelation"
              icon="refresh"
              label="Retry"
            />
          </div>

          <!-- No Data State -->
          <div v-else-if="!hasCorrelatedData || !hasAnyStreams" class="tw-flex tw-flex-col tw-items-center tw-justify-center tw-flex-1 tw-p-4">
            <q-icon name="info_outline" size="3rem" color="grey-5" class="tw-mb-4" />
            <div class="tw-text-base tw-mb-4">No correlated logs found</div>
            <div v-if="incidentDetails" class="tw-text-sm tw-text-gray-500 tw-mb-4">
              Try searching manually using these dimensions:
            </div>
            <div v-if="incidentDetails" class="info-box tw-rounded tw-p-3 tw-text-xs" :class="isDarkMode ? 'info-box-dark' : 'info-box-light'">
              <div v-for="(value, key) in incidentDetails.stable_dimensions" :key="key" class="tw-flex tw-gap-2 tw-mb-1">
                <span class="label-text">{{ key }}:</span>
                <span class="tw-font-mono">{{ value }}</span>
                <q-btn flat dense size="xs" icon="content_copy" @click="() => { navigator.clipboard.writeText(value); $q.notify({ message: 'Copied!', type: 'positive' }); }" />
              </div>
            </div>
          </div>

          <!-- Success State - TelemetryCorrelationDashboard -->
          <div v-else-if="hasCorrelatedData && correlationData" class="tw-flex-1 tw-overflow-hidden">
            <TelemetryCorrelationDashboard
              mode="embedded-tabs"
              :externalActiveTab="'logs'"
              :serviceName="correlationData.serviceName"
              :matchedDimensions="correlationData.matchedDimensions"
              :additionalDimensions="correlationData.additionalDimensions"
              :logStreams="correlationData.logStreams"
              :metricStreams="correlationData.metricStreams"
              :traceStreams="correlationData.traceStreams"
              :timeRange="telemetryTimeRange"
            />
          </div>
        </div>

        <!-- Metrics Tab Content -->
        <div v-if="activeTab === 'metrics'" class="tw-flex tw-flex-col tw-flex-1 tw-overflow-hidden">
          <!-- Refresh Button (shown when data is loaded) -->
          <div v-if="hasCorrelatedData && !correlationLoading" class="tw-px-4 tw-py-2 tw-border-b tw-border-solid tw-border-[var(--o2-border-color)] tw-flex tw-items-center tw-justify-between">
            <span class="tw-text-xs tw-text-gray-500">Showing correlated metrics from incident timeframe</span>
            <q-btn
              flat
              dense
              size="sm"
              icon="refresh"
              color="primary"
              @click="refreshCorrelation"
              :disable="correlationLoading"
            >
              <q-tooltip>Refresh correlated data</q-tooltip>
            </q-btn>
          </div>

          <!-- Loading State -->
          <div v-if="correlationLoading" class="tw-flex tw-flex-col tw-items-center tw-justify-center tw-flex-1 tw-py-20">
            <q-spinner-hourglass color="primary" size="3rem" class="tw-mb-4" />
            <div class="tw-text-base">Loading correlated metrics...</div>
          </div>

          <!-- Error State -->
          <div v-else-if="correlationError" class="tw-flex tw-flex-col tw-items-center tw-justify-center tw-flex-1 tw-p-4">
            <q-icon name="error_outline" size="3rem" color="negative" class="tw-mb-4" />
            <div class="tw-text-base tw-mb-2">Failed to load correlated metrics</div>
            <div class="tw-text-sm tw-text-gray-500 tw-mb-4">{{ correlationError }}</div>
            <q-btn
              color="primary"
              outline
              size="sm"
              @click="refreshCorrelation"
              icon="refresh"
              label="Retry"
            />
          </div>

          <!-- No Data State -->
          <div v-else-if="!hasCorrelatedData || !hasAnyStreams" class="tw-flex tw-flex-col tw-items-center tw-justify-center tw-flex-1 tw-p-4">
            <q-icon name="info_outline" size="3rem" color="grey-5" class="tw-mb-4" />
            <div class="tw-text-base tw-mb-4">No correlated metrics found</div>
            <div v-if="incidentDetails" class="tw-text-sm tw-text-gray-500 tw-mb-4">
              Try searching manually using these dimensions:
            </div>
            <div v-if="incidentDetails" class="info-box tw-rounded tw-p-3 tw-text-xs" :class="isDarkMode ? 'info-box-dark' : 'info-box-light'">
              <div v-for="(value, key) in incidentDetails.stable_dimensions" :key="key" class="tw-flex tw-gap-2 tw-mb-1">
                <span class="label-text">{{ key }}:</span>
                <span class="tw-font-mono">{{ value }}</span>
                <q-btn flat dense size="xs" icon="content_copy" @click="() => { navigator.clipboard.writeText(value); $q.notify({ message: 'Copied!', type: 'positive' }); }" />
              </div>
            </div>
          </div>

          <!-- Success State - TelemetryCorrelationDashboard -->
          <div v-else-if="hasCorrelatedData && correlationData" class="tw-flex-1 tw-overflow-hidden">
            <TelemetryCorrelationDashboard
              mode="embedded-tabs"
              :externalActiveTab="'metrics'"
              :serviceName="correlationData.serviceName"
              :matchedDimensions="correlationData.matchedDimensions"
              :additionalDimensions="correlationData.additionalDimensions"
              :logStreams="correlationData.logStreams"
              :metricStreams="correlationData.metricStreams"
              :traceStreams="correlationData.traceStreams"
              :timeRange="telemetryTimeRange"
            />
          </div>
        </div>

        <!-- Traces Tab Content -->
        <div v-if="activeTab === 'traces'" class="tw-flex tw-flex-col tw-flex-1 tw-overflow-hidden">
          <!-- Refresh Button (shown when data is loaded) -->
          <div v-if="hasCorrelatedData && !correlationLoading" class="tw-px-4 tw-py-2 tw-border-b tw-border-solid tw-border-[var(--o2-border-color)] tw-flex tw-items-center tw-justify-between">
            <span class="tw-text-xs tw-text-gray-500">Showing correlated traces from incident timeframe</span>
            <q-btn
              flat
              dense
              size="sm"
              icon="refresh"
              color="primary"
              @click="refreshCorrelation"
              :disable="correlationLoading"
            >
              <q-tooltip>Refresh correlated data</q-tooltip>
            </q-btn>
          </div>

          <!-- Loading State -->
          <div v-if="correlationLoading" class="tw-flex tw-flex-col tw-items-center tw-justify-center tw-flex-1 tw-py-20">
            <q-spinner-hourglass color="primary" size="3rem" class="tw-mb-4" />
            <div class="tw-text-base">Loading correlated traces...</div>
          </div>

          <!-- Error State -->
          <div v-else-if="correlationError" class="tw-flex tw-flex-col tw-items-center tw-justify-center tw-flex-1 tw-p-4">
            <q-icon name="error_outline" size="3rem" color="negative" class="tw-mb-4" />
            <div class="tw-text-base tw-mb-2">Failed to load correlated traces</div>
            <div class="tw-text-sm tw-text-gray-500 tw-mb-4">{{ correlationError }}</div>
            <q-btn
              color="primary"
              outline
              size="sm"
              @click="refreshCorrelation"
              icon="refresh"
              label="Retry"
            />
          </div>

          <!-- No Data State -->
          <div v-else-if="!hasCorrelatedData || !hasAnyStreams" class="tw-flex tw-flex-col tw-items-center tw-justify-center tw-flex-1 tw-p-4">
            <q-icon name="info_outline" size="3rem" color="grey-5" class="tw-mb-4" />
            <div class="tw-text-base tw-mb-4">No correlated traces found</div>
            <div v-if="incidentDetails" class="tw-text-sm tw-text-gray-500 tw-mb-4">
              Try searching manually using these dimensions:
            </div>
            <div v-if="incidentDetails" class="info-box tw-rounded tw-p-3 tw-text-xs" :class="isDarkMode ? 'info-box-dark' : 'info-box-light'">
              <div v-for="(value, key) in incidentDetails.stable_dimensions" :key="key" class="tw-flex tw-gap-2 tw-mb-1">
                <span class="label-text">{{ key }}:</span>
                <span class="tw-font-mono">{{ value }}</span>
                <q-btn flat dense size="xs" icon="content_copy" @click="() => { navigator.clipboard.writeText(value); $q.notify({ message: 'Copied!', type: 'positive' }); }" />
              </div>
            </div>
          </div>

          <!-- Success State - TelemetryCorrelationDashboard -->
          <div v-else-if="hasCorrelatedData && correlationData" class="tw-flex-1 tw-overflow-hidden">
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
            />
          </div>
        </div>
        </div>
      </div>
      </div>
    </div>

    <!-- Loading state -->
    <div v-if="loading" class="tw:flex-1 tw:flex tw:items-center tw:justify-center">
      <q-spinner-hourglass size="lg" color="primary" />
    </div>
  </div>
  </q-page>
</template>

<script lang="ts">
import { defineComponent, ref, watch, computed, PropType, nextTick, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { useRouter } from "vue-router";
import { date } from "quasar";
import incidentsService, {
  Incident,
  IncidentWithAlerts,
  IncidentAlert,
  IncidentCorrelatedStreams,
} from "@/services/incidents";
import { getImageURL } from "@/utils/zincutils";
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { buildConditionsString } from "@/utils/alerts/conditionsFormatter";
import TelemetryCorrelationDashboard from "@/plugins/correlation/TelemetryCorrelationDashboard.vue";
import IncidentServiceGraph from "./IncidentServiceGraph.vue";
import IncidentTableOfContents from "./IncidentTableOfContents.vue";
import IncidentRCAAnalysis from "./IncidentRCAAnalysis.vue";
import IncidentAlertTriggersTable from "./IncidentAlertTriggersTable.vue";
import CustomChartRenderer from "@/components/dashboards/panels/CustomChartRenderer.vue";
import { contextRegistry, createIncidentsContextProvider } from '@/composables/contextProviders';

export default defineComponent({
  name: "IncidentDetailDrawer",
  components: {
    TelemetryCorrelationDashboard,
    IncidentServiceGraph,
    IncidentAlertTriggersTable,
    IncidentTableOfContents,
    IncidentRCAAnalysis,
    CustomChartRenderer,
  },
  emits: ['close', 'status-updated'],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();
    const $q = useQuasar();
    const router = useRouter();

    // Copy to clipboard state
    const copiedField = ref<string | null>(null);

    // Copy to clipboard function with visual feedback
    const copyToClipboard = (text: string, fieldName: string) => {
      if (!text) return;

      navigator.clipboard
        .writeText(text)
        .then(() => {
          copiedField.value = fieldName;
          $q.notify({
            type: "positive",
            message: "Copied to clipboard",
            timeout: 2000,
          });
          // Reset the icon after 2 seconds
          setTimeout(() => {
            copiedField.value = null;
          }, 2000);
        })
        .catch(() => {
          $q.notify({
            type: "negative",
            message: "Failed to copy to clipboard",
            timeout: 2000,
          });
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

    // Computed to check if analysis already exists
    const hasExistingRca = computed(() => {
      return !!incidentDetails.value?.topology_context?.suggested_root_cause;
    });

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

    // Computed: Alerts sorted by trigger count (descending)
    const sortedAlertsByTriggerCount = computed(() => {
      if (!alerts.value || alerts.value.length === 0) return [];
      return [...alerts.value].sort((a, b) => {
        const countA = getTriggerCountForAlert(a.id);
        const countB = getTriggerCountForAlert(b.id);
        return countB - countA; // Descending order
      });
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
      } catch (error: any) {
        console.error("Failed to load correlated streams:", error);
        correlationError.value =
          error?.response?.data?.message ||
          error?.message ||
          "Failed to load correlated telemetry";
      } finally {
        correlationLoading.value = false;
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
        stable_dimensions: incidentDetails.value.stable_dimensions,
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
            text: t("incidents.noAlertActivityData"),
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
        yAxis: {
          type: 'category',
          data: sortedDates.map(formatDate),
          axisLabel: {
            color: store.state.theme === 'dark' ? '#B7B7B7' : '#72777B'
          },
          axisLine: {
            lineStyle: {
              color: store.state.theme === 'dark' ? '#444444' : '#E7EAEE'
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

        incidentDetails.value = {
    "id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
    "org_id": "default",
    "correlation_key": "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262",
    "status": "acknowledged",
    "severity": "P2",
    "stable_dimensions": {},
    "topology_context": {
        "nodes": [
            {
                "alert_id": "38YOIzNwuFnemYjhVz1bkazh7RR",
                "alert_name": "auto_dedup_alert_6yc8l5",
                "service_name": "unknown",
                "alert_count": 1,
                "first_fired_at": 1768972962281040,
                "last_fired_at": 1768972962281040
            },
            {
                "alert_id": "38c3UaT2jR7miekxqjD0H4kBUYO",
                "alert_name": "alert_bulk_test_665286_1",
                "service_name": "unknown",
                "alert_count": 1,
                "first_fired_at": 1769085050790276,
                "last_fired_at": 1769085050790276
            },
            {
                "alert_id": "38c3UtRmqd1bauacJc9M2RxX8r4",
                "alert_name": "alert_bulk_test_665286_2",
                "service_name": "unknown",
                "alert_count": 1,
                "first_fired_at": 1769085050790276,
                "last_fired_at": 1769085050790276
            },
            {
                "alert_id": "38c4E1Y14u0XNKbUBrAFqwANNrA",
                "alert_name": "alert_bulk_test_598312_1",
                "service_name": "unknown",
                "alert_count": 1,
                "first_fired_at": 1769085410790589,
                "last_fired_at": 1769085410790589
            },
            {
                "alert_id": "38c58PiTLD2iDBxWwd3eD441qJk",
                "alert_name": "alert_bulk_test_872307_1",
                "service_name": "unknown",
                "alert_count": 1,
                "first_fired_at": 1769085860790956,
                "last_fired_at": 1769085860790956
            },
            {
                "alert_id": "38c58go0Nh5PisVX87QVq1DtBsJ",
                "alert_name": "alert_bulk_test_872307_2",
                "service_name": "unknown",
                "alert_count": 1,
                "first_fired_at": 1769085860790956,
                "last_fired_at": 1769085860790956
            },
            {
                "alert_id": "38c5B11exRQ9bKFcs6gHJ35uHSj",
                "alert_name": "alert_bulk_test_484125_1",
                "service_name": "unknown",
                "alert_count": 1,
                "first_fired_at": 1769085880790316,
                "last_fired_at": 1769085880790316
            },
            {
                "alert_id": "38c75DfYYo4ryTeWhiMSQKSMeka",
                "alert_name": "alert_bulk_test_492901_1",
                "service_name": "unknown",
                "alert_count": 1,
                "first_fired_at": 1769086820790714,
                "last_fired_at": 1769086820790714
            },
            {
                "alert_id": "38c77fZpHfZO9iGlVdJeJKVWmah",
                "alert_name": "alert_bulk_test_176765_1",
                "service_name": "unknown",
                "alert_count": 1,
                "first_fired_at": 1769086840791047,
                "last_fired_at": 1769086840791047
            },
            {
                "alert_id": "38c78q6KRBOIxbgaWp3x8qCd3zQ",
                "alert_name": "alert_bulk_test_148388_1",
                "service_name": "unknown",
                "alert_count": 1,
                "first_fired_at": 1769086850790745,
                "last_fired_at": 1769086850790745
            },
            {
                "alert_id": "38c798iuneSmKa1L61wZZ1IGA5I",
                "alert_name": "alert_bulk_test_148388_2",
                "service_name": "unknown",
                "alert_count": 1,
                "first_fired_at": 1769086850790745,
                "last_fired_at": 1769086850790745
            },
            {
                "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
                "alert_name": "rbac_sql_e405b2bf",
                "service_name": "unknown",
                "alert_count": 447,
                "first_fired_at": 1769585417507424,
                "last_fired_at": 1769676092280055
            },
            {
                "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
                "alert_name": "rbac_sql_69badad9",
                "service_name": "unknown",
                "alert_count": 450,
                "first_fired_at": 1769585447563416,
                "last_fired_at": 1769675972280486
            },
            {
                "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
                "alert_name": "rbac_sql_7ec0ee9f",
                "service_name": "unknown",
                "alert_count": 432,
                "first_fired_at": 1769588767506796,
                "last_fired_at": 1769675972280486
            },
            {
                "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
                "alert_name": "rbac_sql_28dff062",
                "service_name": "unknown",
                "alert_count": 423,
                "first_fired_at": 1769590237556203,
                "last_fired_at": 1769676042279548
            },
            {
                "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
                "alert_name": "rbac_sql_f104c71b",
                "service_name": "unknown",
                "alert_count": 390,
                "first_fired_at": 1769596797506844,
                "last_fired_at": 1769676092280055
            },
            {
                "alert_id": "38eX0uSw4C6sn80z4oLsPHJPBmH",
                "alert_name": "testttt",
                "service_name": "unknown",
                "alert_count": 16,
                "first_fired_at": 1769668592329016,
                "last_fired_at": 1769677562280390
            }
        ],
        "edges": [
            {
                "from_node_index": 0,
                "to_node_index": 1,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 0,
                "to_node_index": 2,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 0,
                "to_node_index": 3,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 1,
                "to_node_index": 3,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 2,
                "to_node_index": 3,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 0,
                "to_node_index": 4,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 1,
                "to_node_index": 4,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 2,
                "to_node_index": 4,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 3,
                "to_node_index": 4,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 0,
                "to_node_index": 5,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 1,
                "to_node_index": 5,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 2,
                "to_node_index": 5,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 3,
                "to_node_index": 5,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 0,
                "to_node_index": 6,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 1,
                "to_node_index": 6,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 2,
                "to_node_index": 6,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 3,
                "to_node_index": 6,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 4,
                "to_node_index": 6,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 5,
                "to_node_index": 6,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 0,
                "to_node_index": 7,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 1,
                "to_node_index": 7,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 2,
                "to_node_index": 7,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 3,
                "to_node_index": 7,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 4,
                "to_node_index": 7,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 5,
                "to_node_index": 7,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 6,
                "to_node_index": 7,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 0,
                "to_node_index": 8,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 1,
                "to_node_index": 8,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 2,
                "to_node_index": 8,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 3,
                "to_node_index": 8,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 4,
                "to_node_index": 8,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 5,
                "to_node_index": 8,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 6,
                "to_node_index": 8,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 7,
                "to_node_index": 8,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 0,
                "to_node_index": 9,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 1,
                "to_node_index": 9,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 2,
                "to_node_index": 9,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 3,
                "to_node_index": 9,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 4,
                "to_node_index": 9,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 5,
                "to_node_index": 9,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 6,
                "to_node_index": 9,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 7,
                "to_node_index": 9,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 8,
                "to_node_index": 9,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 0,
                "to_node_index": 10,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 1,
                "to_node_index": 10,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 2,
                "to_node_index": 10,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 3,
                "to_node_index": 10,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 4,
                "to_node_index": 10,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 5,
                "to_node_index": 10,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 6,
                "to_node_index": 10,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 7,
                "to_node_index": 10,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 8,
                "to_node_index": 10,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 0,
                "to_node_index": 11,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 1,
                "to_node_index": 11,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 2,
                "to_node_index": 11,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 3,
                "to_node_index": 11,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 4,
                "to_node_index": 11,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 5,
                "to_node_index": 11,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 6,
                "to_node_index": 11,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 7,
                "to_node_index": 11,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 8,
                "to_node_index": 11,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 9,
                "to_node_index": 11,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 10,
                "to_node_index": 11,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 0,
                "to_node_index": 12,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 1,
                "to_node_index": 12,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 2,
                "to_node_index": 12,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 3,
                "to_node_index": 12,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 4,
                "to_node_index": 12,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 5,
                "to_node_index": 12,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 6,
                "to_node_index": 12,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 7,
                "to_node_index": 12,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 8,
                "to_node_index": 12,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 9,
                "to_node_index": 12,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 10,
                "to_node_index": 12,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 11,
                "to_node_index": 12,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 0,
                "to_node_index": 13,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 1,
                "to_node_index": 13,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 2,
                "to_node_index": 13,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 3,
                "to_node_index": 13,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 4,
                "to_node_index": 13,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 5,
                "to_node_index": 13,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 6,
                "to_node_index": 13,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 7,
                "to_node_index": 13,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 8,
                "to_node_index": 13,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 9,
                "to_node_index": 13,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 10,
                "to_node_index": 13,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 11,
                "to_node_index": 13,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 12,
                "to_node_index": 13,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 0,
                "to_node_index": 14,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 1,
                "to_node_index": 14,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 2,
                "to_node_index": 14,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 3,
                "to_node_index": 14,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 4,
                "to_node_index": 14,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 5,
                "to_node_index": 14,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 6,
                "to_node_index": 14,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 7,
                "to_node_index": 14,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 8,
                "to_node_index": 14,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 9,
                "to_node_index": 14,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 10,
                "to_node_index": 14,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 11,
                "to_node_index": 14,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 12,
                "to_node_index": 14,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 13,
                "to_node_index": 14,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 0,
                "to_node_index": 15,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 1,
                "to_node_index": 15,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 2,
                "to_node_index": 15,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 3,
                "to_node_index": 15,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 4,
                "to_node_index": 15,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 5,
                "to_node_index": 15,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 6,
                "to_node_index": 15,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 7,
                "to_node_index": 15,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 8,
                "to_node_index": 15,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 9,
                "to_node_index": 15,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 10,
                "to_node_index": 15,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 11,
                "to_node_index": 15,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 12,
                "to_node_index": 15,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 13,
                "to_node_index": 15,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 14,
                "to_node_index": 15,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 0,
                "to_node_index": 16,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 1,
                "to_node_index": 16,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 2,
                "to_node_index": 16,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 3,
                "to_node_index": 16,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 4,
                "to_node_index": 16,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 5,
                "to_node_index": 16,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 6,
                "to_node_index": 16,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 7,
                "to_node_index": 16,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 8,
                "to_node_index": 16,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 9,
                "to_node_index": 16,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 10,
                "to_node_index": 16,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 11,
                "to_node_index": 16,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 12,
                "to_node_index": 16,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 13,
                "to_node_index": 16,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 14,
                "to_node_index": 16,
                "edge_type": "temporal"
            },
            {
                "from_node_index": 15,
                "to_node_index": 16,
                "edge_type": "temporal"
            }
        ],
        "related_incident_ids": [],
        "suggested_root_cause": "# Root Cause Analysis Report\n\n## Incident Summary\n- **Incident ID**: 38YOJBB1hOiyE4nGEnxBqDiwPbT\n- **Severity**: Analyzing...\n- **Detected**: Analyzing...\n- **Status**: Investigating...## Incident Summary\n- **Incident ID**: 38YOJBB1hOiyE4nGEnxBqDiwPbT\n- **Severity**: P3\n- **Detected**: 2026-01-20 13:36:02 UTC\n- **Last Alert**: 2026-01-20 13:36:02 UTC\n- **Status**: Open\n- **Duration**: <1 minute\n- **Affected Services**: unknown\n- **Alert Count**: 1 (auto_dedup_alert_6yc8l5)\n\n## Timeline\n\n- 13:36:02.281 - Initial alert fired: auto_dedup_alert_6yc8l5\n- 13:36:03.673 - Incident created\n- 13:36:03.699 - Alert correlated to incident## Evidence\n\n### Service Dependencies\n\nService topology analysis reveals critical failure pattern:\n\n**Affected Services (100% error rate):**\n- auth-service: 114/114 requests failed\n- profile-service: 122/122 requests failed  \n- user-service: 144/144 requests failed\n\n**Gateway Impact:**\n- api-gateway: 65.3% error rate (380/582 failures)\n- All failed requests route through api-gateway to failing downstream services\n\n**Healthy Services:**\n- payment-service: 0% error rate\n- order-service: 0% error rate### Distributed Traces\n\nTrace analysis reveals distinct failure patterns:\n\n**Critical Latency Issues:**\n- user-service: 5000ms+ latency on database_query operations (ERROR status)\n- auth-service: 500ms latency on authenticate_user operations (ERROR status)\n- profile-service: 200ms latency on get_user_profile operations (ERROR status)\n\n**Healthy Operations:**\n- payment-service: 804ms latency (OK status)\n- order-service: 154ms latency (OK status)\n\n**Error Pattern:** All traces through auth-service, profile-service, and user-service show ERROR status, while payment and order services complete successfully.### Log Patterns\n\nSchema limitations prevent direct error status queries. Available fields: service_name, trace_id, _timestamp.### Log Analysis\n\nService event distribution shows no direct correlation with failed services (auth-service, user-service, profile-service not in top event generators).### Metrics Analysis\n\nPrometheus metrics unavailable for the affected services during incident window. Metrics data gaps prevent resource utilization analysis.### Contributing Factors\n\n1. **Complete service failure pattern**: auth-service, user-service, and profile-service exhibit 100% error rates\n2. **Cascading API gateway failures**: 65.3% error rate at api-gateway caused by downstream service unavailability\n3. **Extreme latency degradation**: user-service database queries experiencing 5000ms+ timeouts (33x normal)\n4. **Authentication pipeline collapse**: All authenticate_user operations failing with 500ms delays\n5. **Data unavailability**: No application logs from failed services; no metrics data; alert configuration missing\n\n## Impact Assessment\n\n- **Services Affected**: 3 critical services (auth-service, user-service, profile-service) + api-gateway impact\n- **Peak Error Rate**: 100% for authentication, user operations, and profile services\n- **Failed Requests**: 380+ failed requests through api-gateway\n- **Request Patterns**: \n  - 114 failed authentication requests\n  - 144 failed user-service database queries  \n  - 122 failed profile retrievals\n- **Data Loss**: Unknown (insufficient telemetry)\n- **SLA Breach**: Likely (100% error rate on critical authentication path)\n\n## Actions\n\n### Immediate\n\n- Investigate database connectivity for user-service (5000ms timeout indicates connection pool exhaustion or database unavailability)\n- Restart or scale auth-service, user-service, and profile-service pods/instances\n- Check for recent deployments or configuration changes to these three services\n- Verify database health and connection pool configurations\n- Enable comprehensive logging and metrics collection for affected services\n\n### Future\n\n- Implement circuit breakers between api-gateway and failing downstream services to prevent cascade failures\n- Add comprehensive health checks with automatic service recovery\n- Deploy distributed tracing with error context capture across all services\n- Establish metrics exporter configuration for auth-service, user-service, and profile-service\n- Create runbook for database connection pool saturation scenarios\n- Implement rate limiting and graceful degradation for authentication operations\n- Configure alert correlation with detailed error context and service dependencies\n\n## Executive Summary\n\n**Root Cause**: Simultaneous failure of auth-service, user-service, and profile-service with 100% error rates. User-service database operations experiencing 5000ms+ timeouts suggest database connection pool exhaustion or underlying database connectivity failure as the triggering event. Authentication and profile services failed in cascade, likely due to shared database dependency or infrastructure issue.\n\n**Impact**: Complete outage of authentication, user management, and profile functionality affecting all customer requests requiring these services. 380+ failed requests with 65% error rate at API gateway level.\n\n**Resolution**: Immediate service restart and database connection pool investigation required. Root cause determination limited by missing application logs and metrics from affected services. Implement comprehensive observability instrumentation and circuit breaker patterns to prevent future cascading failures."
    },
    "first_alert_at": 1768972962281040,
    "last_alert_at": 1769677562280390,
    "resolved_at": 1769745316462533,
    "alert_count": 2169,
    "title": "auto_dedup_alert_6yc8l5",
    "created_at": 1768972963673252,
    "updated_at": 1769782197787960,
    "triggers": [
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38eX0uSw4C6sn80z4oLsPHJPBmH",
            "alert_name": "testttt",
            "alert_fired_at": 1769677562280390,
            "correlation_reason": "manual_extraction",
            "created_at": 1769677566111852
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38eX0uSw4C6sn80z4oLsPHJPBmH",
            "alert_name": "testttt",
            "alert_fired_at": 1769676977298421,
            "correlation_reason": "manual_extraction",
            "created_at": 1769676985780899
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38eX0uSw4C6sn80z4oLsPHJPBmH",
            "alert_name": "testttt",
            "alert_fired_at": 1769676377307439,
            "correlation_reason": "manual_extraction",
            "created_at": 1769676394803556
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769676092280055,
            "correlation_reason": "manual_extraction",
            "created_at": 1769676092451620
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769676092280055,
            "correlation_reason": "manual_extraction",
            "created_at": 1769676093427430
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769676082279615,
            "correlation_reason": "manual_extraction",
            "created_at": 1769676083393398
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769676082279615,
            "correlation_reason": "manual_extraction",
            "created_at": 1769676082381242
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769676062279549,
            "correlation_reason": "manual_extraction",
            "created_at": 1769676063377343
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769676062279549,
            "correlation_reason": "manual_extraction",
            "created_at": 1769676062349678
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769676042279548,
            "correlation_reason": "manual_extraction",
            "created_at": 1769676042350675
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769676032279631,
            "correlation_reason": "manual_extraction",
            "created_at": 1769676032437597
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769676002280401,
            "correlation_reason": "manual_extraction",
            "created_at": 1769676009444065
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769675972280486,
            "correlation_reason": "manual_extraction",
            "created_at": 1769675972380998
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769675972280486,
            "correlation_reason": "manual_extraction",
            "created_at": 1769675973387603
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769675962279803,
            "correlation_reason": "manual_extraction",
            "created_at": 1769675963361363
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769675962279803,
            "correlation_reason": "manual_extraction",
            "created_at": 1769675962396093
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769675942279623,
            "correlation_reason": "manual_extraction",
            "created_at": 1769675942489686
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769675942279623,
            "correlation_reason": "manual_extraction",
            "created_at": 1769675943410659
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38eX0uSw4C6sn80z4oLsPHJPBmH",
            "alert_name": "testttt",
            "alert_fired_at": 1769675792297355,
            "correlation_reason": "manual_extraction",
            "created_at": 1769675808577267
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769675502280105,
            "correlation_reason": "manual_extraction",
            "created_at": 1769675502319745
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769675502280105,
            "correlation_reason": "manual_extraction",
            "created_at": 1769675503316152
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769675482279962,
            "correlation_reason": "manual_extraction",
            "created_at": 1769675483317497
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769675482279962,
            "correlation_reason": "manual_extraction",
            "created_at": 1769675485314518
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769675462279965,
            "correlation_reason": "manual_extraction",
            "created_at": 1769675465313643
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769675462279965,
            "correlation_reason": "manual_extraction",
            "created_at": 1769675463327361
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769675442280491,
            "correlation_reason": "manual_extraction",
            "created_at": 1769675442319749
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769675422279606,
            "correlation_reason": "manual_extraction",
            "created_at": 1769675422316832
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769675402279973,
            "correlation_reason": "manual_extraction",
            "created_at": 1769675405315617
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769675392279754,
            "correlation_reason": "manual_extraction",
            "created_at": 1769675392315993
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769675372280240,
            "correlation_reason": "manual_extraction",
            "created_at": 1769675372347928
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769675372280240,
            "correlation_reason": "manual_extraction",
            "created_at": 1769675373327400
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769675352279513,
            "correlation_reason": "manual_extraction",
            "created_at": 1769675352311204
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769675342280236,
            "correlation_reason": "manual_extraction",
            "created_at": 1769675342335584
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769675342280236,
            "correlation_reason": "manual_extraction",
            "created_at": 1769675343320934
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38eX0uSw4C6sn80z4oLsPHJPBmH",
            "alert_name": "testttt",
            "alert_fired_at": 1769675192296419,
            "correlation_reason": "manual_extraction",
            "created_at": 1769675209632268
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769674902279593,
            "correlation_reason": "manual_extraction",
            "created_at": 1769674902319430
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769674902279593,
            "correlation_reason": "manual_extraction",
            "created_at": 1769674903319121
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769674882279497,
            "correlation_reason": "manual_extraction",
            "created_at": 1769674882316874
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769674882279497,
            "correlation_reason": "manual_extraction",
            "created_at": 1769674883323643
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769674862280185,
            "correlation_reason": "manual_extraction",
            "created_at": 1769674863369881
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769674862280185,
            "correlation_reason": "manual_extraction",
            "created_at": 1769674862318275
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769674842280169,
            "correlation_reason": "manual_extraction",
            "created_at": 1769674843330430
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769674832279970,
            "correlation_reason": "manual_extraction",
            "created_at": 1769674832319701
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769674802279763,
            "correlation_reason": "manual_extraction",
            "created_at": 1769674805320750
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769674772280433,
            "correlation_reason": "manual_extraction",
            "created_at": 1769674773331178
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769674772280433,
            "correlation_reason": "manual_extraction",
            "created_at": 1769674772325640
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769674762321706,
            "correlation_reason": "manual_extraction",
            "created_at": 1769674762362630
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769674762321706,
            "correlation_reason": "manual_extraction",
            "created_at": 1769674763456088
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769674742279610,
            "correlation_reason": "manual_extraction",
            "created_at": 1769674743331929
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769674742279610,
            "correlation_reason": "manual_extraction",
            "created_at": 1769674742375391
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38eX0uSw4C6sn80z4oLsPHJPBmH",
            "alert_name": "testttt",
            "alert_fired_at": 1769674592298767,
            "correlation_reason": "manual_extraction",
            "created_at": 1769674596335954
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769674292279785,
            "correlation_reason": "manual_extraction",
            "created_at": 1769674293407420
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769674292279785,
            "correlation_reason": "manual_extraction",
            "created_at": 1769674292340806
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769674282279589,
            "correlation_reason": "manual_extraction",
            "created_at": 1769674282334103
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769674282279589,
            "correlation_reason": "manual_extraction",
            "created_at": 1769674283318504
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769674262280198,
            "correlation_reason": "manual_extraction",
            "created_at": 1769674263323925
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769674262280198,
            "correlation_reason": "manual_extraction",
            "created_at": 1769674262358982
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769674242279781,
            "correlation_reason": "manual_extraction",
            "created_at": 1769674242323179
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769674222279861,
            "correlation_reason": "manual_extraction",
            "created_at": 1769674223326549
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769674202280469,
            "correlation_reason": "manual_extraction",
            "created_at": 1769674205371694
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769674192362509,
            "correlation_reason": "manual_extraction",
            "created_at": 1769674192493247
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769674172279608,
            "correlation_reason": "manual_extraction",
            "created_at": 1769674172437697
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769674172279608,
            "correlation_reason": "manual_extraction",
            "created_at": 1769674173413844
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769674152280396,
            "correlation_reason": "manual_extraction",
            "created_at": 1769674152345023
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769674142280042,
            "correlation_reason": "manual_extraction",
            "created_at": 1769674143381739
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769674142280042,
            "correlation_reason": "manual_extraction",
            "created_at": 1769674142494014
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38eX0uSw4C6sn80z4oLsPHJPBmH",
            "alert_name": "testttt",
            "alert_fired_at": 1769673992300119,
            "correlation_reason": "manual_extraction",
            "created_at": 1769673993007005
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769673702279673,
            "correlation_reason": "manual_extraction",
            "created_at": 1769673702509522
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769673692279951,
            "correlation_reason": "manual_extraction",
            "created_at": 1769673692320583
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769673692279951,
            "correlation_reason": "manual_extraction",
            "created_at": 1769673693323031
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769673672279824,
            "correlation_reason": "manual_extraction",
            "created_at": 1769673672507967
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769673662280244,
            "correlation_reason": "manual_extraction",
            "created_at": 1769673662327536
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769673662280244,
            "correlation_reason": "manual_extraction",
            "created_at": 1769673663313990
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769673632280386,
            "correlation_reason": "manual_extraction",
            "created_at": 1769673632312825
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769673622403944,
            "correlation_reason": "manual_extraction",
            "created_at": 1769673623448723
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769673602280044,
            "correlation_reason": "manual_extraction",
            "created_at": 1769673609341930
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769673592280246,
            "correlation_reason": "manual_extraction",
            "created_at": 1769673592316495
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769673572279741,
            "correlation_reason": "manual_extraction",
            "created_at": 1769673572319555
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769673572279741,
            "correlation_reason": "manual_extraction",
            "created_at": 1769673573313028
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769673552279637,
            "correlation_reason": "manual_extraction",
            "created_at": 1769673552317403
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769673542279793,
            "correlation_reason": "manual_extraction",
            "created_at": 1769673542399685
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769673542279793,
            "correlation_reason": "manual_extraction",
            "created_at": 1769673543359746
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38eX0uSw4C6sn80z4oLsPHJPBmH",
            "alert_name": "testttt",
            "alert_fired_at": 1769673392299111,
            "correlation_reason": "manual_extraction",
            "created_at": 1769673396175541
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769673102279644,
            "correlation_reason": "manual_extraction",
            "created_at": 1769673102366006
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769673102279644,
            "correlation_reason": "manual_extraction",
            "created_at": 1769673103375664
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769673082280225,
            "correlation_reason": "manual_extraction",
            "created_at": 1769673082397636
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769673082280225,
            "correlation_reason": "manual_extraction",
            "created_at": 1769673083396118
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769673062279885,
            "correlation_reason": "manual_extraction",
            "created_at": 1769673063327769
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769673062279885,
            "correlation_reason": "manual_extraction",
            "created_at": 1769673062377423
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769673032279897,
            "correlation_reason": "manual_extraction",
            "created_at": 1769673032399216
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769673012279543,
            "correlation_reason": "manual_extraction",
            "created_at": 1769673012400834
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769673002279811,
            "correlation_reason": "manual_extraction",
            "created_at": 1769673005526331
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769672982279654,
            "correlation_reason": "manual_extraction",
            "created_at": 1769672982337692
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769672972279807,
            "correlation_reason": "manual_extraction",
            "created_at": 1769672973391800
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769672972279807,
            "correlation_reason": "manual_extraction",
            "created_at": 1769672972407461
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769672952280134,
            "correlation_reason": "manual_extraction",
            "created_at": 1769672952367476
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769672942280334,
            "correlation_reason": "manual_extraction",
            "created_at": 1769672943390954
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769672942280334,
            "correlation_reason": "manual_extraction",
            "created_at": 1769672942360927
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38eX0uSw4C6sn80z4oLsPHJPBmH",
            "alert_name": "testttt",
            "alert_fired_at": 1769672792312716,
            "correlation_reason": "manual_extraction",
            "created_at": 1769672801428659
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769672512279823,
            "correlation_reason": "manual_extraction",
            "created_at": 1769672512352276
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769672492280361,
            "correlation_reason": "manual_extraction",
            "created_at": 1769672492436138
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769672492280361,
            "correlation_reason": "manual_extraction",
            "created_at": 1769672493467705
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769672472280216,
            "correlation_reason": "manual_extraction",
            "created_at": 1769672472320360
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769672462280142,
            "correlation_reason": "manual_extraction",
            "created_at": 1769672463378277
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769672462280142,
            "correlation_reason": "manual_extraction",
            "created_at": 1769672465444821
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769672442279539,
            "correlation_reason": "manual_extraction",
            "created_at": 1769672442339225
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769672422279881,
            "correlation_reason": "manual_extraction",
            "created_at": 1769672422382506
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769672402279879,
            "correlation_reason": "manual_extraction",
            "created_at": 1769672405394696
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769672382280488,
            "correlation_reason": "manual_extraction",
            "created_at": 1769672382334634
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769672372279709,
            "correlation_reason": "manual_extraction",
            "created_at": 1769672375353248
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769672372279709,
            "correlation_reason": "manual_extraction",
            "created_at": 1769672372353920
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769672352279771,
            "correlation_reason": "manual_extraction",
            "created_at": 1769672352387371
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769672342279947,
            "correlation_reason": "manual_extraction",
            "created_at": 1769672343473291
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769672342279947,
            "correlation_reason": "manual_extraction",
            "created_at": 1769672342663806
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38eX0uSw4C6sn80z4oLsPHJPBmH",
            "alert_name": "testttt",
            "alert_fired_at": 1769672177305274,
            "correlation_reason": "manual_extraction",
            "created_at": 1769672187297443
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769671912279890,
            "correlation_reason": "manual_extraction",
            "created_at": 1769671912617408
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769671892280435,
            "correlation_reason": "manual_extraction",
            "created_at": 1769671893391034
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769671892280435,
            "correlation_reason": "manual_extraction",
            "created_at": 1769671892411085
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769671872279977,
            "correlation_reason": "manual_extraction",
            "created_at": 1769671872377591
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769671862280247,
            "correlation_reason": "manual_extraction",
            "created_at": 1769671863367519
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769671862280247,
            "correlation_reason": "manual_extraction",
            "created_at": 1769671862377843
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769671832279857,
            "correlation_reason": "manual_extraction",
            "created_at": 1769671832417427
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769671817293747,
            "correlation_reason": "manual_extraction",
            "created_at": 1769671817403980
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769671802280085,
            "correlation_reason": "manual_extraction",
            "created_at": 1769671809345795
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769671782280180,
            "correlation_reason": "manual_extraction",
            "created_at": 1769671782336165
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769671762280408,
            "correlation_reason": "manual_extraction",
            "created_at": 1769671762347536
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769671762280408,
            "correlation_reason": "manual_extraction",
            "created_at": 1769671763352706
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769671752279876,
            "correlation_reason": "manual_extraction",
            "created_at": 1769671752354407
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769671742280227,
            "correlation_reason": "manual_extraction",
            "created_at": 1769671743401898
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769671742280227,
            "correlation_reason": "manual_extraction",
            "created_at": 1769671742357458
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38eX0uSw4C6sn80z4oLsPHJPBmH",
            "alert_name": "testttt",
            "alert_fired_at": 1769671592302706,
            "correlation_reason": "manual_extraction",
            "created_at": 1769671593250217
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769671302280436,
            "correlation_reason": "manual_extraction",
            "created_at": 1769671303527531
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769671302280436,
            "correlation_reason": "manual_extraction",
            "created_at": 1769671302367418
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769671282279557,
            "correlation_reason": "manual_extraction",
            "created_at": 1769671282385020
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769671282279557,
            "correlation_reason": "manual_extraction",
            "created_at": 1769671283396811
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769671262279778,
            "correlation_reason": "manual_extraction",
            "created_at": 1769671263405096
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769671262279778,
            "correlation_reason": "manual_extraction",
            "created_at": 1769671262361440
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769671252280424,
            "correlation_reason": "manual_extraction",
            "created_at": 1769671252380867
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769671232279867,
            "correlation_reason": "manual_extraction",
            "created_at": 1769671232481481
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769671202280230,
            "correlation_reason": "manual_extraction",
            "created_at": 1769671205571719
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769671172279705,
            "correlation_reason": "manual_extraction",
            "created_at": 1769671172385527
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769671172279705,
            "correlation_reason": "manual_extraction",
            "created_at": 1769671173318011
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769671152279666,
            "correlation_reason": "manual_extraction",
            "created_at": 1769671153325152
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769671152279666,
            "correlation_reason": "manual_extraction",
            "created_at": 1769671152310130
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769671142279983,
            "correlation_reason": "manual_extraction",
            "created_at": 1769671142346236
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769671142279983,
            "correlation_reason": "manual_extraction",
            "created_at": 1769671143323001
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38eX0uSw4C6sn80z4oLsPHJPBmH",
            "alert_name": "testttt",
            "alert_fired_at": 1769670992299109,
            "correlation_reason": "manual_extraction",
            "created_at": 1769671008333066
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769670702279518,
            "correlation_reason": "manual_extraction",
            "created_at": 1769670702330136
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769670692279802,
            "correlation_reason": "manual_extraction",
            "created_at": 1769670692365505
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769670692279802,
            "correlation_reason": "manual_extraction",
            "created_at": 1769670693330681
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769670672280156,
            "correlation_reason": "manual_extraction",
            "created_at": 1769670672316241
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769670662280398,
            "correlation_reason": "manual_extraction",
            "created_at": 1769670662321888
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769670662280398,
            "correlation_reason": "manual_extraction",
            "created_at": 1769670663320701
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769670632279939,
            "correlation_reason": "manual_extraction",
            "created_at": 1769670632382411
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769670612279805,
            "correlation_reason": "manual_extraction",
            "created_at": 1769670612408769
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769670602279873,
            "correlation_reason": "manual_extraction",
            "created_at": 1769670609396612
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769670582279579,
            "correlation_reason": "manual_extraction",
            "created_at": 1769670582318893
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769670572279947,
            "correlation_reason": "manual_extraction",
            "created_at": 1769670573319696
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769670572279947,
            "correlation_reason": "manual_extraction",
            "created_at": 1769670572321649
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769670552279857,
            "correlation_reason": "manual_extraction",
            "created_at": 1769670552336465
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769670542279763,
            "correlation_reason": "manual_extraction",
            "created_at": 1769670543407614
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769670542279763,
            "correlation_reason": "manual_extraction",
            "created_at": 1769670542395449
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38eX0uSw4C6sn80z4oLsPHJPBmH",
            "alert_name": "testttt",
            "alert_fired_at": 1769670392321859,
            "correlation_reason": "manual_extraction",
            "created_at": 1769670409967721
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769670092280449,
            "correlation_reason": "manual_extraction",
            "created_at": 1769670093388981
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769670092280449,
            "correlation_reason": "manual_extraction",
            "created_at": 1769670092575355
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769670082279855,
            "correlation_reason": "manual_extraction",
            "created_at": 1769670082534499
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769670082279855,
            "correlation_reason": "manual_extraction",
            "created_at": 1769670083345179
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769670062280122,
            "correlation_reason": "manual_extraction",
            "created_at": 1769670063339385
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769670062280122,
            "correlation_reason": "manual_extraction",
            "created_at": 1769670062327441
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769670052279846,
            "correlation_reason": "manual_extraction",
            "created_at": 1769670052434176
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769670032280263,
            "correlation_reason": "manual_extraction",
            "created_at": 1769670032420243
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769670002280343,
            "correlation_reason": "manual_extraction",
            "created_at": 1769670005340762
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769669992279538,
            "correlation_reason": "manual_extraction",
            "created_at": 1769669992319479
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769669972280266,
            "correlation_reason": "manual_extraction",
            "created_at": 1769669972352542
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769669972280266,
            "correlation_reason": "manual_extraction",
            "created_at": 1769669975355141
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769669952279524,
            "correlation_reason": "manual_extraction",
            "created_at": 1769669952314130
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769669942279773,
            "correlation_reason": "manual_extraction",
            "created_at": 1769669942390387
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769669942279773,
            "correlation_reason": "manual_extraction",
            "created_at": 1769669945413872
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38eX0uSw4C6sn80z4oLsPHJPBmH",
            "alert_name": "testttt",
            "alert_fired_at": 1769669792306196,
            "correlation_reason": "manual_extraction",
            "created_at": 1769669808539957
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769669502279803,
            "correlation_reason": "manual_extraction",
            "created_at": 1769669502322107
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769669492279643,
            "correlation_reason": "manual_extraction",
            "created_at": 1769669493319819
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769669492279643,
            "correlation_reason": "manual_extraction",
            "created_at": 1769669492316343
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769669472279562,
            "correlation_reason": "manual_extraction",
            "created_at": 1769669472340370
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769669462280046,
            "correlation_reason": "manual_extraction",
            "created_at": 1769669463325462
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769669462280046,
            "correlation_reason": "manual_extraction",
            "created_at": 1769669462331239
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769669432279563,
            "correlation_reason": "manual_extraction",
            "created_at": 1769669432315933
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769669417289396,
            "correlation_reason": "manual_extraction",
            "created_at": 1769669417335353
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769669402280304,
            "correlation_reason": "manual_extraction",
            "created_at": 1769669409327659
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769669382279835,
            "correlation_reason": "manual_extraction",
            "created_at": 1769669382356270
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769669372279714,
            "correlation_reason": "manual_extraction",
            "created_at": 1769669372497041
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769669372279714,
            "correlation_reason": "manual_extraction",
            "created_at": 1769669373375351
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769669352279906,
            "correlation_reason": "manual_extraction",
            "created_at": 1769669352321284
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769669342279960,
            "correlation_reason": "manual_extraction",
            "created_at": 1769669342340132
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769669342279960,
            "correlation_reason": "manual_extraction",
            "created_at": 1769669343326245
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38eX0uSw4C6sn80z4oLsPHJPBmH",
            "alert_name": "testttt",
            "alert_fired_at": 1769669177292455,
            "correlation_reason": "manual_extraction",
            "created_at": 1769669193971915
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769668902280476,
            "correlation_reason": "manual_extraction",
            "created_at": 1769668902316706
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769668902280476,
            "correlation_reason": "manual_extraction",
            "created_at": 1769668903319358
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769668882374351,
            "correlation_reason": "manual_extraction",
            "created_at": 1769668882437855
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769668882374351,
            "correlation_reason": "manual_extraction",
            "created_at": 1769668883446036
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769668862279774,
            "correlation_reason": "manual_extraction",
            "created_at": 1769668863322019
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769668862279774,
            "correlation_reason": "manual_extraction",
            "created_at": 1769668862322869
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769668842279958,
            "correlation_reason": "manual_extraction",
            "created_at": 1769668842319129
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769668822279763,
            "correlation_reason": "manual_extraction",
            "created_at": 1769668822317536
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769668802280040,
            "correlation_reason": "manual_extraction",
            "created_at": 1769668805427655
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769668792280371,
            "correlation_reason": "manual_extraction",
            "created_at": 1769668792315674
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769668772280367,
            "correlation_reason": "manual_extraction",
            "created_at": 1769668772318202
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769668772280367,
            "correlation_reason": "manual_extraction",
            "created_at": 1769668773321432
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769668752279868,
            "correlation_reason": "manual_extraction",
            "created_at": 1769668752543007
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769668742280098,
            "correlation_reason": "manual_extraction",
            "created_at": 1769668742374520
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769668742280098,
            "correlation_reason": "manual_extraction",
            "created_at": 1769668743320057
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38eX0uSw4C6sn80z4oLsPHJPBmH",
            "alert_name": "testttt",
            "alert_fired_at": 1769668592329016,
            "correlation_reason": "manual_extraction",
            "created_at": 1769668595009729
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769668292280442,
            "correlation_reason": "manual_extraction",
            "created_at": 1769668293332628
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769668292280442,
            "correlation_reason": "manual_extraction",
            "created_at": 1769668292333683
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769668272279769,
            "correlation_reason": "manual_extraction",
            "created_at": 1769668273317448
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769668272279769,
            "correlation_reason": "manual_extraction",
            "created_at": 1769668272314008
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769668262279560,
            "correlation_reason": "manual_extraction",
            "created_at": 1769668262325962
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769668262279560,
            "correlation_reason": "manual_extraction",
            "created_at": 1769668263321680
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769668232280501,
            "correlation_reason": "manual_extraction",
            "created_at": 1769668232354054
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769668212279948,
            "correlation_reason": "manual_extraction",
            "created_at": 1769668212386199
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769668202280123,
            "correlation_reason": "manual_extraction",
            "created_at": 1769668205337107
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769668182280247,
            "correlation_reason": "manual_extraction",
            "created_at": 1769668182323820
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769668172280214,
            "correlation_reason": "manual_extraction",
            "created_at": 1769668172327867
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769668172280214,
            "correlation_reason": "manual_extraction",
            "created_at": 1769668173325591
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769668152279988,
            "correlation_reason": "manual_extraction",
            "created_at": 1769668152419110
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769668142279772,
            "correlation_reason": "manual_extraction",
            "created_at": 1769668142344487
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769668142279772,
            "correlation_reason": "manual_extraction",
            "created_at": 1769668143329074
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769667712279499,
            "correlation_reason": "manual_extraction",
            "created_at": 1769667715565335
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769667692280251,
            "correlation_reason": "manual_extraction",
            "created_at": 1769667692314575
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769667692280251,
            "correlation_reason": "manual_extraction",
            "created_at": 1769667693323686
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769667672279575,
            "correlation_reason": "manual_extraction",
            "created_at": 1769667672317449
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769667662280086,
            "correlation_reason": "manual_extraction",
            "created_at": 1769667663338589
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769667662280086,
            "correlation_reason": "manual_extraction",
            "created_at": 1769667662355404
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769667642279839,
            "correlation_reason": "manual_extraction",
            "created_at": 1769667642364637
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769667622280367,
            "correlation_reason": "manual_extraction",
            "created_at": 1769667622406625
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769667602279510,
            "correlation_reason": "manual_extraction",
            "created_at": 1769667605416419
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769667572280341,
            "correlation_reason": "manual_extraction",
            "created_at": 1769667572321920
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769667572280341,
            "correlation_reason": "manual_extraction",
            "created_at": 1769667573316694
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769667552280433,
            "correlation_reason": "manual_extraction",
            "created_at": 1769667553316708
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769667552280433,
            "correlation_reason": "manual_extraction",
            "created_at": 1769667552316917
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769667542279976,
            "correlation_reason": "manual_extraction",
            "created_at": 1769667542374708
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769667542279976,
            "correlation_reason": "manual_extraction",
            "created_at": 1769667543319680
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769667092280056,
            "correlation_reason": "manual_extraction",
            "created_at": 1769667093333558
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769667092280056,
            "correlation_reason": "manual_extraction",
            "created_at": 1769667092332134
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769667072280283,
            "correlation_reason": "manual_extraction",
            "created_at": 1769667072322232
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769667072280283,
            "correlation_reason": "manual_extraction",
            "created_at": 1769667073320690
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769667062280318,
            "correlation_reason": "manual_extraction",
            "created_at": 1769667065328604
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769667062280318,
            "correlation_reason": "manual_extraction",
            "created_at": 1769667063446650
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769667042279753,
            "correlation_reason": "manual_extraction",
            "created_at": 1769667042326917
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769667022280204,
            "correlation_reason": "manual_extraction",
            "created_at": 1769667022417502
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769667002279638,
            "correlation_reason": "manual_extraction",
            "created_at": 1769667009326475
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769666992279593,
            "correlation_reason": "manual_extraction",
            "created_at": 1769666992325703
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769666972279879,
            "correlation_reason": "manual_extraction",
            "created_at": 1769666973368650
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769666972279879,
            "correlation_reason": "manual_extraction",
            "created_at": 1769666972337772
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769666952280035,
            "correlation_reason": "manual_extraction",
            "created_at": 1769666952329327
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769666942279591,
            "correlation_reason": "manual_extraction",
            "created_at": 1769666943321919
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769666942279591,
            "correlation_reason": "manual_extraction",
            "created_at": 1769666942517486
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769666502280304,
            "correlation_reason": "manual_extraction",
            "created_at": 1769666503356934
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769666502280304,
            "correlation_reason": "manual_extraction",
            "created_at": 1769666502537061
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769666482279524,
            "correlation_reason": "manual_extraction",
            "created_at": 1769666483346614
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769666482279524,
            "correlation_reason": "manual_extraction",
            "created_at": 1769666482372715
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769666462279489,
            "correlation_reason": "manual_extraction",
            "created_at": 1769666462328579
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769666462279489,
            "correlation_reason": "manual_extraction",
            "created_at": 1769666463365702
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769666442279560,
            "correlation_reason": "manual_extraction",
            "created_at": 1769666443337293
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769666432280153,
            "correlation_reason": "manual_extraction",
            "created_at": 1769666432363312
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769666402279893,
            "correlation_reason": "manual_extraction",
            "created_at": 1769666405330509
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769666392279812,
            "correlation_reason": "manual_extraction",
            "created_at": 1769666392319502
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769666372280054,
            "correlation_reason": "manual_extraction",
            "created_at": 1769666372313385
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769666372280054,
            "correlation_reason": "manual_extraction",
            "created_at": 1769666373318269
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769666352280443,
            "correlation_reason": "manual_extraction",
            "created_at": 1769666352315256
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769666342279606,
            "correlation_reason": "manual_extraction",
            "created_at": 1769666342370053
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769666342279606,
            "correlation_reason": "manual_extraction",
            "created_at": 1769666343377571
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769665902280301,
            "correlation_reason": "manual_extraction",
            "created_at": 1769665903320767
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769665902280301,
            "correlation_reason": "manual_extraction",
            "created_at": 1769665902325590
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769665882280292,
            "correlation_reason": "manual_extraction",
            "created_at": 1769665882318037
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769665882280292,
            "correlation_reason": "manual_extraction",
            "created_at": 1769665883323312
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769665862280110,
            "correlation_reason": "manual_extraction",
            "created_at": 1769665863316752
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769665862280110,
            "correlation_reason": "manual_extraction",
            "created_at": 1769665862320468
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769665842279913,
            "correlation_reason": "manual_extraction",
            "created_at": 1769665842322079
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769665822280034,
            "correlation_reason": "manual_extraction",
            "created_at": 1769665823452695
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769665802280086,
            "correlation_reason": "manual_extraction",
            "created_at": 1769665809327990
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769665792279997,
            "correlation_reason": "manual_extraction",
            "created_at": 1769665792319253
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769665772279699,
            "correlation_reason": "manual_extraction",
            "created_at": 1769665773327490
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769665772279699,
            "correlation_reason": "manual_extraction",
            "created_at": 1769665772310884
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769665752279899,
            "correlation_reason": "manual_extraction",
            "created_at": 1769665752345619
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769665742280067,
            "correlation_reason": "manual_extraction",
            "created_at": 1769665742468874
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769665742280067,
            "correlation_reason": "manual_extraction",
            "created_at": 1769665743382778
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769665292279660,
            "correlation_reason": "manual_extraction",
            "created_at": 1769665293345751
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769665292279660,
            "correlation_reason": "manual_extraction",
            "created_at": 1769665292360436
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769665282310320,
            "correlation_reason": "manual_extraction",
            "created_at": 1769665283344419
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769665282310320,
            "correlation_reason": "manual_extraction",
            "created_at": 1769665282345744
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769665262279667,
            "correlation_reason": "manual_extraction",
            "created_at": 1769665263327626
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769665262279667,
            "correlation_reason": "manual_extraction",
            "created_at": 1769665265437733
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769665242279625,
            "correlation_reason": "manual_extraction",
            "created_at": 1769665242327986
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769665222280123,
            "correlation_reason": "manual_extraction",
            "created_at": 1769665223316671
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769665202279727,
            "correlation_reason": "manual_extraction",
            "created_at": 1769665209425065
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769665192280447,
            "correlation_reason": "manual_extraction",
            "created_at": 1769665192322121
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769665172279505,
            "correlation_reason": "manual_extraction",
            "created_at": 1769665172322075
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769665172279505,
            "correlation_reason": "manual_extraction",
            "created_at": 1769665173324649
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769665152451328,
            "correlation_reason": "manual_extraction",
            "created_at": 1769665152571176
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769665142279967,
            "correlation_reason": "manual_extraction",
            "created_at": 1769665143369430
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769665142279967,
            "correlation_reason": "manual_extraction",
            "created_at": 1769665142445617
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769664712389267,
            "correlation_reason": "manual_extraction",
            "created_at": 1769664712429221
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769664692279665,
            "correlation_reason": "manual_extraction",
            "created_at": 1769664692318465
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769664692279665,
            "correlation_reason": "manual_extraction",
            "created_at": 1769664693315387
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769664672279975,
            "correlation_reason": "manual_extraction",
            "created_at": 1769664672392526
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769664662280478,
            "correlation_reason": "manual_extraction",
            "created_at": 1769664665340337
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769664662280478,
            "correlation_reason": "manual_extraction",
            "created_at": 1769664663338072
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769664652279524,
            "correlation_reason": "manual_extraction",
            "created_at": 1769664652341875
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769664632279618,
            "correlation_reason": "manual_extraction",
            "created_at": 1769664632322391
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769664602279744,
            "correlation_reason": "manual_extraction",
            "created_at": 1769664617326128
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769664582279544,
            "correlation_reason": "manual_extraction",
            "created_at": 1769664582338455
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769664572280351,
            "correlation_reason": "manual_extraction",
            "created_at": 1769664575364210
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769664572280351,
            "correlation_reason": "manual_extraction",
            "created_at": 1769664572332204
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769664552280075,
            "correlation_reason": "manual_extraction",
            "created_at": 1769664552326881
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769664542280416,
            "correlation_reason": "manual_extraction",
            "created_at": 1769664543321321
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769664542280416,
            "correlation_reason": "manual_extraction",
            "created_at": 1769664542390294
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769664092280347,
            "correlation_reason": "manual_extraction",
            "created_at": 1769664092353478
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769664092280347,
            "correlation_reason": "manual_extraction",
            "created_at": 1769664093357561
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769664072279895,
            "correlation_reason": "manual_extraction",
            "created_at": 1769664072320656
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769664072279895,
            "correlation_reason": "manual_extraction",
            "created_at": 1769664073317911
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769664062280327,
            "correlation_reason": "manual_extraction",
            "created_at": 1769664063320593
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769664062280327,
            "correlation_reason": "manual_extraction",
            "created_at": 1769664062316984
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769664042279966,
            "correlation_reason": "manual_extraction",
            "created_at": 1769664042319660
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769664022279989,
            "correlation_reason": "manual_extraction",
            "created_at": 1769664023329740
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769664002279608,
            "correlation_reason": "manual_extraction",
            "created_at": 1769664009423406
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769663982279951,
            "correlation_reason": "manual_extraction",
            "created_at": 1769663983318962
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769663972279518,
            "correlation_reason": "manual_extraction",
            "created_at": 1769663973320827
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769663972279518,
            "correlation_reason": "manual_extraction",
            "created_at": 1769663972323116
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769663952279970,
            "correlation_reason": "manual_extraction",
            "created_at": 1769663952336652
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769663942279503,
            "correlation_reason": "manual_extraction",
            "created_at": 1769663942394497
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769663942279503,
            "correlation_reason": "manual_extraction",
            "created_at": 1769663943376174
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769663502279889,
            "correlation_reason": "manual_extraction",
            "created_at": 1769663503408647
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769663502279889,
            "correlation_reason": "manual_extraction",
            "created_at": 1769663502512781
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769663482279623,
            "correlation_reason": "manual_extraction",
            "created_at": 1769663483351373
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769663482279623,
            "correlation_reason": "manual_extraction",
            "created_at": 1769663482353066
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769663462280099,
            "correlation_reason": "manual_extraction",
            "created_at": 1769663463319657
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769663462280099,
            "correlation_reason": "manual_extraction",
            "created_at": 1769663465400221
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769663442279660,
            "correlation_reason": "manual_extraction",
            "created_at": 1769663442398436
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769663422280137,
            "correlation_reason": "manual_extraction",
            "created_at": 1769663422340358
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769663402280085,
            "correlation_reason": "manual_extraction",
            "created_at": 1769663409331840
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769663372280484,
            "correlation_reason": "manual_extraction",
            "created_at": 1769663373320607
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769663372280484,
            "correlation_reason": "manual_extraction",
            "created_at": 1769663372327855
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769663352280487,
            "correlation_reason": "manual_extraction",
            "created_at": 1769663353397861
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769663352280487,
            "correlation_reason": "manual_extraction",
            "created_at": 1769663352335483
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769663342279655,
            "correlation_reason": "manual_extraction",
            "created_at": 1769663342355201
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769663342279655,
            "correlation_reason": "manual_extraction",
            "created_at": 1769663343326726
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769662902279518,
            "correlation_reason": "manual_extraction",
            "created_at": 1769662903344838
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769662902279518,
            "correlation_reason": "manual_extraction",
            "created_at": 1769662902350901
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769662882280479,
            "correlation_reason": "manual_extraction",
            "created_at": 1769662883337719
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769662882280479,
            "correlation_reason": "manual_extraction",
            "created_at": 1769662882325038
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769662862280127,
            "correlation_reason": "manual_extraction",
            "created_at": 1769662862324908
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769662862280127,
            "correlation_reason": "manual_extraction",
            "created_at": 1769662863320542
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769662852280413,
            "correlation_reason": "manual_extraction",
            "created_at": 1769662852328659
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769662832279899,
            "correlation_reason": "manual_extraction",
            "created_at": 1769662832342915
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769662802279540,
            "correlation_reason": "manual_extraction",
            "created_at": 1769662809490645
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769662792279889,
            "correlation_reason": "manual_extraction",
            "created_at": 1769662792354275
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769662792279889,
            "correlation_reason": "manual_extraction",
            "created_at": 1769662793422547
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769662772279575,
            "correlation_reason": "manual_extraction",
            "created_at": 1769662773362496
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769662772279575,
            "correlation_reason": "manual_extraction",
            "created_at": 1769662772319280
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769662742279747,
            "correlation_reason": "manual_extraction",
            "created_at": 1769662745329238
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769662742279747,
            "correlation_reason": "manual_extraction",
            "created_at": 1769662743351311
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769662302280362,
            "correlation_reason": "manual_extraction",
            "created_at": 1769662303323394
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769662302280362,
            "correlation_reason": "manual_extraction",
            "created_at": 1769662302388302
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769662282280280,
            "correlation_reason": "manual_extraction",
            "created_at": 1769662282326070
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769662282280280,
            "correlation_reason": "manual_extraction",
            "created_at": 1769662283321606
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769662262279614,
            "correlation_reason": "manual_extraction",
            "created_at": 1769662263331542
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769662262279614,
            "correlation_reason": "manual_extraction",
            "created_at": 1769662262387834
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769662242280252,
            "correlation_reason": "manual_extraction",
            "created_at": 1769662242369052
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769662232280161,
            "correlation_reason": "manual_extraction",
            "created_at": 1769662232319650
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769662202279986,
            "correlation_reason": "manual_extraction",
            "created_at": 1769662209410327
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769662172279833,
            "correlation_reason": "manual_extraction",
            "created_at": 1769662172484566
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769662172279833,
            "correlation_reason": "manual_extraction",
            "created_at": 1769662173388151
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769662162279789,
            "correlation_reason": "manual_extraction",
            "created_at": 1769662162322604
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769662162279789,
            "correlation_reason": "manual_extraction",
            "created_at": 1769662165317543
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769662142280424,
            "correlation_reason": "manual_extraction",
            "created_at": 1769662143324569
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769662142280424,
            "correlation_reason": "manual_extraction",
            "created_at": 1769662142374760
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769661682356275,
            "correlation_reason": "manual_extraction",
            "created_at": 1769661683411868
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769661682356275,
            "correlation_reason": "manual_extraction",
            "created_at": 1769661682417291
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769661672280092,
            "correlation_reason": "manual_extraction",
            "created_at": 1769661672328700
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769661672280092,
            "correlation_reason": "manual_extraction",
            "created_at": 1769661673369788
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769661662279984,
            "correlation_reason": "manual_extraction",
            "created_at": 1769661663324633
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769661662279984,
            "correlation_reason": "manual_extraction",
            "created_at": 1769661662325384
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769661642280068,
            "correlation_reason": "manual_extraction",
            "created_at": 1769661642319505
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769661622279608,
            "correlation_reason": "manual_extraction",
            "created_at": 1769661622348541
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769661602280136,
            "correlation_reason": "manual_extraction",
            "created_at": 1769661609451839
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769661572280176,
            "correlation_reason": "manual_extraction",
            "created_at": 1769661573477157
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769661572280176,
            "correlation_reason": "manual_extraction",
            "created_at": 1769661572422785
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769661552280410,
            "correlation_reason": "manual_extraction",
            "created_at": 1769661552599354
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769661552280410,
            "correlation_reason": "manual_extraction",
            "created_at": 1769661553576973
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769661542279550,
            "correlation_reason": "manual_extraction",
            "created_at": 1769661543353817
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769661542279550,
            "correlation_reason": "manual_extraction",
            "created_at": 1769661542357517
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769661092280389,
            "correlation_reason": "manual_extraction",
            "created_at": 1769661093324638
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769661092280389,
            "correlation_reason": "manual_extraction",
            "created_at": 1769661092324285
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769661072279643,
            "correlation_reason": "manual_extraction",
            "created_at": 1769661072398173
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769661072279643,
            "correlation_reason": "manual_extraction",
            "created_at": 1769661073326465
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769661062280234,
            "correlation_reason": "manual_extraction",
            "created_at": 1769661063321108
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769661062280234,
            "correlation_reason": "manual_extraction",
            "created_at": 1769661062318646
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769661042279771,
            "correlation_reason": "manual_extraction",
            "created_at": 1769661042331311
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769661022279892,
            "correlation_reason": "manual_extraction",
            "created_at": 1769661022350025
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769661002279575,
            "correlation_reason": "manual_extraction",
            "created_at": 1769661009334924
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769660982279835,
            "correlation_reason": "manual_extraction",
            "created_at": 1769660982328604
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769660972279932,
            "correlation_reason": "manual_extraction",
            "created_at": 1769660972327248
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769660972279932,
            "correlation_reason": "manual_extraction",
            "created_at": 1769660975327968
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769660952279544,
            "correlation_reason": "manual_extraction",
            "created_at": 1769660952324176
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769660942280301,
            "correlation_reason": "manual_extraction",
            "created_at": 1769660943397740
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769660942280301,
            "correlation_reason": "manual_extraction",
            "created_at": 1769660942363912
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769660512280376,
            "correlation_reason": "manual_extraction",
            "created_at": 1769660512322970
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769660492279963,
            "correlation_reason": "manual_extraction",
            "created_at": 1769660492318396
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769660492279963,
            "correlation_reason": "manual_extraction",
            "created_at": 1769660493327386
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769660472280359,
            "correlation_reason": "manual_extraction",
            "created_at": 1769660472380827
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769660462279543,
            "correlation_reason": "manual_extraction",
            "created_at": 1769660463322756
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769660462279543,
            "correlation_reason": "manual_extraction",
            "created_at": 1769660462320395
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769660432279756,
            "correlation_reason": "manual_extraction",
            "created_at": 1769660432328552
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769660412280140,
            "correlation_reason": "manual_extraction",
            "created_at": 1769660412314825
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769660402280085,
            "correlation_reason": "manual_extraction",
            "created_at": 1769660405461671
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769660382279939,
            "correlation_reason": "manual_extraction",
            "created_at": 1769660382326334
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769660372280207,
            "correlation_reason": "manual_extraction",
            "created_at": 1769660372326034
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769660372280207,
            "correlation_reason": "manual_extraction",
            "created_at": 1769660373329141
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769660352280157,
            "correlation_reason": "manual_extraction",
            "created_at": 1769660352323231
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769660342280159,
            "correlation_reason": "manual_extraction",
            "created_at": 1769660343370463
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769660342280159,
            "correlation_reason": "manual_extraction",
            "created_at": 1769660342421413
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769659902279893,
            "correlation_reason": "manual_extraction",
            "created_at": 1769659902382170
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769659902279893,
            "correlation_reason": "manual_extraction",
            "created_at": 1769659903341485
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769659892279771,
            "correlation_reason": "manual_extraction",
            "created_at": 1769659893320613
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769659892279771,
            "correlation_reason": "manual_extraction",
            "created_at": 1769659892318215
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769659862279901,
            "correlation_reason": "manual_extraction",
            "created_at": 1769659863358623
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769659862279901,
            "correlation_reason": "manual_extraction",
            "created_at": 1769659862335533
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769659852279900,
            "correlation_reason": "manual_extraction",
            "created_at": 1769659852334422
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769659832280102,
            "correlation_reason": "manual_extraction",
            "created_at": 1769659832506121
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769659802279891,
            "correlation_reason": "manual_extraction",
            "created_at": 1769659805350161
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769659782279942,
            "correlation_reason": "manual_extraction",
            "created_at": 1769659782322480
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769659782279942,
            "correlation_reason": "manual_extraction",
            "created_at": 1769659783348593
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769659762280256,
            "correlation_reason": "manual_extraction",
            "created_at": 1769659762324080
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769659762280256,
            "correlation_reason": "manual_extraction",
            "created_at": 1769659763359179
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769659742279971,
            "correlation_reason": "manual_extraction",
            "created_at": 1769659742380526
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769659742279971,
            "correlation_reason": "manual_extraction",
            "created_at": 1769659743316104
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769659302279906,
            "correlation_reason": "manual_extraction",
            "created_at": 1769659302591421
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769659302279906,
            "correlation_reason": "manual_extraction",
            "created_at": 1769659303427579
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769659282280056,
            "correlation_reason": "manual_extraction",
            "created_at": 1769659285346749
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769659282280056,
            "correlation_reason": "manual_extraction",
            "created_at": 1769659283352940
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769659262280325,
            "correlation_reason": "manual_extraction",
            "created_at": 1769659263348958
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769659262280325,
            "correlation_reason": "manual_extraction",
            "created_at": 1769659262354969
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769659242279595,
            "correlation_reason": "manual_extraction",
            "created_at": 1769659242370833
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769659232279707,
            "correlation_reason": "manual_extraction",
            "created_at": 1769659232347044
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769659202279696,
            "correlation_reason": "manual_extraction",
            "created_at": 1769659209326058
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769659172280283,
            "correlation_reason": "manual_extraction",
            "created_at": 1769659172334055
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769659172280283,
            "correlation_reason": "manual_extraction",
            "created_at": 1769659173395306
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769659152279504,
            "correlation_reason": "manual_extraction",
            "created_at": 1769659152324487
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769659152279504,
            "correlation_reason": "manual_extraction",
            "created_at": 1769659153321464
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769659142279878,
            "correlation_reason": "manual_extraction",
            "created_at": 1769659143341777
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769659142279878,
            "correlation_reason": "manual_extraction",
            "created_at": 1769659142360314
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769658702280157,
            "correlation_reason": "manual_extraction",
            "created_at": 1769658702317957
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769658702280157,
            "correlation_reason": "manual_extraction",
            "created_at": 1769658703324645
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769658682280178,
            "correlation_reason": "manual_extraction",
            "created_at": 1769658683326189
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769658682280178,
            "correlation_reason": "manual_extraction",
            "created_at": 1769658682354782
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769658662279493,
            "correlation_reason": "manual_extraction",
            "created_at": 1769658663329828
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769658662279493,
            "correlation_reason": "manual_extraction",
            "created_at": 1769658662326018
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769658642279905,
            "correlation_reason": "manual_extraction",
            "created_at": 1769658642321429
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769658622279980,
            "correlation_reason": "manual_extraction",
            "created_at": 1769658622441757
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769658602279982,
            "correlation_reason": "manual_extraction",
            "created_at": 1769658603319071
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769658592279537,
            "correlation_reason": "manual_extraction",
            "created_at": 1769658592319983
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769658572279689,
            "correlation_reason": "manual_extraction",
            "created_at": 1769658573328470
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769658572279689,
            "correlation_reason": "manual_extraction",
            "created_at": 1769658572352003
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769658552279542,
            "correlation_reason": "manual_extraction",
            "created_at": 1769658552325840
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769658542279495,
            "correlation_reason": "manual_extraction",
            "created_at": 1769658542385164
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769658542279495,
            "correlation_reason": "manual_extraction",
            "created_at": 1769658543379825
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769658112279970,
            "correlation_reason": "manual_extraction",
            "created_at": 1769658115329705
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769658082401332,
            "correlation_reason": "manual_extraction",
            "created_at": 1769658083465318
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769658082401332,
            "correlation_reason": "manual_extraction",
            "created_at": 1769658082460121
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769658072279799,
            "correlation_reason": "manual_extraction",
            "created_at": 1769658072325673
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769658062280289,
            "correlation_reason": "manual_extraction",
            "created_at": 1769658063326058
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769658062280289,
            "correlation_reason": "manual_extraction",
            "created_at": 1769658062321110
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769658042279859,
            "correlation_reason": "manual_extraction",
            "created_at": 1769658042361660
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769658022280094,
            "correlation_reason": "manual_extraction",
            "created_at": 1769658022316275
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769658002279802,
            "correlation_reason": "manual_extraction",
            "created_at": 1769658003342250
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769657992280313,
            "correlation_reason": "manual_extraction",
            "created_at": 1769657992330483
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769657972279875,
            "correlation_reason": "manual_extraction",
            "created_at": 1769657972333489
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769657972279875,
            "correlation_reason": "manual_extraction",
            "created_at": 1769657973324448
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769657952280289,
            "correlation_reason": "manual_extraction",
            "created_at": 1769657952321477
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769657942280482,
            "correlation_reason": "manual_extraction",
            "created_at": 1769657942337252
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769657942280482,
            "correlation_reason": "manual_extraction",
            "created_at": 1769657943327359
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769657492279656,
            "correlation_reason": "manual_extraction",
            "created_at": 1769657493314939
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769657492279656,
            "correlation_reason": "manual_extraction",
            "created_at": 1769657492321022
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769657472279984,
            "correlation_reason": "manual_extraction",
            "created_at": 1769657473324678
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769657472279984,
            "correlation_reason": "manual_extraction",
            "created_at": 1769657472315566
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769657462280331,
            "correlation_reason": "manual_extraction",
            "created_at": 1769657465330553
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769657462280331,
            "correlation_reason": "manual_extraction",
            "created_at": 1769657463316714
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769657442279652,
            "correlation_reason": "manual_extraction",
            "created_at": 1769657442320957
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769657417291373,
            "correlation_reason": "manual_extraction",
            "created_at": 1769657417332714
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769657402280496,
            "correlation_reason": "manual_extraction",
            "created_at": 1769657403409224
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769657382280032,
            "correlation_reason": "manual_extraction",
            "created_at": 1769657382319739
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769657372279523,
            "correlation_reason": "manual_extraction",
            "created_at": 1769657372330029
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769657372279523,
            "correlation_reason": "manual_extraction",
            "created_at": 1769657373365571
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769657352279500,
            "correlation_reason": "manual_extraction",
            "created_at": 1769657352315209
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769657342280229,
            "correlation_reason": "manual_extraction",
            "created_at": 1769657342363037
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769657342280229,
            "correlation_reason": "manual_extraction",
            "created_at": 1769657343329611
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769656902279565,
            "correlation_reason": "manual_extraction",
            "created_at": 1769656902324150
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769656892279810,
            "correlation_reason": "manual_extraction",
            "created_at": 1769656892317901
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769656892279810,
            "correlation_reason": "manual_extraction",
            "created_at": 1769656893315850
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769656872279765,
            "correlation_reason": "manual_extraction",
            "created_at": 1769656872331527
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769656862279957,
            "correlation_reason": "manual_extraction",
            "created_at": 1769656863323895
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769656862279957,
            "correlation_reason": "manual_extraction",
            "created_at": 1769656862352238
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769656832279989,
            "correlation_reason": "manual_extraction",
            "created_at": 1769656832317024
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769656822280429,
            "correlation_reason": "manual_extraction",
            "created_at": 1769656822317883
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769656802279580,
            "correlation_reason": "manual_extraction",
            "created_at": 1769656809477496
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769656792279948,
            "correlation_reason": "manual_extraction",
            "created_at": 1769656792318938
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769656772279941,
            "correlation_reason": "manual_extraction",
            "created_at": 1769656772319000
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769656772279941,
            "correlation_reason": "manual_extraction",
            "created_at": 1769656773320511
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769656752279889,
            "correlation_reason": "manual_extraction",
            "created_at": 1769656752492469
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769656742280488,
            "correlation_reason": "manual_extraction",
            "created_at": 1769656742341535
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769656742280488,
            "correlation_reason": "manual_extraction",
            "created_at": 1769656743321499
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769656302280450,
            "correlation_reason": "manual_extraction",
            "created_at": 1769656302331593
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769656292279701,
            "correlation_reason": "manual_extraction",
            "created_at": 1769656293324141
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769656292279701,
            "correlation_reason": "manual_extraction",
            "created_at": 1769656292334797
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769656272280407,
            "correlation_reason": "manual_extraction",
            "created_at": 1769656272403373
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769656262279760,
            "correlation_reason": "manual_extraction",
            "created_at": 1769656262391182
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769656262279760,
            "correlation_reason": "manual_extraction",
            "created_at": 1769656263341442
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769656232280107,
            "correlation_reason": "manual_extraction",
            "created_at": 1769656233333626
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769656212280455,
            "correlation_reason": "manual_extraction",
            "created_at": 1769656212361195
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769656202280436,
            "correlation_reason": "manual_extraction",
            "created_at": 1769656203334231
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769656182279984,
            "correlation_reason": "manual_extraction",
            "created_at": 1769656182324996
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769656172280452,
            "correlation_reason": "manual_extraction",
            "created_at": 1769656172325726
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769656172280452,
            "correlation_reason": "manual_extraction",
            "created_at": 1769656173335978
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769656152280126,
            "correlation_reason": "manual_extraction",
            "created_at": 1769656152427664
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769656142280280,
            "correlation_reason": "manual_extraction",
            "created_at": 1769656142464431
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769656142280280,
            "correlation_reason": "manual_extraction",
            "created_at": 1769656143389226
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769655702280063,
            "correlation_reason": "manual_extraction",
            "created_at": 1769655702590959
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769655692280420,
            "correlation_reason": "manual_extraction",
            "created_at": 1769655692528892
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769655692280420,
            "correlation_reason": "manual_extraction",
            "created_at": 1769655693502184
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769655672280303,
            "correlation_reason": "manual_extraction",
            "created_at": 1769655672330432
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769655662279788,
            "correlation_reason": "manual_extraction",
            "created_at": 1769655663384066
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769655662279788,
            "correlation_reason": "manual_extraction",
            "created_at": 1769655662332391
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769655632279500,
            "correlation_reason": "manual_extraction",
            "created_at": 1769655632332206
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769655622279848,
            "correlation_reason": "manual_extraction",
            "created_at": 1769655623365015
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769655602280156,
            "correlation_reason": "manual_extraction",
            "created_at": 1769655609341012
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769655582280299,
            "correlation_reason": "manual_extraction",
            "created_at": 1769655582320574
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769655572279749,
            "correlation_reason": "manual_extraction",
            "created_at": 1769655572318049
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769655572279749,
            "correlation_reason": "manual_extraction",
            "created_at": 1769655573327301
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769655552279685,
            "correlation_reason": "manual_extraction",
            "created_at": 1769655552443283
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769655542280200,
            "correlation_reason": "manual_extraction",
            "created_at": 1769655543332983
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769655542280200,
            "correlation_reason": "manual_extraction",
            "created_at": 1769655542344588
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769655102280433,
            "correlation_reason": "manual_extraction",
            "created_at": 1769655102331454
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769655102280433,
            "correlation_reason": "manual_extraction",
            "created_at": 1769655103316972
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769655082280238,
            "correlation_reason": "manual_extraction",
            "created_at": 1769655082440955
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769655082280238,
            "correlation_reason": "manual_extraction",
            "created_at": 1769655083331295
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769655062279902,
            "correlation_reason": "manual_extraction",
            "created_at": 1769655063333694
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769655062279902,
            "correlation_reason": "manual_extraction",
            "created_at": 1769655062325110
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769655032279957,
            "correlation_reason": "manual_extraction",
            "created_at": 1769655032314585
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769655017290615,
            "correlation_reason": "manual_extraction",
            "created_at": 1769655017328018
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769655002279993,
            "correlation_reason": "manual_extraction",
            "created_at": 1769655003331252
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769654982280412,
            "correlation_reason": "manual_extraction",
            "created_at": 1769654982330234
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769654972280330,
            "correlation_reason": "manual_extraction",
            "created_at": 1769654973325192
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769654972280330,
            "correlation_reason": "manual_extraction",
            "created_at": 1769654972334769
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769654952279984,
            "correlation_reason": "manual_extraction",
            "created_at": 1769654952317821
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769654942280405,
            "correlation_reason": "manual_extraction",
            "created_at": 1769654943378256
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769654942280405,
            "correlation_reason": "manual_extraction",
            "created_at": 1769654942547524
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769654512280083,
            "correlation_reason": "manual_extraction",
            "created_at": 1769654512323802
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769654492280361,
            "correlation_reason": "manual_extraction",
            "created_at": 1769654493492636
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769654492280361,
            "correlation_reason": "manual_extraction",
            "created_at": 1769654492317052
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769654472280335,
            "correlation_reason": "manual_extraction",
            "created_at": 1769654472344275
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769654462280336,
            "correlation_reason": "manual_extraction",
            "created_at": 1769654462324474
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769654462280336,
            "correlation_reason": "manual_extraction",
            "created_at": 1769654463326177
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769654442279982,
            "correlation_reason": "manual_extraction",
            "created_at": 1769654442340128
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769654417420300,
            "correlation_reason": "manual_extraction",
            "created_at": 1769654417464056
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769654402279679,
            "correlation_reason": "manual_extraction",
            "created_at": 1769654409328985
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769654382279976,
            "correlation_reason": "manual_extraction",
            "created_at": 1769654382377286
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769654372280297,
            "correlation_reason": "manual_extraction",
            "created_at": 1769654379331158
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769654372280297,
            "correlation_reason": "manual_extraction",
            "created_at": 1769654372332541
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769654352280185,
            "correlation_reason": "manual_extraction",
            "created_at": 1769654352551833
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769654342280065,
            "correlation_reason": "manual_extraction",
            "created_at": 1769654342545436
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769654342280065,
            "correlation_reason": "manual_extraction",
            "created_at": 1769654343500612
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769653892279901,
            "correlation_reason": "manual_extraction",
            "created_at": 1769653892321389
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769653892279901,
            "correlation_reason": "manual_extraction",
            "created_at": 1769653893318082
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769653872280401,
            "correlation_reason": "manual_extraction",
            "created_at": 1769653872338308
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769653872280401,
            "correlation_reason": "manual_extraction",
            "created_at": 1769653873334125
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769653862280115,
            "correlation_reason": "manual_extraction",
            "created_at": 1769653863328519
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769653862280115,
            "correlation_reason": "manual_extraction",
            "created_at": 1769653862330888
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769653832279552,
            "correlation_reason": "manual_extraction",
            "created_at": 1769653832321003
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769653817289828,
            "correlation_reason": "manual_extraction",
            "created_at": 1769653817371960
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769653802280251,
            "correlation_reason": "manual_extraction",
            "created_at": 1769653805339374
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769653782280403,
            "correlation_reason": "manual_extraction",
            "created_at": 1769653783331730
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769653762280228,
            "correlation_reason": "manual_extraction",
            "created_at": 1769653763328377
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769653762280228,
            "correlation_reason": "manual_extraction",
            "created_at": 1769653762324549
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769653752280265,
            "correlation_reason": "manual_extraction",
            "created_at": 1769653752408510
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769653742279760,
            "correlation_reason": "manual_extraction",
            "created_at": 1769653742357251
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769653742279760,
            "correlation_reason": "manual_extraction",
            "created_at": 1769653743330073
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769653302280219,
            "correlation_reason": "manual_extraction",
            "created_at": 1769653302355308
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769653302280219,
            "correlation_reason": "manual_extraction",
            "created_at": 1769653303339354
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769653282280369,
            "correlation_reason": "manual_extraction",
            "created_at": 1769653283339393
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769653282280369,
            "correlation_reason": "manual_extraction",
            "created_at": 1769653282339151
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769653262280200,
            "correlation_reason": "manual_extraction",
            "created_at": 1769653262325231
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769653262280200,
            "correlation_reason": "manual_extraction",
            "created_at": 1769653263342318
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769653242280429,
            "correlation_reason": "manual_extraction",
            "created_at": 1769653242318484
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769653232280412,
            "correlation_reason": "manual_extraction",
            "created_at": 1769653232647748
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769653202280374,
            "correlation_reason": "manual_extraction",
            "created_at": 1769653203334783
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769653172280115,
            "correlation_reason": "manual_extraction",
            "created_at": 1769653173320218
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769653172280115,
            "correlation_reason": "manual_extraction",
            "created_at": 1769653172328027
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769653152280462,
            "correlation_reason": "manual_extraction",
            "created_at": 1769653153317801
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769653152280462,
            "correlation_reason": "manual_extraction",
            "created_at": 1769653152320097
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769653142280206,
            "correlation_reason": "manual_extraction",
            "created_at": 1769653143380837
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769653142280206,
            "correlation_reason": "manual_extraction",
            "created_at": 1769653142511506
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769652692279973,
            "correlation_reason": "manual_extraction",
            "created_at": 1769652693368358
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769652692279973,
            "correlation_reason": "manual_extraction",
            "created_at": 1769652692315382
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769652682280201,
            "correlation_reason": "manual_extraction",
            "created_at": 1769652682316063
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769652682280201,
            "correlation_reason": "manual_extraction",
            "created_at": 1769652683324302
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769652662279804,
            "correlation_reason": "manual_extraction",
            "created_at": 1769652663317279
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769652662279804,
            "correlation_reason": "manual_extraction",
            "created_at": 1769652662323566
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769652642279771,
            "correlation_reason": "manual_extraction",
            "created_at": 1769652642437324
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769652622279709,
            "correlation_reason": "manual_extraction",
            "created_at": 1769652622313285
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769652602279806,
            "correlation_reason": "manual_extraction",
            "created_at": 1769652609331895
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769652582279781,
            "correlation_reason": "manual_extraction",
            "created_at": 1769652582316488
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769652572279605,
            "correlation_reason": "manual_extraction",
            "created_at": 1769652572322494
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769652572279605,
            "correlation_reason": "manual_extraction",
            "created_at": 1769652573323485
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769652552279645,
            "correlation_reason": "manual_extraction",
            "created_at": 1769652552326100
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769652542279569,
            "correlation_reason": "manual_extraction",
            "created_at": 1769652542387856
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769652542279569,
            "correlation_reason": "manual_extraction",
            "created_at": 1769652545335700
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769652102280400,
            "correlation_reason": "manual_extraction",
            "created_at": 1769652103381269
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769652102280400,
            "correlation_reason": "manual_extraction",
            "created_at": 1769652102492610
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769652082279998,
            "correlation_reason": "manual_extraction",
            "created_at": 1769652083350562
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769652082279998,
            "correlation_reason": "manual_extraction",
            "created_at": 1769652082349868
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769652062279496,
            "correlation_reason": "manual_extraction",
            "created_at": 1769652063343473
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769652062279496,
            "correlation_reason": "manual_extraction",
            "created_at": 1769652062333249
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769652042280257,
            "correlation_reason": "manual_extraction",
            "created_at": 1769652042324673
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769652022279723,
            "correlation_reason": "manual_extraction",
            "created_at": 1769652022336479
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769652002280265,
            "correlation_reason": "manual_extraction",
            "created_at": 1769652003321540
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769651992280322,
            "correlation_reason": "manual_extraction",
            "created_at": 1769651992321159
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769651972280342,
            "correlation_reason": "manual_extraction",
            "created_at": 1769651973324151
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769651972280342,
            "correlation_reason": "manual_extraction",
            "created_at": 1769651972319186
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769651952279663,
            "correlation_reason": "manual_extraction",
            "created_at": 1769651952317809
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769651942279874,
            "correlation_reason": "manual_extraction",
            "created_at": 1769651943330036
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769651942279874,
            "correlation_reason": "manual_extraction",
            "created_at": 1769651942351620
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769651502280106,
            "correlation_reason": "manual_extraction",
            "created_at": 1769651502411809
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769651492279961,
            "correlation_reason": "manual_extraction",
            "created_at": 1769651492492293
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769651492279961,
            "correlation_reason": "manual_extraction",
            "created_at": 1769651493389165
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769651472279506,
            "correlation_reason": "manual_extraction",
            "created_at": 1769651472318289
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769651462279758,
            "correlation_reason": "manual_extraction",
            "created_at": 1769651462353363
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769651462279758,
            "correlation_reason": "manual_extraction",
            "created_at": 1769651463341822
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769651442279903,
            "correlation_reason": "manual_extraction",
            "created_at": 1769651442321809
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769651422280267,
            "correlation_reason": "manual_extraction",
            "created_at": 1769651422343669
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769651402279722,
            "correlation_reason": "manual_extraction",
            "created_at": 1769651409323803
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769651392279987,
            "correlation_reason": "manual_extraction",
            "created_at": 1769651392318473
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769651372279952,
            "correlation_reason": "manual_extraction",
            "created_at": 1769651373316909
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769651372279952,
            "correlation_reason": "manual_extraction",
            "created_at": 1769651372324892
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769651352279800,
            "correlation_reason": "manual_extraction",
            "created_at": 1769651352314214
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769651342280204,
            "correlation_reason": "manual_extraction",
            "created_at": 1769651343329160
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769651342280204,
            "correlation_reason": "manual_extraction",
            "created_at": 1769651342529175
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769650892280255,
            "correlation_reason": "manual_extraction",
            "created_at": 1769650893322546
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769650892280255,
            "correlation_reason": "manual_extraction",
            "created_at": 1769650892320970
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769650872280117,
            "correlation_reason": "manual_extraction",
            "created_at": 1769650873332741
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769650872280117,
            "correlation_reason": "manual_extraction",
            "created_at": 1769650872337991
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769650862280031,
            "correlation_reason": "manual_extraction",
            "created_at": 1769650863354577
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769650862280031,
            "correlation_reason": "manual_extraction",
            "created_at": 1769650865362020
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769650842280180,
            "correlation_reason": "manual_extraction",
            "created_at": 1769650842327581
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769650822279973,
            "correlation_reason": "manual_extraction",
            "created_at": 1769650822336783
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769650802279726,
            "correlation_reason": "manual_extraction",
            "created_at": 1769650809331768
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769650782280370,
            "correlation_reason": "manual_extraction",
            "created_at": 1769650782322267
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769650772280157,
            "correlation_reason": "manual_extraction",
            "created_at": 1769650773336199
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769650772280157,
            "correlation_reason": "manual_extraction",
            "created_at": 1769650772416697
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769650752455832,
            "correlation_reason": "manual_extraction",
            "created_at": 1769650752498992
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769650742280334,
            "correlation_reason": "manual_extraction",
            "created_at": 1769650743374077
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769650742280334,
            "correlation_reason": "manual_extraction",
            "created_at": 1769650742554353
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769650302279984,
            "correlation_reason": "manual_extraction",
            "created_at": 1769650303319056
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769650302279984,
            "correlation_reason": "manual_extraction",
            "created_at": 1769650302324788
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769650282279848,
            "correlation_reason": "manual_extraction",
            "created_at": 1769650283315062
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769650282279848,
            "correlation_reason": "manual_extraction",
            "created_at": 1769650282371640
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769650262280446,
            "correlation_reason": "manual_extraction",
            "created_at": 1769650263320485
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769650262280446,
            "correlation_reason": "manual_extraction",
            "created_at": 1769650262320812
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769650252279734,
            "correlation_reason": "manual_extraction",
            "created_at": 1769650252318835
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769650232279934,
            "correlation_reason": "manual_extraction",
            "created_at": 1769650232322574
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769650202279964,
            "correlation_reason": "manual_extraction",
            "created_at": 1769650209337189
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769650192280145,
            "correlation_reason": "manual_extraction",
            "created_at": 1769650192347997
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769650172280053,
            "correlation_reason": "manual_extraction",
            "created_at": 1769650172318045
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769650172280053,
            "correlation_reason": "manual_extraction",
            "created_at": 1769650173326127
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769650152279881,
            "correlation_reason": "manual_extraction",
            "created_at": 1769650152515657
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769650142279537,
            "correlation_reason": "manual_extraction",
            "created_at": 1769650142410963
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769650142279537,
            "correlation_reason": "manual_extraction",
            "created_at": 1769650143398235
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769649692279641,
            "correlation_reason": "manual_extraction",
            "created_at": 1769649692335038
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769649692279641,
            "correlation_reason": "manual_extraction",
            "created_at": 1769649693497348
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769649682279511,
            "correlation_reason": "manual_extraction",
            "created_at": 1769649683535700
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769649682279511,
            "correlation_reason": "manual_extraction",
            "created_at": 1769649682351424
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769649662279786,
            "correlation_reason": "manual_extraction",
            "created_at": 1769649663319541
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769649662279786,
            "correlation_reason": "manual_extraction",
            "created_at": 1769649662322407
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769649642280241,
            "correlation_reason": "manual_extraction",
            "created_at": 1769649642314692
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769649622280344,
            "correlation_reason": "manual_extraction",
            "created_at": 1769649623315775
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769649602279786,
            "correlation_reason": "manual_extraction",
            "created_at": 1769649603320801
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769649582279859,
            "correlation_reason": "manual_extraction",
            "created_at": 1769649582521778
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769649572280221,
            "correlation_reason": "manual_extraction",
            "created_at": 1769649573338408
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769649572280221,
            "correlation_reason": "manual_extraction",
            "created_at": 1769649572338778
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769649552280120,
            "correlation_reason": "manual_extraction",
            "created_at": 1769649552417482
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769649542280326,
            "correlation_reason": "manual_extraction",
            "created_at": 1769649542499280
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769649542280326,
            "correlation_reason": "manual_extraction",
            "created_at": 1769649543353074
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769649102280053,
            "correlation_reason": "manual_extraction",
            "created_at": 1769649103313907
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769649102280053,
            "correlation_reason": "manual_extraction",
            "created_at": 1769649102324967
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769649082279820,
            "correlation_reason": "manual_extraction",
            "created_at": 1769649082312471
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769649082279820,
            "correlation_reason": "manual_extraction",
            "created_at": 1769649083337292
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769649062279520,
            "correlation_reason": "manual_extraction",
            "created_at": 1769649069397269
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769649062279520,
            "correlation_reason": "manual_extraction",
            "created_at": 1769649065323192
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769649042279720,
            "correlation_reason": "manual_extraction",
            "created_at": 1769649042331034
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769649022280348,
            "correlation_reason": "manual_extraction",
            "created_at": 1769649022326356
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769649002279493,
            "correlation_reason": "manual_extraction",
            "created_at": 1769649009329187
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769648982280236,
            "correlation_reason": "manual_extraction",
            "created_at": 1769648982330799
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769648972279531,
            "correlation_reason": "manual_extraction",
            "created_at": 1769648973372874
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769648972279531,
            "correlation_reason": "manual_extraction",
            "created_at": 1769648972516609
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769648952279856,
            "correlation_reason": "manual_extraction",
            "created_at": 1769648952323063
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769648942279944,
            "correlation_reason": "manual_extraction",
            "created_at": 1769648942345463
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769648942279944,
            "correlation_reason": "manual_extraction",
            "created_at": 1769648943441101
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769648502280240,
            "correlation_reason": "manual_extraction",
            "created_at": 1769648503368525
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769648502280240,
            "correlation_reason": "manual_extraction",
            "created_at": 1769648502503346
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769648482279653,
            "correlation_reason": "manual_extraction",
            "created_at": 1769648483358111
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769648482279653,
            "correlation_reason": "manual_extraction",
            "created_at": 1769648482377881
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769648462280433,
            "correlation_reason": "manual_extraction",
            "created_at": 1769648463371576
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769648462280433,
            "correlation_reason": "manual_extraction",
            "created_at": 1769648465507414
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769648442279606,
            "correlation_reason": "manual_extraction",
            "created_at": 1769648445452938
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769648422280196,
            "correlation_reason": "manual_extraction",
            "created_at": 1769648422327169
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769648402279586,
            "correlation_reason": "manual_extraction",
            "created_at": 1769648409361700
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769648392280048,
            "correlation_reason": "manual_extraction",
            "created_at": 1769648392374324
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769648372279752,
            "correlation_reason": "manual_extraction",
            "created_at": 1769648372330702
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769648372279752,
            "correlation_reason": "manual_extraction",
            "created_at": 1769648373325232
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769648352280215,
            "correlation_reason": "manual_extraction",
            "created_at": 1769648352326259
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769648342280176,
            "correlation_reason": "manual_extraction",
            "created_at": 1769648343325987
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769648342280176,
            "correlation_reason": "manual_extraction",
            "created_at": 1769648342413087
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769647902279981,
            "correlation_reason": "manual_extraction",
            "created_at": 1769647902387031
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769647902279981,
            "correlation_reason": "manual_extraction",
            "created_at": 1769647903396687
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769647882279695,
            "correlation_reason": "manual_extraction",
            "created_at": 1769647882607625
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769647882279695,
            "correlation_reason": "manual_extraction",
            "created_at": 1769647883397712
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769647862280209,
            "correlation_reason": "manual_extraction",
            "created_at": 1769647863417578
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769647862280209,
            "correlation_reason": "manual_extraction",
            "created_at": 1769647862437936
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769647842280109,
            "correlation_reason": "manual_extraction",
            "created_at": 1769647843404452
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769647832279787,
            "correlation_reason": "manual_extraction",
            "created_at": 1769647832487443
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769647802279553,
            "correlation_reason": "manual_extraction",
            "created_at": 1769647805453383
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769647792280458,
            "correlation_reason": "manual_extraction",
            "created_at": 1769647792387668
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769647772279838,
            "correlation_reason": "manual_extraction",
            "created_at": 1769647773321209
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769647772279838,
            "correlation_reason": "manual_extraction",
            "created_at": 1769647772314838
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769647752280099,
            "correlation_reason": "manual_extraction",
            "created_at": 1769647752346570
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769647742279978,
            "correlation_reason": "manual_extraction",
            "created_at": 1769647743407284
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769647742279978,
            "correlation_reason": "manual_extraction",
            "created_at": 1769647742540682
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769647292279710,
            "correlation_reason": "manual_extraction",
            "created_at": 1769647293501005
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769647292279710,
            "correlation_reason": "manual_extraction",
            "created_at": 1769647292647415
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769647272279845,
            "correlation_reason": "manual_extraction",
            "created_at": 1769647275407278
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769647272279845,
            "correlation_reason": "manual_extraction",
            "created_at": 1769647273418014
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769647262280295,
            "correlation_reason": "manual_extraction",
            "created_at": 1769647263353600
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769647262280295,
            "correlation_reason": "manual_extraction",
            "created_at": 1769647262335296
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769647242279892,
            "correlation_reason": "manual_extraction",
            "created_at": 1769647242377349
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769647222279908,
            "correlation_reason": "manual_extraction",
            "created_at": 1769647222437523
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769647202279818,
            "correlation_reason": "manual_extraction",
            "created_at": 1769647209338473
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769647172279952,
            "correlation_reason": "manual_extraction",
            "created_at": 1769647172437450
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769647172279952,
            "correlation_reason": "manual_extraction",
            "created_at": 1769647173429529
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769647152444713,
            "correlation_reason": "manual_extraction",
            "created_at": 1769647153657313
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769647152444713,
            "correlation_reason": "manual_extraction",
            "created_at": 1769647152557272
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769647142279900,
            "correlation_reason": "manual_extraction",
            "created_at": 1769647142487378
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769647142279900,
            "correlation_reason": "manual_extraction",
            "created_at": 1769647143488112
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769646692279671,
            "correlation_reason": "manual_extraction",
            "created_at": 1769646692447374
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769646692279671,
            "correlation_reason": "manual_extraction",
            "created_at": 1769646693438058
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769646672280303,
            "correlation_reason": "manual_extraction",
            "created_at": 1769646672467563
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769646672280303,
            "correlation_reason": "manual_extraction",
            "created_at": 1769646673451294
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769646662279872,
            "correlation_reason": "manual_extraction",
            "created_at": 1769646662418138
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769646662279872,
            "correlation_reason": "manual_extraction",
            "created_at": 1769646663467476
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769646602280396,
            "correlation_reason": "manual_extraction",
            "created_at": 1769646603368733
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769646582280314,
            "correlation_reason": "manual_extraction",
            "created_at": 1769646582557810
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769646572280147,
            "correlation_reason": "manual_extraction",
            "created_at": 1769646579372684
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769646572280147,
            "correlation_reason": "manual_extraction",
            "created_at": 1769646572374543
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769646572280147,
            "correlation_reason": "manual_extraction",
            "created_at": 1769646575417363
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769646552279849,
            "correlation_reason": "manual_extraction",
            "created_at": 1769646552444824
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769646542280240,
            "correlation_reason": "manual_extraction",
            "created_at": 1769646542448215
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769646542280240,
            "correlation_reason": "manual_extraction",
            "created_at": 1769646543438752
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769646542280240,
            "correlation_reason": "manual_extraction",
            "created_at": 1769646545352446
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769646102279968,
            "correlation_reason": "manual_extraction",
            "created_at": 1769646102357278
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769646082279565,
            "correlation_reason": "manual_extraction",
            "created_at": 1769646082325087
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769646082279565,
            "correlation_reason": "manual_extraction",
            "created_at": 1769646083315809
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769646072280194,
            "correlation_reason": "manual_extraction",
            "created_at": 1769646072321221
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769646062279592,
            "correlation_reason": "manual_extraction",
            "created_at": 1769646063340342
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769646062279592,
            "correlation_reason": "manual_extraction",
            "created_at": 1769646062326802
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769645982280434,
            "correlation_reason": "manual_extraction",
            "created_at": 1769645982361647
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769645982280434,
            "correlation_reason": "manual_extraction",
            "created_at": 1769645983363268
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769645962280163,
            "correlation_reason": "manual_extraction",
            "created_at": 1769645962317470
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769645962280163,
            "correlation_reason": "manual_extraction",
            "created_at": 1769645965341456
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769645962280163,
            "correlation_reason": "manual_extraction",
            "created_at": 1769645963326433
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769645952280485,
            "correlation_reason": "manual_extraction",
            "created_at": 1769645952330108
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769645942279621,
            "correlation_reason": "manual_extraction",
            "created_at": 1769645943423039
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769645942279621,
            "correlation_reason": "manual_extraction",
            "created_at": 1769645942572209
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769645942279621,
            "correlation_reason": "manual_extraction",
            "created_at": 1769645945324118
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769645502279992,
            "correlation_reason": "manual_extraction",
            "created_at": 1769645502361652
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769645492279665,
            "correlation_reason": "manual_extraction",
            "created_at": 1769645493324354
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769645492279665,
            "correlation_reason": "manual_extraction",
            "created_at": 1769645492319307
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769645472280422,
            "correlation_reason": "manual_extraction",
            "created_at": 1769645472319976
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769645462279944,
            "correlation_reason": "manual_extraction",
            "created_at": 1769645463323343
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769645462279944,
            "correlation_reason": "manual_extraction",
            "created_at": 1769645462323104
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769645372280296,
            "correlation_reason": "manual_extraction",
            "created_at": 1769645372354442
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769645372280296,
            "correlation_reason": "manual_extraction",
            "created_at": 1769645373334725
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769645372280296,
            "correlation_reason": "manual_extraction",
            "created_at": 1769645375327429
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769645352280201,
            "correlation_reason": "manual_extraction",
            "created_at": 1769645355323346
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769645352280201,
            "correlation_reason": "manual_extraction",
            "created_at": 1769645359319571
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769645352280201,
            "correlation_reason": "manual_extraction",
            "created_at": 1769645352320608
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769645342279862,
            "correlation_reason": "manual_extraction",
            "created_at": 1769645343387727
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769645342279862,
            "correlation_reason": "manual_extraction",
            "created_at": 1769645342353297
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769645342279862,
            "correlation_reason": "manual_extraction",
            "created_at": 1769645345323603
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769644902280404,
            "correlation_reason": "manual_extraction",
            "created_at": 1769644902582803
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769644882280195,
            "correlation_reason": "manual_extraction",
            "created_at": 1769644882403594
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769644862279961,
            "correlation_reason": "manual_extraction",
            "created_at": 1769644862321327
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769644862279961,
            "correlation_reason": "manual_extraction",
            "created_at": 1769644863327538
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769644842280080,
            "correlation_reason": "manual_extraction",
            "created_at": 1769644842356028
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769644802279662,
            "correlation_reason": "manual_extraction",
            "created_at": 1769644817349071
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769644782279967,
            "correlation_reason": "manual_extraction",
            "created_at": 1769644785357647
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769644782279967,
            "correlation_reason": "manual_extraction",
            "created_at": 1769644783391825
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769644782279967,
            "correlation_reason": "manual_extraction",
            "created_at": 1769644782348673
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769644772279853,
            "correlation_reason": "manual_extraction",
            "created_at": 1769644775393258
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769644772279853,
            "correlation_reason": "manual_extraction",
            "created_at": 1769644773437845
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769644772279853,
            "correlation_reason": "manual_extraction",
            "created_at": 1769644779355671
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769644742279798,
            "correlation_reason": "manual_extraction",
            "created_at": 1769644745402950
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769644742279798,
            "correlation_reason": "manual_extraction",
            "created_at": 1769644743408921
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769644742279798,
            "correlation_reason": "manual_extraction",
            "created_at": 1769644742362213
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769644302280313,
            "correlation_reason": "manual_extraction",
            "created_at": 1769644302376070
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769644282280256,
            "correlation_reason": "manual_extraction",
            "created_at": 1769644282450346
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769644262280049,
            "correlation_reason": "manual_extraction",
            "created_at": 1769644262321046
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769644252279693,
            "correlation_reason": "manual_extraction",
            "created_at": 1769644252397583
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769644232280369,
            "correlation_reason": "manual_extraction",
            "created_at": 1769644232439589
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769644202279826,
            "correlation_reason": "manual_extraction",
            "created_at": 1769644209323904
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769644182280182,
            "correlation_reason": "manual_extraction",
            "created_at": 1769644182353930
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769644182280182,
            "correlation_reason": "manual_extraction",
            "created_at": 1769644183334387
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769644162280356,
            "correlation_reason": "manual_extraction",
            "created_at": 1769644165318887
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769644162280356,
            "correlation_reason": "manual_extraction",
            "created_at": 1769644162317017
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769644162280356,
            "correlation_reason": "manual_extraction",
            "created_at": 1769644163320256
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769644152280088,
            "correlation_reason": "manual_extraction",
            "created_at": 1769644152322126
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769644142279516,
            "correlation_reason": "manual_extraction",
            "created_at": 1769644142420789
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769644142279516,
            "correlation_reason": "manual_extraction",
            "created_at": 1769644143323962
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769644142279516,
            "correlation_reason": "manual_extraction",
            "created_at": 1769644145323578
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769643702280298,
            "correlation_reason": "manual_extraction",
            "created_at": 1769643702360363
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769643682279998,
            "correlation_reason": "manual_extraction",
            "created_at": 1769643682334358
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769643662279809,
            "correlation_reason": "manual_extraction",
            "created_at": 1769643662468559
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769643642279891,
            "correlation_reason": "manual_extraction",
            "created_at": 1769643642317100
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769643622279588,
            "correlation_reason": "manual_extraction",
            "created_at": 1769643622355649
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769643602280231,
            "correlation_reason": "manual_extraction",
            "created_at": 1769643609357449
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769643572280049,
            "correlation_reason": "manual_extraction",
            "created_at": 1769643575384454
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769643572280049,
            "correlation_reason": "manual_extraction",
            "created_at": 1769643573386650
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769643572280049,
            "correlation_reason": "manual_extraction",
            "created_at": 1769643572489651
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769643552422236,
            "correlation_reason": "manual_extraction",
            "created_at": 1769643559717751
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769643552422236,
            "correlation_reason": "manual_extraction",
            "created_at": 1769643555465440
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769643552422236,
            "correlation_reason": "manual_extraction",
            "created_at": 1769643552469911
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769643542280188,
            "correlation_reason": "manual_extraction",
            "created_at": 1769643543319502
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769643542280188,
            "correlation_reason": "manual_extraction",
            "created_at": 1769643542362556
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769643542280188,
            "correlation_reason": "manual_extraction",
            "created_at": 1769643545360425
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769643102279639,
            "correlation_reason": "manual_extraction",
            "created_at": 1769643102359290
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769643082280244,
            "correlation_reason": "manual_extraction",
            "created_at": 1769643082324114
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769643062280227,
            "correlation_reason": "manual_extraction",
            "created_at": 1769643063318512
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769643042279981,
            "correlation_reason": "manual_extraction",
            "created_at": 1769643042331407
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769643022280109,
            "correlation_reason": "manual_extraction",
            "created_at": 1769643022323111
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769643002280271,
            "correlation_reason": "manual_extraction",
            "created_at": 1769643009324718
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769642982479498,
            "correlation_reason": "manual_extraction",
            "created_at": 1769642985524168
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769642982479498,
            "correlation_reason": "manual_extraction",
            "created_at": 1769642982522889
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769642982479498,
            "correlation_reason": "manual_extraction",
            "created_at": 1769642983550233
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769642962280358,
            "correlation_reason": "manual_extraction",
            "created_at": 1769642962337366
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769642962280358,
            "correlation_reason": "manual_extraction",
            "created_at": 1769642965333049
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769642962280358,
            "correlation_reason": "manual_extraction",
            "created_at": 1769642963329629
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769642942280055,
            "correlation_reason": "manual_extraction",
            "created_at": 1769642945511368
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769642942280055,
            "correlation_reason": "manual_extraction",
            "created_at": 1769642943321677
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769642942280055,
            "correlation_reason": "manual_extraction",
            "created_at": 1769642942355015
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769642492279515,
            "correlation_reason": "manual_extraction",
            "created_at": 1769642492432445
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769642472279600,
            "correlation_reason": "manual_extraction",
            "created_at": 1769642472318401
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769642462280297,
            "correlation_reason": "manual_extraction",
            "created_at": 1769642462456290
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769642442279766,
            "correlation_reason": "manual_extraction",
            "created_at": 1769642443317281
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769642422280395,
            "correlation_reason": "manual_extraction",
            "created_at": 1769642422369690
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769642402280198,
            "correlation_reason": "manual_extraction",
            "created_at": 1769642409359582
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769642392280301,
            "correlation_reason": "manual_extraction",
            "created_at": 1769642393315409
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769642392280301,
            "correlation_reason": "manual_extraction",
            "created_at": 1769642392314826
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769642372280469,
            "correlation_reason": "manual_extraction",
            "created_at": 1769642373380095
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769642372280469,
            "correlation_reason": "manual_extraction",
            "created_at": 1769642372363945
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769642372280469,
            "correlation_reason": "manual_extraction",
            "created_at": 1769642375333686
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769642352280106,
            "correlation_reason": "manual_extraction",
            "created_at": 1769642352320936
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769642342279979,
            "correlation_reason": "manual_extraction",
            "created_at": 1769642343325981
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769642342279979,
            "correlation_reason": "manual_extraction",
            "created_at": 1769642342363499
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769642342279979,
            "correlation_reason": "manual_extraction",
            "created_at": 1769642345354294
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769641892279535,
            "correlation_reason": "manual_extraction",
            "created_at": 1769641892324960
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769641872279564,
            "correlation_reason": "manual_extraction",
            "created_at": 1769641872324143
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769641862280382,
            "correlation_reason": "manual_extraction",
            "created_at": 1769641862329050
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769641832280306,
            "correlation_reason": "manual_extraction",
            "created_at": 1769641832467393
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769641822279946,
            "correlation_reason": "manual_extraction",
            "created_at": 1769641823340435
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769641802279883,
            "correlation_reason": "manual_extraction",
            "created_at": 1769641809450349
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769641792279630,
            "correlation_reason": "manual_extraction",
            "created_at": 1769641793321261
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769641792279630,
            "correlation_reason": "manual_extraction",
            "created_at": 1769641792320085
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769641772280326,
            "correlation_reason": "manual_extraction",
            "created_at": 1769641775320168
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769641772280326,
            "correlation_reason": "manual_extraction",
            "created_at": 1769641772316041
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769641772280326,
            "correlation_reason": "manual_extraction",
            "created_at": 1769641773322811
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769641752279716,
            "correlation_reason": "manual_extraction",
            "created_at": 1769641752322446
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769641742279823,
            "correlation_reason": "manual_extraction",
            "created_at": 1769641743317227
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769641742279823,
            "correlation_reason": "manual_extraction",
            "created_at": 1769641742337772
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769641742279823,
            "correlation_reason": "manual_extraction",
            "created_at": 1769641745323832
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769641292280039,
            "correlation_reason": "manual_extraction",
            "created_at": 1769641292328330
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769641282279918,
            "correlation_reason": "manual_extraction",
            "created_at": 1769641282336174
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769641262279705,
            "correlation_reason": "manual_extraction",
            "created_at": 1769641263346080
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769641242280355,
            "correlation_reason": "manual_extraction",
            "created_at": 1769641242322248
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769641232279501,
            "correlation_reason": "manual_extraction",
            "created_at": 1769641232328713
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769641202280441,
            "correlation_reason": "manual_extraction",
            "created_at": 1769641209345925
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769641192280050,
            "correlation_reason": "manual_extraction",
            "created_at": 1769641192333496
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769641192280050,
            "correlation_reason": "manual_extraction",
            "created_at": 1769641193328684
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769641172279665,
            "correlation_reason": "manual_extraction",
            "created_at": 1769641175331341
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769641172279665,
            "correlation_reason": "manual_extraction",
            "created_at": 1769641173338593
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769641172279665,
            "correlation_reason": "manual_extraction",
            "created_at": 1769641172391337
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769641152279913,
            "correlation_reason": "manual_extraction",
            "created_at": 1769641152323752
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769641142280325,
            "correlation_reason": "manual_extraction",
            "created_at": 1769641143320328
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769641142280325,
            "correlation_reason": "manual_extraction",
            "created_at": 1769641142380455
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769641142280325,
            "correlation_reason": "manual_extraction",
            "created_at": 1769641145326641
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769640692280032,
            "correlation_reason": "manual_extraction",
            "created_at": 1769640692372040
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769640672280032,
            "correlation_reason": "manual_extraction",
            "created_at": 1769640672326646
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769640662279953,
            "correlation_reason": "manual_extraction",
            "created_at": 1769640662371095
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769640642279675,
            "correlation_reason": "manual_extraction",
            "created_at": 1769640643351461
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769640622280450,
            "correlation_reason": "manual_extraction",
            "created_at": 1769640622360540
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769640602280414,
            "correlation_reason": "manual_extraction",
            "created_at": 1769640609330053
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769640582280171,
            "correlation_reason": "manual_extraction",
            "created_at": 1769640583318903
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769640582280171,
            "correlation_reason": "manual_extraction",
            "created_at": 1769640582319583
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769640572279945,
            "correlation_reason": "manual_extraction",
            "created_at": 1769640575336562
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769640572279945,
            "correlation_reason": "manual_extraction",
            "created_at": 1769640573336152
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769640572279945,
            "correlation_reason": "manual_extraction",
            "created_at": 1769640572353103
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769640552280107,
            "correlation_reason": "manual_extraction",
            "created_at": 1769640552330106
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769640542280221,
            "correlation_reason": "manual_extraction",
            "created_at": 1769640542565637
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769640542280221,
            "correlation_reason": "manual_extraction",
            "created_at": 1769640545388068
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769640542280221,
            "correlation_reason": "manual_extraction",
            "created_at": 1769640543361634
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769640102280063,
            "correlation_reason": "manual_extraction",
            "created_at": 1769640102530016
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769640082279846,
            "correlation_reason": "manual_extraction",
            "created_at": 1769640082319436
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769640062279639,
            "correlation_reason": "manual_extraction",
            "created_at": 1769640063328841
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769640052279740,
            "correlation_reason": "manual_extraction",
            "created_at": 1769640052323197
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769640032279743,
            "correlation_reason": "manual_extraction",
            "created_at": 1769640032422603
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769640002279723,
            "correlation_reason": "manual_extraction",
            "created_at": 1769640009328973
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769639982279634,
            "correlation_reason": "manual_extraction",
            "created_at": 1769639983330420
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769639982279634,
            "correlation_reason": "manual_extraction",
            "created_at": 1769639982352859
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769639962279978,
            "correlation_reason": "manual_extraction",
            "created_at": 1769639965406345
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769639962279978,
            "correlation_reason": "manual_extraction",
            "created_at": 1769639962328074
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769639962279978,
            "correlation_reason": "manual_extraction",
            "created_at": 1769639963332464
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769639952380444,
            "correlation_reason": "manual_extraction",
            "created_at": 1769639952420713
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769639942280284,
            "correlation_reason": "manual_extraction",
            "created_at": 1769639945319136
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769639942280284,
            "correlation_reason": "manual_extraction",
            "created_at": 1769639942341981
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769639942280284,
            "correlation_reason": "manual_extraction",
            "created_at": 1769639943365786
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769639492280023,
            "correlation_reason": "manual_extraction",
            "created_at": 1769639492326764
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769639472279766,
            "correlation_reason": "manual_extraction",
            "created_at": 1769639472319274
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769639462279713,
            "correlation_reason": "manual_extraction",
            "created_at": 1769639465355509
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769639452279649,
            "correlation_reason": "manual_extraction",
            "created_at": 1769639452402235
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769639442280115,
            "correlation_reason": "manual_extraction",
            "created_at": 1769639443374334
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769639402279836,
            "correlation_reason": "manual_extraction",
            "created_at": 1769639417359372
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769639372280377,
            "correlation_reason": "manual_extraction",
            "created_at": 1769639372326257
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769639372280377,
            "correlation_reason": "manual_extraction",
            "created_at": 1769639375320657
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769639372280377,
            "correlation_reason": "manual_extraction",
            "created_at": 1769639373327321
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769639352280164,
            "correlation_reason": "manual_extraction",
            "created_at": 1769639355319319
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769639352280164,
            "correlation_reason": "manual_extraction",
            "created_at": 1769639352326487
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769639352280164,
            "correlation_reason": "manual_extraction",
            "created_at": 1769639353321613
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769639342280181,
            "correlation_reason": "manual_extraction",
            "created_at": 1769639343365601
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769639342280181,
            "correlation_reason": "manual_extraction",
            "created_at": 1769639342461603
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769639342280181,
            "correlation_reason": "manual_extraction",
            "created_at": 1769639345328591
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769638892279808,
            "correlation_reason": "manual_extraction",
            "created_at": 1769638892340596
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769638872280237,
            "correlation_reason": "manual_extraction",
            "created_at": 1769638872321094
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769638862280099,
            "correlation_reason": "manual_extraction",
            "created_at": 1769638862410827
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769638842280386,
            "correlation_reason": "manual_extraction",
            "created_at": 1769638845354602
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769638822280235,
            "correlation_reason": "manual_extraction",
            "created_at": 1769638823362866
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769638802279990,
            "correlation_reason": "manual_extraction",
            "created_at": 1769638809320335
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769638792279505,
            "correlation_reason": "manual_extraction",
            "created_at": 1769638793328481
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769638792279505,
            "correlation_reason": "manual_extraction",
            "created_at": 1769638792334890
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769638772280188,
            "correlation_reason": "manual_extraction",
            "created_at": 1769638772488010
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769638772280188,
            "correlation_reason": "manual_extraction",
            "created_at": 1769638775346790
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769638772280188,
            "correlation_reason": "manual_extraction",
            "created_at": 1769638773369731
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769638752280376,
            "correlation_reason": "manual_extraction",
            "created_at": 1769638752322741
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769638742279977,
            "correlation_reason": "manual_extraction",
            "created_at": 1769638743413226
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769638742279977,
            "correlation_reason": "manual_extraction",
            "created_at": 1769638745350594
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769638742279977,
            "correlation_reason": "manual_extraction",
            "created_at": 1769638742397350
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769638302280443,
            "correlation_reason": "manual_extraction",
            "created_at": 1769638302322140
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769638292279559,
            "correlation_reason": "manual_extraction",
            "created_at": 1769638292339370
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769638262280431,
            "correlation_reason": "manual_extraction",
            "created_at": 1769638262316248
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769638252279801,
            "correlation_reason": "manual_extraction",
            "created_at": 1769638252366210
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769638242279743,
            "correlation_reason": "manual_extraction",
            "created_at": 1769638242562548
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769638202279554,
            "correlation_reason": "manual_extraction",
            "created_at": 1769638217338400
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769638182280425,
            "correlation_reason": "manual_extraction",
            "created_at": 1769638183502492
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769638182280425,
            "correlation_reason": "manual_extraction",
            "created_at": 1769638182324592
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769638172280075,
            "correlation_reason": "manual_extraction",
            "created_at": 1769638175342560
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769638172280075,
            "correlation_reason": "manual_extraction",
            "created_at": 1769638172317958
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769638172280075,
            "correlation_reason": "manual_extraction",
            "created_at": 1769638173319513
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769638152280182,
            "correlation_reason": "manual_extraction",
            "created_at": 1769638152313404
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769638142279972,
            "correlation_reason": "manual_extraction",
            "created_at": 1769638145359755
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769638142279972,
            "correlation_reason": "manual_extraction",
            "created_at": 1769638142574827
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769638142279972,
            "correlation_reason": "manual_extraction",
            "created_at": 1769638143408930
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769637692280336,
            "correlation_reason": "manual_extraction",
            "created_at": 1769637692337773
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769637672280087,
            "correlation_reason": "manual_extraction",
            "created_at": 1769637672331838
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769637662279851,
            "correlation_reason": "manual_extraction",
            "created_at": 1769637662336716
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769637612280177,
            "correlation_reason": "manual_extraction",
            "created_at": 1769637613487517
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769637572280469,
            "correlation_reason": "manual_extraction",
            "created_at": 1769637579331526
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769637572280469,
            "correlation_reason": "manual_extraction",
            "created_at": 1769637573320533
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769637572280469,
            "correlation_reason": "manual_extraction",
            "created_at": 1769637587325923
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769637572280469,
            "correlation_reason": "manual_extraction",
            "created_at": 1769637575321409
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769637562279508,
            "correlation_reason": "manual_extraction",
            "created_at": 1769637565321438
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769637562279508,
            "correlation_reason": "manual_extraction",
            "created_at": 1769637563326211
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769637562279508,
            "correlation_reason": "manual_extraction",
            "created_at": 1769637562325942
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769637542279542,
            "correlation_reason": "manual_extraction",
            "created_at": 1769637543430064
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769637542279542,
            "correlation_reason": "manual_extraction",
            "created_at": 1769637545322517
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769637542279542,
            "correlation_reason": "manual_extraction",
            "created_at": 1769637549320731
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769637542279542,
            "correlation_reason": "manual_extraction",
            "created_at": 1769637557328594
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769637092280453,
            "correlation_reason": "manual_extraction",
            "created_at": 1769637092321777
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769637072280102,
            "correlation_reason": "manual_extraction",
            "created_at": 1769637072374295
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769637062279629,
            "correlation_reason": "manual_extraction",
            "created_at": 1769637062479616
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769636972279528,
            "correlation_reason": "manual_extraction",
            "created_at": 1769636975330034
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769636972279528,
            "correlation_reason": "manual_extraction",
            "created_at": 1769636973329360
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769636972279528,
            "correlation_reason": "manual_extraction",
            "created_at": 1769636979324489
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769636962279534,
            "correlation_reason": "manual_extraction",
            "created_at": 1769636963314772
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769636962279534,
            "correlation_reason": "manual_extraction",
            "created_at": 1769636965320568
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769636962279534,
            "correlation_reason": "manual_extraction",
            "created_at": 1769636969328409
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769636962279534,
            "correlation_reason": "manual_extraction",
            "created_at": 1769636962322846
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769636957291384,
            "correlation_reason": "manual_extraction",
            "created_at": 1769636957337458
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769636942279514,
            "correlation_reason": "manual_extraction",
            "created_at": 1769636945320584
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769636942279514,
            "correlation_reason": "manual_extraction",
            "created_at": 1769636957331373
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769636942279514,
            "correlation_reason": "manual_extraction",
            "created_at": 1769636943489562
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769636942279514,
            "correlation_reason": "manual_extraction",
            "created_at": 1769636942355160
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769636492280392,
            "correlation_reason": "manual_extraction",
            "created_at": 1769636492363588
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769636472279536,
            "correlation_reason": "manual_extraction",
            "created_at": 1769636472426697
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769636462280381,
            "correlation_reason": "manual_extraction",
            "created_at": 1769636462627031
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769636382279773,
            "correlation_reason": "manual_extraction",
            "created_at": 1769636383342623
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769636382279773,
            "correlation_reason": "manual_extraction",
            "created_at": 1769636382371770
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769636382279773,
            "correlation_reason": "manual_extraction",
            "created_at": 1769636385353591
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769636362279698,
            "correlation_reason": "manual_extraction",
            "created_at": 1769636365387253
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769636362279698,
            "correlation_reason": "manual_extraction",
            "created_at": 1769636369412952
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769636362279698,
            "correlation_reason": "manual_extraction",
            "created_at": 1769636362427300
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769636362279698,
            "correlation_reason": "manual_extraction",
            "created_at": 1769636363348936
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769636357314279,
            "correlation_reason": "manual_extraction",
            "created_at": 1769636357375458
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769636342280446,
            "correlation_reason": "manual_extraction",
            "created_at": 1769636342498020
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769636342280446,
            "correlation_reason": "manual_extraction",
            "created_at": 1769636343501596
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769636342280446,
            "correlation_reason": "manual_extraction",
            "created_at": 1769636357361075
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769636342280446,
            "correlation_reason": "manual_extraction",
            "created_at": 1769636345414517
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769635892279963,
            "correlation_reason": "manual_extraction",
            "created_at": 1769635892313898
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769635872280225,
            "correlation_reason": "manual_extraction",
            "created_at": 1769635872315009
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769635862279486,
            "correlation_reason": "manual_extraction",
            "created_at": 1769635862322305
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769635772279705,
            "correlation_reason": "manual_extraction",
            "created_at": 1769635772353927
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769635772279705,
            "correlation_reason": "manual_extraction",
            "created_at": 1769635775347196
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769635772279705,
            "correlation_reason": "manual_extraction",
            "created_at": 1769635773342625
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769635762279748,
            "correlation_reason": "manual_extraction",
            "created_at": 1769635765356275
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769635762279748,
            "correlation_reason": "manual_extraction",
            "created_at": 1769635763356829
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769635762279748,
            "correlation_reason": "manual_extraction",
            "created_at": 1769635762327175
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769635762279748,
            "correlation_reason": "manual_extraction",
            "created_at": 1769635769370127
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769635757293576,
            "correlation_reason": "manual_extraction",
            "created_at": 1769635757344893
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769635742280337,
            "correlation_reason": "manual_extraction",
            "created_at": 1769635745348659
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769635742280337,
            "correlation_reason": "manual_extraction",
            "created_at": 1769635757339402
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769635742280337,
            "correlation_reason": "manual_extraction",
            "created_at": 1769635743415356
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769635742280337,
            "correlation_reason": "manual_extraction",
            "created_at": 1769635742518087
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769635302279976,
            "correlation_reason": "manual_extraction",
            "created_at": 1769635302316409
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769635282280431,
            "correlation_reason": "manual_extraction",
            "created_at": 1769635282316377
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769635262279664,
            "correlation_reason": "manual_extraction",
            "created_at": 1769635263387498
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769635182280425,
            "correlation_reason": "manual_extraction",
            "created_at": 1769635182317587
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769635162280275,
            "correlation_reason": "manual_extraction",
            "created_at": 1769635162316626
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769635162280275,
            "correlation_reason": "manual_extraction",
            "created_at": 1769635163321944
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769635162280275,
            "correlation_reason": "manual_extraction",
            "created_at": 1769635165466128
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769635162280275,
            "correlation_reason": "manual_extraction",
            "created_at": 1769635169323982
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769635157287313,
            "correlation_reason": "manual_extraction",
            "created_at": 1769635160326608
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769635157287313,
            "correlation_reason": "manual_extraction",
            "created_at": 1769635158332368
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769635157287313,
            "correlation_reason": "manual_extraction",
            "created_at": 1769635157350453
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769635142279891,
            "correlation_reason": "manual_extraction",
            "created_at": 1769635145321780
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769635142279891,
            "correlation_reason": "manual_extraction",
            "created_at": 1769635143390855
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769635142279891,
            "correlation_reason": "manual_extraction",
            "created_at": 1769635149320937
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769635142279891,
            "correlation_reason": "manual_extraction",
            "created_at": 1769635142707330
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769634692279632,
            "correlation_reason": "manual_extraction",
            "created_at": 1769634692347139
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769634672280148,
            "correlation_reason": "manual_extraction",
            "created_at": 1769634672377605
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769634662279553,
            "correlation_reason": "manual_extraction",
            "created_at": 1769634662433155
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769634582280085,
            "correlation_reason": "manual_extraction",
            "created_at": 1769634582412914
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769634562279658,
            "correlation_reason": "manual_extraction",
            "created_at": 1769634562317245
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769634562279658,
            "correlation_reason": "manual_extraction",
            "created_at": 1769634565320184
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769634562279658,
            "correlation_reason": "manual_extraction",
            "created_at": 1769634563318628
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769634557291914,
            "correlation_reason": "manual_extraction",
            "created_at": 1769634558334208
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769634557291914,
            "correlation_reason": "manual_extraction",
            "created_at": 1769634557421171
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769634542280215,
            "correlation_reason": "manual_extraction",
            "created_at": 1769634557387530
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769634542280215,
            "correlation_reason": "manual_extraction",
            "created_at": 1769634542319708
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769634542280215,
            "correlation_reason": "manual_extraction",
            "created_at": 1769634543326125
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769634542280215,
            "correlation_reason": "manual_extraction",
            "created_at": 1769634545322397
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769634512322155,
            "correlation_reason": "manual_extraction",
            "created_at": 1769634513381780
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769634497311556,
            "correlation_reason": "manual_extraction",
            "created_at": 1769634498386283
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769634092280272,
            "correlation_reason": "manual_extraction",
            "created_at": 1769634092417587
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769634072279987,
            "correlation_reason": "manual_extraction",
            "created_at": 1769634072314246
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769634062279830,
            "correlation_reason": "manual_extraction",
            "created_at": 1769634062458692
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769633992279522,
            "correlation_reason": "manual_extraction",
            "created_at": 1769633992409256
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769633972279887,
            "correlation_reason": "manual_extraction",
            "created_at": 1769633973388969
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769633972279887,
            "correlation_reason": "manual_extraction",
            "created_at": 1769633975400377
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769633972279887,
            "correlation_reason": "manual_extraction",
            "created_at": 1769633972357441
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769633957289761,
            "correlation_reason": "manual_extraction",
            "created_at": 1769633957347817
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769633957289761,
            "correlation_reason": "manual_extraction",
            "created_at": 1769633958345276
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769633942280078,
            "correlation_reason": "manual_extraction",
            "created_at": 1769633942329945
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769633942280078,
            "correlation_reason": "manual_extraction",
            "created_at": 1769633957335671
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769633942280078,
            "correlation_reason": "manual_extraction",
            "created_at": 1769633945321236
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769633932280307,
            "correlation_reason": "manual_extraction",
            "created_at": 1769633932318024
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769633912301721,
            "correlation_reason": "manual_extraction",
            "created_at": 1769633912345300
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769633882280058,
            "correlation_reason": "manual_extraction",
            "created_at": 1769633897360767
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769633492279813,
            "correlation_reason": "manual_extraction",
            "created_at": 1769633492316987
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769633472279810,
            "correlation_reason": "manual_extraction",
            "created_at": 1769633472316481
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769633462279755,
            "correlation_reason": "manual_extraction",
            "created_at": 1769633462333112
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769633382279530,
            "correlation_reason": "manual_extraction",
            "created_at": 1769633382320027
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769633382279530,
            "correlation_reason": "manual_extraction",
            "created_at": 1769633385331581
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769633382279530,
            "correlation_reason": "manual_extraction",
            "created_at": 1769633383325793
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769633362280160,
            "correlation_reason": "manual_extraction",
            "created_at": 1769633365529249
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769633362280160,
            "correlation_reason": "manual_extraction",
            "created_at": 1769633363342787
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769633362280160,
            "correlation_reason": "manual_extraction",
            "created_at": 1769633362406360
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769633342280224,
            "correlation_reason": "manual_extraction",
            "created_at": 1769633349325378
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769633342280224,
            "correlation_reason": "manual_extraction",
            "created_at": 1769633343323825
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769633342280224,
            "correlation_reason": "manual_extraction",
            "created_at": 1769633342343580
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769633332280296,
            "correlation_reason": "manual_extraction",
            "created_at": 1769633332314849
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769633312280177,
            "correlation_reason": "manual_extraction",
            "created_at": 1769633312325907
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769633282279580,
            "correlation_reason": "manual_extraction",
            "created_at": 1769633297351970
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769632912280224,
            "correlation_reason": "manual_extraction",
            "created_at": 1769632912428438
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769632892280250,
            "correlation_reason": "manual_extraction",
            "created_at": 1769632892529223
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769632862279849,
            "correlation_reason": "manual_extraction",
            "created_at": 1769632863652757
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769632782279883,
            "correlation_reason": "manual_extraction",
            "created_at": 1769632782387618
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769632782279883,
            "correlation_reason": "manual_extraction",
            "created_at": 1769632783414052
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769632772279656,
            "correlation_reason": "manual_extraction",
            "created_at": 1769632772447804
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769632772279656,
            "correlation_reason": "manual_extraction",
            "created_at": 1769632773497750
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769632772279656,
            "correlation_reason": "manual_extraction",
            "created_at": 1769632779504250
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769632752280120,
            "correlation_reason": "manual_extraction",
            "created_at": 1769632752397513
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769632742279982,
            "correlation_reason": "manual_extraction",
            "created_at": 1769632743507914
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769632742279982,
            "correlation_reason": "manual_extraction",
            "created_at": 1769632749359264
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769632742279982,
            "correlation_reason": "manual_extraction",
            "created_at": 1769632742418001
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769632712279513,
            "correlation_reason": "manual_extraction",
            "created_at": 1769632712500211
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769632697297401,
            "correlation_reason": "manual_extraction",
            "created_at": 1769632697627587
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769632682280189,
            "correlation_reason": "manual_extraction",
            "created_at": 1769632689678570
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769632292279622,
            "correlation_reason": "manual_extraction",
            "created_at": 1769632292355462
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769632272280130,
            "correlation_reason": "manual_extraction",
            "created_at": 1769632272374680
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769632262280334,
            "correlation_reason": "manual_extraction",
            "created_at": 1769632262380629
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769632172280032,
            "correlation_reason": "manual_extraction",
            "created_at": 1769632172357235
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769632172280032,
            "correlation_reason": "manual_extraction",
            "created_at": 1769632173420731
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769632172280032,
            "correlation_reason": "manual_extraction",
            "created_at": 1769632175344039
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769632162279892,
            "correlation_reason": "manual_extraction",
            "created_at": 1769632162403067
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769632162279892,
            "correlation_reason": "manual_extraction",
            "created_at": 1769632165363933
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769632162279892,
            "correlation_reason": "manual_extraction",
            "created_at": 1769632163504785
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769632142279495,
            "correlation_reason": "manual_extraction",
            "created_at": 1769632143364424
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769632142279495,
            "correlation_reason": "manual_extraction",
            "created_at": 1769632149380701
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769632142279495,
            "correlation_reason": "manual_extraction",
            "created_at": 1769632142376149
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769632132279636,
            "correlation_reason": "manual_extraction",
            "created_at": 1769632132384973
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769632122279564,
            "correlation_reason": "manual_extraction",
            "created_at": 1769632122337818
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769632082279938,
            "correlation_reason": "manual_extraction",
            "created_at": 1769632097347560
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769631702279952,
            "correlation_reason": "manual_extraction",
            "created_at": 1769631702508044
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769631682280303,
            "correlation_reason": "manual_extraction",
            "created_at": 1769631682617603
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769631662280212,
            "correlation_reason": "manual_extraction",
            "created_at": 1769631665411320
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769631592280190,
            "correlation_reason": "manual_extraction",
            "created_at": 1769631592478735
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769631572280033,
            "correlation_reason": "manual_extraction",
            "created_at": 1769631572328211
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769631572280033,
            "correlation_reason": "manual_extraction",
            "created_at": 1769631573326292
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769631572280033,
            "correlation_reason": "manual_extraction",
            "created_at": 1769631575331513
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769631552280039,
            "correlation_reason": "manual_extraction",
            "created_at": 1769631552349645
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769631552280039,
            "correlation_reason": "manual_extraction",
            "created_at": 1769631553338730
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769631542279842,
            "correlation_reason": "manual_extraction",
            "created_at": 1769631542322133
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769631542279842,
            "correlation_reason": "manual_extraction",
            "created_at": 1769631543316879
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769631542279842,
            "correlation_reason": "manual_extraction",
            "created_at": 1769631549323635
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769631522279775,
            "correlation_reason": "manual_extraction",
            "created_at": 1769631522319714
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769631502280182,
            "correlation_reason": "manual_extraction",
            "created_at": 1769631502323322
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769631482280402,
            "correlation_reason": "manual_extraction",
            "created_at": 1769631483432878
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769631062279581,
            "correlation_reason": "manual_extraction",
            "created_at": 1769631062336740
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769631042463188,
            "correlation_reason": "manual_extraction",
            "created_at": 1769631045620851
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769631002279815,
            "correlation_reason": "manual_extraction",
            "created_at": 1769631017332248
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769630992280353,
            "correlation_reason": "manual_extraction",
            "created_at": 1769630992326665
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769630992280353,
            "correlation_reason": "manual_extraction",
            "created_at": 1769630993399015
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769630972279970,
            "correlation_reason": "manual_extraction",
            "created_at": 1769630972383159
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769630972279970,
            "correlation_reason": "manual_extraction",
            "created_at": 1769630973333962
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769630972279970,
            "correlation_reason": "manual_extraction",
            "created_at": 1769630975334990
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769630952280331,
            "correlation_reason": "manual_extraction",
            "created_at": 1769630952327420
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769630942279877,
            "correlation_reason": "manual_extraction",
            "created_at": 1769630949343849
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769630942279877,
            "correlation_reason": "manual_extraction",
            "created_at": 1769630942467707
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769630942279877,
            "correlation_reason": "manual_extraction",
            "created_at": 1769630943347993
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769630912280194,
            "correlation_reason": "manual_extraction",
            "created_at": 1769630913337025
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769630902279875,
            "correlation_reason": "manual_extraction",
            "created_at": 1769630902546130
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769630882279875,
            "correlation_reason": "manual_extraction",
            "created_at": 1769630885569241
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769630452280461,
            "correlation_reason": "manual_extraction",
            "created_at": 1769630453319998
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769630432280246,
            "correlation_reason": "manual_extraction",
            "created_at": 1769630433323885
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769630402280188,
            "correlation_reason": "manual_extraction",
            "created_at": 1769630409330809
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769630382280446,
            "correlation_reason": "manual_extraction",
            "created_at": 1769630389341758
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769630382280446,
            "correlation_reason": "manual_extraction",
            "created_at": 1769630382397911
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769630382280446,
            "correlation_reason": "manual_extraction",
            "created_at": 1769630385326825
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769630362280276,
            "correlation_reason": "manual_extraction",
            "created_at": 1769630363342410
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769630362280276,
            "correlation_reason": "manual_extraction",
            "created_at": 1769630365342495
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769630362280276,
            "correlation_reason": "manual_extraction",
            "created_at": 1769630362345032
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769630342279972,
            "correlation_reason": "manual_extraction",
            "created_at": 1769630343342019
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769630342279972,
            "correlation_reason": "manual_extraction",
            "created_at": 1769630349355746
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769630342279972,
            "correlation_reason": "manual_extraction",
            "created_at": 1769630342336226
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769630332280071,
            "correlation_reason": "manual_extraction",
            "created_at": 1769630332335395
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769630304319757,
            "correlation_reason": "manual_extraction",
            "created_at": 1769630304571683
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769630282279981,
            "correlation_reason": "manual_extraction",
            "created_at": 1769630285412495
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769629832279685,
            "correlation_reason": "manual_extraction",
            "created_at": 1769629833335898
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769629812279706,
            "correlation_reason": "manual_extraction",
            "created_at": 1769629812315101
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769629802279686,
            "correlation_reason": "manual_extraction",
            "created_at": 1769629809316074
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769629782279895,
            "correlation_reason": "manual_extraction",
            "created_at": 1769629782322206
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769629782279895,
            "correlation_reason": "manual_extraction",
            "created_at": 1769629783323397
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769629772279605,
            "correlation_reason": "manual_extraction",
            "created_at": 1769629775318147
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769629772279605,
            "correlation_reason": "manual_extraction",
            "created_at": 1769629772322919
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769629772279605,
            "correlation_reason": "manual_extraction",
            "created_at": 1769629773409686
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769629752280211,
            "correlation_reason": "manual_extraction",
            "created_at": 1769629752318479
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769629742280240,
            "correlation_reason": "manual_extraction",
            "created_at": 1769629742318286
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769629742280240,
            "correlation_reason": "manual_extraction",
            "created_at": 1769629743349095
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769629742280240,
            "correlation_reason": "manual_extraction",
            "created_at": 1769629749328577
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769629722279764,
            "correlation_reason": "manual_extraction",
            "created_at": 1769629722314178
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769629702280192,
            "correlation_reason": "manual_extraction",
            "created_at": 1769629702457926
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769629682279765,
            "correlation_reason": "manual_extraction",
            "created_at": 1769629685344309
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769629202280338,
            "correlation_reason": "manual_extraction",
            "created_at": 1769629217557894
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769629182280405,
            "correlation_reason": "manual_extraction",
            "created_at": 1769629182437835
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769629182280405,
            "correlation_reason": "manual_extraction",
            "created_at": 1769629189383085
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769629182280405,
            "correlation_reason": "manual_extraction",
            "created_at": 1769629185343676
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769629182280405,
            "correlation_reason": "manual_extraction",
            "created_at": 1769629183409243
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769629162279520,
            "correlation_reason": "manual_extraction",
            "created_at": 1769629162383236
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769629162279520,
            "correlation_reason": "manual_extraction",
            "created_at": 1769629165467834
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769629162279520,
            "correlation_reason": "manual_extraction",
            "created_at": 1769629163427823
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769629157305152,
            "correlation_reason": "manual_extraction",
            "created_at": 1769629157487506
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769629142279937,
            "correlation_reason": "manual_extraction",
            "created_at": 1769629145488375
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769629142279937,
            "correlation_reason": "manual_extraction",
            "created_at": 1769629157356522
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769629142279937,
            "correlation_reason": "manual_extraction",
            "created_at": 1769629143430631
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769629112279985,
            "correlation_reason": "manual_extraction",
            "created_at": 1769629112319819
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769629097290132,
            "correlation_reason": "manual_extraction",
            "created_at": 1769629097401906
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769629082280373,
            "correlation_reason": "manual_extraction",
            "created_at": 1769629085477688
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769628597533919,
            "correlation_reason": "manual_extraction",
            "created_at": 1769628598659223
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769628582316965,
            "correlation_reason": "manual_extraction",
            "created_at": 1769628585418052
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769628582316965,
            "correlation_reason": "manual_extraction",
            "created_at": 1769628583416111
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769628582316965,
            "correlation_reason": "manual_extraction",
            "created_at": 1769628589618542
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769628582316965,
            "correlation_reason": "manual_extraction",
            "created_at": 1769628597631795
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769628562280175,
            "correlation_reason": "manual_extraction",
            "created_at": 1769628562356180
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769628562280175,
            "correlation_reason": "manual_extraction",
            "created_at": 1769628565348392
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769628562280175,
            "correlation_reason": "manual_extraction",
            "created_at": 1769628563358817
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769628542279675,
            "correlation_reason": "manual_extraction",
            "created_at": 1769628543421221
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769628542279675,
            "correlation_reason": "manual_extraction",
            "created_at": 1769628542440094
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769628542279675,
            "correlation_reason": "manual_extraction",
            "created_at": 1769628549354359
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769628542279675,
            "correlation_reason": "manual_extraction",
            "created_at": 1769628557371700
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769628504305945,
            "correlation_reason": "manual_extraction",
            "created_at": 1769628504387351
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769628497292811,
            "correlation_reason": "manual_extraction",
            "created_at": 1769628497354401
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769628482280136,
            "correlation_reason": "manual_extraction",
            "created_at": 1769628483345844
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769627982279553,
            "correlation_reason": "manual_extraction",
            "created_at": 1769627982353963
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769627982279553,
            "correlation_reason": "manual_extraction",
            "created_at": 1769627983565727
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769627982279553,
            "correlation_reason": "manual_extraction",
            "created_at": 1769627985558615
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769627962279537,
            "correlation_reason": "manual_extraction",
            "created_at": 1769627969447845
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769627962279537,
            "correlation_reason": "manual_extraction",
            "created_at": 1769627962323457
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769627962279537,
            "correlation_reason": "manual_extraction",
            "created_at": 1769627963327209
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769627962279537,
            "correlation_reason": "manual_extraction",
            "created_at": 1769627965328197
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769627957289172,
            "correlation_reason": "manual_extraction",
            "created_at": 1769627957365261
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769627942280368,
            "correlation_reason": "manual_extraction",
            "created_at": 1769627943352223
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769627942280368,
            "correlation_reason": "manual_extraction",
            "created_at": 1769627957345814
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769627942280368,
            "correlation_reason": "manual_extraction",
            "created_at": 1769627942387660
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769627942280368,
            "correlation_reason": "manual_extraction",
            "created_at": 1769627949326166
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769627912280104,
            "correlation_reason": "manual_extraction",
            "created_at": 1769627912628034
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769627897683340,
            "correlation_reason": "manual_extraction",
            "created_at": 1769627897817239
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769627882467508,
            "correlation_reason": "manual_extraction",
            "created_at": 1769627885670700
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769627392279583,
            "correlation_reason": "manual_extraction",
            "created_at": 1769627393339511
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769627372279668,
            "correlation_reason": "manual_extraction",
            "created_at": 1769627373408328
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769627372279668,
            "correlation_reason": "manual_extraction",
            "created_at": 1769627372330040
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769627362280159,
            "correlation_reason": "manual_extraction",
            "created_at": 1769627362367738
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769627362280159,
            "correlation_reason": "manual_extraction",
            "created_at": 1769627365336786
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769627362280159,
            "correlation_reason": "manual_extraction",
            "created_at": 1769627369371869
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769627362280159,
            "correlation_reason": "manual_extraction",
            "created_at": 1769627363336392
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769627357289681,
            "correlation_reason": "manual_extraction",
            "created_at": 1769627357334543
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769627342279749,
            "correlation_reason": "manual_extraction",
            "created_at": 1769627349323369
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769627342279749,
            "correlation_reason": "manual_extraction",
            "created_at": 1769627343326665
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769627342279749,
            "correlation_reason": "manual_extraction",
            "created_at": 1769627342377527
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769627342279749,
            "correlation_reason": "manual_extraction",
            "created_at": 1769627357331708
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769627312490018,
            "correlation_reason": "manual_extraction",
            "created_at": 1769627313612835
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769627297286959,
            "correlation_reason": "manual_extraction",
            "created_at": 1769627298329312
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769627282279877,
            "correlation_reason": "manual_extraction",
            "created_at": 1769627285574623
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769626782280416,
            "correlation_reason": "manual_extraction",
            "created_at": 1769626782325557
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769626782280416,
            "correlation_reason": "manual_extraction",
            "created_at": 1769626783324555
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769626782280416,
            "correlation_reason": "manual_extraction",
            "created_at": 1769626785370559
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769626782280416,
            "correlation_reason": "manual_extraction",
            "created_at": 1769626789342157
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769626762279814,
            "correlation_reason": "manual_extraction",
            "created_at": 1769626762330797
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769626762279814,
            "correlation_reason": "manual_extraction",
            "created_at": 1769626765344032
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769626762279814,
            "correlation_reason": "manual_extraction",
            "created_at": 1769626769325677
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769626762279814,
            "correlation_reason": "manual_extraction",
            "created_at": 1769626763371150
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769626742280147,
            "correlation_reason": "manual_extraction",
            "created_at": 1769626745331737
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769626742280147,
            "correlation_reason": "manual_extraction",
            "created_at": 1769626749326921
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769626742280147,
            "correlation_reason": "manual_extraction",
            "created_at": 1769626743375086
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769626742280147,
            "correlation_reason": "manual_extraction",
            "created_at": 1769626742525875
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769626712279843,
            "correlation_reason": "manual_extraction",
            "created_at": 1769626712343876
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769626704305103,
            "correlation_reason": "manual_extraction",
            "created_at": 1769626704365499
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769626682279848,
            "correlation_reason": "manual_extraction",
            "created_at": 1769626683344186
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769626172279685,
            "correlation_reason": "manual_extraction",
            "created_at": 1769626175358249
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769626172279685,
            "correlation_reason": "manual_extraction",
            "created_at": 1769626173352814
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769626172279685,
            "correlation_reason": "manual_extraction",
            "created_at": 1769626172571242
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769626162280067,
            "correlation_reason": "manual_extraction",
            "created_at": 1769626165375434
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769626162280067,
            "correlation_reason": "manual_extraction",
            "created_at": 1769626163323576
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769626162280067,
            "correlation_reason": "manual_extraction",
            "created_at": 1769626162333812
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769626162280067,
            "correlation_reason": "manual_extraction",
            "created_at": 1769626169371392
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769626157294981,
            "correlation_reason": "manual_extraction",
            "created_at": 1769626157344102
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769626142279823,
            "correlation_reason": "manual_extraction",
            "created_at": 1769626157343919
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769626142279823,
            "correlation_reason": "manual_extraction",
            "created_at": 1769626149325668
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769626142279823,
            "correlation_reason": "manual_extraction",
            "created_at": 1769626143323341
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769626142279823,
            "correlation_reason": "manual_extraction",
            "created_at": 1769626142365585
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769626112398517,
            "correlation_reason": "manual_extraction",
            "created_at": 1769626115517597
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769626097287178,
            "correlation_reason": "manual_extraction",
            "created_at": 1769626098330216
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769626082279875,
            "correlation_reason": "manual_extraction",
            "created_at": 1769626089445984
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769625592279559,
            "correlation_reason": "manual_extraction",
            "created_at": 1769625592502357
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769625582279980,
            "correlation_reason": "manual_extraction",
            "created_at": 1769625582319797
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769625582279980,
            "correlation_reason": "manual_extraction",
            "created_at": 1769625589341850
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769625582279980,
            "correlation_reason": "manual_extraction",
            "created_at": 1769625585325602
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769625582279980,
            "correlation_reason": "manual_extraction",
            "created_at": 1769625583322969
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769625562279682,
            "correlation_reason": "manual_extraction",
            "created_at": 1769625563322042
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769625562279682,
            "correlation_reason": "manual_extraction",
            "created_at": 1769625562315775
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769625562279682,
            "correlation_reason": "manual_extraction",
            "created_at": 1769625565323984
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769625542280078,
            "correlation_reason": "manual_extraction",
            "created_at": 1769625557335273
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769625542280078,
            "correlation_reason": "manual_extraction",
            "created_at": 1769625542322053
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769625542280078,
            "correlation_reason": "manual_extraction",
            "created_at": 1769625543339815
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769625542280078,
            "correlation_reason": "manual_extraction",
            "created_at": 1769625549327218
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769625532280456,
            "correlation_reason": "manual_extraction",
            "created_at": 1769625533368749
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769625512280141,
            "correlation_reason": "manual_extraction",
            "created_at": 1769625512326410
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769625482279896,
            "correlation_reason": "manual_extraction",
            "created_at": 1769625497345065
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769624982279528,
            "correlation_reason": "manual_extraction",
            "created_at": 1769624983313531
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769624982279528,
            "correlation_reason": "manual_extraction",
            "created_at": 1769624989355183
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769624982279528,
            "correlation_reason": "manual_extraction",
            "created_at": 1769624982316429
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769624982279528,
            "correlation_reason": "manual_extraction",
            "created_at": 1769624985358461
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769624962280148,
            "correlation_reason": "manual_extraction",
            "created_at": 1769624962320883
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769624962280148,
            "correlation_reason": "manual_extraction",
            "created_at": 1769624965326529
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769624962280148,
            "correlation_reason": "manual_extraction",
            "created_at": 1769624969324442
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769624962280148,
            "correlation_reason": "manual_extraction",
            "created_at": 1769624963320678
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769624942279720,
            "correlation_reason": "manual_extraction",
            "created_at": 1769624949338234
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769624942279720,
            "correlation_reason": "manual_extraction",
            "created_at": 1769624943332316
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769624942279720,
            "correlation_reason": "manual_extraction",
            "created_at": 1769624942346621
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769624942279720,
            "correlation_reason": "manual_extraction",
            "created_at": 1769624957331079
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769624932279561,
            "correlation_reason": "manual_extraction",
            "created_at": 1769624932472038
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769624912302047,
            "correlation_reason": "manual_extraction",
            "created_at": 1769624913373034
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769624897292474,
            "correlation_reason": "manual_extraction",
            "created_at": 1769624898405712
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769624382279621,
            "correlation_reason": "manual_extraction",
            "created_at": 1769624385502448
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769624382279621,
            "correlation_reason": "manual_extraction",
            "created_at": 1769624383376502
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769624382279621,
            "correlation_reason": "manual_extraction",
            "created_at": 1769624382392606
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769624362279822,
            "correlation_reason": "manual_extraction",
            "created_at": 1769624363407499
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769624362279822,
            "correlation_reason": "manual_extraction",
            "created_at": 1769624365399516
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769624362279822,
            "correlation_reason": "manual_extraction",
            "created_at": 1769624362387570
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769624352279634,
            "correlation_reason": "manual_extraction",
            "created_at": 1769624352462945
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769624342279638,
            "correlation_reason": "manual_extraction",
            "created_at": 1769624343332259
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769624342279638,
            "correlation_reason": "manual_extraction",
            "created_at": 1769624349395583
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769624342279638,
            "correlation_reason": "manual_extraction",
            "created_at": 1769624342340570
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769624332279505,
            "correlation_reason": "manual_extraction",
            "created_at": 1769624332397439
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769624312504018,
            "correlation_reason": "manual_extraction",
            "created_at": 1769624315657547
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769624312504018,
            "correlation_reason": "manual_extraction",
            "created_at": 1769624312667668
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769624297494529,
            "correlation_reason": "manual_extraction",
            "created_at": 1769624298557635
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769624282279483,
            "correlation_reason": "manual_extraction",
            "created_at": 1769624289596261
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769623772280385,
            "correlation_reason": "manual_extraction",
            "created_at": 1769623773348292
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769623772280385,
            "correlation_reason": "manual_extraction",
            "created_at": 1769623775323505
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769623772280385,
            "correlation_reason": "manual_extraction",
            "created_at": 1769623772340155
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769623762280385,
            "correlation_reason": "manual_extraction",
            "created_at": 1769623762325139
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769623762280385,
            "correlation_reason": "manual_extraction",
            "created_at": 1769623765341636
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769623762280385,
            "correlation_reason": "manual_extraction",
            "created_at": 1769623763333830
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769623742279720,
            "correlation_reason": "manual_extraction",
            "created_at": 1769623742322593
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769623742279720,
            "correlation_reason": "manual_extraction",
            "created_at": 1769623743316295
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769623742279720,
            "correlation_reason": "manual_extraction",
            "created_at": 1769623749328219
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769623732279822,
            "correlation_reason": "manual_extraction",
            "created_at": 1769623733315437
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769623732279822,
            "correlation_reason": "manual_extraction",
            "created_at": 1769623732322631
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769623712322729,
            "correlation_reason": "manual_extraction",
            "created_at": 1769623712372610
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769623712322729,
            "correlation_reason": "manual_extraction",
            "created_at": 1769623713360278
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769623697464219,
            "correlation_reason": "manual_extraction",
            "created_at": 1769623697901991
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769623682279639,
            "correlation_reason": "manual_extraction",
            "created_at": 1769623697677265
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769623182280236,
            "correlation_reason": "manual_extraction",
            "created_at": 1769623183390763
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769623182280236,
            "correlation_reason": "manual_extraction",
            "created_at": 1769623185392816
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769623182280236,
            "correlation_reason": "manual_extraction",
            "created_at": 1769623182403374
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769623172279675,
            "correlation_reason": "manual_extraction",
            "created_at": 1769623173390615
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769623172279675,
            "correlation_reason": "manual_extraction",
            "created_at": 1769623175401770
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769623172279675,
            "correlation_reason": "manual_extraction",
            "created_at": 1769623172377512
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769623142350643,
            "correlation_reason": "manual_extraction",
            "created_at": 1769623143458388
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769623142350643,
            "correlation_reason": "manual_extraction",
            "created_at": 1769623145478301
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769623142350643,
            "correlation_reason": "manual_extraction",
            "created_at": 1769623142451667
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769623112315862,
            "correlation_reason": "manual_extraction",
            "created_at": 1769623113574343
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769623112315862,
            "correlation_reason": "manual_extraction",
            "created_at": 1769623112365453
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769623097305309,
            "correlation_reason": "manual_extraction",
            "created_at": 1769623097342218
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769623097305309,
            "correlation_reason": "manual_extraction",
            "created_at": 1769623098345145
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769623082280222,
            "correlation_reason": "manual_extraction",
            "created_at": 1769623085407361
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769623082280222,
            "correlation_reason": "manual_extraction",
            "created_at": 1769623083345926
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769622592280237,
            "correlation_reason": "manual_extraction",
            "created_at": 1769622593506243
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769622592280237,
            "correlation_reason": "manual_extraction",
            "created_at": 1769622595417477
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769622572374373,
            "correlation_reason": "manual_extraction",
            "created_at": 1769622575627447
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769622572374373,
            "correlation_reason": "manual_extraction",
            "created_at": 1769622573560516
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769622572374373,
            "correlation_reason": "manual_extraction",
            "created_at": 1769622572547269
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769622552280043,
            "correlation_reason": "manual_extraction",
            "created_at": 1769622552438261
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769622542279654,
            "correlation_reason": "manual_extraction",
            "created_at": 1769622543609505
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769622542279654,
            "correlation_reason": "manual_extraction",
            "created_at": 1769622549593966
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769622542279654,
            "correlation_reason": "manual_extraction",
            "created_at": 1769622542487498
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769622512322543,
            "correlation_reason": "manual_extraction",
            "created_at": 1769622513407503
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769622512322543,
            "correlation_reason": "manual_extraction",
            "created_at": 1769622515478086
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769622497300978,
            "correlation_reason": "manual_extraction",
            "created_at": 1769622497390685
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769622497300978,
            "correlation_reason": "manual_extraction",
            "created_at": 1769622498361074
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769622482280063,
            "correlation_reason": "manual_extraction",
            "created_at": 1769622485517635
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769622482280063,
            "correlation_reason": "manual_extraction",
            "created_at": 1769622483537367
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769621982279622,
            "correlation_reason": "manual_extraction",
            "created_at": 1769621982319988
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769621982279622,
            "correlation_reason": "manual_extraction",
            "created_at": 1769621983316624
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769621982279622,
            "correlation_reason": "manual_extraction",
            "created_at": 1769621985433684
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769621962280297,
            "correlation_reason": "manual_extraction",
            "created_at": 1769621963325153
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769621962280297,
            "correlation_reason": "manual_extraction",
            "created_at": 1769621962317641
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769621962280297,
            "correlation_reason": "manual_extraction",
            "created_at": 1769621965481349
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769621942279870,
            "correlation_reason": "manual_extraction",
            "created_at": 1769621945318846
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769621942279870,
            "correlation_reason": "manual_extraction",
            "created_at": 1769621943318618
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769621942279870,
            "correlation_reason": "manual_extraction",
            "created_at": 1769621942324568
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769621932279960,
            "correlation_reason": "manual_extraction",
            "created_at": 1769621932325354
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769621932279960,
            "correlation_reason": "manual_extraction",
            "created_at": 1769621933326249
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769621904318467,
            "correlation_reason": "manual_extraction",
            "created_at": 1769621904359756
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769621904318467,
            "correlation_reason": "manual_extraction",
            "created_at": 1769621905359846
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769621882280224,
            "correlation_reason": "manual_extraction",
            "created_at": 1769621885372795
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769621882280224,
            "correlation_reason": "manual_extraction",
            "created_at": 1769621889341812
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769621372280180,
            "correlation_reason": "manual_extraction",
            "created_at": 1769621373359469
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769621372280180,
            "correlation_reason": "manual_extraction",
            "created_at": 1769621375328086
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769621372280180,
            "correlation_reason": "manual_extraction",
            "created_at": 1769621372346336
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769621362279712,
            "correlation_reason": "manual_extraction",
            "created_at": 1769621362326218
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769621362279712,
            "correlation_reason": "manual_extraction",
            "created_at": 1769621365327080
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769621362279712,
            "correlation_reason": "manual_extraction",
            "created_at": 1769621363321034
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769621342279612,
            "correlation_reason": "manual_extraction",
            "created_at": 1769621342323883
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769621342279612,
            "correlation_reason": "manual_extraction",
            "created_at": 1769621349321488
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769621342279612,
            "correlation_reason": "manual_extraction",
            "created_at": 1769621343323568
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769621332280134,
            "correlation_reason": "manual_extraction",
            "created_at": 1769621332324762
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769621312303390,
            "correlation_reason": "manual_extraction",
            "created_at": 1769621312346934
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769621312303390,
            "correlation_reason": "manual_extraction",
            "created_at": 1769621313347259
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769621297290084,
            "correlation_reason": "manual_extraction",
            "created_at": 1769621298345911
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769621297290084,
            "correlation_reason": "manual_extraction",
            "created_at": 1769621297337116
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769621282279577,
            "correlation_reason": "manual_extraction",
            "created_at": 1769621285491660
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769620772279619,
            "correlation_reason": "manual_extraction",
            "created_at": 1769620772378381
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769620772279619,
            "correlation_reason": "manual_extraction",
            "created_at": 1769620779372770
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769620772279619,
            "correlation_reason": "manual_extraction",
            "created_at": 1769620775410203
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769620752279968,
            "correlation_reason": "manual_extraction",
            "created_at": 1769620753324484
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769620752279968,
            "correlation_reason": "manual_extraction",
            "created_at": 1769620755319222
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769620752279968,
            "correlation_reason": "manual_extraction",
            "created_at": 1769620752381819
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769620742280444,
            "correlation_reason": "manual_extraction",
            "created_at": 1769620742333677
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769620742280444,
            "correlation_reason": "manual_extraction",
            "created_at": 1769620745323654
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769620742280444,
            "correlation_reason": "manual_extraction",
            "created_at": 1769620743319970
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769620722280065,
            "correlation_reason": "manual_extraction",
            "created_at": 1769620722387377
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769620712298680,
            "correlation_reason": "manual_extraction",
            "created_at": 1769620713553713
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769620712298680,
            "correlation_reason": "manual_extraction",
            "created_at": 1769620712517899
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769620697289763,
            "correlation_reason": "manual_extraction",
            "created_at": 1769620698363429
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769620697289763,
            "correlation_reason": "manual_extraction",
            "created_at": 1769620697330179
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769620682280122,
            "correlation_reason": "manual_extraction",
            "created_at": 1769620683492362
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769620192280121,
            "correlation_reason": "manual_extraction",
            "created_at": 1769620193334086
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769620172280449,
            "correlation_reason": "manual_extraction",
            "created_at": 1769620175358188
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769620172280449,
            "correlation_reason": "manual_extraction",
            "created_at": 1769620172367515
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769620172280449,
            "correlation_reason": "manual_extraction",
            "created_at": 1769620173328550
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769620152280468,
            "correlation_reason": "manual_extraction",
            "created_at": 1769620152320062
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769620152280468,
            "correlation_reason": "manual_extraction",
            "created_at": 1769620153316422
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769620142279693,
            "correlation_reason": "manual_extraction",
            "created_at": 1769620143336135
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769620142279693,
            "correlation_reason": "manual_extraction",
            "created_at": 1769620142320901
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769620142279693,
            "correlation_reason": "manual_extraction",
            "created_at": 1769620149417084
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769620122280091,
            "correlation_reason": "manual_extraction",
            "created_at": 1769620122323086
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769620112295597,
            "correlation_reason": "manual_extraction",
            "created_at": 1769620113344577
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769620112295597,
            "correlation_reason": "manual_extraction",
            "created_at": 1769620112330950
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769620097286751,
            "correlation_reason": "manual_extraction",
            "created_at": 1769620097347003
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769620082280065,
            "correlation_reason": "manual_extraction",
            "created_at": 1769620085719395
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769620082280065,
            "correlation_reason": "manual_extraction",
            "created_at": 1769620089328075
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769619582280234,
            "correlation_reason": "manual_extraction",
            "created_at": 1769619582320054
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769619582280234,
            "correlation_reason": "manual_extraction",
            "created_at": 1769619583325096
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769619582280234,
            "correlation_reason": "manual_extraction",
            "created_at": 1769619585435649
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769619562279606,
            "correlation_reason": "manual_extraction",
            "created_at": 1769619565346280
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769619562279606,
            "correlation_reason": "manual_extraction",
            "created_at": 1769619563339663
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769619562279606,
            "correlation_reason": "manual_extraction",
            "created_at": 1769619562349844
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769619542279604,
            "correlation_reason": "manual_extraction",
            "created_at": 1769619543328227
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769619542279604,
            "correlation_reason": "manual_extraction",
            "created_at": 1769619545333027
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769619542279604,
            "correlation_reason": "manual_extraction",
            "created_at": 1769619542331713
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769619532280110,
            "correlation_reason": "manual_extraction",
            "created_at": 1769619533324102
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769619532280110,
            "correlation_reason": "manual_extraction",
            "created_at": 1769619532322687
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769619512280336,
            "correlation_reason": "manual_extraction",
            "created_at": 1769619512316274
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769619504295364,
            "correlation_reason": "manual_extraction",
            "created_at": 1769619505355051
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769619497288711,
            "correlation_reason": "manual_extraction",
            "created_at": 1769619497330308
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769619482279577,
            "correlation_reason": "manual_extraction",
            "created_at": 1769619489361897
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769618972279664,
            "correlation_reason": "manual_extraction",
            "created_at": 1769618979391806
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769618972279664,
            "correlation_reason": "manual_extraction",
            "created_at": 1769618975321104
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769618972279664,
            "correlation_reason": "manual_extraction",
            "created_at": 1769618973325239
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769618952279712,
            "correlation_reason": "manual_extraction",
            "created_at": 1769618953317367
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769618952279712,
            "correlation_reason": "manual_extraction",
            "created_at": 1769618955326712
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769618952279712,
            "correlation_reason": "manual_extraction",
            "created_at": 1769618959325863
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769618942280244,
            "correlation_reason": "manual_extraction",
            "created_at": 1769618943359338
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769618942280244,
            "correlation_reason": "manual_extraction",
            "created_at": 1769618949358873
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769618942280244,
            "correlation_reason": "manual_extraction",
            "created_at": 1769618942427632
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769618922279983,
            "correlation_reason": "manual_extraction",
            "created_at": 1769618922333798
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769618922279983,
            "correlation_reason": "manual_extraction",
            "created_at": 1769618923429320
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769618912312876,
            "correlation_reason": "manual_extraction",
            "created_at": 1769618913389432
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769618912312876,
            "correlation_reason": "manual_extraction",
            "created_at": 1769618915353380
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769618897300721,
            "correlation_reason": "manual_extraction",
            "created_at": 1769618898469085
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769618882279633,
            "correlation_reason": "manual_extraction",
            "created_at": 1769618897502508
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769618372280378,
            "correlation_reason": "manual_extraction",
            "created_at": 1769618379352928
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769618372280378,
            "correlation_reason": "manual_extraction",
            "created_at": 1769618375338474
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769618372280378,
            "correlation_reason": "manual_extraction",
            "created_at": 1769618372318070
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769618362280042,
            "correlation_reason": "manual_extraction",
            "created_at": 1769618362330399
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769618362280042,
            "correlation_reason": "manual_extraction",
            "created_at": 1769618365321943
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769618362280042,
            "correlation_reason": "manual_extraction",
            "created_at": 1769618363353282
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769618342280171,
            "correlation_reason": "manual_extraction",
            "created_at": 1769618345347670
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769618342280171,
            "correlation_reason": "manual_extraction",
            "created_at": 1769618342427042
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769618342280171,
            "correlation_reason": "manual_extraction",
            "created_at": 1769618343346395
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769618332280240,
            "correlation_reason": "manual_extraction",
            "created_at": 1769618335327601
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769618332280240,
            "correlation_reason": "manual_extraction",
            "created_at": 1769618333333279
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769618312298938,
            "correlation_reason": "manual_extraction",
            "created_at": 1769618312344115
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769618312298938,
            "correlation_reason": "manual_extraction",
            "created_at": 1769618313343122
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769618282279678,
            "correlation_reason": "manual_extraction",
            "created_at": 1769618285505932
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769618282279678,
            "correlation_reason": "manual_extraction",
            "created_at": 1769618289355068
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769617772279750,
            "correlation_reason": "manual_extraction",
            "created_at": 1769617775317938
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769617772279750,
            "correlation_reason": "manual_extraction",
            "created_at": 1769617772319153
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769617772279750,
            "correlation_reason": "manual_extraction",
            "created_at": 1769617773317679
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769617762280466,
            "correlation_reason": "manual_extraction",
            "created_at": 1769617765320839
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769617762280466,
            "correlation_reason": "manual_extraction",
            "created_at": 1769617763320743
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769617762280466,
            "correlation_reason": "manual_extraction",
            "created_at": 1769617762319381
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769617742279986,
            "correlation_reason": "manual_extraction",
            "created_at": 1769617742322507
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769617742279986,
            "correlation_reason": "manual_extraction",
            "created_at": 1769617749326227
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769617742279986,
            "correlation_reason": "manual_extraction",
            "created_at": 1769617743319739
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769617732279618,
            "correlation_reason": "manual_extraction",
            "created_at": 1769617733318262
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769617732279618,
            "correlation_reason": "manual_extraction",
            "created_at": 1769617735336016
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769617722279550,
            "correlation_reason": "manual_extraction",
            "created_at": 1769617723320456
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769617722279550,
            "correlation_reason": "manual_extraction",
            "created_at": 1769617722326436
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769617697289186,
            "correlation_reason": "manual_extraction",
            "created_at": 1769617698329653
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769617682280343,
            "correlation_reason": "manual_extraction",
            "created_at": 1769617697399698
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769617192280235,
            "correlation_reason": "manual_extraction",
            "created_at": 1769617192317143
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769617192280235,
            "correlation_reason": "manual_extraction",
            "created_at": 1769617195321252
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769617192280235,
            "correlation_reason": "manual_extraction",
            "created_at": 1769617193322966
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769617172280437,
            "correlation_reason": "manual_extraction",
            "created_at": 1769617175335506
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769617172280437,
            "correlation_reason": "manual_extraction",
            "created_at": 1769617172340591
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769617172280437,
            "correlation_reason": "manual_extraction",
            "created_at": 1769617173426123
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769617142279766,
            "correlation_reason": "manual_extraction",
            "created_at": 1769617143322872
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769617142279766,
            "correlation_reason": "manual_extraction",
            "created_at": 1769617149318289
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769617142279766,
            "correlation_reason": "manual_extraction",
            "created_at": 1769617142324887
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769617132279627,
            "correlation_reason": "manual_extraction",
            "created_at": 1769617132427435
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769617132279627,
            "correlation_reason": "manual_extraction",
            "created_at": 1769617135448310
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769617112299463,
            "correlation_reason": "manual_extraction",
            "created_at": 1769617115476892
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769617112299463,
            "correlation_reason": "manual_extraction",
            "created_at": 1769617113353007
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769617082279832,
            "correlation_reason": "manual_extraction",
            "created_at": 1769617089331871
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769617082279832,
            "correlation_reason": "manual_extraction",
            "created_at": 1769617085382740
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769616592280109,
            "correlation_reason": "manual_extraction",
            "created_at": 1769616592326369
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769616572280371,
            "correlation_reason": "manual_extraction",
            "created_at": 1769616575407181
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769616572280371,
            "correlation_reason": "manual_extraction",
            "created_at": 1769616573422306
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769616572280371,
            "correlation_reason": "manual_extraction",
            "created_at": 1769616572410231
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769616552280196,
            "correlation_reason": "manual_extraction",
            "created_at": 1769616553427705
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769616552280196,
            "correlation_reason": "manual_extraction",
            "created_at": 1769616552493778
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769616542279970,
            "correlation_reason": "manual_extraction",
            "created_at": 1769616549394819
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769616542279970,
            "correlation_reason": "manual_extraction",
            "created_at": 1769616543407272
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769616542279970,
            "correlation_reason": "manual_extraction",
            "created_at": 1769616542337558
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769616522280298,
            "correlation_reason": "manual_extraction",
            "created_at": 1769616523411660
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769616522280298,
            "correlation_reason": "manual_extraction",
            "created_at": 1769616522397308
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769616512646299,
            "correlation_reason": "manual_extraction",
            "created_at": 1769616513726850
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769616512646299,
            "correlation_reason": "manual_extraction",
            "created_at": 1769616515751255
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769616497430848,
            "correlation_reason": "manual_extraction",
            "created_at": 1769616498537775
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769616482279765,
            "correlation_reason": "manual_extraction",
            "created_at": 1769616497642276
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769615972279888,
            "correlation_reason": "manual_extraction",
            "created_at": 1769615972627002
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769615952280167,
            "correlation_reason": "manual_extraction",
            "created_at": 1769615952392677
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769615942479371,
            "correlation_reason": "manual_extraction",
            "created_at": 1769615949607137
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769615942479371,
            "correlation_reason": "manual_extraction",
            "created_at": 1769615943518351
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769615942479371,
            "correlation_reason": "manual_extraction",
            "created_at": 1769615942526331
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769615927470416,
            "correlation_reason": "manual_extraction",
            "created_at": 1769615928511727
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769615927470416,
            "correlation_reason": "manual_extraction",
            "created_at": 1769615930509723
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769615927470416,
            "correlation_reason": "manual_extraction",
            "created_at": 1769615927518060
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769615927470416,
            "correlation_reason": "manual_extraction",
            "created_at": 1769615934698272
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769615912301852,
            "correlation_reason": "manual_extraction",
            "created_at": 1769615912346480
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769615912301852,
            "correlation_reason": "manual_extraction",
            "created_at": 1769615913343132
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769615897294111,
            "correlation_reason": "manual_extraction",
            "created_at": 1769615897336835
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769615897294111,
            "correlation_reason": "manual_extraction",
            "created_at": 1769615898651117
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769615882279811,
            "correlation_reason": "manual_extraction",
            "created_at": 1769615885457248
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769615882279811,
            "correlation_reason": "manual_extraction",
            "created_at": 1769615889328397
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769615352280082,
            "correlation_reason": "manual_extraction",
            "created_at": 1769615352316121
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769615327395076,
            "correlation_reason": "manual_extraction",
            "created_at": 1769615342526950
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769615327395076,
            "correlation_reason": "manual_extraction",
            "created_at": 1769615328434361
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769615327395076,
            "correlation_reason": "manual_extraction",
            "created_at": 1769615327435754
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769615312386217,
            "correlation_reason": "manual_extraction",
            "created_at": 1769615312429860
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769615312386217,
            "correlation_reason": "manual_extraction",
            "created_at": 1769615315430984
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769615312386217,
            "correlation_reason": "manual_extraction",
            "created_at": 1769615313425386
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769615297373202,
            "correlation_reason": "manual_extraction",
            "created_at": 1769615312423105
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769615297373202,
            "correlation_reason": "manual_extraction",
            "created_at": 1769615297425932
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769615282312827,
            "correlation_reason": "manual_extraction",
            "created_at": 1769615297412976
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769615282312827,
            "correlation_reason": "manual_extraction",
            "created_at": 1769615289562363
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769615267304527,
            "correlation_reason": "manual_extraction",
            "created_at": 1769615282451923
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769615252296054,
            "correlation_reason": "manual_extraction",
            "created_at": 1769615255334637
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769615237288349,
            "correlation_reason": "manual_extraction",
            "created_at": 1769615252360581
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769615207375756,
            "correlation_reason": "manual_extraction",
            "created_at": 1769615207425496
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769614722280228,
            "correlation_reason": "manual_extraction",
            "created_at": 1769614722319189
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769614712503729,
            "correlation_reason": "manual_extraction",
            "created_at": 1769614713550697
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769614712503729,
            "correlation_reason": "manual_extraction",
            "created_at": 1769614715565188
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769614697496580,
            "correlation_reason": "manual_extraction",
            "created_at": 1769614704538851
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769614697496580,
            "correlation_reason": "manual_extraction",
            "created_at": 1769614697536946
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769614682487513,
            "correlation_reason": "manual_extraction",
            "created_at": 1769614683531552
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769614667473248,
            "correlation_reason": "manual_extraction",
            "created_at": 1769614682522355
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769614637400167,
            "correlation_reason": "manual_extraction",
            "created_at": 1769614652457049
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769614622387723,
            "correlation_reason": "manual_extraction",
            "created_at": 1769614637454269
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769614607323784,
            "correlation_reason": "manual_extraction",
            "created_at": 1769614622430073
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769614607323784,
            "correlation_reason": "manual_extraction",
            "created_at": 1769614608361809
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769614592313902,
            "correlation_reason": "manual_extraction",
            "created_at": 1769614592361270
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769614562280253,
            "correlation_reason": "manual_extraction",
            "created_at": 1769614577419976
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769614552279992,
            "correlation_reason": "manual_extraction",
            "created_at": 1769614552405864
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769614517288590,
            "correlation_reason": "manual_extraction",
            "created_at": 1769614532522130
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769614132280341,
            "correlation_reason": "manual_extraction",
            "created_at": 1769614133322546
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769614112279802,
            "correlation_reason": "manual_extraction",
            "created_at": 1769614113326265
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769614087697585,
            "correlation_reason": "manual_extraction",
            "created_at": 1769614094947079
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769614042562876,
            "correlation_reason": "manual_extraction",
            "created_at": 1769614057658455
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769613997402588,
            "correlation_reason": "manual_extraction",
            "created_at": 1769614012647941
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769613967379964,
            "correlation_reason": "manual_extraction",
            "created_at": 1769613970431866
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769613967379964,
            "correlation_reason": "manual_extraction",
            "created_at": 1769613982430617
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769613952363134,
            "correlation_reason": "manual_extraction",
            "created_at": 1769613959436370
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769613952363134,
            "correlation_reason": "manual_extraction",
            "created_at": 1769613967424214
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769613937350639,
            "correlation_reason": "manual_extraction",
            "created_at": 1769613952541090
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769613922341527,
            "correlation_reason": "manual_extraction",
            "created_at": 1769613925388115
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769613922341527,
            "correlation_reason": "manual_extraction",
            "created_at": 1769613923441596
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769613907331484,
            "correlation_reason": "manual_extraction",
            "created_at": 1769613922547533
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769612587507044,
            "correlation_reason": "manual_extraction",
            "created_at": 1769612587739409
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769612587507044,
            "correlation_reason": "manual_extraction",
            "created_at": 1769612588548589
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769612567507306,
            "correlation_reason": "manual_extraction",
            "created_at": 1769612567554424
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769612547507162,
            "correlation_reason": "manual_extraction",
            "created_at": 1769612547554403
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769612527507005,
            "correlation_reason": "manual_extraction",
            "created_at": 1769612527852110
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769612257507464,
            "correlation_reason": "manual_extraction",
            "created_at": 1769612257550234
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769612237507513,
            "correlation_reason": "manual_extraction",
            "created_at": 1769612237549647
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769612227506951,
            "correlation_reason": "manual_extraction",
            "created_at": 1769612227784969
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769612077506951,
            "correlation_reason": "manual_extraction",
            "created_at": 1769612077715926
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769612067507102,
            "correlation_reason": "manual_extraction",
            "created_at": 1769612067672212
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769612047507375,
            "correlation_reason": "manual_extraction",
            "created_at": 1769612050563267
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769612027506623,
            "correlation_reason": "manual_extraction",
            "created_at": 1769612027558778
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769612017506846,
            "correlation_reason": "manual_extraction",
            "created_at": 1769612017708564
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769612017506846,
            "correlation_reason": "manual_extraction",
            "created_at": 1769612018558536
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769611997506774,
            "correlation_reason": "manual_extraction",
            "created_at": 1769611997547755
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769611987506863,
            "correlation_reason": "manual_extraction",
            "created_at": 1769611987551356
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769611987506863,
            "correlation_reason": "manual_extraction",
            "created_at": 1769611988650257
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769611957506903,
            "correlation_reason": "manual_extraction",
            "created_at": 1769611957565157
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769611947506667,
            "correlation_reason": "manual_extraction",
            "created_at": 1769611947550761
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769611927506509,
            "correlation_reason": "manual_extraction",
            "created_at": 1769611927806419
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769611657506747,
            "correlation_reason": "manual_extraction",
            "created_at": 1769611658639391
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769611637705735,
            "correlation_reason": "manual_extraction",
            "created_at": 1769611637887479
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769611627506758,
            "correlation_reason": "manual_extraction",
            "created_at": 1769611627777681
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769611487507537,
            "correlation_reason": "manual_extraction",
            "created_at": 1769611487598586
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769611477507155,
            "correlation_reason": "manual_extraction",
            "created_at": 1769611477649502
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769611447506500,
            "correlation_reason": "manual_extraction",
            "created_at": 1769611450644713
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769611427506999,
            "correlation_reason": "manual_extraction",
            "created_at": 1769611428606011
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769611427506999,
            "correlation_reason": "manual_extraction",
            "created_at": 1769611427603477
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769611407507361,
            "correlation_reason": "manual_extraction",
            "created_at": 1769611410591124
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769611407507361,
            "correlation_reason": "manual_extraction",
            "created_at": 1769611408617243
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769611387507563,
            "correlation_reason": "manual_extraction",
            "created_at": 1769611390745488
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769611387507563,
            "correlation_reason": "manual_extraction",
            "created_at": 1769611388916759
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769611347506909,
            "correlation_reason": "manual_extraction",
            "created_at": 1769611347567850
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769611342676681,
            "correlation_reason": "manual_extraction",
            "created_at": 1769611342789031
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769611327507050,
            "correlation_reason": "manual_extraction",
            "created_at": 1769611327669402
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769611067507127,
            "correlation_reason": "manual_extraction",
            "created_at": 1769611068765311
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769611057507128,
            "correlation_reason": "manual_extraction",
            "created_at": 1769611057668796
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769611027507151,
            "correlation_reason": "manual_extraction",
            "created_at": 1769611027662687
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769610887507304,
            "correlation_reason": "manual_extraction",
            "created_at": 1769610887688383
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769610867507001,
            "correlation_reason": "manual_extraction",
            "created_at": 1769610867559490
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769610847506809,
            "correlation_reason": "manual_extraction",
            "created_at": 1769610850553857
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769610837507140,
            "correlation_reason": "manual_extraction",
            "created_at": 1769610837619616
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769610817507289,
            "correlation_reason": "manual_extraction",
            "created_at": 1769610818647315
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769610817507289,
            "correlation_reason": "manual_extraction",
            "created_at": 1769610817651335
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769610797507517,
            "correlation_reason": "manual_extraction",
            "created_at": 1769610797637058
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769610787506825,
            "correlation_reason": "manual_extraction",
            "created_at": 1769610787718526
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769610787506825,
            "correlation_reason": "manual_extraction",
            "created_at": 1769610788657216
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769610757506967,
            "correlation_reason": "manual_extraction",
            "created_at": 1769610757839897
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769610742609249,
            "correlation_reason": "manual_extraction",
            "created_at": 1769610742742120
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769610727506726,
            "correlation_reason": "manual_extraction",
            "created_at": 1769610727847227
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769610457506708,
            "correlation_reason": "manual_extraction",
            "created_at": 1769610458667387
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769610437506931,
            "correlation_reason": "manual_extraction",
            "created_at": 1769610437834567
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769610427506638,
            "correlation_reason": "manual_extraction",
            "created_at": 1769610427868384
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769610277506760,
            "correlation_reason": "manual_extraction",
            "created_at": 1769610277609809
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769610257506801,
            "correlation_reason": "manual_extraction",
            "created_at": 1769610257735439
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769610247507133,
            "correlation_reason": "manual_extraction",
            "created_at": 1769610250639972
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769610227507411,
            "correlation_reason": "manual_extraction",
            "created_at": 1769610228647330
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769610227507411,
            "correlation_reason": "manual_extraction",
            "created_at": 1769610227674235
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769610207507035,
            "correlation_reason": "manual_extraction",
            "created_at": 1769610210651747
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769610207507035,
            "correlation_reason": "manual_extraction",
            "created_at": 1769610208699641
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769610187506935,
            "correlation_reason": "manual_extraction",
            "created_at": 1769610188687185
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769610187506935,
            "correlation_reason": "manual_extraction",
            "created_at": 1769610187651514
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769610167507388,
            "correlation_reason": "manual_extraction",
            "created_at": 1769610167629414
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769610147506930,
            "correlation_reason": "manual_extraction",
            "created_at": 1769610148691341
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769610127507229,
            "correlation_reason": "manual_extraction",
            "created_at": 1769610128698505
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769609857507464,
            "correlation_reason": "manual_extraction",
            "created_at": 1769609858562015
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769609837506954,
            "correlation_reason": "manual_extraction",
            "created_at": 1769609838708280
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769609827506877,
            "correlation_reason": "manual_extraction",
            "created_at": 1769609827574114
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769609687507488,
            "correlation_reason": "manual_extraction",
            "created_at": 1769609688558807
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769609677507235,
            "correlation_reason": "manual_extraction",
            "created_at": 1769609678725383
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769609647506904,
            "correlation_reason": "manual_extraction",
            "created_at": 1769609650628424
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769609627506813,
            "correlation_reason": "manual_extraction",
            "created_at": 1769609628555838
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769609627506813,
            "correlation_reason": "manual_extraction",
            "created_at": 1769609627568200
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769609607506925,
            "correlation_reason": "manual_extraction",
            "created_at": 1769609608554180
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769609607506925,
            "correlation_reason": "manual_extraction",
            "created_at": 1769609610554012
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769609587506537,
            "correlation_reason": "manual_extraction",
            "created_at": 1769609587779740
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769609587506537,
            "correlation_reason": "manual_extraction",
            "created_at": 1769609588670143
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769609567507070,
            "correlation_reason": "manual_extraction",
            "created_at": 1769609567548747
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769609547506687,
            "correlation_reason": "manual_extraction",
            "created_at": 1769609547689164
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769609527507288,
            "correlation_reason": "manual_extraction",
            "created_at": 1769609530715881
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769609257506878,
            "correlation_reason": "manual_extraction",
            "created_at": 1769609257563132
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769609237507069,
            "correlation_reason": "manual_extraction",
            "created_at": 1769609237659019
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769609227507171,
            "correlation_reason": "manual_extraction",
            "created_at": 1769609227597163
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769609077507019,
            "correlation_reason": "manual_extraction",
            "created_at": 1769609077564738
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769609057507032,
            "correlation_reason": "manual_extraction",
            "created_at": 1769609058606936
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769609047506555,
            "correlation_reason": "manual_extraction",
            "created_at": 1769609054834864
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769609027506484,
            "correlation_reason": "manual_extraction",
            "created_at": 1769609027545353
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769609017507437,
            "correlation_reason": "manual_extraction",
            "created_at": 1769609018696137
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769609017507437,
            "correlation_reason": "manual_extraction",
            "created_at": 1769609017580234
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769608997506765,
            "correlation_reason": "manual_extraction",
            "created_at": 1769608997551452
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769608987507057,
            "correlation_reason": "manual_extraction",
            "created_at": 1769608988576269
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769608987507057,
            "correlation_reason": "manual_extraction",
            "created_at": 1769608987555612
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769608957506677,
            "correlation_reason": "manual_extraction",
            "created_at": 1769608958764139
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769608937507205,
            "correlation_reason": "manual_extraction",
            "created_at": 1769608937675264
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769608927507094,
            "correlation_reason": "manual_extraction",
            "created_at": 1769608928860830
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769608657507232,
            "correlation_reason": "manual_extraction",
            "created_at": 1769608657911125
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769608637506857,
            "correlation_reason": "manual_extraction",
            "created_at": 1769608637688849
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769608627506717,
            "correlation_reason": "manual_extraction",
            "created_at": 1769608627821766
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769608477517264,
            "correlation_reason": "manual_extraction",
            "created_at": 1769608477685531
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769608457506508,
            "correlation_reason": "manual_extraction",
            "created_at": 1769608457757383
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769608447506861,
            "correlation_reason": "manual_extraction",
            "created_at": 1769608454757429
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769608427507095,
            "correlation_reason": "manual_extraction",
            "created_at": 1769608428616572
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769608417507198,
            "correlation_reason": "manual_extraction",
            "created_at": 1769608417612169
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769608417507198,
            "correlation_reason": "manual_extraction",
            "created_at": 1769608418679856
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769608397506945,
            "correlation_reason": "manual_extraction",
            "created_at": 1769608397657595
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769608387506992,
            "correlation_reason": "manual_extraction",
            "created_at": 1769608387661139
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769608387506992,
            "correlation_reason": "manual_extraction",
            "created_at": 1769608388681943
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769608357506857,
            "correlation_reason": "manual_extraction",
            "created_at": 1769608357776866
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769608337506730,
            "correlation_reason": "manual_extraction",
            "created_at": 1769608337707250
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769608327506966,
            "correlation_reason": "manual_extraction",
            "created_at": 1769608328774382
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769608057507525,
            "correlation_reason": "manual_extraction",
            "created_at": 1769608058554710
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769608037507302,
            "correlation_reason": "manual_extraction",
            "created_at": 1769608037558779
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769608027507301,
            "correlation_reason": "manual_extraction",
            "created_at": 1769608027811341
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769607887507483,
            "correlation_reason": "manual_extraction",
            "created_at": 1769607887564210
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769607867506536,
            "correlation_reason": "manual_extraction",
            "created_at": 1769607867597583
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769607847507231,
            "correlation_reason": "manual_extraction",
            "created_at": 1769607850567622
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769607827507203,
            "correlation_reason": "manual_extraction",
            "created_at": 1769607827558598
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769607817506709,
            "correlation_reason": "manual_extraction",
            "created_at": 1769607818566691
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769607817506709,
            "correlation_reason": "manual_extraction",
            "created_at": 1769607820561446
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769607797507314,
            "correlation_reason": "manual_extraction",
            "created_at": 1769607797577768
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769607787507313,
            "correlation_reason": "manual_extraction",
            "created_at": 1769607788567414
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769607787507313,
            "correlation_reason": "manual_extraction",
            "created_at": 1769607787560107
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769607757507320,
            "correlation_reason": "manual_extraction",
            "created_at": 1769607757557417
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769607737506877,
            "correlation_reason": "manual_extraction",
            "created_at": 1769607737550472
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769607727506730,
            "correlation_reason": "manual_extraction",
            "created_at": 1769607728638373
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769607457507516,
            "correlation_reason": "manual_extraction",
            "created_at": 1769607457571716
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769607437506647,
            "correlation_reason": "manual_extraction",
            "created_at": 1769607437554343
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769607427506962,
            "correlation_reason": "manual_extraction",
            "created_at": 1769607427597842
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769607287507055,
            "correlation_reason": "manual_extraction",
            "created_at": 1769607287604877
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769607267506683,
            "correlation_reason": "manual_extraction",
            "created_at": 1769607267551021
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769607247506734,
            "correlation_reason": "manual_extraction",
            "created_at": 1769607250561687
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769607217507275,
            "correlation_reason": "manual_extraction",
            "created_at": 1769607217755975
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769607217507275,
            "correlation_reason": "manual_extraction",
            "created_at": 1769607218616949
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769607197507071,
            "correlation_reason": "manual_extraction",
            "created_at": 1769607200581335
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769607197507071,
            "correlation_reason": "manual_extraction",
            "created_at": 1769607198698671
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769607187507267,
            "correlation_reason": "manual_extraction",
            "created_at": 1769607188576379
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769607187507267,
            "correlation_reason": "manual_extraction",
            "created_at": 1769607190570688
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769607167507183,
            "correlation_reason": "manual_extraction",
            "created_at": 1769607167553250
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769607147507191,
            "correlation_reason": "manual_extraction",
            "created_at": 1769607147563880
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769607127507277,
            "correlation_reason": "manual_extraction",
            "created_at": 1769607127678208
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769606857506837,
            "correlation_reason": "manual_extraction",
            "created_at": 1769606857745986
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769606837506664,
            "correlation_reason": "manual_extraction",
            "created_at": 1769606837545542
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769606827506783,
            "correlation_reason": "manual_extraction",
            "created_at": 1769606827609046
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769606677507055,
            "correlation_reason": "manual_extraction",
            "created_at": 1769606677548248
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769606667507359,
            "correlation_reason": "manual_extraction",
            "created_at": 1769606667623091
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769606647506843,
            "correlation_reason": "manual_extraction",
            "created_at": 1769606650573912
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769606627507426,
            "correlation_reason": "manual_extraction",
            "created_at": 1769606628550082
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769606627507426,
            "correlation_reason": "manual_extraction",
            "created_at": 1769606627547926
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769606607507508,
            "correlation_reason": "manual_extraction",
            "created_at": 1769606608661775
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769606607507508,
            "correlation_reason": "manual_extraction",
            "created_at": 1769606610629684
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769606587506669,
            "correlation_reason": "manual_extraction",
            "created_at": 1769606588549606
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769606587506669,
            "correlation_reason": "manual_extraction",
            "created_at": 1769606587555168
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769606567507081,
            "correlation_reason": "manual_extraction",
            "created_at": 1769606570571863
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769606557506705,
            "correlation_reason": "manual_extraction",
            "created_at": 1769606557582873
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769606527506530,
            "correlation_reason": "manual_extraction",
            "created_at": 1769606528678868
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769606257506764,
            "correlation_reason": "manual_extraction",
            "created_at": 1769606260701085
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769606237507318,
            "correlation_reason": "manual_extraction",
            "created_at": 1769606237548071
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769606227506922,
            "correlation_reason": "manual_extraction",
            "created_at": 1769606227747248
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769606097507452,
            "correlation_reason": "manual_extraction",
            "created_at": 1769606097554845
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769606077507365,
            "correlation_reason": "manual_extraction",
            "created_at": 1769606078552652
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769606047507487,
            "correlation_reason": "manual_extraction",
            "created_at": 1769606050570178
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769606017506654,
            "correlation_reason": "manual_extraction",
            "created_at": 1769606017562630
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769606017506654,
            "correlation_reason": "manual_extraction",
            "created_at": 1769606018552090
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769605997506840,
            "correlation_reason": "manual_extraction",
            "created_at": 1769605998554708
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769605997506840,
            "correlation_reason": "manual_extraction",
            "created_at": 1769605997550260
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769605987507164,
            "correlation_reason": "manual_extraction",
            "created_at": 1769605988553345
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769605987507164,
            "correlation_reason": "manual_extraction",
            "created_at": 1769605987562764
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769605967506952,
            "correlation_reason": "manual_extraction",
            "created_at": 1769605967562472
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769605947506842,
            "correlation_reason": "manual_extraction",
            "created_at": 1769605947587869
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769605927506851,
            "correlation_reason": "manual_extraction",
            "created_at": 1769605928691801
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769605657507283,
            "correlation_reason": "manual_extraction",
            "created_at": 1769605657620089
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769605637506618,
            "correlation_reason": "manual_extraction",
            "created_at": 1769605638550150
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769605627575961,
            "correlation_reason": "manual_extraction",
            "created_at": 1769605627656412
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769605447507063,
            "correlation_reason": "manual_extraction",
            "created_at": 1769605450681538
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769605427507273,
            "correlation_reason": "manual_extraction",
            "created_at": 1769605427605967
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769605417507321,
            "correlation_reason": "manual_extraction",
            "created_at": 1769605418548142
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769605417507321,
            "correlation_reason": "manual_extraction",
            "created_at": 1769605424630167
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769605417507321,
            "correlation_reason": "manual_extraction",
            "created_at": 1769605417552845
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769605397507534,
            "correlation_reason": "manual_extraction",
            "created_at": 1769605397549986
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769605387507028,
            "correlation_reason": "manual_extraction",
            "created_at": 1769605388549523
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769605387507028,
            "correlation_reason": "manual_extraction",
            "created_at": 1769605390558073
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769605387507028,
            "correlation_reason": "manual_extraction",
            "created_at": 1769605387557389
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769605367506538,
            "correlation_reason": "manual_extraction",
            "created_at": 1769605367547953
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769605347507022,
            "correlation_reason": "manual_extraction",
            "created_at": 1769605347555894
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769605327506873,
            "correlation_reason": "manual_extraction",
            "created_at": 1769605327843196
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769605057580355,
            "correlation_reason": "manual_extraction",
            "created_at": 1769605057625345
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769605037507066,
            "correlation_reason": "manual_extraction",
            "created_at": 1769605038549892
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769605027507395,
            "correlation_reason": "manual_extraction",
            "created_at": 1769605027595162
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769604827506995,
            "correlation_reason": "manual_extraction",
            "created_at": 1769604827551622
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769604827506995,
            "correlation_reason": "manual_extraction",
            "created_at": 1769604828563634
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769604817506603,
            "correlation_reason": "manual_extraction",
            "created_at": 1769604818575495
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769604817506603,
            "correlation_reason": "manual_extraction",
            "created_at": 1769604820566471
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769604817506603,
            "correlation_reason": "manual_extraction",
            "created_at": 1769604817746804
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769604797506507,
            "correlation_reason": "manual_extraction",
            "created_at": 1769604798566822
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769604787507225,
            "correlation_reason": "manual_extraction",
            "created_at": 1769604794684303
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769604787507225,
            "correlation_reason": "manual_extraction",
            "created_at": 1769604790787805
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769604787507225,
            "correlation_reason": "manual_extraction",
            "created_at": 1769604788635288
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769604767507135,
            "correlation_reason": "manual_extraction",
            "created_at": 1769604767583355
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769604747506694,
            "correlation_reason": "manual_extraction",
            "created_at": 1769604747717338
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769604727507030,
            "correlation_reason": "manual_extraction",
            "created_at": 1769604730782184
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769604457507403,
            "correlation_reason": "manual_extraction",
            "created_at": 1769604458555197
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769604437507061,
            "correlation_reason": "manual_extraction",
            "created_at": 1769604438707785
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769604427506853,
            "correlation_reason": "manual_extraction",
            "created_at": 1769604427908764
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769604237507287,
            "correlation_reason": "manual_extraction",
            "created_at": 1769604237561114
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769604217507329,
            "correlation_reason": "manual_extraction",
            "created_at": 1769604220688736
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769604217507329,
            "correlation_reason": "manual_extraction",
            "created_at": 1769604218559240
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769604207506753,
            "correlation_reason": "manual_extraction",
            "created_at": 1769604210655884
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769604207506753,
            "correlation_reason": "manual_extraction",
            "created_at": 1769604214573394
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769604207506753,
            "correlation_reason": "manual_extraction",
            "created_at": 1769604208585993
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769604187507171,
            "correlation_reason": "manual_extraction",
            "created_at": 1769604187749456
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769604187507171,
            "correlation_reason": "manual_extraction",
            "created_at": 1769604190606461
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769604187507171,
            "correlation_reason": "manual_extraction",
            "created_at": 1769604188615054
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769604167507274,
            "correlation_reason": "manual_extraction",
            "created_at": 1769604167718024
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769604142518638,
            "correlation_reason": "manual_extraction",
            "created_at": 1769604142636908
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769604127506640,
            "correlation_reason": "manual_extraction",
            "created_at": 1769604128739469
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769603867506675,
            "correlation_reason": "manual_extraction",
            "created_at": 1769603868555366
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769603847506497,
            "correlation_reason": "manual_extraction",
            "created_at": 1769603848548924
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769603827506541,
            "correlation_reason": "manual_extraction",
            "created_at": 1769603827790490
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769603637506870,
            "correlation_reason": "manual_extraction",
            "created_at": 1769603637556935
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769603617506718,
            "correlation_reason": "manual_extraction",
            "created_at": 1769603618573339
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769603617506718,
            "correlation_reason": "manual_extraction",
            "created_at": 1769603617555630
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769603607507025,
            "correlation_reason": "manual_extraction",
            "created_at": 1769603610550477
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769603607507025,
            "correlation_reason": "manual_extraction",
            "created_at": 1769603614628779
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769603607507025,
            "correlation_reason": "manual_extraction",
            "created_at": 1769603608546715
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769603587507250,
            "correlation_reason": "manual_extraction",
            "created_at": 1769603587705988
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769603587507250,
            "correlation_reason": "manual_extraction",
            "created_at": 1769603590699688
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769603587507250,
            "correlation_reason": "manual_extraction",
            "created_at": 1769603588635433
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769603567506738,
            "correlation_reason": "manual_extraction",
            "created_at": 1769603567591998
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769603547506834,
            "correlation_reason": "manual_extraction",
            "created_at": 1769603547563382
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769603527506947,
            "correlation_reason": "manual_extraction",
            "created_at": 1769603527801646
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769603257506845,
            "correlation_reason": "manual_extraction",
            "created_at": 1769603257553824
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769603237507010,
            "correlation_reason": "manual_extraction",
            "created_at": 1769603237549984
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769603227506514,
            "correlation_reason": "manual_extraction",
            "created_at": 1769603227937661
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769603027507062,
            "correlation_reason": "manual_extraction",
            "created_at": 1769603028547206
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769603027507062,
            "correlation_reason": "manual_extraction",
            "created_at": 1769603027547817
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769603017507001,
            "correlation_reason": "manual_extraction",
            "created_at": 1769603017549599
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769603017507001,
            "correlation_reason": "manual_extraction",
            "created_at": 1769603020575680
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769603017507001,
            "correlation_reason": "manual_extraction",
            "created_at": 1769603018551978
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769602997506609,
            "correlation_reason": "manual_extraction",
            "created_at": 1769602997656973
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769602987506556,
            "correlation_reason": "manual_extraction",
            "created_at": 1769602988612259
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769602987506556,
            "correlation_reason": "manual_extraction",
            "created_at": 1769602990673779
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769602987506556,
            "correlation_reason": "manual_extraction",
            "created_at": 1769602987668752
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769602967507309,
            "correlation_reason": "manual_extraction",
            "created_at": 1769602968675972
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769602942516963,
            "correlation_reason": "manual_extraction",
            "created_at": 1769602942575272
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769602927506801,
            "correlation_reason": "manual_extraction",
            "created_at": 1769602928671856
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769602667506483,
            "correlation_reason": "manual_extraction",
            "created_at": 1769602667587067
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769602647506766,
            "correlation_reason": "manual_extraction",
            "created_at": 1769602648627513
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769602627506796,
            "correlation_reason": "manual_extraction",
            "created_at": 1769602627758547
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769602427507107,
            "correlation_reason": "manual_extraction",
            "created_at": 1769602428632666
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769602427507107,
            "correlation_reason": "manual_extraction",
            "created_at": 1769602427596888
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769602417506942,
            "correlation_reason": "manual_extraction",
            "created_at": 1769602417554137
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769602417506942,
            "correlation_reason": "manual_extraction",
            "created_at": 1769602420624571
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769602417506942,
            "correlation_reason": "manual_extraction",
            "created_at": 1769602418556667
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769602397507321,
            "correlation_reason": "manual_extraction",
            "created_at": 1769602397555956
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769602387507537,
            "correlation_reason": "manual_extraction",
            "created_at": 1769602388551937
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769602387507537,
            "correlation_reason": "manual_extraction",
            "created_at": 1769602390568643
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769602387507537,
            "correlation_reason": "manual_extraction",
            "created_at": 1769602387558227
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769602357507315,
            "correlation_reason": "manual_extraction",
            "created_at": 1769602357560229
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769602337540900,
            "correlation_reason": "manual_extraction",
            "created_at": 1769602337599649
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769602327507337,
            "correlation_reason": "manual_extraction",
            "created_at": 1769602327599408
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769602057506901,
            "correlation_reason": "manual_extraction",
            "created_at": 1769602057560885
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769602037506898,
            "correlation_reason": "manual_extraction",
            "created_at": 1769602037577147
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769602027507279,
            "correlation_reason": "manual_extraction",
            "created_at": 1769602027582581
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769601837506970,
            "correlation_reason": "manual_extraction",
            "created_at": 1769601838605421
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769601837506970,
            "correlation_reason": "manual_extraction",
            "created_at": 1769601837658343
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769601817507133,
            "correlation_reason": "manual_extraction",
            "created_at": 1769601820606547
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769601817507133,
            "correlation_reason": "manual_extraction",
            "created_at": 1769601818593652
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769601817507133,
            "correlation_reason": "manual_extraction",
            "created_at": 1769601817600779
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769601797507423,
            "correlation_reason": "manual_extraction",
            "created_at": 1769601797560968
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769601787506866,
            "correlation_reason": "manual_extraction",
            "created_at": 1769601788564930
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769601787506866,
            "correlation_reason": "manual_extraction",
            "created_at": 1769601790575232
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769601787506866,
            "correlation_reason": "manual_extraction",
            "created_at": 1769601787633895
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769601767550505,
            "correlation_reason": "manual_extraction",
            "created_at": 1769601767669010
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769601747507360,
            "correlation_reason": "manual_extraction",
            "created_at": 1769601747547356
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769601727507302,
            "correlation_reason": "manual_extraction",
            "created_at": 1769601728592665
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769601467506784,
            "correlation_reason": "manual_extraction",
            "created_at": 1769601467750397
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769601447507488,
            "correlation_reason": "manual_extraction",
            "created_at": 1769601448600769
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769601427507131,
            "correlation_reason": "manual_extraction",
            "created_at": 1769601427595854
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769601227507369,
            "correlation_reason": "manual_extraction",
            "created_at": 1769601230552162
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769601227507369,
            "correlation_reason": "manual_extraction",
            "created_at": 1769601228591507
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769601227507369,
            "correlation_reason": "manual_extraction",
            "created_at": 1769601227555404
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769601207507358,
            "correlation_reason": "manual_extraction",
            "created_at": 1769601210552341
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769601207507358,
            "correlation_reason": "manual_extraction",
            "created_at": 1769601214556264
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769601207507358,
            "correlation_reason": "manual_extraction",
            "created_at": 1769601208641277
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769601187507008,
            "correlation_reason": "manual_extraction",
            "created_at": 1769601188546124
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769601187507008,
            "correlation_reason": "manual_extraction",
            "created_at": 1769601190560366
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769601187507008,
            "correlation_reason": "manual_extraction",
            "created_at": 1769601187552978
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769601177506966,
            "correlation_reason": "manual_extraction",
            "created_at": 1769601177634394
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769601157507472,
            "correlation_reason": "manual_extraction",
            "created_at": 1769601157698411
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769601127507309,
            "correlation_reason": "manual_extraction",
            "created_at": 1769601128637795
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769600857506484,
            "correlation_reason": "manual_extraction",
            "created_at": 1769600858558281
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769600837506627,
            "correlation_reason": "manual_extraction",
            "created_at": 1769600837565953
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769600827506741,
            "correlation_reason": "manual_extraction",
            "created_at": 1769600827803749
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769600617506508,
            "correlation_reason": "manual_extraction",
            "created_at": 1769600617553454
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769600617506508,
            "correlation_reason": "manual_extraction",
            "created_at": 1769600620560323
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769600617506508,
            "correlation_reason": "manual_extraction",
            "created_at": 1769600618567431
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769600607507391,
            "correlation_reason": "manual_extraction",
            "created_at": 1769600614553502
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769600607507391,
            "correlation_reason": "manual_extraction",
            "created_at": 1769600610557849
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769600607507391,
            "correlation_reason": "manual_extraction",
            "created_at": 1769600608549055
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769600587507098,
            "correlation_reason": "manual_extraction",
            "created_at": 1769600587590649
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769600587507098,
            "correlation_reason": "manual_extraction",
            "created_at": 1769600590638284
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769600587507098,
            "correlation_reason": "manual_extraction",
            "created_at": 1769600588563122
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769600567507214,
            "correlation_reason": "manual_extraction",
            "created_at": 1769600567561934
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769600547506689,
            "correlation_reason": "manual_extraction",
            "created_at": 1769600547559537
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769600527506786,
            "correlation_reason": "manual_extraction",
            "created_at": 1769600528653401
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769600257507313,
            "correlation_reason": "manual_extraction",
            "created_at": 1769600257593656
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769600237506980,
            "correlation_reason": "manual_extraction",
            "created_at": 1769600237551167
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769600227506870,
            "correlation_reason": "manual_extraction",
            "created_at": 1769600227810829
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769600027507367,
            "correlation_reason": "manual_extraction",
            "created_at": 1769600028557913
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769600027507367,
            "correlation_reason": "manual_extraction",
            "created_at": 1769600027551914
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769600007507402,
            "correlation_reason": "manual_extraction",
            "created_at": 1769600014559360
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769600007507402,
            "correlation_reason": "manual_extraction",
            "created_at": 1769600010559725
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769599987506691,
            "correlation_reason": "manual_extraction",
            "created_at": 1769599988597260
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769599987506691,
            "correlation_reason": "manual_extraction",
            "created_at": 1769599990590341
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769599987506691,
            "correlation_reason": "manual_extraction",
            "created_at": 1769599987708805
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769599967507410,
            "correlation_reason": "manual_extraction",
            "created_at": 1769599967684523
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769599967507410,
            "correlation_reason": "manual_extraction",
            "created_at": 1769599968591709
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769599947507276,
            "correlation_reason": "manual_extraction",
            "created_at": 1769599947614716
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769599927507516,
            "correlation_reason": "manual_extraction",
            "created_at": 1769599942563210
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769599927507516,
            "correlation_reason": "manual_extraction",
            "created_at": 1769599927588230
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769599657506777,
            "correlation_reason": "manual_extraction",
            "created_at": 1769599657557124
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769599637507294,
            "correlation_reason": "manual_extraction",
            "created_at": 1769599637574135
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769599627506861,
            "correlation_reason": "manual_extraction",
            "created_at": 1769599627590506
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769599427507340,
            "correlation_reason": "manual_extraction",
            "created_at": 1769599427727240
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769599417507045,
            "correlation_reason": "manual_extraction",
            "created_at": 1769599418905248
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769599417507045,
            "correlation_reason": "manual_extraction",
            "created_at": 1769599420627238
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769599397506515,
            "correlation_reason": "manual_extraction",
            "created_at": 1769599397545155
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769599387506867,
            "correlation_reason": "manual_extraction",
            "created_at": 1769599388589917
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769599387506867,
            "correlation_reason": "manual_extraction",
            "created_at": 1769599390668142
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769599377507338,
            "correlation_reason": "manual_extraction",
            "created_at": 1769599377607731
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769599357507060,
            "correlation_reason": "manual_extraction",
            "created_at": 1769599357628770
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769599357507060,
            "correlation_reason": "manual_extraction",
            "created_at": 1769599358561039
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769599342516964,
            "correlation_reason": "manual_extraction",
            "created_at": 1769599342564438
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769599327507307,
            "correlation_reason": "manual_extraction",
            "created_at": 1769599328571440
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769599327507307,
            "correlation_reason": "manual_extraction",
            "created_at": 1769599342559775
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769599067506995,
            "correlation_reason": "manual_extraction",
            "created_at": 1769599067817923
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769599047507364,
            "correlation_reason": "manual_extraction",
            "created_at": 1769599048644547
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769599027506904,
            "correlation_reason": "manual_extraction",
            "created_at": 1769599027593389
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769598817507140,
            "correlation_reason": "manual_extraction",
            "created_at": 1769598818609405
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769598817507140,
            "correlation_reason": "manual_extraction",
            "created_at": 1769598817583412
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769598807506535,
            "correlation_reason": "manual_extraction",
            "created_at": 1769598810694639
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769598807506535,
            "correlation_reason": "manual_extraction",
            "created_at": 1769598808601939
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769598787506529,
            "correlation_reason": "manual_extraction",
            "created_at": 1769598788587771
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769598787506529,
            "correlation_reason": "manual_extraction",
            "created_at": 1769598787554277
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769598767507421,
            "correlation_reason": "manual_extraction",
            "created_at": 1769598768597829
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769598747507060,
            "correlation_reason": "manual_extraction",
            "created_at": 1769598747710854
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769598737506783,
            "correlation_reason": "manual_extraction",
            "created_at": 1769598737580876
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769598727506717,
            "correlation_reason": "manual_extraction",
            "created_at": 1769598727572546
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769598713548325,
            "correlation_reason": "manual_extraction",
            "created_at": 1769598713645477
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769598697530829,
            "correlation_reason": "manual_extraction",
            "created_at": 1769598697839250
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769598457507154,
            "correlation_reason": "manual_extraction",
            "created_at": 1769598458602559
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769598437506997,
            "correlation_reason": "manual_extraction",
            "created_at": 1769598437571770
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769598427506707,
            "correlation_reason": "manual_extraction",
            "created_at": 1769598427772921
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769598217506661,
            "correlation_reason": "manual_extraction",
            "created_at": 1769598218559714
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769598217506661,
            "correlation_reason": "manual_extraction",
            "created_at": 1769598217781623
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769598207506520,
            "correlation_reason": "manual_extraction",
            "created_at": 1769598210574096
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769598207506520,
            "correlation_reason": "manual_extraction",
            "created_at": 1769598208557543
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769598187506714,
            "correlation_reason": "manual_extraction",
            "created_at": 1769598187551935
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769598187506714,
            "correlation_reason": "manual_extraction",
            "created_at": 1769598188546484
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769598157506663,
            "correlation_reason": "manual_extraction",
            "created_at": 1769598157641666
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769598137507171,
            "correlation_reason": "manual_extraction",
            "created_at": 1769598137718827
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769598127507010,
            "correlation_reason": "manual_extraction",
            "created_at": 1769598128562718
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769598115541655,
            "correlation_reason": "manual_extraction",
            "created_at": 1769598115661143
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769598112536862,
            "correlation_reason": "manual_extraction",
            "created_at": 1769598113577254
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769598067506735,
            "correlation_reason": "manual_extraction",
            "created_at": 1769598074703203
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769597857507136,
            "correlation_reason": "manual_extraction",
            "created_at": 1769597857592057
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769597837506687,
            "correlation_reason": "manual_extraction",
            "created_at": 1769597838555714
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769597827507029,
            "correlation_reason": "manual_extraction",
            "created_at": 1769597827657945
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769597627506972,
            "correlation_reason": "manual_extraction",
            "created_at": 1769597628649005
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769597627506972,
            "correlation_reason": "manual_extraction",
            "created_at": 1769597627552194
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769597617507316,
            "correlation_reason": "manual_extraction",
            "created_at": 1769597618573209
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769597617507316,
            "correlation_reason": "manual_extraction",
            "created_at": 1769597617678783
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769597587507096,
            "correlation_reason": "manual_extraction",
            "created_at": 1769597588552090
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769597587507096,
            "correlation_reason": "manual_extraction",
            "created_at": 1769597590552122
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769597557506686,
            "correlation_reason": "manual_extraction",
            "created_at": 1769597557643953
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769597542529867,
            "correlation_reason": "manual_extraction",
            "created_at": 1769597542645037
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769597527507228,
            "correlation_reason": "manual_extraction",
            "created_at": 1769597527722240
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769597482620709,
            "correlation_reason": "manual_extraction",
            "created_at": 1769597482670507
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769597453552425,
            "correlation_reason": "manual_extraction",
            "created_at": 1769597453794232
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769597437528978,
            "correlation_reason": "manual_extraction",
            "created_at": 1769597440811780
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769597257507184,
            "correlation_reason": "manual_extraction",
            "created_at": 1769597258635769
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769597237506897,
            "correlation_reason": "manual_extraction",
            "created_at": 1769597237554257
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769597227507430,
            "correlation_reason": "manual_extraction",
            "created_at": 1769597227599586
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769597027507465,
            "correlation_reason": "manual_extraction",
            "created_at": 1769597027587142
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769597017507030,
            "correlation_reason": "manual_extraction",
            "created_at": 1769597018632991
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769597017507030,
            "correlation_reason": "manual_extraction",
            "created_at": 1769597017647354
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769596997506983,
            "correlation_reason": "manual_extraction",
            "created_at": 1769597000602113
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769596987507366,
            "correlation_reason": "manual_extraction",
            "created_at": 1769596988647933
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769596987507366,
            "correlation_reason": "manual_extraction",
            "created_at": 1769596987742032
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769596957507009,
            "correlation_reason": "manual_extraction",
            "created_at": 1769596957700555
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769596947507356,
            "correlation_reason": "manual_extraction",
            "created_at": 1769596947597227
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769596927507163,
            "correlation_reason": "manual_extraction",
            "created_at": 1769596928631409
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769596852571413,
            "correlation_reason": "manual_extraction",
            "created_at": 1769596855714604
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769596822525913,
            "correlation_reason": "manual_extraction",
            "created_at": 1769596837680323
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38smkgNeIPvrcHqdKpWay2ua2ry",
            "alert_name": "rbac_sql_f104c71b",
            "alert_fired_at": 1769596797506844,
            "correlation_reason": "manual_extraction",
            "created_at": 1769596798623998
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769596667506994,
            "correlation_reason": "manual_extraction",
            "created_at": 1769596668604163
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769596647506681,
            "correlation_reason": "manual_extraction",
            "created_at": 1769596648697925
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769596627507018,
            "correlation_reason": "manual_extraction",
            "created_at": 1769596628948253
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769596427506914,
            "correlation_reason": "manual_extraction",
            "created_at": 1769596428596171
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769596427506914,
            "correlation_reason": "manual_extraction",
            "created_at": 1769596427745303
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769596407506901,
            "correlation_reason": "manual_extraction",
            "created_at": 1769596410557857
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769596407506901,
            "correlation_reason": "manual_extraction",
            "created_at": 1769596408548375
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769596387506896,
            "correlation_reason": "manual_extraction",
            "created_at": 1769596388711963
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769596387506896,
            "correlation_reason": "manual_extraction",
            "created_at": 1769596387550435
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769596357507015,
            "correlation_reason": "manual_extraction",
            "created_at": 1769596358666124
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769596337506775,
            "correlation_reason": "manual_extraction",
            "created_at": 1769596337705576
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769596327507250,
            "correlation_reason": "manual_extraction",
            "created_at": 1769596328602372
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769596057506784,
            "correlation_reason": "manual_extraction",
            "created_at": 1769596057554576
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769596037507496,
            "correlation_reason": "manual_extraction",
            "created_at": 1769596038548358
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769596027507348,
            "correlation_reason": "manual_extraction",
            "created_at": 1769596027606770
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769595817507071,
            "correlation_reason": "manual_extraction",
            "created_at": 1769595817549442
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769595807507211,
            "correlation_reason": "manual_extraction",
            "created_at": 1769595808553066
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769595787506646,
            "correlation_reason": "manual_extraction",
            "created_at": 1769595788557470
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769595787506646,
            "correlation_reason": "manual_extraction",
            "created_at": 1769595787551073
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769595767506855,
            "correlation_reason": "manual_extraction",
            "created_at": 1769595768637149
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769595747507013,
            "correlation_reason": "manual_extraction",
            "created_at": 1769595747575581
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769595742517307,
            "correlation_reason": "manual_extraction",
            "created_at": 1769595743562068
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769595742517307,
            "correlation_reason": "manual_extraction",
            "created_at": 1769595742579280
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769595727507086,
            "correlation_reason": "manual_extraction",
            "created_at": 1769595728605541
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769595457507018,
            "correlation_reason": "manual_extraction",
            "created_at": 1769595458545959
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769595437507130,
            "correlation_reason": "manual_extraction",
            "created_at": 1769595437579423
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769595427507352,
            "correlation_reason": "manual_extraction",
            "created_at": 1769595427591356
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769595227507516,
            "correlation_reason": "manual_extraction",
            "created_at": 1769595227748620
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769595207507064,
            "correlation_reason": "manual_extraction",
            "created_at": 1769595208572384
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769595187507056,
            "correlation_reason": "manual_extraction",
            "created_at": 1769595187576973
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769595167507428,
            "correlation_reason": "manual_extraction",
            "created_at": 1769595168558589
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769595167507428,
            "correlation_reason": "manual_extraction",
            "created_at": 1769595167558983
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769595147507375,
            "correlation_reason": "manual_extraction",
            "created_at": 1769595148630434
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769595147507375,
            "correlation_reason": "manual_extraction",
            "created_at": 1769595147560190
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769595142517131,
            "correlation_reason": "manual_extraction",
            "created_at": 1769595142572101
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769595127506902,
            "correlation_reason": "manual_extraction",
            "created_at": 1769595128715582
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769594867506902,
            "correlation_reason": "manual_extraction",
            "created_at": 1769594870598750
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769594847506844,
            "correlation_reason": "manual_extraction",
            "created_at": 1769594848746838
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769594827507044,
            "correlation_reason": "manual_extraction",
            "created_at": 1769594828755503
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769594627507110,
            "correlation_reason": "manual_extraction",
            "created_at": 1769594627646941
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769594617532082,
            "correlation_reason": "manual_extraction",
            "created_at": 1769594617628281
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769594587507193,
            "correlation_reason": "manual_extraction",
            "created_at": 1769594587626918
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769594577507045,
            "correlation_reason": "manual_extraction",
            "created_at": 1769594577795699
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769594557506665,
            "correlation_reason": "manual_extraction",
            "created_at": 1769594564661754
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769594557506665,
            "correlation_reason": "manual_extraction",
            "created_at": 1769594557586145
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769594542515009,
            "correlation_reason": "manual_extraction",
            "created_at": 1769594542648488
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769594527506761,
            "correlation_reason": "manual_extraction",
            "created_at": 1769594542647200
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769594527506761,
            "correlation_reason": "manual_extraction",
            "created_at": 1769594528669238
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769594257506949,
            "correlation_reason": "manual_extraction",
            "created_at": 1769594257764617
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769594237506812,
            "correlation_reason": "manual_extraction",
            "created_at": 1769594237699030
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769594227506727,
            "correlation_reason": "manual_extraction",
            "created_at": 1769594227744180
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769594027506686,
            "correlation_reason": "manual_extraction",
            "created_at": 1769594027581883
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769594007506751,
            "correlation_reason": "manual_extraction",
            "created_at": 1769594008546244
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769593987507132,
            "correlation_reason": "manual_extraction",
            "created_at": 1769593987626870
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769593967507491,
            "correlation_reason": "manual_extraction",
            "created_at": 1769593968692508
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769593947507443,
            "correlation_reason": "manual_extraction",
            "created_at": 1769593948709863
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769593947507443,
            "correlation_reason": "manual_extraction",
            "created_at": 1769593947585272
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769593942526542,
            "correlation_reason": "manual_extraction",
            "created_at": 1769593942639610
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769593927506692,
            "correlation_reason": "manual_extraction",
            "created_at": 1769593930606952
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769593927506692,
            "correlation_reason": "manual_extraction",
            "created_at": 1769593927870987
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769593657506721,
            "correlation_reason": "manual_extraction",
            "created_at": 1769593658641872
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769593637507328,
            "correlation_reason": "manual_extraction",
            "created_at": 1769593637629602
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769593627506741,
            "correlation_reason": "manual_extraction",
            "created_at": 1769593627767201
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769593387507366,
            "correlation_reason": "manual_extraction",
            "created_at": 1769593387657312
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769593367506678,
            "correlation_reason": "manual_extraction",
            "created_at": 1769593368619983
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769593367506678,
            "correlation_reason": "manual_extraction",
            "created_at": 1769593367634023
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769593347506492,
            "correlation_reason": "manual_extraction",
            "created_at": 1769593347652921
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769593347506492,
            "correlation_reason": "manual_extraction",
            "created_at": 1769593348676937
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769593342534518,
            "correlation_reason": "manual_extraction",
            "created_at": 1769593343695054
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769593342534518,
            "correlation_reason": "manual_extraction",
            "created_at": 1769593342585281
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769593327506652,
            "correlation_reason": "manual_extraction",
            "created_at": 1769593330638290
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769593327506652,
            "correlation_reason": "manual_extraction",
            "created_at": 1769593327900100
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769593057506890,
            "correlation_reason": "manual_extraction",
            "created_at": 1769593057672973
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769593037543757,
            "correlation_reason": "manual_extraction",
            "created_at": 1769593037697063
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769593027506649,
            "correlation_reason": "manual_extraction",
            "created_at": 1769593027802706
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769592777507108,
            "correlation_reason": "manual_extraction",
            "created_at": 1769592777684877
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769592757506891,
            "correlation_reason": "manual_extraction",
            "created_at": 1769592760649358
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769592757506891,
            "correlation_reason": "manual_extraction",
            "created_at": 1769592757679083
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769592757506891,
            "correlation_reason": "manual_extraction",
            "created_at": 1769592764657206
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769592742540568,
            "correlation_reason": "manual_extraction",
            "created_at": 1769592745600480
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769592742540568,
            "correlation_reason": "manual_extraction",
            "created_at": 1769592742601954
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769592742540568,
            "correlation_reason": "manual_extraction",
            "created_at": 1769592743587306
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769592727507225,
            "correlation_reason": "manual_extraction",
            "created_at": 1769592728729319
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769592727507225,
            "correlation_reason": "manual_extraction",
            "created_at": 1769592730560003
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769592457507322,
            "correlation_reason": "manual_extraction",
            "created_at": 1769592457556103
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769592437507504,
            "correlation_reason": "manual_extraction",
            "created_at": 1769592437559784
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769592427506992,
            "correlation_reason": "manual_extraction",
            "created_at": 1769592427725770
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769592167507524,
            "correlation_reason": "manual_extraction",
            "created_at": 1769592168557664
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769592167507524,
            "correlation_reason": "manual_extraction",
            "created_at": 1769592170777977
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769592147507315,
            "correlation_reason": "manual_extraction",
            "created_at": 1769592148555569
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769592147507315,
            "correlation_reason": "manual_extraction",
            "created_at": 1769592147597904
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769592142526549,
            "correlation_reason": "manual_extraction",
            "created_at": 1769592142600152
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769592127506884,
            "correlation_reason": "manual_extraction",
            "created_at": 1769592127600280
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769592127506884,
            "correlation_reason": "manual_extraction",
            "created_at": 1769592142564055
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769592117507426,
            "correlation_reason": "manual_extraction",
            "created_at": 1769592117566250
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769592082519085,
            "correlation_reason": "manual_extraction",
            "created_at": 1769592097823797
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769591857507240,
            "correlation_reason": "manual_extraction",
            "created_at": 1769591858585037
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769591837507324,
            "correlation_reason": "manual_extraction",
            "created_at": 1769591837553098
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769591827506547,
            "correlation_reason": "manual_extraction",
            "created_at": 1769591827588394
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769591567506537,
            "correlation_reason": "manual_extraction",
            "created_at": 1769591568596595
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769591567506537,
            "correlation_reason": "manual_extraction",
            "created_at": 1769591567559838
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769591547507205,
            "correlation_reason": "manual_extraction",
            "created_at": 1769591548659227
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769591547507205,
            "correlation_reason": "manual_extraction",
            "created_at": 1769591547752975
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769591527507121,
            "correlation_reason": "manual_extraction",
            "created_at": 1769591534671084
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769591527507121,
            "correlation_reason": "manual_extraction",
            "created_at": 1769591527558451
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769591517507303,
            "correlation_reason": "manual_extraction",
            "created_at": 1769591517558943
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769591507506726,
            "correlation_reason": "manual_extraction",
            "created_at": 1769591507570878
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769591482516112,
            "correlation_reason": "manual_extraction",
            "created_at": 1769591489614610
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769591257507513,
            "correlation_reason": "manual_extraction",
            "created_at": 1769591257556058
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769591237507203,
            "correlation_reason": "manual_extraction",
            "created_at": 1769591237549715
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769591227507174,
            "correlation_reason": "manual_extraction",
            "created_at": 1769591227850801
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769590967506499,
            "correlation_reason": "manual_extraction",
            "created_at": 1769590967549938
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769590947507169,
            "correlation_reason": "manual_extraction",
            "created_at": 1769590948560567
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769590947507169,
            "correlation_reason": "manual_extraction",
            "created_at": 1769590947559318
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769590942545695,
            "correlation_reason": "manual_extraction",
            "created_at": 1769590942630451
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769590927506820,
            "correlation_reason": "manual_extraction",
            "created_at": 1769590942612835
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769590927506820,
            "correlation_reason": "manual_extraction",
            "created_at": 1769590927698498
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769590897527788,
            "correlation_reason": "manual_extraction",
            "created_at": 1769590898584188
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769590882518052,
            "correlation_reason": "manual_extraction",
            "created_at": 1769590885566243
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769590867507181,
            "correlation_reason": "manual_extraction",
            "created_at": 1769590874905880
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769590657507543,
            "correlation_reason": "manual_extraction",
            "created_at": 1769590657547594
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769590637507388,
            "correlation_reason": "manual_extraction",
            "created_at": 1769590637549911
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769590627506862,
            "correlation_reason": "manual_extraction",
            "created_at": 1769590627585377
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769590367507457,
            "correlation_reason": "manual_extraction",
            "created_at": 1769590370562417
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769590367507457,
            "correlation_reason": "manual_extraction",
            "created_at": 1769590368626980
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769590357507284,
            "correlation_reason": "manual_extraction",
            "created_at": 1769590358556094
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769590357507284,
            "correlation_reason": "manual_extraction",
            "created_at": 1769590357563785
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769590327507352,
            "correlation_reason": "manual_extraction",
            "created_at": 1769590328558426
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769590327507352,
            "correlation_reason": "manual_extraction",
            "created_at": 1769590330558789
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769590282744797,
            "correlation_reason": "manual_extraction",
            "created_at": 1769590285801572
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769590267732036,
            "correlation_reason": "manual_extraction",
            "created_at": 1769590270781889
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sZOUuAB976oqs1GlTqPuwI3d3",
            "alert_name": "rbac_sql_28dff062",
            "alert_fired_at": 1769590237556203,
            "correlation_reason": "manual_extraction",
            "created_at": 1769590244857584
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769590037507523,
            "correlation_reason": "manual_extraction",
            "created_at": 1769590037567683
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769590017506757,
            "correlation_reason": "manual_extraction",
            "created_at": 1769590017640902
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769589997525130,
            "correlation_reason": "manual_extraction",
            "created_at": 1769589998980148
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769589767507007,
            "correlation_reason": "manual_extraction",
            "created_at": 1769589767625214
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769589747701895,
            "correlation_reason": "manual_extraction",
            "created_at": 1769589747794420
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769589747701895,
            "correlation_reason": "manual_extraction",
            "created_at": 1769589748757930
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769589742516991,
            "correlation_reason": "manual_extraction",
            "created_at": 1769589742564947
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769589727506760,
            "correlation_reason": "manual_extraction",
            "created_at": 1769589727576091
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769589727506760,
            "correlation_reason": "manual_extraction",
            "created_at": 1769589742555694
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769589417506545,
            "correlation_reason": "manual_extraction",
            "created_at": 1769589417548422
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769589398545544,
            "correlation_reason": "manual_extraction",
            "created_at": 1769589398619451
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769589382519496,
            "correlation_reason": "manual_extraction",
            "created_at": 1769589389834324
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769589167507189,
            "correlation_reason": "manual_extraction",
            "created_at": 1769589168567200
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769589147506522,
            "correlation_reason": "manual_extraction",
            "created_at": 1769589147557664
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769589147506522,
            "correlation_reason": "manual_extraction",
            "created_at": 1769589148747102
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769589142517529,
            "correlation_reason": "manual_extraction",
            "created_at": 1769589142568358
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769589127507211,
            "correlation_reason": "manual_extraction",
            "created_at": 1769589130594309
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769589127507211,
            "correlation_reason": "manual_extraction",
            "created_at": 1769589128609364
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769588817507329,
            "correlation_reason": "manual_extraction",
            "created_at": 1769588817649352
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769588798530508,
            "correlation_reason": "manual_extraction",
            "created_at": 1769588798601625
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sWTH55JrtMMDLhpX3BDOSIyEm",
            "alert_name": "rbac_sql_7ec0ee9f",
            "alert_fired_at": 1769588767506796,
            "correlation_reason": "manual_extraction",
            "created_at": 1769588782591647
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769588557507317,
            "correlation_reason": "manual_extraction",
            "created_at": 1769588557806883
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769588549529451,
            "correlation_reason": "manual_extraction",
            "created_at": 1769588550573244
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769588549529451,
            "correlation_reason": "manual_extraction",
            "created_at": 1769588549580701
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769588542519257,
            "correlation_reason": "manual_extraction",
            "created_at": 1769588542581572
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769588527507048,
            "correlation_reason": "manual_extraction",
            "created_at": 1769588530588409
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769588527507048,
            "correlation_reason": "manual_extraction",
            "created_at": 1769588527691757
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769587917506612,
            "correlation_reason": "manual_extraction",
            "created_at": 1769587920560121
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769587917506612,
            "correlation_reason": "manual_extraction",
            "created_at": 1769587924556229
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769587907507399,
            "correlation_reason": "manual_extraction",
            "created_at": 1769587907555256
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769587897542877,
            "correlation_reason": "manual_extraction",
            "created_at": 1769587897608668
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769587867506890,
            "correlation_reason": "manual_extraction",
            "created_at": 1769587882572860
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769587867506890,
            "correlation_reason": "manual_extraction",
            "created_at": 1769587874794108
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769587317507131,
            "correlation_reason": "manual_extraction",
            "created_at": 1769587317569904
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769587297533521,
            "correlation_reason": "manual_extraction",
            "created_at": 1769587297606058
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769587297533521,
            "correlation_reason": "manual_extraction",
            "created_at": 1769587304631514
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769587282522476,
            "correlation_reason": "manual_extraction",
            "created_at": 1769587282649256
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769587267507482,
            "correlation_reason": "manual_extraction",
            "created_at": 1769587267750308
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769587267507482,
            "correlation_reason": "manual_extraction",
            "created_at": 1769587282614194
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769586707506611,
            "correlation_reason": "manual_extraction",
            "created_at": 1769586707546773
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769586707506611,
            "correlation_reason": "manual_extraction",
            "created_at": 1769586708547505
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769586697531783,
            "correlation_reason": "manual_extraction",
            "created_at": 1769586697579414
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769586697531783,
            "correlation_reason": "manual_extraction",
            "created_at": 1769586698576854
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769586667507513,
            "correlation_reason": "manual_extraction",
            "created_at": 1769586674796816
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769586667507513,
            "correlation_reason": "manual_extraction",
            "created_at": 1769586682669060
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769586117507128,
            "correlation_reason": "manual_extraction",
            "created_at": 1769586117706700
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769586117507128,
            "correlation_reason": "manual_extraction",
            "created_at": 1769586118625081
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769586097896597,
            "correlation_reason": "manual_extraction",
            "created_at": 1769586097946506
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769586097896597,
            "correlation_reason": "manual_extraction",
            "created_at": 1769586099192690
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769586082681491,
            "correlation_reason": "manual_extraction",
            "created_at": 1769586083739999
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769586067507246,
            "correlation_reason": "manual_extraction",
            "created_at": 1769586068889001
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769585477585086,
            "correlation_reason": "manual_extraction",
            "created_at": 1769585492641848
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769585477585086,
            "correlation_reason": "manual_extraction",
            "created_at": 1769585477633575
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769585462572615,
            "correlation_reason": "manual_extraction",
            "created_at": 1769585463638830
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPhF0gyjB85NLzqSzkIuW8uSa",
            "alert_name": "rbac_sql_69badad9",
            "alert_fired_at": 1769585447563416,
            "correlation_reason": "manual_extraction",
            "created_at": 1769585448614592
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769585447563416,
            "correlation_reason": "manual_extraction",
            "created_at": 1769585462629377
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38sPfVs7FPYb9RuT7QQfy0KcdgB",
            "alert_name": "rbac_sql_e405b2bf",
            "alert_fired_at": 1769585417507424,
            "correlation_reason": "manual_extraction",
            "created_at": 1769585420925615
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38c78q6KRBOIxbgaWp3x8qCd3zQ",
            "alert_name": "alert_bulk_test_148388_1",
            "alert_fired_at": 1769086850790745,
            "correlation_reason": "manual_extraction",
            "created_at": 1769086850956407
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38c798iuneSmKa1L61wZZ1IGA5I",
            "alert_name": "alert_bulk_test_148388_2",
            "alert_fired_at": 1769086850790745,
            "correlation_reason": "manual_extraction",
            "created_at": 1769086851914845
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38c77fZpHfZO9iGlVdJeJKVWmah",
            "alert_name": "alert_bulk_test_176765_1",
            "alert_fired_at": 1769086840791047,
            "correlation_reason": "manual_extraction",
            "created_at": 1769086840948880
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38c75DfYYo4ryTeWhiMSQKSMeka",
            "alert_name": "alert_bulk_test_492901_1",
            "alert_fired_at": 1769086820790714,
            "correlation_reason": "manual_extraction",
            "created_at": 1769086821056041
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38c5B11exRQ9bKFcs6gHJ35uHSj",
            "alert_name": "alert_bulk_test_484125_1",
            "alert_fired_at": 1769085880790316,
            "correlation_reason": "manual_extraction",
            "created_at": 1769085880847140
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38c58go0Nh5PisVX87QVq1DtBsJ",
            "alert_name": "alert_bulk_test_872307_2",
            "alert_fired_at": 1769085860790956,
            "correlation_reason": "manual_extraction",
            "created_at": 1769085861910127
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38c58PiTLD2iDBxWwd3eD441qJk",
            "alert_name": "alert_bulk_test_872307_1",
            "alert_fired_at": 1769085860790956,
            "correlation_reason": "manual_extraction",
            "created_at": 1769085860967195
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38c4E1Y14u0XNKbUBrAFqwANNrA",
            "alert_name": "alert_bulk_test_598312_1",
            "alert_fired_at": 1769085410790589,
            "correlation_reason": "manual_extraction",
            "created_at": 1769085411008257
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38c3UaT2jR7miekxqjD0H4kBUYO",
            "alert_name": "alert_bulk_test_665286_1",
            "alert_fired_at": 1769085050790276,
            "correlation_reason": "manual_extraction",
            "created_at": 1769085051369659
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38c3UtRmqd1bauacJc9M2RxX8r4",
            "alert_name": "alert_bulk_test_665286_2",
            "alert_fired_at": 1769085050790276,
            "correlation_reason": "manual_extraction",
            "created_at": 1769085051928671
        },
        {
            "incident_id": "38YOJBB1hOiyE4nGEnxBqDiwPbT",
            "alert_id": "38YOIzNwuFnemYjhVz1bkazh7RR",
            "alert_name": "auto_dedup_alert_6yc8l5",
            "alert_fired_at": 1768972962281040,
            "correlation_reason": "manual_extraction",
            "created_at": 1768972963699623
        }
    ],
    "alerts": [
        {
            "id": "38eX0uSw4C6sn80z4oLsPHJPBmH",
            "name": "testttt",
            "org_id": "default",
            "stream_type": "logs",
            "stream_name": "default",
            "is_real_time": false,
            "query_condition": {
                "type": "custom",
                "conditions": {
                    "version": 2,
                    "conditions": {
                        "filterType": "group",
                        "logicalOperator": "AND",
                        "conditions": []
                    }
                },
                "sql": null,
                "promql": null,
                "promql_condition": null,
                "aggregation": null,
                "vrl_function": null,
                "search_event_type": null,
                "multi_time_range": []
            },
            "trigger_condition": {
                "period": 10,
                "operator": ">=",
                "threshold": 3,
                "frequency": 120,
                "cron": "",
                "frequency_type": "minutes",
                "silence": 10,
                "timezone": "UTC",
                "tolerance_in_secs": null,
                "align_time": true
            },
            "destinations": [
                "dest_bulk_test_131835"
            ],
            "context_attributes": {},
            "row_template": "",
            "row_template_type": "String",
            "description": "",
            "enabled": true,
            "tz_offset": 0,
            "last_triggered_at": null,
            "last_satisfied_at": null,
            "owner": "root@example.com",
            "last_edited_by": "root@example.com",
            "deduplication": {
                "enabled": true,
                "fingerprint_fields": [
                    "_timestamp",
                    "body"
                ]
            }
        }
    ]
};
        triggers.value = (response.data as any).triggers || [];
        alerts.value = response.data.alerts || [];

        // Initialize editable status and severity from incident data
        editableStatus.value = response.data.status;
        editableSeverity.value = response.data.severity;
      } catch (error) {
        console.error("Failed to load incident details:", error);
        $q.notify({
          type: "negative",
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
        $q.notify({
          type: "positive",
          message: t("alerts.incidents.statusUpdated"),
        });
        emit("status-updated");
      } catch (error) {
        console.error("[UPDATE STATUS] Failed to update status:", error);
        $q.notify({
          type: "negative",
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

        $q.notify({
          type: "positive",
          message: "Incident title updated successfully",
          timeout: 2000,
        });
      } catch (error: any) {
        console.error("Failed to update title:", error);
        $q.notify({
          type: "negative",
          message: error?.response?.data?.message || "Failed to update incident title",
          timeout: 3000,
        });
        cancelTitleEdit();
      }
    };

    const getStatusColor = (status: string) => {
      switch (status) {
        case "open":
          return "negative";
        case "acknowledged":
          return "orange";
        case "resolved":
          return "positive";
        default:
          return "grey";
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

        $q.notify({
          type: "positive",
          message: `Incident status updated to ${response.data.status}`,
          timeout: 2000,
        });
      } catch (error: any) {
        console.error("Failed to update status:", error);
        $q.notify({
          type: "negative",
          message: error?.response?.data?.message || "Failed to update incident status",
          timeout: 3000,
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
        const response = await incidentsService.updateIncident(
          org,
          incidentDetails.value.id,
          { severity: newSeverity }
        );

        // Update local state with the actual severity from the API response
        incidentDetails.value.severity = response.data.severity;
        editableSeverity.value = response.data.severity;

        $q.notify({
          type: "positive",
          message: `Incident severity updated to ${response.data.severity}`,
          timeout: 2000,
        });
      } catch (error: any) {
        console.error("Failed to update severity:", error);
        $q.notify({
          type: "negative",
          message: error?.response?.data?.message || "Failed to update incident severity",
          timeout: 3000,
        });
        // Revert on error
        editableSeverity.value = incidentDetails.value.severity;
      } finally {
        updating.value = false;
      }
    };

    const formatTimestamp = (timestamp: number) => {
      // Backend sends microseconds
      return date.formatDate(timestamp / 1000, "YYYY-MM-DD HH:mm:ss");
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
              'rca-h1 tw:font-bold tw:text-lg tw:text-center tw:mb-4 tw:pb-2 tw:border-b-2',
              // TODO: Discuss with team - h2 section separators with background and left border
              // Remove 'rca-section-bg tw:px-4 tw:py-3 tw:rounded tw:border-l-4 tw:border-blue-600' if not approved
              'rca-h2 tw:font-bold tw:text-lg tw:mt-5 tw:mb-3 tw:text-blue-600 rca-section-bg tw:px-4 tw:py-3 tw:rounded tw:border-l-4 tw:border-blue-600',
              'rca-h3 tw:font-semibold tw:text-base tw:mt-4 tw:mb-2',
              'rca-h4 tw:font-semibold tw:text-sm tw:mt-3 tw:mb-2 tw:text-gray-700',
            ];
            return `<div id="${id}" class="${classes[depth - 1] || ''}">${parsedText}</div>`;
          },
          code({ text }: any) {
            return `<div class="rca-code-block tw:bg-gray-100 tw:border tw:border-gray-300 tw:rounded tw:p-3 tw:my-3 tw:overflow-x-auto"><pre class="tw:text-sm tw:font-mono tw:whitespace-pre tw:m-0"><code>${text}</code></pre></div>`;
          },
          codespan({ text }: any) {
            return `<code class="rca-inline-code tw:bg-gray-100 tw:px-1.5 tw:py-0.5 tw:rounded tw:text-sm tw:font-mono">${text}</code>`;
          },
          list(token: any) {
            const body = token.items.map((item: any) => this.listitem(item)).join('');
            const tag = token.ordered ? 'ol' : 'ul';
            const classes = token.ordered ? 'rca-ol tw:pl-5 tw:my-3 tw:space-y-1.5 tw:list-decimal' : 'rca-ul tw:pl-5 tw:my-3 tw:space-y-1.5 tw:list-disc';
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
              header += `<th class="tw:px-3 tw:py-2 tw:text-left tw:font-semibold tw:text-sm tw:border-b ${cellClass}">${content}</th>`;
            }
            header += '</tr>';

            let body = '';
            for (const row of token.rows) {
              body += '<tr class="hover:tw:bg-gray-50">';
              for (let i = 0; i < row.length; i++) {
                const cell = row[i];
                const content = this.parser.parseInline(cell.tokens);
                const cellClass = i === 0 ? 'rca-first-cell' : '';
                body += `<td class="tw:px-3 tw:py-2 tw:text-sm tw:border-b ${cellClass}">${content}</td>`;
              }
              body += '</tr>';
            }

            return `<div class="rca-table-wrapper tw:my-4 tw:overflow-x-auto"><table class="rca-table tw:w-full tw:border tw:border-gray-300 tw:rounded"><thead class="tw:bg-gray-100">${header}</thead><tbody>${body}</tbody></table></div>`;
          },
          blockquote({ tokens }: any) {
            const text = this.parser.parse(tokens);
            return `<blockquote class="rca-blockquote tw:border-l-4 tw:border-blue-500 tw:pl-4 tw:py-2 tw:my-3 tw:bg-blue-50 tw:italic">${text}</blockquote>`;
          },
          paragraph({ tokens }: any) {
            const text = this.parser.parseInline(tokens);
            return `<p class="tw:mb-3">${text}</p>`;
          },
          strong({ tokens }: any) {
            const text = this.parser.parseInline(tokens);
            return `<strong class="tw:font-semibold">${text}</strong>`;
          },
          em({ tokens }: any) {
            const text = this.parser.parseInline(tokens);
            return `<em class="tw:italic">${text}</em>`;
          },
          hr() {
            return `<hr class="tw:my-4 tw:border-t tw:border-gray-300" />`;
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

        $q.notify({
          type: "positive",
          message: t("alerts.incidents.rcaCompleted"),
        });

        // Reload incident to get the saved RCA in topology context
        await loadDetails(incidentDetails.value.id);
      } catch (error: any) {
        console.error("Failed to trigger RCA:", error);
        rcaStreamContent.value = "";
        $q.notify({
          type: "negative",
          message: error?.response?.data?.message || error?.message || "Failed to perform RCA analysis",
        });
      } finally {
        rcaLoading.value = false;
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
      isDarkMode,
      activeTab,
      tableOfContents,
      expandedSections,
      formattedRcaContent,
      correlationData,
      correlationLoading,
      correlationError,
      hasCorrelatedData,
      hasAnyStreams,
      telemetryTimeRange,
      incidentContextData,
      affectedServicesCount,
      alertFrequency,
      getTriggerCountForAlert,
      sortedAlertsByTriggerCount,
      peakAlertRate,
      peakActivity,
      correlationType,
      correlationTooltip,
      alertActivityChartData,
      refreshCorrelation,
      close,
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
      getStatusColor,
      getStatusLabel,
      getSeverityColorHex,
      formatPeriod,
      formatCustomConditions,
      formatTimestamp,
      formatTimestampUTC,
      copyToClipboard,
      copiedField,
      calculateDuration,
      formatRcaContent,
    };
  },
});
</script>

<style scoped>
.incident-detail-header {
  min-height: 60px;
}

/* Tile Styles - matching schema.vue */
.tile-content-light {
  background-color: #ffffff;
  transition: all 0.2s ease;
}

.tile-content-dark {
  background-color: #1e1e1e;
  transition: all 0.2s ease;
}

.tile-content:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

body.body--dark .tile-content:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

/* Action Buttons - Compact */
.action-btn-compact {
  min-height: 28px;
  padding: 4px 12px;
  border-radius: 4px;
  font-weight: 500;
  transition: all 0.2s ease;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.action-btn-compact:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.action-btn-compact:active {
  transform: translateY(0);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

/* Section Header Background */
.section-header-bg {
  background: var(--o2-table-header-bg) !important;
}

/* Section Container Border and Radius */
.section-container {
  border: 0.0625rem solid var(--o2-border-color);
  border-radius: 0.375rem;
}

/* Info Box (Stable Dimensions, Topology) - Light Mode */
.info-box-light {
  background-color: #f3f4f6; /* gray-100 */
}

/* Info Box - Dark Mode */
.info-box-dark {
  background-color: #374151; /* gray-700 */
}

/* Label text color */
.label-text {
  color: #6b7280; /* gray-500 in light mode */
}

body.body--dark .label-text {
  color: #9ca3af; /* gray-400 in dark mode */
}

/* Muted text color */
.muted-text {
  color: #9ca3af; /* gray-400 in light mode */
}

body.body--dark .muted-text {
  color: #6b7280; /* gray-500 in dark mode */
}

/* Two-Column Layout Styles */
.incident-details-column {
  min-width: 400px;
  max-width: 400px;
}

.tabs-content-column {
  min-width: 0; /* Allow flex shrinking */
}

/* Responsive scrolling */
.incident-details-column::-webkit-scrollbar,
.tabs-content-column .tw:overflow-auto::-webkit-scrollbar {
  width: 6px;
}

.incident-details-column::-webkit-scrollbar-track,
.tabs-content-column .tw:overflow-auto::-webkit-scrollbar-track {
  background: transparent;
}

.incident-details-column::-webkit-scrollbar-thumb,
.tabs-content-column .tw:overflow-auto::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 3px;
}

body.body--dark .incident-details-column::-webkit-scrollbar-thumb,
body.body--dark .tabs-content-column .tw:overflow-auto::-webkit-scrollbar-thumb {
  background: #475569;
}

/* AI Chat Panel Styles */
.ai-chat-panel {
  min-width: 380px;
  max-width: 380px;
}

.ai-chat-panel::-webkit-scrollbar {
  width: 6px;
}

.ai-chat-panel::-webkit-scrollbar-track {
  background: transparent;
}

.ai-chat-panel::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 3px;
}

body.body--dark .ai-chat-panel::-webkit-scrollbar-thumb {
  background: #475569;
}

/* AI Button Styles */
.ai-btn-active {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
}

.ai-hover-btn {
  transition: background 0.3s ease;
}

.ai-hover-btn:hover {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
}

.ai-icon {
  transition: transform 0.6s ease, filter 0.3s ease;
}

.ai-hover-btn:hover .ai-icon,
.ai-btn-active .ai-icon {
  transform: rotate(180deg);
  filter: brightness(0) invert(1);
}

.incident-action-buttons{
  padding: 4px 6px;
}
</style>

<style lang="scss">
@import './RcaReport.scss';

.o2-incident-card-bg {
  background-color: var(--o2-card-bg);
}
</style>
