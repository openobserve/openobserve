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
    class="tw:flex tw:flex-col tw:w-full tw:h-full tw:bg-(--o2-card-bg) discovered-services"
    :class="{ 'ds-dark': store.state.theme === 'dark' }"
  >
    <!-- Loading State -->
    <div v-if="loading" class="tw:flex tw:flex-1 tw:items-center tw:justify-center">
      <OSpinner size="sm" data-test="discovered-services-loading-indicator" />
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="tw:flex tw:flex-col tw:flex-1 tw:items-center tw:justify-center tw:gap-3">
      <OIcon
        name="error-outline"
        class="tw:text-red-500" style="width: 3rem; height: 3rem;" />
      <div class="tw:text-base tw:text-red-500">{{ error }}</div>
      <OButton
        data-test="retry-discovered-services-btn"
        variant="outline"
        size="sm-action"
        @click="loadServices"
        icon-left="refresh"
      >
        {{ t("settings.correlation.retry") }}
      </OButton>
    </div>

    <!-- Empty State -->
    <div v-else-if="services.length === 0" class="tw:flex tw:flex-1 tw:items-center tw:justify-center">
      <OEmptyState
        size="hero"
        preset="no-discovered-services"
        :title="t('settings.correlation.noServicesYet')"
        :description="t('settings.correlation.noServicesDescription')"
        data-test="discovered-services-empty-state"
      >
        <template #actions>
          <OButton
            data-test="refresh-discovered-services-btn"
            variant="outline"
            size="sm-action"
            :loading="refreshing"
            @click="loadServices(true)"
            icon-left="refresh"
          >
            {{ t("common.refresh") }}
          </OButton>
        </template>
      </OEmptyState>
    </div>

    <!-- Services List -->
    <div v-else class="tw:flex tw:flex-col tw:flex-1 tw:min-h-0 tw:pt-3">
      <!-- Info banner -->
      <div
        class="info-banner tw:shrink-0 tw:mb-3 tw:mx-4 tw:rounded-lg tw:flex tw:items-center tw:gap-3 tw:py-3 tw:px-4 tw:bg-[rgba(59,130,246,0.04)] tw:border tw:border-[rgba(59,130,246,0.15)]"
        :class="store.state.theme === 'dark' ? 'tw:bg-[rgba(59,130,246,0.08)] tw:border-[rgba(59,130,246,0.25)]' : ''"
      >
        <OIcon
          name="info"
          size="md"
          class="tw:shrink-0 info-banner-icon tw:text-[#1d4ed8]"
          :class="store.state.theme === 'dark' ? 'tw:text-[#93c5fd]' : ''"
        />
        <div
          class="tw:text-sm tw:leading-relaxed info-banner-text tw:text-[#374151]"
          :class="store.state.theme === 'dark' ? 'tw:text-[#d1d5db]' : ''"
        >
          {{ t("settings.correlation.discoveredServicesDescription") }}
          <a
            class="tw:cursor-pointer tw:inline-block tw:mx-1 tw:px-2 tw:py-0.5 tw:rounded tw:text-xs tw:font-semibold tw:no-underline tw:align-middle tw:border tw:border-[#3b82f6] tw:text-[#2563eb] tw:bg-[rgba(59,130,246,0.08)] tw:transition-[background] tw:duration-[150ms] tw:hover:bg-[rgba(59,130,246,0.18)] tw:dark:border-[#60a5fa] tw:dark:text-[#93c5fd] tw:dark:bg-[rgba(96,165,250,0.12)] tw:dark:hover:bg-[rgba(96,165,250,0.22)]"
            @click.prevent="$emit('navigate-to-configuration')"
            >{{ t("settings.correlation.goToConfiguration") }}</a
          >
          <span>{{ t("settings.correlation.configureServicesHint") }}</span>
        </div>
      </div>

      <!-- Header with title -->
      <div class="card-container tw:shrink-0 tw:mb-[0.625rem]">
        <div
          class="services-header-bar tw:flex tw:justify-between tw:items-center tw:w-full tw:py-3 tw:px-4 tw:h-[4.25rem]"
        >
          <div
            class="tw:text-xl tw:tracking-[0.005em] tw:font-[600]"
            data-test="services-list-title"
          >
            {{ t("settings.correlation.discoveredServicesTitle") }}
          </div>
          <!-- Filter bar -->
          <div class="tw:flex tw:items-center tw:gap-2">
            <span class="tw:text-md tw:text-gray-400 tw:whitespace-nowrap">{{
              t("settings.correlation.filterBy")
            }}</span>
            <OSelect
              v-model="filterKey"
              :options="allKeys"
              labelKey="label"
              valueKey="value"
              clearable
              searchable
              :placeholder="t('settings.correlation.selectFieldPlaceholder')"
              data-test="service-filter-key"
              class="o2-search-input filter-select tw:min-w-[10rem]"
              @update:model-value="filterValue = null"
            />
            <span>
              <OSelect
                v-model="filterValue"
                :options="allValues"
                clearable
                searchable
                :disabled="!filterKey"
                :placeholder="t('settings.correlation.selectValuePlaceholder')"
                data-test="service-filter-value"
                class="o2-search-input filter-select tw:min-w-[10rem]"
              />
              <OTooltip v-if="!filterKey" :content="t('settings.correlation.selectFieldFirst')" side="top" />
            </span>
            <OSearchInput
              v-model="searchQuery"
              :placeholder="t('settings.correlation.searchServiceName')"
              data-test="service-search-input"
              clearable
              class="o2-search-input"
            />
            <OButton
              data-test="reset-discovered-services-btn"
              variant="outline"
              size="sm"
              :loading="resetting"
              @click="confirmResetServices"
            >
              {{ t("settings.correlation.resetServices") }}
              <OTooltip :content="t('settings.correlation.resetServicesTooltip')" side="top" />
            </OButton>
            <OButton
              variant="outline"
              size="sm-action"
              :loading="refreshing"
              @click="loadServices(true)"
              data-test="refresh-discovered-services-btn"
            >
              {{ t("common.refresh") }}
            </OButton>
          </div>
        </div>
      </div>

      <!-- Grouped Services Table -->
      <div class="tw:flex-1 tw:min-h-0">
        <div class="tw:h-full">
          <OTable
            :data="refreshing ? [] : filteredGroups"
            :columns="columns"
            :loading="refreshing"
            row-key="id"
            pagination="client"
            :page-size="pageSize"
            :page-size-options="[20, 50, 100, 250, 500]"
            sorting="client"
            filter-mode="client"
            :default-columns="false"
            :enable-column-resize="true"
            :persist-columns="true"
            table-id="settings-discovered-services"
            :show-global-filter="false"
            expansion="multi"
            :expand-on-row-click="(row: any) => row.__type === 'group'"
            :get-row-expansion-enabled="(row: any) => row.__type === 'group'"
            :keep-page-on-data-change="true"
            :current-page="currentPage"
            class="o2-table o2-row-md o2-table-header-sticky services-table tw:w-full"
            :class="filteredGroupCount > 0 ? 'services-table-full-height tw:h-[calc(100vh-21.25rem)]' : ''"
            data-test="services-list-table"
            @update:expanded-ids="syncExpansion"
            @row-click="handleRowClick"
            @pagination-change="({ page }: { page: number }) => currentPage = page"
          >
            <template #empty>
              <OEmptyState
                size="hero"
                preset="no-discovered-services"
                :filtered="!!searchQuery"
                :hide-action="!searchQuery"
                @action="(id) => id === 'clear-filters' && (searchQuery = '')"
              />
            </template>
            <template #cell-service_name="{ row }">
              <div v-if="row.__type === 'group'" class="tw:flex tw:items-center tw:gap-2 tw:ml-2">
                <span class="tw:font-semibold">{{ row.service_name }}</span>
                <span class="instance-count-badge tw:inline-flex tw:items-center tw:py-[0.0625rem] tw:px-2 tw:rounded-[0.625rem] tw:text-[0.6875rem] tw:font-medium" :class="store.state.theme === 'dark' ? 'tw:bg-[#4b5563] tw:text-[#d1d5db]' : 'tw:bg-[#e5e7eb] tw:text-[#6b7280]'">
                  {{ row.instances.length }}
                  {{
                    row.instances.length === 1
                      ? t("settings.correlation.instanceSingular")
                      : t("settings.correlation.instancePlural")
                  }}
                </span>
              </div>
              <div v-else class="tw:flex tw:items-center tw:gap-2 tw:flex-wrap">
                <span class="set-id-badge tw:inline-flex tw:items-center tw:py-[0.0625rem] tw:px-2 tw:rounded-[0.625rem] tw:text-[0.6875rem] tw:font-semibold tw:border tw:whitespace-nowrap tw:shrink-0" :class="store.state.theme === 'dark' ? 'tw:bg-[rgba(109,40,217,0.2)] tw:text-[#c4b5fd] tw:border-[#7c3aed]' : 'tw:bg-[#ede9fe] tw:text-[#5b21b6] tw:border-[#a78bfa]'">{{ row.set_id }}</span>
                <span
                  v-for="[key, value] in Object.entries(
                    row.disambiguation,
                  ).sort(([a], [b]) => a.localeCompare(b))"
                  :key="`${key}=${value}`"
                  class="dimension-badge tw:inline-flex tw:items-center tw:gap-[0.125rem] tw:py-[0.1875rem] tw:px-[0.625rem] tw:rounded-md tw:text-xs tw:font-semibold tw:whitespace-nowrap"
                  :class="getDimensionColorClass(key)"
                >
                  <span class="tw:font-medium">{{ key }}</span
                  >=<span>{{ value }}</span>
                </span>
                <span
                  v-if="Object.keys(row.disambiguation).length === 0"
                  class="tw:text-xs tw:italic no-dimensions-text tw:text-[#9ca3af]"
                  :class="store.state.theme === 'dark' ? 'tw:text-[#6b7280]' : ''"
                  >{{ t("settings.correlation.noDimensions") }}</span
                >
              </div>
            </template>
            <template #cell-telemetry="{ row }">
              <div v-if="row.__type === 'group'" class="instance-telemetry-grid tw:inline-grid tw:grid-cols-[minmax(4rem,auto)_minmax(5rem,auto)_minmax(5.75rem,auto)] tw:gap-1 tw:items-center tw:justify-items-start">
                <span
                  v-if="row.totalLogs > 0"
                  class="telemetry-badge telemetry-logs tw:inline-flex tw:items-center tw:py-1 tw:px-3 tw:rounded-md tw:text-[0.8125rem] tw:font-semibold tw:whitespace-nowrap tw:border tw:border-[#1d4ed8]"
                  :class="store.state.theme === 'dark' ? 'tw:border-[#93c5fd]' : ''"
                  >{{ t("settings.correlation.logs") }}</span
                >
                <span v-else class="telemetry-slot-empty tw:inline-block"></span>
                <span
                  v-if="row.totalTraces > 0"
                  class="telemetry-badge telemetry-traces tw:inline-flex tw:items-center tw:py-1 tw:px-3 tw:rounded-md tw:text-[0.8125rem] tw:font-semibold tw:whitespace-nowrap tw:border tw:border-[#c2410c]"
                  :class="store.state.theme === 'dark' ? 'tw:border-[#fdba74]' : ''"
                  >{{ t("settings.correlation.traces") }}</span
                >
                <span v-else class="telemetry-slot-empty tw:inline-block"></span>
                <span
                  v-if="row.totalMetrics > 0"
                  class="telemetry-badge telemetry-metrics tw:inline-flex tw:items-center tw:py-1 tw:px-3 tw:rounded-md tw:text-[0.8125rem] tw:font-semibold tw:whitespace-nowrap tw:border tw:border-[#065f46]"
                  :class="store.state.theme === 'dark' ? 'tw:border-[#6ee7b7]' : ''"
                  >{{ t("settings.correlation.metrics") }}</span
                >
                <span v-else class="telemetry-slot-empty tw:inline-block"></span>
              </div>
              <div v-else class="instance-telemetry-grid tw:inline-grid tw:grid-cols-[minmax(4rem,auto)_minmax(5rem,auto)_minmax(5.75rem,auto)] tw:gap-1 tw:items-center tw:justify-items-start">
                <span
                  v-if="row.logs_streams.length > 0"
                  class="telemetry-badge telemetry-sm telemetry-logs tw:inline-flex tw:items-center tw:py-[0.1875rem] tw:px-[0.625rem] tw:rounded-md tw:text-xs tw:font-semibold tw:whitespace-nowrap tw:border tw:border-[#1d4ed8]"
                  :class="store.state.theme === 'dark' ? 'tw:border-[#93c5fd]' : ''"
                >
                  <OTooltip
                    :content="row.logs_streams.join(', ')"
                    content-class="tw:text-xs"
                  />
                  {{
                    t("settings.correlation.logsWithCount", {
                      count: row.logs_streams.length,
                    })
                  }}
                </span>
                <span v-else class="telemetry-slot-empty tw:inline-block"></span>

                <span
                  v-if="row.traces_streams.length > 0"
                  class="telemetry-badge telemetry-sm telemetry-traces tw:inline-flex tw:items-center tw:py-[0.1875rem] tw:px-[0.625rem] tw:rounded-md tw:text-xs tw:font-semibold tw:whitespace-nowrap tw:border tw:border-[#c2410c]"
                  :class="store.state.theme === 'dark' ? 'tw:border-[#fdba74]' : ''"
                >
                  <OTooltip
                    :content="row.traces_streams.join(', ')"
                    content-class="tw:text-xs"
                  />
                  {{
                    t("settings.correlation.tracesWithCount", {
                      count: row.traces_streams.length,
                    })
                  }}
                </span>
                <span v-else class="telemetry-slot-empty tw:inline-block"></span>

                <span
                  v-if="row.metrics_streams.length > 0"
                  class="telemetry-badge telemetry-sm telemetry-metrics tw:inline-flex tw:items-center tw:py-[0.1875rem] tw:px-[0.625rem] tw:rounded-md tw:text-xs tw:font-semibold tw:whitespace-nowrap tw:border tw:border-[#065f46]"
                  :class="store.state.theme === 'dark' ? 'tw:border-[#6ee7b7]' : ''"
                >
                  <OTooltip
                    :content="row.metrics_streams.join(', ')"
                    content-class="tw:text-xs"
                  />
                  {{
                    t("settings.correlation.metricsWithCount", {
                      count: row.metrics_streams.length,
                    })
                  }}
                </span>
                <span v-else class="telemetry-slot-empty tw:inline-block"></span>
              </div>
            </template>
            <template #cell-last_seen="{ row }">
              <OTimeCell
                :value="row.lastSeen"
                unit="us"
                :timezone="store.state.timezone"
                :class="row.__type === 'group' ? 'tw:text-sm' : 'tw:text-xs'"
              />
            </template>

            <!-- Bottom -->
            <template #bottom>
              <div
                class="bottom-btn tw:flex tw:items-center tw:justify-between tw:w-full tw:h-[2.25rem]"
              >
                <div class="o2-table-footer-title tw:w-[15.625rem] tw:mr-md">
                  {{
                    filteredGroupCount === 1
                      ? t("settings.correlation.serviceCountSingular", {
                          count: filteredGroupCount,
                        })
                      : t("settings.correlation.serviceCountPlural", {
                          count: filteredGroupCount,
                        })
                  }}
                  {{
                    t("settings.correlation.instancesCount", {
                      count: totalInstances,
                    })
                  }}
                </div>
              </div>
            </template>
          </OTable>
        </div>
      </div>
    </div>

    <!-- Service detail side panel -->
    <ODrawer
      :open="!!selectedService"
      @update:open="
        (val) => {
          if (!val) selectedService = null;
        }
      "
      size="lg"
      :title="selectedService?.service_name"
      data-test="service-side-panel"
    >
      <template #header-right>
        <span class="set-id-badge tw:inline-flex tw:items-center tw:py-[0.0625rem] tw:px-2 tw:rounded-[0.625rem] tw:text-[0.6875rem] tw:font-semibold tw:border tw:whitespace-nowrap tw:shrink-0" :class="store.state.theme === 'dark' ? 'tw:bg-[rgba(109,40,217,0.2)] tw:text-[#c4b5fd] tw:border-[#7c3aed]' : 'tw:bg-[#ede9fe] tw:text-[#5b21b6] tw:border-[#a78bfa]'">{{ selectedService?.set_id }}</span>
      </template>

      <!-- Default set warning banner -->
      <div
        v-if="selectedService?.set_id === 'default'"
        class="panel-warning-banner tw:flex tw:items-start tw:gap-[0.625rem] tw:py-3 tw:px-5 tw:bg-[rgba(234,179,8,0.08)] tw:border-b tw:border-b-[rgba(234,179,8,0.25)] tw:text-[#854d0e]"
        :class="store.state.theme === 'dark' ? 'tw:bg-[rgba(234,179,8,0.1)] tw:border-b-[rgba(234,179,8,0.3)] tw:text-[#fde68a]' : ''"
      >
        <OIcon name="info-outline" size="sm" class="tw:shrink-0 tw:mt-0.5" />
        <div class="tw:text-xs tw:leading-relaxed">
          <span class="tw:font-semibold">{{
            t("settings.correlation.defaultSetWarningTitle")
          }}</span>
          {{ t("settings.correlation.defaultSetWarningBody") }}
        </div>
      </div>

      <OSeparator />

      <!-- Scrollable body -->
      <div class="panel-body tw:flex-1 tw:overflow-y-auto tw:p-0">
        <!-- Instance Identity -->
        <div class="panel-block tw:py-4 tw:px-5 tw:border-b tw:border-b-[#f3f4f6]" :class="store.state.theme === 'dark' ? 'tw:border-b-[#1f2937]' : ''">
          <div class="panel-block-label tw:text-xs tw:font-semibold tw:normal-case tw:tracking-normal tw:text-[#9ca3af] tw:mb-[0.625rem]">
            {{ t("settings.correlation.instanceIdentity") }}
          </div>
          <div
            v-if="
              selectedService &&
              Object.keys(selectedService.disambiguation).length > 0
            "
            class="tw:flex tw:flex-wrap tw:gap-1.5"
          >
            <span
              v-for="[key, value] in Object.entries(
                selectedService.disambiguation,
              ).sort(([a], [b]) => a.localeCompare(b))"
              :key="`${key}=${value}`"
              class="dimension-badge tw:inline-flex tw:items-center tw:gap-[0.125rem] tw:py-[0.1875rem] tw:px-[0.625rem] tw:rounded-md tw:text-xs tw:font-semibold tw:whitespace-nowrap"
              :class="getDimensionColorClass(key)"
            >
              <span class="tw:font-medium">{{ key }}</span
              >=<span>{{ value }}</span>
            </span>
          </div>
          <div v-else class="panel-empty-text tw:text-[0.8125rem] tw:text-[#9ca3af] tw:italic" :class="store.state.theme === 'dark' ? 'tw:text-[#6b7280]' : ''">
            {{ t("settings.correlation.noDimensionsCatchAll") }}
          </div>
        </div>

        <!-- Stream Sources -->
        <div class="panel-block tw:py-4 tw:px-5 tw:border-b tw:border-b-[#f3f4f6]" :class="store.state.theme === 'dark' ? 'tw:border-b-[#1f2937]' : ''">
          <div class="panel-block-label tw:text-xs tw:font-semibold tw:normal-case tw:tracking-normal tw:text-[#9ca3af] tw:mb-[0.625rem]">
            {{ t("settings.correlation.streamSources") }}
          </div>
          <div class="tw:flex tw:flex-col tw:gap-3">
            <!-- Logs -->
            <div
              v-if="selectedService && selectedService.logs_streams.length > 0"
            >
              <div class="panel-signal-row tw:flex tw:items-start tw:gap-3">
                <span
                  class="telemetry-badge telemetry-logs panel-signal-type tw:inline-flex tw:items-center tw:py-1 tw:px-3 tw:rounded-md tw:text-[0.8125rem] tw:font-semibold tw:whitespace-nowrap tw:border tw:border-[#1d4ed8] tw:shrink-0 tw:min-w-[3.75rem] tw:justify-center tw:mt-[0.0625rem]"
                  :class="store.state.theme === 'dark' ? 'tw:border-[#93c5fd]' : ''"
                  >{{ t("settings.correlation.logs") }}</span
                >
                <div class="tw:flex tw:flex-wrap tw:gap-1.5">
                  <span
                    v-for="stream in selectedService.logs_streams"
                    :key="stream"
                    class="stream-name-badge tw:inline-flex tw:items-center tw:py-[0.0625rem] tw:px-[0.4375rem] tw:rounded tw:text-[0.6875rem] tw:font-mono tw:border tw:whitespace-nowrap"
                    :class="store.state.theme === 'dark' ? 'tw:bg-[#1f2937] tw:text-[#d1d5db] tw:border-[#374151]' : 'tw:bg-[#f3f4f6] tw:text-[#374151] tw:border-[#e5e7eb]'"
                    >{{ stream }}</span
                  >
                </div>
              </div>
            </div>

            <!-- Traces -->
            <div
              v-if="
                selectedService && selectedService.traces_streams.length > 0
              "
            >
              <div class="panel-signal-row tw:flex tw:items-start tw:gap-3">
                <span
                  class="telemetry-badge telemetry-traces panel-signal-type tw:inline-flex tw:items-center tw:py-1 tw:px-3 tw:rounded-md tw:text-[0.8125rem] tw:font-semibold tw:whitespace-nowrap tw:border tw:border-[#c2410c] tw:shrink-0 tw:min-w-[3.75rem] tw:justify-center tw:mt-[0.0625rem]"
                  :class="store.state.theme === 'dark' ? 'tw:border-[#fdba74]' : ''"
                  >{{ t("settings.correlation.traces") }}</span
                >
                <div class="tw:flex tw:flex-wrap tw:gap-1.5">
                  <span
                    v-for="stream in selectedService.traces_streams"
                    :key="stream"
                    class="stream-name-badge tw:inline-flex tw:items-center tw:py-[0.0625rem] tw:px-[0.4375rem] tw:rounded tw:text-[0.6875rem] tw:font-mono tw:border tw:whitespace-nowrap"
                    :class="store.state.theme === 'dark' ? 'tw:bg-[#1f2937] tw:text-[#d1d5db] tw:border-[#374151]' : 'tw:bg-[#f3f4f6] tw:text-[#374151] tw:border-[#e5e7eb]'"
                    >{{ stream }}</span
                  >
                </div>
              </div>
            </div>

            <!-- Metrics -->
            <div
              v-if="
                selectedService && selectedService.metrics_streams.length > 0
              "
            >
              <div class="panel-signal-row tw:flex tw:items-start tw:gap-3">
                <span
                  class="telemetry-badge telemetry-metrics panel-signal-type tw:inline-flex tw:items-center tw:py-1 tw:px-3 tw:rounded-md tw:text-[0.8125rem] tw:font-semibold tw:whitespace-nowrap tw:border tw:border-[#065f46] tw:shrink-0 tw:min-w-[3.75rem] tw:justify-center tw:mt-[0.0625rem]"
                  :class="store.state.theme === 'dark' ? 'tw:border-[#6ee7b7]' : ''"
                  >{{ t("settings.correlation.metrics") }}</span
                >
                <div class="tw:flex tw:flex-wrap tw:gap-1.5">
                  <span
                    v-for="stream in selectedService.metrics_streams"
                    :key="stream"
                    class="stream-name-badge tw:inline-flex tw:items-center tw:py-[0.0625rem] tw:px-[0.4375rem] tw:rounded tw:text-[0.6875rem] tw:font-mono tw:border tw:whitespace-nowrap"
                    :class="store.state.theme === 'dark' ? 'tw:bg-[#1f2937] tw:text-[#d1d5db] tw:border-[#374151]' : 'tw:bg-[#f3f4f6] tw:text-[#374151] tw:border-[#e5e7eb]'"
                    >{{ stream }}</span
                  >
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Field Name Mapping -->
        <div
          v-if="
            selectedService &&
            Object.keys(selectedService.field_name_mapping ?? {}).length > 0
          "
          class="panel-block tw:py-4 tw:px-5 tw:border-b tw:border-b-[#f3f4f6]" :class="store.state.theme === 'dark' ? 'tw:border-b-[#1f2937]' : ''"
        >
          <div class="panel-block-label tw:text-xs tw:font-semibold tw:normal-case tw:tracking-normal tw:text-[#9ca3af] tw:mb-[0.625rem]">
            {{ t("settings.correlation.fieldNameMapping") }}
          </div>
          <div class="panel-mapping-grid">
            <template
              v-for="[raw, mapped] in Object.entries(
                selectedService.field_name_mapping ?? {},
              ).sort(([a], [b]) => a.localeCompare(b))"
              :key="raw"
            >
              <span class="mapping-key tw:font-mono tw:text-[0.6875rem] tw:py-[0.0625rem] tw:px-[0.375rem] tw:rounded tw:border tw:whitespace-nowrap" :class="store.state.theme === 'dark' ? 'tw:bg-[#1f2937] tw:text-[#d1d5db] tw:border-[#374151]' : 'tw:bg-[#f3f4f6] tw:text-[#374151] tw:border-[#e5e7eb]'">{{ raw }}</span>
              <OIcon
                name="arrow-forward"
                size="xs"
                class="tw:text-gray-400 tw:justify-self-center"
              />
              <span class="mapping-val tw:font-mono tw:text-[0.6875rem] tw:py-[0.0625rem] tw:px-[0.375rem] tw:rounded tw:border tw:whitespace-nowrap" :class="store.state.theme === 'dark' ? 'tw:bg-[rgba(6,95,70,0.2)] tw:text-[#6ee7b7] tw:border-[#065f46]' : 'tw:bg-[#ecfdf5] tw:text-[#065f46] tw:border-[#a7f3d0]'">{{ mapped }}</span>
            </template>
          </div>
        </div>
      </div>
    </ODrawer>

    <ConfirmDialog
      :title="t('settings.correlation.resetServicesConfirmTitle')"
      :message="t('settings.correlation.resetServicesConfirmMessage')"
      :warningMessage="t('settings.correlation.resetServicesConfirmWarning')"
      @update:ok="doResetServices"
      @update:cancel="confirmResetOpen = false"
      v-model="confirmResetOpen"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import serviceStreamsService from "@/services/service_streams";
