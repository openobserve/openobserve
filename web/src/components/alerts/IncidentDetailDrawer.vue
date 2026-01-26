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
      <div v-if="incidentDetails && !isEditingTitle" class="tw:flex tw:items-center tw:gap-2 tw:ml-auto tw:mr-3">
        <!-- Status Badge -->
        <q-badge
          :color="getStatusColor(incidentDetails.status)"
          class="tw:px-2.5 tw:py-1.5 tw:cursor-default"
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
          :style="{ color: getSeverityColorHex(incidentDetails.severity) }"
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
          outline
        >
          <div class="tw:flex tw:items-center tw:gap-1.5">
            <q-icon name="notifications_active" size="14px" />
            <span>{{ incidentDetails.alert_count }} Alerts</span>
          </div>
          <q-tooltip :delay="200" class="tw:text-sm">
            {{ t("alerts.incidents.alertCount") }}: {{ incidentDetails.alert_count }} correlated alerts
          </q-tooltip>
        </q-badge>
      </div>

      <!-- Save/Cancel buttons when editing -->
      <div v-if="incidentDetails && isEditingTitle" class="tw:flex tw:items-center tw:gap-2 tw:ml-auto">
         <q-btn
          dense
          no-caps
          @click="cancelTitleEdit"
          class="o2-secondary-button"
        >
          <span>Cancel</span>
        </q-btn>
        <q-btn
          no-caps
          dense
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
          color="brown-5"
          size="sm"
          no-caps
          unelevated
          dense
          @click="acknowledgeIncident"
          :loading="updating"
          class="incident-action-buttons"
        >
          <q-icon name="check_circle" size="16px" class="tw:mr-1" />
          <span>{{ t("alerts.incidents.acknowledge") }}</span>
          <q-tooltip :delay="500">Mark incident as acknowledged and being worked on</q-tooltip>
        </q-btn>
        <q-btn
          v-if="incidentDetails.status !== 'resolved'"
          no-caps
          unelevated
          dense
          @click="resolveIncident"
          :loading="updating"
          class="o2-primary-button"
        >
          <q-icon name="task_alt" size="16px" class="tw:mr-1" />
          <span>{{ t("alerts.incidents.resolve") }}</span>
          <q-tooltip :delay="500">Mark incident as resolved and close it</q-tooltip>
        </q-btn>
        <q-btn
          v-if="incidentDetails.status === 'resolved'"
          color="info"
          size="sm"
          no-caps
          unelevated
          dense
          @click="reopenIncident"
          :loading="updating"
          class="incident-action-buttons"
        >
          <q-icon name="refresh" size="16px" class="tw:mr-1" />
          <span>{{ t("alerts.incidents.reopen") }}</span>
          <q-tooltip :delay="500">Reopen this resolved incident</q-tooltip>
        </q-btn>

        <!-- Edit Title Button -->
        <q-btn
          no-caps
          flat
          dense
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
      <!-- Left Column: Incident Details (only show on Overview and Incident Analysis tabs) -->
      <div v-if="activeTab === 'overview' || activeTab === 'incidentAnalysis'" class="incident-details-column tw:w-[400px] tw:flex-shrink-0 tw:flex tw:flex-col tw:h-full" style="order: 1;">

        <!-- Top Section - Table of Contents (only on Incident Analysis) OR Overview (other tabs) -->
        <IncidentTableOfContents
          v-if="activeTab === 'incidentAnalysis'"
          :table-of-contents="tableOfContents"
          :expanded-sections="expandedSections"
          :is-dark-mode="isDarkMode"
          @scroll-to-section="scrollToSection"
          @toggle-section="toggleSection"
        />

        <!-- Overview Section (Other Tabs) -->
        <div
          v-else
          class="tw:px-2 tw:pt-4 tw:pb-2 tw:flex tw:flex-col"
        >
          <div
            :class="[
              'section-container tw:overflow-hidden tw:flex tw:flex-col'
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
              <q-icon :name="activeTab === 'incidentAnalysis' ? 'format_list_bulleted' : 'settings'" size="16px" class="tw:opacity-80" />
              <span :class="store.state.theme === 'dark' ? 'tw:text-gray-300' : 'tw:text-gray-700'" class="tw:text-sm tw:font-semibold">
                {{ activeTab === 'incidentAnalysis' ? 'Table of Contents' : 'Manage' }}
              </span>
            </div>
            <!-- Content -->
            <div class="tw:p-3">

              <!-- Table of Contents (Incident Analysis Tab) -->
              <template v-if="activeTab === 'incidentAnalysis'">
                <div v-if="tableOfContents.length === 0" :class="store.state.theme === 'dark' ? 'tw:text-gray-500' : 'tw:text-gray-400'" class="tw:text-sm tw:italic">
                  No sections available
                </div>
                <div v-else class="tw:space-y-1">
                <!-- TOC Items -->
                <template v-for="item in tableOfContents" :key="item.id">
                  <div>
                    <!-- Level 1 Item -->
                    <div
                      :class="[
                        'tw:flex tw:items-center tw:gap-2 tw:px-2 tw:py-1.5 tw:rounded tw:transition-colors',
                        store.state.theme === 'dark'
                          ? 'tw:text-gray-200'
                          : 'tw:text-gray-900'
                      ]"
                    >
                      <!-- Icon on the left -->
                      <q-icon
                        :name="item.children.length > 0 ? 'folder' : 'article'"
                        size="14px"
                        class="tw:opacity-60 tw:flex-shrink-0"
                      />
                      <!-- Text in the middle - clickable to scroll -->
                      <span
                        @click="scrollToSection(item.id)"
                        :class="[
                          'tw:text-sm tw:font-medium tw:truncate tw:flex-1 tw:cursor-pointer',
                          store.state.theme === 'dark'
                            ? 'hover:tw:text-blue-400'
                            : 'hover:tw:text-blue-600'
                        ]"
                      >{{ item.text }}</span>
                      <!-- Expand button on the right (only for items with children) -->
                      <q-btn
                        v-if="item.children.length > 0"
                        flat
                        dense
                        round
                        size="xs"
                        :icon="expandedSections[item.id] ? 'expand_more' : 'chevron_right'"
                        @click="toggleSection(item, $event)"
                        class="tw:flex-shrink-0"
                      >
                        <q-tooltip :delay="500">{{ expandedSections[item.id] ? 'Collapse' : 'Expand' }}</q-tooltip>
                      </q-btn>
                    </div>

                    <!-- Level 2 Children -->
                    <div v-if="expandedSections[item.id] && item.children.length > 0" class="tw:ml-4 tw:space-y-1 tw:mt-1">
                      <template v-for="child in item.children" :key="child.id">
                        <div>
                          <!-- Level 2 Item -->
                          <div
                            :class="[
                              'tw:flex tw:items-center tw:gap-2 tw:px-2 tw:py-1 tw:rounded tw:transition-colors',
                              store.state.theme === 'dark'
                                ? 'tw:text-gray-300'
                                : 'tw:text-gray-700'
                            ]"
                          >
                            <!-- Icon on the left -->
                            <q-icon
                              name="label"
                              size="12px"
                              class="tw:opacity-60 tw:flex-shrink-0"
                            />
                            <!-- Text in the middle - clickable to scroll -->
                            <span
                              @click="scrollToSection(child.id)"
                              :class="[
                                'tw:text-sm tw:truncate tw:flex-1 tw:cursor-pointer',
                                store.state.theme === 'dark'
                                  ? 'hover:tw:text-blue-400'
                                  : 'hover:tw:text-blue-600'
                              ]"
                            >{{ child.text }}</span>
                            <!-- Expand button on the right (only for items with children) -->
                            <q-btn
                              v-if="child.children.length > 0"
                              flat
                              dense
                              round
                              size="xs"
                              :icon="expandedSections[child.id] ? 'expand_more' : 'chevron_right'"
                              @click="toggleSection(child, $event)"
                              class="tw:flex-shrink-0"
                            >
                              <q-tooltip :delay="500">{{ expandedSections[child.id] ? 'Collapse' : 'Expand' }}</q-tooltip>
                            </q-btn>
                          </div>

                          <!-- Level 3 Children -->
                          <div v-if="expandedSections[child.id] && child.children.length > 0" class="tw:ml-4 tw:space-y-1 tw:mt-1">
                            <div
                              v-for="grandchild in child.children"
                              :key="grandchild.id"
                              @click="scrollToSection(grandchild.id)"
                              :class="[
                                'tw:flex tw:items-center tw:gap-2 tw:px-2 tw:py-1 tw:rounded tw:cursor-pointer tw:transition-colors',
                                store.state.theme === 'dark'
                                  ? 'hover:tw:bg-gray-700 tw:text-gray-400'
                                  : 'hover:tw:bg-blue-50 tw:text-gray-600'
                              ]"
                            >
                              <q-icon name="fiber_manual_record" size="8px" class="tw:opacity-60" />
                              <span class="tw:text-[11px] tw:truncate">{{ grandchild.text }}</span>
                            </div>
                          </div>
                        </div>
                      </template>
                    </div>
                  </div>
                </template>
              </div>
              </template>

              <!-- Overview Section (Other Tabs) -->
              <template v-else>
                <div v-if="incidentDetails" class="tw:space-y-3">
                  <!-- Status Section -->
                  <div>
                    <div class="tw:flex tw:items-center tw:gap-2 tw:mb-2">
                      <span :class="store.state.theme === 'dark' ? 'tw:text-gray-300' : 'tw:text-gray-700'" class="tw:text-sm tw:font-semibold">
                        Status
                      </span>
                    </div>
                    <q-select
                      v-model="editableStatus"
                      :options="statusOptions"
                      option-value="value"
                      option-label="label"
                      emit-value
                      map-options
                      borderless
                      dense
                      @update:model-value="handleStatusChange"
                      :class="store.state.theme === 'dark' ? 'dark-select' : ''"
                    />
                  </div>

                  <!-- Severity Section -->
                  <div>
                    <div class="tw:flex tw:items-center tw:gap-2 tw:mb-2">
                      <span :class="store.state.theme === 'dark' ? 'tw:text-gray-300' : 'tw:text-gray-700'" class="tw:text-sm tw:font-semibold">
                        Severity
                      </span>
                    </div>
                    <q-select
                      v-model="editableSeverity"
                      :options="severityOptions"
                      option-value="value"
                      option-label="label"
                      emit-value
                      map-options
                      borderless
                      dense
                      @update:model-value="handleSeverityChange"
                      :class="store.state.theme === 'dark' ? 'dark-select' : ''"
                    />
                  </div>
                </div>
              </template>

            </div>
          </div>
        </div>

        <!-- Bottom Section - Timeline, Dimensions, Topology (only for non-Incident Analysis tabs) -->
        <div v-if="activeTab !== 'incidentAnalysis'" class="tw:flex-1 tw:overflow-y-auto tw:px-2 tw:pt-2 tw:pb-2">
        <!-- Timeline with UTC timestamps -->
        <div
          id="timeline"
          :class="[
            'section-container tw:mb-4 tw:overflow-hidden tw:flex tw:flex-col'
          ]"
          style="max-height: 120px;"
        >
          <!-- Header -->
          <div
            :class="[
              'section-header-bg tw:px-3 tw:py-2 tw:flex tw:items-center tw:justify-between tw:border-b',
              store.state.theme === 'dark'
                ? 'tw:border-gray-700'
                : 'tw:border-gray-200'
            ]"
          >
            <div class="tw:flex tw:items-center tw:gap-2">
              <q-icon name="schedule" size="16px" class="tw:opacity-80" />
              <span :class="store.state.theme === 'dark' ? 'tw:text-gray-300' : 'tw:text-gray-700'" class="tw:text-sm tw:font-semibold">
                Timeline
              </span>
            </div>
            <span
              :class="[
                'tw:text-[10px] tw:font-medium tw:px-2 tw:py-0.5 tw:rounded-full',
                store.state.theme === 'dark'
                  ? 'tw:text-blue-300 tw:bg-blue-900/30'
                  : 'tw:text-blue-700 tw:bg-blue-100'
              ]"
            >
              UTC
            </span>
          </div>

          <!-- Content -->
          <div class="tw:p-3">
            <div class="tw:space-y-2.5">
              <div class="tw:flex tw:items-center tw:gap-2">
                <q-icon name="play_arrow" size="14px" :class="store.state.theme === 'dark' ? 'tw:text-green-400' : 'tw:text-green-600'" />
                <span :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-600'" class="tw:text-[14px] tw:font-medium">
                  First Alert:
                </span>
                <span
                  :class="[
                    'tw:text-sm tw:font-mono',
                    store.state.theme === 'dark' ? 'tw:text-gray-200' : 'tw:text-gray-900'
                  ]"
                >
                  {{ formatTimestampUTC(incidentDetails.first_alert_at) }}
                </span>
              </div>

              <div class="tw:flex tw:items-center tw:gap-2">
                <q-icon name="flag" size="14px" :class="store.state.theme === 'dark' ? 'tw:text-orange-400' : 'tw:text-orange-600'" />
                <span :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-600'" class="tw:text-[14px] tw:font-medium">
                  Last Alert:
                </span>
                <span
                  :class="[
                    'tw:text-sm tw:font-mono',
                    store.state.theme === 'dark' ? 'tw:text-gray-200' : 'tw:text-gray-900'
                  ]"
                >
                  {{ formatTimestampUTC(incidentDetails.last_alert_at) }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Dimensions & Topology - stacked -->
        <div class="tw:flex tw:flex-col tw:gap-3 tw:mb-4">
          <!-- Stable Dimensions -->
          <div
            :class="[
              'section-container tw:overflow-hidden tw:flex tw:flex-col'
            ]"
            style="max-height: 250px;"
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
              <q-icon name="category" size="16px" class="tw:opacity-80" />
              <span :class="store.state.theme === 'dark' ? 'tw:text-gray-300' : 'tw:text-gray-700'" class="tw:text-sm tw:font-semibold">
                {{ t("alerts.incidents.stableDimensions") }}
              </span>
            </div>
            <!-- Content -->
            <div class="tw:p-3 tw:overflow-y-auto tw:flex-1">
              <div
                v-for="(value, key) in incidentDetails.stable_dimensions"
                :key="key"
                class="tw:flex tw:text-sm tw:mb-1.5 last:tw:mb-0"
              >
                <span :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-600'" class="tw:mr-1 tw:font-medium tw:whitespace-nowrap">{{ key }}:</span>
                <span :class="store.state.theme === 'dark' ? 'tw:text-gray-200' : 'tw:text-gray-900'" class="tw:font-mono tw:whitespace-nowrap">{{ value }}</span>
              </div>
              <div
                v-if="Object.keys(incidentDetails.stable_dimensions).length === 0"
                :class="store.state.theme === 'dark' ? 'tw:text-gray-500' : 'tw:text-gray-400'"
                class="tw:text-sm tw:italic"
              >
                No dimensions
              </div>
            </div>
          </div>

          <!-- Alert Flow Summary -->
          <div
            v-if="incidentDetails.topology_context && incidentDetails.topology_context.nodes?.length"
            :class="[
              'section-container tw:overflow-hidden tw:flex tw:flex-col'
            ]"
            style="max-height: 250px;"
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
              <q-icon name="timeline" size="16px" class="tw:opacity-80" />
              <span :class="store.state.theme === 'dark' ? 'tw:text-gray-300' : 'tw:text-gray-700'" class="tw:text-sm tw:font-semibold">
                Alert Flow ({{ incidentDetails.topology_context.nodes.length }} unique)
              </span>
            </div>
            <!-- Content -->
            <div class="tw:p-3 tw:overflow-y-auto tw:flex-1">
              <div class="tw:flex tw:flex-wrap tw:gap-1.5">
                <q-badge
                  v-for="(node, index) in incidentDetails.topology_context.nodes"
                  :key="node.alert_id"
                  :color="index === 0 ? 'red-5' : 'blue-grey-5'"
                  :label="`${node.alert_name} (${node.service_name})`"
                  size="xs"
                >
                  <q-tooltip v-if="node.alert_count > 1" class="text-xs">
                    Fired {{ node.alert_count }} times
                  </q-tooltip>
                </q-badge>
              </div>
            </div>
          </div>
        </div>
        </div>
        <!-- End Bottom Section -->
      </div>

      <!-- Right Column: Content -->
      <div class="tabs-content-column tw:flex-1 tw:flex tw:flex-col tw:overflow-hidden" style="order: 2;">
        <!-- Tab Content Area -->
        <div class="tw:flex-1 tw:flex tw:flex-col tw:px-2 tw:pt-4 tw:pb-2 tw:overflow-hidden tw:relative">

        <!-- Overview Tab Content -->
        <div v-if="activeTab === 'overview'" class="tw:flex tw:gap-4 tw:flex-1 tw:overflow-hidden">
          <!-- Left: Incident Information Card -->
          <div class="tw:flex-1 tw:flex tw:flex-col">
            <!-- Row: Incident Details and Statistics Side by Side -->
            <div class="tw:grid tw:grid-cols-2 tw:gap-4" style="max-height: 300px;">
              <!-- Incident Details Card -->
              <div
                :class="[
                  'section-container tw:flex tw:flex-col tw:overflow-hidden'
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
                    Incident Details
                  </span>
                </div>
                <!-- Content -->
                <div class="tw:p-2 tw:flex-1 tw:overflow-y-auto">
                  <div class="tw:space-y-1.5">
                    <div class="tw:flex tw:items-start tw:gap-2">
                      <span :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-600'" class="tw:text-sm tw:font-medium tw:w-28 tw:flex-shrink-0">Incident ID:</span>
                      <span :class="store.state.theme === 'dark' ? 'tw:text-gray-200' : 'tw:text-gray-900'" class="tw:text-sm tw:font-mono tw:break-all">{{ incidentDetails.id }}</span>
                    </div>
                    <div class="tw:flex tw:items-start tw:gap-2">
                      <span :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-600'" class="tw:text-sm tw:font-medium tw:w-28 tw:flex-shrink-0">Correlation Key:</span>
                      <span :class="store.state.theme === 'dark' ? 'tw:text-gray-200' : 'tw:text-gray-900'" class="tw:text-sm tw:font-mono tw:break-all">{{ incidentDetails.correlation_key }}</span>
                    </div>
                    <div class="tw:flex tw:items-start tw:gap-2">
                      <span :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-600'" class="tw:text-sm tw:font-medium tw:w-28 tw:flex-shrink-0">Alert Count:</span>
                      <span :class="store.state.theme === 'dark' ? 'tw:text-gray-200' : 'tw:text-gray-900'" class="tw:text-sm">{{ incidentDetails.alert_count }}</span>
                    </div>
                    <div class="tw:flex tw:items-start tw:gap-2">
                      <span :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-600'" class="tw:text-sm tw:font-medium tw:w-28 tw:flex-shrink-0">Created:</span>
                      <span :class="store.state.theme === 'dark' ? 'tw:text-gray-200' : 'tw:text-gray-900'" class="tw:text-sm">{{ formatTimestamp(incidentDetails.created_at) }}</span>
                    </div>
                    <div class="tw:flex tw:items-start tw:gap-2">
                      <span :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-600'" class="tw:text-sm tw:font-medium tw:w-28 tw:flex-shrink-0">Updated:</span>
                      <span :class="store.state.theme === 'dark' ? 'tw:text-gray-200' : 'tw:text-gray-900'" class="tw:text-sm">{{ formatTimestamp(incidentDetails.updated_at) }}</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Incident Statistics Card -->
              <div
                :class="[
                  'section-container tw:flex tw:flex-col tw:overflow-hidden'
                ]"
              >
                <div
                  :class="[
                    'section-header-bg tw:px-3 tw:py-2 tw:flex tw:items-center tw:gap-2 tw:border-b tw:flex-shrink-0',
                    store.state.theme === 'dark'
                      ? 'tw:border-gray-700'
                      : 'tw:border-gray-200'
                  ]"
                >
                  <q-icon name="analytics" size="16px" class="tw:opacity-80" />
                  <span :class="store.state.theme === 'dark' ? 'tw:text-gray-300' : 'tw:text-gray-700'" class="tw:text-sm tw:font-semibold">
                    Incident Statistics
                  </span>
                </div>
                <div class="tw:p-2 tw:flex-1 tw:overflow-y-auto">
                  <div class="tw:space-y-1.5">
                    <div class="tw:flex tw:items-start tw:gap-2">
                      <span :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-600'" class="tw:text-sm tw:font-medium tw:w-28 tw:flex-shrink-0">Total Triggers:</span>
                      <span :class="store.state.theme === 'dark' ? 'tw:text-gray-200' : 'tw:text-gray-900'" class="tw:text-sm">{{ triggers.length }}</span>
                    </div>
                    <div class="tw:flex tw:items-start tw:gap-2">
                      <span :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-600'" class="tw:text-sm tw:font-medium tw:w-28 tw:flex-shrink-0">Unique Alerts:</span>
                      <span :class="store.state.theme === 'dark' ? 'tw:text-gray-200' : 'tw:text-gray-900'" class="tw:text-sm">{{ uniqueAlertsCount }}</span>
                    </div>
                    <div class="tw:flex tw:items-start tw:gap-2">
                      <span :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-600'" class="tw:text-sm tw:font-medium tw:whitespace-nowrap tw:flex-shrink-0">Affected Services:</span>
                      <span :class="store.state.theme === 'dark' ? 'tw:text-gray-200' : 'tw:text-gray-900'" class="tw:text-sm">{{ affectedServicesCount }}</span>
                    </div>
                    <div class="tw:flex tw:items-start tw:gap-2">
                      <span :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-600'" class="tw:text-sm tw:font-medium tw:w-28 tw:flex-shrink-0">
                        {{ incidentDetails.resolved_at ? 'Duration:' : 'Active Duration:' }}
                      </span>
                      <span :class="store.state.theme === 'dark' ? 'tw:text-gray-200' : 'tw:text-gray-900'" class="tw:text-sm">
                        {{ calculateDuration(incidentDetails.first_alert_at, incidentDetails.resolved_at || incidentDetails.last_alert_at) }}
                      </span>
                    </div>
                    <div class="tw:flex tw:items-start tw:gap-2">
                      <span :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-600'" class="tw:text-sm tw:font-medium tw:w-28 tw:flex-shrink-0">Alert Frequency:</span>
                      <span :class="store.state.theme === 'dark' ? 'tw:text-gray-200' : 'tw:text-gray-900'" class="tw:text-sm">{{ alertFrequency }}</span>
                    </div>
                    <div class="tw:flex tw:items-start tw:gap-2">
                      <span :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-600'" class="tw:text-sm tw:font-medium tw:w-28 tw:flex-shrink-0">Peak Alert Rate:</span>
                      <span :class="store.state.theme === 'dark' ? 'tw:text-gray-200' : 'tw:text-gray-900'" class="tw:text-sm">{{ peakAlertRate }}</span>
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
            :org-id="store.state.selectedOrganization.identifier"
            :incident-id="incidentDetails.id"
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
import { contextRegistry, createIncidentsContextProvider } from '@/composables/contextProviders';