import OButton from "@/lib/core/Button/OButton.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";

const emit = defineEmits<{
  (e: "navigate-to-configuration"): void;
}>();

const { t } = useI18n();

interface ServiceRecord {
  id: string;
  org_id: string;
  service_name: string;
  set_id: string;
  disambiguation: Record<string, string>;
  all_dimensions: Record<string, string>;
  logs_streams: string[];
  traces_streams: string[];
  metrics_streams: string[];
  field_name_mapping: Record<string, string>;
  last_seen: number; // microseconds epoch
}

interface ServiceGroup {
  service_name: string;
  instances: ServiceRecord[];
  sharedDimensions: [string, string][];
  varyingKeys: string[];
  totalLogs: number;
  totalTraces: number;
  totalMetrics: number;
  correlationScore: number;
  lastSeen: number;
}

const store = useStore();

const loading = ref(true);
const refreshing = ref(false);
const resetting = ref(false);
const error = ref<string | null>(null);
const services = ref<ServiceRecord[]>([]);
const searchQuery = ref("");
const filterKey = ref<string | null>(null);
const filterValue = ref<string | null>(null);
const selectedService = ref<ServiceRecord | null>(null);
const expandedGroupNames = ref<Set<string>>(new Set());
const pageSize = ref(20);
const currentPage = ref(1);

watch([filterKey, filterValue, searchQuery], () => {
  currentPage.value = 1;
});

// Label override for internal field keys shown in the filter dropdown
const KEY_DISPLAY_LABELS: Record<string, string> = {
  set_id: t("settings.correlation.workload"),
};

const allKeys = computed((): { label: string; value: string }[] => {
  const keys = new Set<string>();
  keys.add("set_id");
  for (const s of services.value) {
    for (const k of Object.keys(s.disambiguation)) keys.add(k);
  }
  return [...keys]
    .sort()
    .map((k) => ({ label: KEY_DISPLAY_LABELS[k] ?? k, value: k }));
});

const allValues = computed((): string[] => {
  if (!filterKey.value) return [];
  const vals = new Set<string>();
  for (const s of services.value) {
    if (filterKey.value === "set_id") {
      vals.add(s.set_id);
    } else {
      const v = s.disambiguation[filterKey.value];
      if (v) vals.add(v);
    }
  }
  return [...vals].sort();
});

const filteredKeyOptions = ref<{ label: string; value: string }[]>([]);
const filteredValueOptions = ref<string[]>([]);

function filterKeyFn(val: string, update: (fn: () => void) => void) {
  update(() => {
    const needle = val.toLowerCase();
    filteredKeyOptions.value = needle
      ? allKeys.value.filter((k) => k.label.toLowerCase().includes(needle))
      : allKeys.value;
  });
}