export default defineComponent({
  name: "IncidentDetailDrawer",
  components: {
    TelemetryCorrelationDashboard,
    IncidentServiceGraph,
    IncidentAlertTriggersTable,
    IncidentTableOfContents,
    IncidentRCAAnalysis,
  },
  emits: ['close', 'status-updated'],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();
    const $q = useQuasar();
    const router = useRouter();

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
    const processedAlerts = computed(() => {
      if (!alerts.value || alerts.value.length === 0) return [];

      return alerts.value.map((alert: any) => {
        let formattedConditions = '--';

        if (alert.query_condition) {
          const qc = alert.query_condition;

          if (qc.type === 'custom' && qc.conditions) {
            formattedConditions = formatCustomConditions(qc.conditions);
          } else if (qc.sql) {
            formattedConditions = qc.sql;
          } else if (qc.promql) {
            formattedConditions = qc.promql;
          }
        }

        return {
          ...alert,
          _displayConditions: formattedConditions,
        };
      });
    });

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
    const tocRenderKey = ref(0);

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
    const uniqueAlertsCount = computed(() => {
      if (!incidentDetails.value?.alerts) return 0;
      const uniqueAlertIds = new Set(incidentDetails.value.alerts.map(a => a.id));
      return uniqueAlertIds.size;
    });

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
        return `1 per ${minutesBetween} minutes`;
      }
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
      return {
        startTime: incidentDetails.value.first_alert_at,
        endTime: incidentDetails.value.last_alert_at,
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

    const loadDetails = async (incidentId: string) => {
      console.log('[LOAD DETAILS] Called with incident ID:', incidentId)
      loading.value = true;

      // Reset correlation state when loading new incident
      correlationData.value = null;
      correlationError.value = null;

      try {
        const org = store.state.selectedOrganization.identifier;
        console.log('[LOAD DETAILS] Fetching incident from API...')
        const response = await incidentsService.get(org, incidentId);

        console.log('[LOAD DETAILS] API Response:', response.data)
        incidentDetails.value = response.data;
        triggers.value = (response.data as any).triggers || [];
        alerts.value = response.data.alerts || [];

        // Initialize editable status and severity from incident data
        editableStatus.value = response.data.status;
        editableSeverity.value = response.data.severity;
        console.log('[LOAD DETAILS] Incident loaded, status:', response.data.status)
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
      console.log('[UPDATE STATUS] Starting update, newStatus:', newStatus)
      try {
        const org = store.state.selectedOrganization.identifier;
        console.log('[UPDATE STATUS] Making API call...')
        const response = await incidentsService.updateStatus(
          org,
          incidentDetails.value.id,
          newStatus
        );
        console.log('[UPDATE STATUS] API Response:', response.data)
        console.log('[UPDATE STATUS] Response status field:', response.data.status)
        // Update local state with the actual status from the API response
        incidentDetails.value.status = response.data.status;
        incidentDetails.value.updated_at = response.data.updated_at || Date.now() * 1000;
        editableStatus.value = response.data.status;
        console.log('[UPDATE STATUS] Local state updated, new status:', incidentDetails.value.status)
        $q.notify({
          type: "positive",
          message: t("alerts.incidents.statusUpdated"),
        });
        console.log('[UPDATE STATUS] Emitting status-updated event')
        emit("status-updated");
        console.log('[UPDATE STATUS] Update complete!')
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

    const getStatusDotColor = (status: string) => {
      switch (status) {
        case "open":
          return "#ef4444"; // red-500
        case "acknowledged":
          return "#f59e0b"; // amber-500
        case "resolved":
          return "#10b981"; // green-500
        default:
          return "#6b7280"; // gray-500
      }
    };

    const getStatusTextColor = (status: string) => {
      switch (status) {
        case "open":
          return "#dc2626"; // red-600
        case "acknowledged":
          return "#d97706"; // amber-600
        case "resolved":
          return "#059669"; // green-600
        default:
          return "#4b5563"; // gray-600
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

    const getSeverityColor = (severity: string) => {
      switch (severity) {
        case "P1":
          return "red-10";
        case "P2":
          return "orange-8";
        case "P3":
          return "amber-8";
        case "P4":
          return "grey-7";
        default:
          return "grey";
      }
    };

    const getSeverityDotColor = (severity: string) => {
      switch (severity) {
        case "P1":
          return "#991b1b"; // red-900
        case "P2":
          return "#ea580c"; // orange-600
        case "P3":
          return "#f59e0b"; // amber-500
        case "P4":
          return "#6b7280"; // gray-500
        default:
          return "#9ca3af"; // gray-400
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

    const getSeverityTextColor = (severity: string) => {
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

    const getReasonColor = (reason: string) => {
      switch (reason) {
        case "service_discovery":
          return "blue";
        case "manual_extraction":
          return "purple";
        case "temporal":
          return "teal";
        default:
          return "grey";
      }
    };

    const getReasonLabel = (reason: string) => {
      switch (reason) {
        case "service_discovery":
          return t("alerts.incidents.correlationServiceDiscovery");
        case "manual_extraction":
          return t("alerts.incidents.correlationManualExtraction");
        case "temporal":
          return t("alerts.incidents.correlationTemporal");
        default:
          return reason;
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

    const getStatusIcon = (status: string) => {
      switch (status) {
        case "open":
          return "error";
        case "acknowledged":
          return "warning";
        case "resolved":
          return "check_circle";
        default:
          return "info";
      }
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

    // openSREChat is no longer needed - context is auto-registered via watch
    // Keeping function for backwards compatibility but it just opens the AI chat
    const openSREChat = () => {
      store.dispatch('setAiChatEnabled', true);
    };

    const getTimezone = () => {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    };

    const getAIIconURL = () => {
      return store.state.theme === 'dark'
        ? getImageURL('images/common/ai_icon_dark.svg')
        : getImageURL('images/common/ai_icon.svg');
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
      tocRenderKey,
      formattedRcaContent,
      correlationData,
      correlationLoading,
      correlationError,
      hasCorrelatedData,
      hasAnyStreams,
      telemetryTimeRange,
      incidentContextData,
      uniqueAlertsCount,
      affectedServicesCount,
      alertFrequency,
      peakAlertRate,
      correlationType,
      correlationTooltip,
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
      openSREChat,
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
      getStatusDotColor,
      getStatusTextColor,
      getStatusLabel,
      getStatusIcon,
      getSeverityColor,
      getSeverityDotColor,
      getSeverityColorHex,
      getSeverityTextColor,
      getReasonColor,
      getReasonLabel,
      formatPeriod,
      formatCustomConditions,
      formatTimestamp,
      formatTimestampUTC,
      calculateDuration,
      formatRcaContent,
      getTimezone,
      getAIIconURL,
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
</style>