function filterValueFn(val: string, update: (fn: () => void) => void) {
  update(() => {
    const needle = val.toLowerCase();
    filteredValueOptions.value = needle
      ? allValues.value.filter((v) => v.toLowerCase().includes(needle))
      : allValues.value;
  });
}

function unique(arr: string[]): string[] {
  return [...new Set(arr)];
}

const sortBy = ref<string>("lastSeen");
const sortDescending = ref<boolean>(true);

const columns: OTableColumnDef[] = [
  {
    id: "service_name",
    header: t("settings.correlation.serviceName"),
    accessorKey: "service_name",
    sortable: true,
    resizable: true,
    hideable: true,
    minSize: 160,
    meta: { align: "left", flex: true },
  },
  {
    id: "telemetry",
    header: t("settings.correlation.telemetryCoverage"),
    accessorKey: "telemetry",
    resizable: true,
    hideable: true,
    size: 260,
    meta: { align: "left" },
  },
  {
    id: "last_seen",
    header: t("settings.correlation.lastSeen"),
    accessorKey: "lastSeen",
    sortable: true,
    resizable: true,
    hideable: true,
    size: 120,
    meta: { align: "left" },
  },
];

function syncExpansion(ids: string[]) {
  expandedGroupNames.value = new Set(ids);
}

function handleRowClick(row: any) {
  if (row.__type !== 'group') {
    selectedService.value = row;
  }
}

// Group services by service_name
const serviceGroups = computed((): ServiceGroup[] => {
  const groupMap: Record<string, ServiceRecord[]> = {};
  for (const s of services.value) {
    if (!groupMap[s.service_name]) groupMap[s.service_name] = [];
    groupMap[s.service_name].push(s);
  }

  return Object.entries(groupMap)
    .map(([name, instances]) => {
      const allDimKeys = new Set<string>();
      for (const inst of instances) {
        for (const k of Object.keys(inst.disambiguation)) allDimKeys.add(k);
      }

      const shared: [string, string][] = [];
      const varying: string[] = [];
      for (const key of allDimKeys) {
        const values = new Set(
          instances.map((i) => i.disambiguation[key]).filter(Boolean),
        );
        if (values.size === 1) {
          shared.push([key, [...values][0]]);
        } else {
          varying.push(key);
        }
      }

      const allLogs = new Set<string>();
      const allTraces = new Set<string>();
      const allMetrics = new Set<string>();
      let latestSeen = 0;
      for (const inst of instances) {
        inst.logs_streams.forEach((s) => allLogs.add(s));
        inst.traces_streams.forEach((s) => allTraces.add(s));
        inst.metrics_streams.forEach((s) => allMetrics.add(s));
        if (inst.last_seen > latestSeen) latestSeen = inst.last_seen;
      }

      const correlationScore =
        (allLogs.size > 0 ? 1 : 0) +
        (allTraces.size > 0 ? 1 : 0) +
        (allMetrics.size > 0 ? 1 : 0);

      const sortedInstances = [...instances].sort((a, b) => {
        const aIsDefault = a.set_id === "default" ? 1 : 0;
        const bIsDefault = b.set_id === "default" ? 1 : 0;
        if (aIsDefault !== bIsDefault) return aIsDefault - bIsDefault;
        const scoreA =
          (a.logs_streams.length > 0 ? 1 : 0) +
          (a.traces_streams.length > 0 ? 1 : 0) +
          (a.metrics_streams.length > 0 ? 1 : 0);
        const scoreB =
          (b.logs_streams.length > 0 ? 1 : 0) +
          (b.traces_streams.length > 0 ? 1 : 0) +
          (b.metrics_streams.length > 0 ? 1 : 0);
        return scoreB - scoreA;
      });

      return {
        service_name: name,
        instances: sortedInstances,
        sharedDimensions: shared.sort(([a], [b]) => a.localeCompare(b)),
        varyingKeys: varying.sort(),
        totalLogs: allLogs.size,
        totalTraces: allTraces.size,
        totalMetrics: allMetrics.size,
        correlationScore,
        lastSeen: latestSeen,
      };
    })
    .sort((a, b) => b.lastSeen - a.lastSeen);
});

function filterInstances(instances: ServiceRecord[]): ServiceRecord[] {
  if (!filterKey.value || !filterValue.value) return instances;
  return instances.filter((inst) => {
    if (filterKey.value === "set_id") return inst.set_id === filterValue.value;
    const v = inst.disambiguation[filterKey.value!];
    return v === filterValue.value;
  });
}

const filteredGroups = computed((): any[] => {
  let groups = serviceGroups.value;

  if (filterKey.value && filterValue.value) {
    groups = groups
      .map((g) => ({ ...g, instances: filterInstances(g.instances) }))
      .filter((g) => g.instances.length > 0);
  }

  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    groups = groups.filter(
      (g) =>
        g.service_name.toLowerCase().includes(query) ||
        g.instances.some(
          (inst) =>
            inst.set_id.toLowerCase().includes(query) ||
            Object.entries(inst.disambiguation).some(
              ([k, v]) =>
                k.toLowerCase().includes(query) ||
                v.toLowerCase().includes(query),
            ) ||
            inst.logs_streams.some((stream) =>
              stream.toLowerCase().includes(query),
            ) ||
            inst.traces_streams.some((stream) =>
              stream.toLowerCase().includes(query),
            ) ||
            inst.metrics_streams.some((stream) =>
              stream.toLowerCase().includes(query),
            ),
        ),
    );
  }

  // Apply sorting
  if (sortBy.value) {
    groups = [...groups].sort((a, b) => {
      let aVal: any, bVal: any;
      if (sortBy.value === "lastSeen") {
        aVal = a.lastSeen || 0;
        bVal = b.lastSeen || 0;
      } else {
        aVal = (a as any)[sortBy.value];
        bVal = (b as any)[sortBy.value];
      }
      if (typeof aVal === "string" && typeof bVal === "string") {
        const result = aVal.localeCompare(bVal);
        return sortDescending.value ? -result : result;
      }
      const diff = aVal - bVal;
      return sortDescending.value ? -diff : diff;
    });
  }

  // Manually flatten: group rows + instance rows when expanded
  const result: any[] = [];
  for (const g of groups) {
    const groupRow = {
      id: g.service_name,
      __type: 'group',
      service_name: g.service_name,
      totalLogs: g.totalLogs,
      totalTraces: g.totalTraces,
      totalMetrics: g.totalMetrics,
      lastSeen: g.lastSeen,
      correlationScore: g.correlationScore,
      instances: g.instances,
    };
    result.push(groupRow);
    if (expandedGroupNames.value.has(g.service_name)) {
      for (const inst of g.instances) {
        result.push({
          ...inst,
          id: inst.id,
          __type: 'instance',
          lastSeen: inst.last_seen,
        });
      }
    }
  }
  return result;
});

const filteredGroupCount = computed(() =>
  filteredGroups.value.filter((r: any) => r.__type === 'group').length,
);

const totalInstances = computed(() =>
  filteredGroups.value.filter((r: any) => r.__type === 'group').reduce((sum: number, g: any) => sum + g.instances.length, 0),
);

// Badge color classes — each entry: [light border, dark border]
const BADGE_COLOR_MAP: Record<string, [string, string]> = {
  blue:   ["tw:border-[#1d4ed8]", "tw:dark:border-[#93c5fd]"],
  green:  ["tw:border-[#065f46]", "tw:dark:border-[#6ee7b7]"],
  yellow: ["tw:border-[#a16207]", "tw:dark:border-[#fcd34d]"],
  pink:   ["tw:border-[#9d174d]", "tw:dark:border-[#f9a8d4]"],
  purple: ["tw:border-[#5b21b6]", "tw:dark:border-[#c4b5fd]"],
  orange: ["tw:border-[#c2410c]", "tw:dark:border-[#fdba74]"],
  cyan:   ["tw:border-[#0e7490]", "tw:dark:border-[#67e8f9]"],
  indigo: ["tw:border-[#3730a3]", "tw:dark:border-[#a5b4fc]"],
  teal:   ["tw:border-[#0f766e]", "tw:dark:border-[#5eead4]"],
  red:    ["tw:border-[#b91c1c]", "tw:dark:border-[#fca5a5]"],
  gray:   ["tw:border-[#6b7280]", "tw:dark:border-[#d1d5db]"],
  amber:  ["tw:border-[#b45309]", "tw:dark:border-[#fbbf24]"],
  violet: ["tw:border-[#6d28d9]", "tw:dark:border-[#c4b5fd]"],
  rose:   ["tw:border-[#be185d]", "tw:dark:border-[#fda4af]"],
};

const KEY_COLOR_LOOKUP: Record<string, string> = {
  "k8s-deployment": "blue",
  "k8s-namespace": "orange",
  "k8s-cluster": "indigo",
  deployment: "blue",
  namespace: "orange",
  cluster: "indigo",
  env: "green",
  environment: "green",
  host: "purple",
  hostname: "purple",
  service: "cyan",
  service_name: "cyan",
  region: "pink",
  zone: "pink",
  pod: "teal",
  container: "red",
  app: "yellow",
  application: "yellow",
};

const FALLBACK_COLORS = ["gray", "amber", "violet", "rose"];

const getDimensionColorClass = (key: string): string => {
  let colorName = KEY_COLOR_LOOKUP[key];

  if (!colorName) {
    const lowerKey = key.toLowerCase();
    for (const [pattern, name] of Object.entries(KEY_COLOR_LOOKUP)) {
      if (lowerKey.includes(pattern)) { colorName = name; break; }
    }
  }

  if (!colorName) {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = (hash << 5) - hash + key.charCodeAt(i);
      hash = hash & hash;
    }
    colorName = FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length];
  }

  const [light, dark] = BADGE_COLOR_MAP[colorName];
  return `${light} ${dark}`;
};

const loadServices = async (isRefresh = false) => {
  if (isRefresh) {
    refreshing.value = true;
  } else {
    loading.value = true;
  }
  error.value = null;

  try {
    const orgId = store.state.selectedOrganization?.identifier;
    if (!orgId) {
      throw new Error("No organization selected");
    }

    const response = await serviceStreamsService.getServicesList(orgId);
    const raw: ServiceRecord[] = response.data || [];
    services.value = raw.map((s) => ({
      ...s,
      logs_streams: unique(s.logs_streams),
      traces_streams: unique(s.traces_streams),
      metrics_streams: unique(s.metrics_streams),
    }));
  } catch (err: any) {
    console.error("Failed to load services:", err);
    error.value = err?.message || "Failed to load services";
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
};

const confirmResetOpen = ref(false);

const confirmResetServices = () => {
  confirmResetOpen.value = true;
};

const doResetServices = async () => {
  resetting.value = true;
  try {
    const orgId = store.state.selectedOrganization?.identifier;
    if (!orgId) {
      throw new Error("No organization selected");
    }

    const response = await serviceStreamsService.resetServices(orgId);
    const { deleted_count, note } = response.data;

    toast({
      variant: "success",
      message: t("settings.correlation.resetServicesSuccess", {
        count: deleted_count,
      }),
      caption: note,
      timeout: 5000,
    });

    await loadServices();
  } catch (err: any) {
    toast({
      variant: "error",
      message: t("settings.correlation.resetServicesFailed"),
      caption: err?.message || String(err),
    });
  } finally {
    resetting.value = false;
  }
};

onMounted(() => {
  loadServices();
});
</script>

