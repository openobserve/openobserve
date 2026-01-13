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
  <div class="tw:w-full discovered-services q-mt-sm">
    <div>
      <GroupHeader :title="t('settings.correlation.discoveredServicesTitle')" :showIcon="false" class="tw:mb-2" />
      <div class="text-body2 tw:mb-4">
        {{ t("settings.correlation.discoveredServicesDescription") }}
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="tw:flex tw:justify-center tw:py-8">
      <q-spinner-hourglass color="primary" size="30px" />
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="tw:text-center tw:py-8">
      <q-icon name="error_outline" size="3rem" color="negative" class="tw:mb-4" />
      <div class="text-body1 text-negative">{{ error }}</div>
      <q-btn
        data-test="retry-discovered-services-btn"
        class="text-bold o2-secondary-button tw:h-[28px] tw:w-[32px] tw:min-w-[32px]!"
        :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
        flat
        :label="t('settings.correlation.retry')"
        @click="loadServices"
      />
    </div>

    <!-- Empty State -->
    <div v-else-if="groupedServices.groups.length === 0" class="tw:text-center tw:py-8">
      <q-icon name="search_off" size="3rem" color="grey-5" class="tw:mb-4" />
      <div class="text-body1">{{ t("settings.correlation.noServicesYet") }}</div>
      <div class="text-body2 text-grey-6 tw:mt-2">
        {{ t("settings.correlation.noServicesDescription") }}
      </div>
      <q-btn
        data-test="refresh-discovered-services-btn"
        class="text-bold o2-secondary-button tw:h-[28px] tw:w-[32px] tw:min-w-[32px]!"
        :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
        flat
        :label="t('common.refresh')"
        @click="loadServices"
        :loading="loading"
      />
    </div>

    <!-- Services List -->
    <div v-else>
      <!-- Compact Summary & Suggestions Banner -->
      <div class="tw:flex tw:items-center tw:justify-between tw:mb-4 tw:p-3 tw:rounded-lg tw:bg-grey-2 dark:tw:bg-grey-9">
        <!-- Stats (compact inline) -->
        <div class="tw:flex tw:items-center tw:gap-6">
          <div class="tw:flex tw:items-center tw:gap-2">
            <q-icon name="hub" size="1.25rem" color="primary" />
            <span class="tw:font-semibold text-primary">{{ groupedServices.total_fqns }}</span>
            <span class="text-caption">{{ t("settings.correlation.fqns") }}</span>
          </div>
          <div class="tw:flex tw:items-center tw:gap-2">
            <q-icon name="miscellaneous_services" size="1.25rem" color="primary" />
            <span class="tw:font-semibold text-primary">{{ groupedServices.total_services }}</span>
            <span class="text-caption">{{ t("settings.correlation.services") }}</span>
          </div>
          <div class="tw:flex tw:items-center tw:gap-2">
            <q-icon
              :name="fullCorrelationCount > 0 ? 'check_circle' : 'warning'"
              size="1.25rem"
              :color="fullCorrelationCount > 0 ? 'positive' : 'warning'"
            />
            <span class="tw:font-semibold" :class="fullCorrelationCount > 0 ? 'text-positive' : 'text-warning'">
              {{ fullCorrelationCount }}
            </span>
            <span class="text-caption">{{ t("settings.correlation.fullyCorrelated") }}</span>
          </div>
        </div>

        <!-- Correlation Suggestions -->
        <div v-if="correlationSuggestions.length > 0" class="tw:flex tw:items-center tw:gap-2">
          <q-btn
            flat
            dense
            color="orange"
            :label="`${correlationSuggestions.length} ${t('settings.correlation.suggestions')}`"
            icon="lightbulb"
            @click="showSuggestionsDialog = true"
          >
            <q-tooltip>{{ t("settings.correlation.clickToViewSuggestions") }}</q-tooltip>
          </q-btn>
          <q-btn
            data-test="refresh-discovered-services-btn"
            class="text-bold o2-secondary-button tw:h-[28px] tw:w-[32px] tw:min-w-[32px]!"
            :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
            flat
            :label="t('common.refresh')"
            @click="loadServices"
            :loading="loading"
          />
        </div>
      </div>

      <!-- View Mode & Filter -->
      <div class="tw:flex tw:gap-4 tw:mb-4 tw:items-center">
        <q-btn-toggle
          v-model="viewMode"
          toggle-color="primary"
          :options="viewModeOptions"
          dense
          unelevated
          class="tw:border tw:rounded"
        />
        <q-input
          v-model="searchQuery"
          dense
          filled
          :placeholder="getSearchPlaceholder"
          class="tw:flex-1"
          clearable
        >
          <template #prepend>
            <q-icon name="search" />
          </template>
        </q-input>
        <q-select
          v-model="filterStatus"
          dense
          filled
          :options="filterOptions"
          emit-value
          map-options
          class="tw:w-48"
        />
      </div>

      <!-- View: By FQN (default) - Compact table view -->
      <div class="app-table-container" v-if="viewMode === 'fqn'">
        <q-table
          
          :rows="filteredGroups"
          :columns="fqnViewColumns"
          row-key="fqn"
          flat
          dense
          class="tw:rounded-lg tw:border"
          :pagination="{ rowsPerPage: 20 }"
        >
          <template #body-cell-status="props">
            <q-td :props="props">
              <q-icon
                :name="props.row.stream_summary.has_full_correlation ? 'check_circle' : 'warning'"
                :color="props.row.stream_summary.has_full_correlation ? 'positive' : 'warning'"
                size="1.25rem"
              />
            </q-td>
          </template>
          <template #body-cell-fqn="props">
            <q-td :props="props">
              <span>{{ props.row.fqn }}</span>
            </q-td>
          </template>
          <template #body-cell-correlation_key="props">
            <q-td :props="props">
              <div class="tw:flex tw:flex-col tw:gap-1">
                <div class="tw:flex tw:items-center tw:gap-2">
                  <q-chip
                    size="12px"
                    :color="getDerivedFromColor(getCorrelationSource(props.row))"
                    text-color="white"
                    dense
                  >
                    {{ formatDerivedFrom(getCorrelationSource(props.row)) }}
                  </q-chip>
                  <span>
                    {{ getCorrelationDimensionValue(props.row) }}
                  </span>
                </div>
              </div>
            </q-td>
          </template>
          <template #body-cell-services="props">
            <q-td :props="props">
              <q-btn
                flat
                dense
                size="13px"
                :label="`${props.row.services.length} ${t('settings.correlation.services').toLowerCase()}`"
                @click="showServicesDialog(props.row)"
              >
                <q-tooltip>{{ t("settings.correlation.viewServices") }}</q-tooltip>
              </q-btn>
            </q-td>
          </template>
          <template #body-cell-telemetry="props">
            <q-td :props="props">
              <div class="tw:flex tw:gap-1">
                <q-badge
                  v-if="props.row.stream_summary.logs_count > 0"
                  color="blue"
                  text-color="white"
                >
                  {{ props.row.stream_summary.logs_count }} {{ t("settings.correlation.logs") }}
                </q-badge>
                <q-badge
                  v-else
                  color="grey-8"
                  text-color="grey-1"
                >
                  0 {{ t("settings.correlation.logs") }}
                </q-badge>
                <q-badge
                  v-if="props.row.stream_summary.traces_count > 0"
                  color="orange"
                  text-color="white"
                >
                  {{ props.row.stream_summary.traces_count }} {{ t("settings.correlation.traces") }}
                </q-badge>
                <q-badge
                  v-else
                  color="grey-8"
                  text-color="grey-1"
                >
                  0 {{ t("settings.correlation.traces") }}
                </q-badge>
                <q-badge
                  v-if="props.row.stream_summary.metrics_count > 0"
                  color="green"
                  text-color="white"
                >
                  {{ props.row.stream_summary.metrics_count }} {{ t("settings.correlation.metrics") }}
                </q-badge>
                <q-badge
                  v-else
                  color="grey-8"
                  text-color="grey-1"
                >
                  0 {{ t("settings.correlation.metrics") }}
                </q-badge>
              </div>
            </q-td>
          </template>
        </q-table>
      </div>

      <!-- View: By Service Name -->
      <div class="app-table-container" v-else-if="viewMode === 'service'">
        <q-table
          :rows="filteredServicesList"
          :columns="serviceNameViewColumns"
          row-key="uniqueKey"
          flat
          dense
          class="tw:rounded-lg tw:border"
          :pagination="{ rowsPerPage: 20 }"
        >
          <template #body-cell-service_name="props">
            <q-td :props="props">
              <span>{{ props.row.service_name }}</span>
            </q-td>
          </template>
          <template #body-cell-fqn="props">
            <q-td :props="props">
              <span>{{ props.row.fqn }}</span>
            </q-td>
          </template>
          <template #body-cell-stream_types="props">
            <q-td :props="props">
              <div class="tw:flex tw:gap-1">
                <q-badge
                  v-if="props.row.streams.logs?.length"
                  color="blue"
                  text-color="white"
                >
                  {{ props.row.streams.logs.length }} {{ t("settings.correlation.logs") }}
                </q-badge>
                <q-badge
                  v-if="props.row.streams.traces?.length"
                  color="orange"
                  text-color="white"
                >
                  {{ props.row.streams.traces.length }} {{ t("settings.correlation.traces") }}
                </q-badge>
                <q-badge
                  v-if="props.row.streams.metrics?.length"
                  color="green"
                  text-color="white"
                >
                  {{ props.row.streams.metrics.length }} {{ t("settings.correlation.metrics") }}
                </q-badge>
              </div>
            </q-td>
          </template>
          <template #body-cell-derived_from="props">
            <q-td :props="props">
              <q-chip
                size="sm"
                :color="getDerivedFromColor(props.row.derived_from)"
                text-color="white"
                dense
              >
                {{ formatDerivedFrom(props.row.derived_from) }}
              </q-chip>
            </q-td>
          </template>
          <template #body-cell-actions="props">
            <q-td :props="props">
              <q-btn
                flat
                dense
                size="sm"
                icon="visibility"
                @click="showDimensionsDialog(props.row)"
              >
                <q-tooltip>{{ t("settings.correlation.viewDimensions") }}</q-tooltip>
              </q-btn>
            </q-td>
          </template>
        </q-table>
      </div>

      <!-- View: By Stream -->
      <div v-else-if="viewMode === 'stream'">
        <!-- Loading state for view switch -->
        <div v-if="viewModeLoading" class="tw:flex tw:justify-center tw:items-center tw:py-12 tw:rounded-lg tw:border">
          <div class="tw:flex tw:flex-col tw:items-center tw:gap-2">
            <q-spinner-hourglass color="primary" size="30px" />
            <div class="text-body2">Loading stream view...</div>
          </div>
        </div>

        <q-list v-else separator class="tw:rounded-lg tw:border">
          <template v-for="(streamType) in ['logs', 'traces', 'metrics']" :key="streamType">
          <q-expansion-item
            v-if="paginatedStreamGroups[streamType].totalStreams > 0"
            default-opened
            class="stream-type-section"
          >
            <template #header>
              <q-item-section class="tw:pl-4 tw:py-3">
                <q-item-label class="tw:capitalize" style="font-weight: 700; font-size: 1rem;">
                  {{ streamType }} ({{ paginatedStreamGroups[streamType].totalStreams }} stream{{ paginatedStreamGroups[streamType].totalStreams !== 1 ? 's' : '' }})
                </q-item-label>
              </q-item-section>
              <q-item-section side class="tw:flex tw:flex-row tw:items-center tw:gap-3">
                <q-pagination
                  v-if="paginatedStreamGroups[streamType].totalPages > 1"
                  v-model="streamPagination[streamType].page"
                  :max="paginatedStreamGroups[streamType].totalPages"
                  :max-pages="3"
                  direction-links
                  boundary-links
                  size="sm"
                  @update:model-value="(newPage) => onStreamPageChange(streamType as 'logs' | 'traces' | 'metrics', newPage)"
                  @click.stop
                />
              </q-item-section>
              <q-item-section side class="tw:flex tw:flex-row tw:items-center tw:gap-3">
                <q-badge
                  :color="getStreamTypeColor(streamType as string)"
                  text-color="white"
                  class="tw:position-relative tw:top-[-3px]"
                >
                  {{ Object.values(filteredStreamGroups[streamType]).flat().length }} services
                </q-badge>
              </q-item-section>
            </template>

            <!-- Streams within type -->
            <q-list class="tw:ml-8">
              <!-- Loading indicator -->
              <div v-if="paginationLoading[streamType]" class="tw:flex tw:justify-center tw:py-4">
                <q-spinner-hourglass color="primary" size="30px" />
              </div>

              <q-expansion-item
                v-else
                v-for="(services, streamName) in paginatedStreamGroups[streamType].streams"
                :key="`${streamType}-${streamName}-${streamPagination[streamType].page}`"
                dense
              >
                <template #header>
                  <q-item-section avatar>
                    <q-icon name="storage" size="1.25rem" color="grey-6" />
                  </q-item-section>
                  <q-item-section>
                    <q-item-label>{{ streamName }}</q-item-label>
                    <q-item-label caption>{{ services.length }} service(s)</q-item-label>
                  </q-item-section>
                </template>

                <!-- Services for this stream -->
                <q-list dense class="tw:ml-8">
                  <q-item v-for="svc in services" :key="svc.uniqueKey" dense>
                    <q-item-section avatar>
                      <q-icon name="miscellaneous_services" size="1rem" color="grey-5" />
                    </q-item-section>
                    <q-item-section>
                      <q-item-label>{{ svc.service_name }}</q-item-label>
                      <q-item-label caption>FQN: {{ svc.fqn }}</q-item-label>
                    </q-item-section>
                    <q-item-section side>
                      <q-chip
                        size="sm"
                        :color="getDerivedFromColor(svc.derived_from)"
                        text-color="white"
                        dense
                      >
                        {{ formatDerivedFrom(svc.derived_from) }}
                      </q-chip>
                    </q-item-section>
                  </q-item>
                </q-list>
              </q-expansion-item>
            </q-list>
          </q-expansion-item>
        </template>
        </q-list>
      </div>

      <!-- Dimensions Dialog -->
      <q-dialog v-model="dimensionsDialog">
        <q-card class="dimensions-dialog-card">
          <q-card-section class="row items-center">
            <div class="text-h6">{{ t("settings.correlation.dimensionsFor") }} {{ selectedService?.service_name }}</div>
            <q-space />
            <q-btn icon="close" flat round dense v-close-popup />
          </q-card-section>
          <q-separator />
          <q-card-section class="tw:max-h-96 tw:overflow-auto">
            <q-list dense separator>
              <q-item v-for="(value, key) in selectedService?.dimensions" :key="key">
                <q-item-section>
                  <q-item-label class="tw:font-mono tw:text-sm">{{ key }}</q-item-label>
                </q-item-section>
                <q-item-section side>
                  <q-item-label class="tw:font-mono tw:text-sm text-grey-7">{{ value }}</q-item-label>
                </q-item-section>
              </q-item>
            </q-list>
          </q-card-section>
        </q-card>
      </q-dialog>

      <!-- Services in FQN Group Dialog -->
      <q-dialog v-model="servicesDialog">
        <q-card class="services-dialog-card">
          <q-card-section class="row items-center">
            <div>
              <div class="text-h6">{{ selectedFqnGroup?.fqn }}</div>
              <div class="text-caption text-grey-7">
                {{ selectedFqnGroup?.services.length }} {{ t("settings.correlation.correlatedViaSharedDimensions") }}
              </div>
            </div>
            <q-space />
            <q-btn icon="close" flat round dense v-close-popup />
          </q-card-section>

          <!-- Correlation Dimensions Section -->
          <q-card-section v-if="selectedFqnGroup" class="tw:bg-blue-50 dark:tw:bg-blue-900/20 tw:py-3">
            <div class="tw:flex tw:items-center tw:gap-2 tw:mb-2">
              <q-icon name="link" color="primary" size="1.25rem" />
              <span class="tw:font-semibold text-primary">{{ t("settings.correlation.correlationDimensions") }}</span>
            </div>
            <div class="tw:flex tw:flex-wrap tw:gap-2">
              <q-chip
                v-for="(value, key) in getSharedDimensions(selectedFqnGroup)"
                :key="key"
                size="sm"
                color="primary"
                text-color="white"
                dense
              >
                <span class="tw:font-semibold">{{ key }}:</span>
                <span class="tw:ml-1">{{ value }}</span>
              </q-chip>
            </div>
            <div v-if="Object.keys(getSharedDimensions(selectedFqnGroup)).length === 0" class="text-caption text-grey-7">
              {{ t("settings.correlation.noSharedDimensions") }}
            </div>
          </q-card-section>

          <q-separator />
          <q-card-section class="tw:p-0">
            <q-table
              :rows="selectedFqnGroup?.services || []"
              :columns="serviceColumns"
              row-key="service_name"
              flat
              dense
              hide-pagination
              :pagination="{ rowsPerPage: 0 }"
            >
              <template #body-cell-streams="props">
                <q-td :props="props">
                  <div class="tw:flex tw:gap-1 tw:flex-wrap">
                    <q-badge
                      v-if="props.row.streams.logs?.length"
                      color="blue"
                      text-color="white"
                    >
                      {{ props.row.streams.logs.length }} {{ t("settings.correlation.logs") }}
                    </q-badge>
                    <q-badge
                      v-if="props.row.streams.traces?.length"
                      color="orange"
                      text-color="white"
                    >
                      {{ props.row.streams.traces.length }} {{ t("settings.correlation.traces") }}
                    </q-badge>
                    <q-badge
                      v-if="props.row.streams.metrics?.length"
                      color="green"
                      text-color="white"
                    >
                      {{ props.row.streams.metrics.length }} {{ t("settings.correlation.metrics") }}
                    </q-badge>
                  </div>
                </q-td>
              </template>
              <template #body-cell-derived_from="props">
                <q-td :props="props">
                  <q-chip
                    size="sm"
                    :color="getDerivedFromColor(props.row.derived_from)"
                    text-color="white"
                    dense
                  >
                    {{ formatDerivedFrom(props.row.derived_from) }}
                  </q-chip>
                </q-td>
              </template>
              <template #body-cell-dimensions="props">
                <q-td :props="props">
                  <q-btn
                    flat
                    dense
                    size="sm"
                    icon="visibility"
                    @click="showDimensionsDialog(props.row)"
                  >
                    <q-tooltip>{{ t("settings.correlation.viewDimensions") }}</q-tooltip>
                  </q-btn>
                  <span class="text-caption text-grey-7">
                    {{ Object.keys(props.row.dimensions).length }}
                  </span>
                </q-td>
              </template>
            </q-table>
          </q-card-section>
        </q-card>
      </q-dialog>

      <!-- Correlation Suggestions Dialog -->
      <q-dialog v-model="showSuggestionsDialog">
        <q-card class="suggestions-dialog-card">
          <q-card-section class="row items-center">
            <div>
              <div class="text-h6">{{ t("settings.correlation.suggestionsDialogTitle") }}</div>
              <div class="text-caption text-grey-7">
                {{ t("settings.correlation.suggestionsDialogSubtitle") }}
              </div>
            </div>
            <q-space />
            <q-btn icon="close" flat round dense v-close-popup />
          </q-card-section>
          <q-separator />
          <q-card-section class="tw:max-h-96 tw:overflow-auto">
            <q-list separator>
              <q-item v-for="suggestion in correlationSuggestions" :key="suggestion.fqn">
                <q-item-section avatar>
                  <q-icon name="lightbulb" color="orange" />
                </q-item-section>
                <q-item-section>
                  <q-item-label class="tw:font-semibold">{{ suggestion.fqn }}</q-item-label>
                  <q-item-label caption>
                    <span v-if="suggestion.missingTypes.length > 0">
                      {{ t("settings.correlation.missing") }}:
                      <q-badge
                        v-for="type in suggestion.missingTypes"
                        :key="type"
                        :color="getStreamTypeColor(type)"
                        text-color="white"
                        class="tw:mr-1"
                      >
                        {{ type }}
                      </q-badge>
                    </span>
                  </q-item-label>
                  <q-item-label caption class="tw:mt-1">
                    {{ suggestion.reason }}
                  </q-item-label>
                </q-item-section>
                <q-item-section side>
                  <div class="tw:flex tw:gap-1">
                    <q-badge
                      v-if="suggestion.hasLogs"
                      color="blue"
                      text-color="white"
                    >{{ t("settings.correlation.logs") }}</q-badge>
                    <q-badge
                      v-if="suggestion.hasTraces"
                      color="orange"
                      text-color="white"
                    >{{ t("settings.correlation.traces") }}</q-badge>
                    <q-badge
                      v-if="suggestion.hasMetrics"
                      color="green"
                      text-color="white"
                    >{{ t("settings.correlation.metrics") }}</q-badge>
                  </div>
                </q-item-section>
              </q-item>
            </q-list>
          </q-card-section>
          <q-separator />
          <q-card-section class="tw:bg-grey-2 dark:tw:bg-grey-9">
            <div class="text-caption">
              <q-icon name="info" size="1rem" class="tw:mr-1" />
              {{ t("settings.correlation.suggestionsInfoText") }}
            </div>
          </q-card-section>
        </q-card>
      </q-dialog>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import serviceStreamsService, {
  type GroupedServicesResponse,
  type ServiceFqnGroup,
  type ServiceInGroup,
} from "@/services/service_streams";
import GroupHeader from "@/components/common/GroupHeader.vue";

const { t } = useI18n();

interface FlatService extends ServiceInGroup {
  fqn: string;
  uniqueKey: string;
}

interface StreamGroups {
  logs: Record<string, FlatService[]>;
  traces: Record<string, FlatService[]>;
  metrics: Record<string, FlatService[]>;
}

interface CorrelationSuggestion {
  fqn: string;
  hasLogs: boolean;
  hasTraces: boolean;
  hasMetrics: boolean;
  missingTypes: string[];
  reason: string;
}

const store = useStore();

const loading = ref(true);
const error = ref<string | null>(null);
const groupedServices = ref<GroupedServicesResponse>({
  groups: [],
  total_fqns: 0,
  total_services: 0,
});

const searchQuery = ref("");
const filterStatus = ref("all");
const viewMode = ref<"fqn" | "service" | "stream">("fqn");
const viewModeLoading = ref(false);
const dimensionsDialog = ref(false);
const servicesDialog = ref(false);
const showSuggestionsDialog = ref(false);
const selectedService = ref<ServiceInGroup | FlatService | null>(null);
const selectedFqnGroup = ref<ServiceFqnGroup | null>(null);

// Pagination state for stream view
const streamPagination = ref({
  logs: { page: 1, rowsPerPage: 10 },
  traces: { page: 1, rowsPerPage: 10 },
  metrics: { page: 1, rowsPerPage: 10 },
});

// Loading state for pagination
const paginationLoading = ref({
  logs: false,
  traces: false,
  metrics: false,
});

const viewModeOptions = computed(() => [
  { label: t("settings.correlation.byFqn"), value: "fqn", icon: "hub" },
  { label: t("settings.correlation.byService"), value: "service", icon: "miscellaneous_services" },
  { label: t("settings.correlation.byStream"), value: "stream", icon: "storage" },
]);

const filterOptions = computed(() => [
  { label: t("settings.correlation.allServices"), value: "all" },
  { label: t("settings.correlation.fullyCorrelated"), value: "full" },
  { label: t("settings.correlation.missingTelemetry"), value: "partial" },
]);

const getSearchPlaceholder = computed(() => {
  switch (viewMode.value) {
    case "fqn":
      return t("settings.correlation.searchFqnOrService");
    case "service":
      return t("settings.correlation.searchServiceName");
    case "stream":
      return t("settings.correlation.searchStreamName");
    default:
      return t("common.search");
  }
});

const fqnViewColumns = computed(() => [
  {
    name: "status",
    label: "",
    field: "stream_summary",
    align: "center" as const,
    style: "width: 2.5rem",
  },
  {
    name: "fqn",
    label: t("settings.correlation.fqn"),
    field: "fqn",
    align: "left" as const,
    sortable: true,
  },
  {
    name: "correlation_key",
    label: t("settings.correlation.correlationKey"),
    field: "services",
    align: "left" as const,
  },
  {
    name: "services",
    label: t("settings.correlation.services"),
    field: "services",
    align: "left" as const,
  },
  {
    name: "telemetry",
    label: t("settings.correlation.telemetryCoverage"),
    field: "stream_summary",
    align: "left" as const,
  },
]);

const serviceColumns = computed(() => [
  {
    name: "service_name",
    label: t("settings.correlation.serviceName"),
    field: "service_name",
    align: "left" as const,
    sortable: true,
  },
  {
    name: "derived_from",
    label: t("settings.correlation.fqnSource"),
    field: "derived_from",
    align: "left" as const,
    sortable: true,
  },
  {
    name: "streams",
    label: t("settings.correlation.streams"),
    field: "streams",
    align: "left" as const,
  },
  {
    name: "dimensions",
    label: t("common.details"),
    field: "dimensions",
    align: "left" as const,
  },
]);

const serviceNameViewColumns = computed(() => [
  {
    name: "service_name",
    label: t("settings.correlation.serviceName"),
    field: "service_name",
    align: "left" as const,
    sortable: true,
  },
  {
    name: "fqn",
    label: t("settings.correlation.fqn"),
    field: "fqn",
    align: "left" as const,
    sortable: true,
  },
  {
    name: "stream_types",
    label: t("settings.correlation.streams"),
    field: "streams",
    align: "left" as const,
  },
  {
    name: "derived_from",
    label: t("settings.correlation.fqnSource"),
    field: "derived_from",
    align: "left" as const,
    sortable: true,
  },
  {
    name: "actions",
    label: "",
    field: "actions",
    align: "right" as const,
  },
]);

const fullCorrelationCount = computed(() => {
  return groupedServices.value.groups.filter(
    (g) => g.stream_summary.has_full_correlation
  ).length;
});

// Compute correlation suggestions - services that have some telemetry but not all three types
const correlationSuggestions = computed((): CorrelationSuggestion[] => {
  const suggestions: CorrelationSuggestion[] = [];

  for (const group of groupedServices.value.groups) {
    const summary = group.stream_summary;

    // Skip already fully correlated
    if (summary.has_full_correlation) continue;

    const hasLogs = summary.logs_count > 0;
    const hasTraces = summary.traces_count > 0;
    const hasMetrics = summary.metrics_count > 0;

    // Only suggest if they have at least 2 types (close to full correlation)
    const typeCount = [hasLogs, hasTraces, hasMetrics].filter(Boolean).length;
    if (typeCount < 2) continue;

    const missingTypes: string[] = [];
    if (!hasLogs) missingTypes.push("logs");
    if (!hasTraces) missingTypes.push("traces");
    if (!hasMetrics) missingTypes.push("metrics");

    let reason = "";
    if (hasLogs && hasMetrics && !hasTraces) {
      reason = t("settings.correlation.addTracingSuggestion");
    } else if (hasTraces && hasMetrics && !hasLogs) {
      reason = t("settings.correlation.addLogsSuggestion");
    } else if (hasLogs && hasTraces && !hasMetrics) {
      reason = t("settings.correlation.addMetricsSuggestion");
    }

    suggestions.push({
      fqn: group.fqn,
      hasLogs,
      hasTraces,
      hasMetrics,
      missingTypes,
      reason,
    });
  }

  // Sort by number of existing types (descending) - closest to full correlation first
  return suggestions.sort((a, b) => {
    const aCount = [a.hasLogs, a.hasTraces, a.hasMetrics].filter(Boolean).length;
    const bCount = [b.hasLogs, b.hasTraces, b.hasMetrics].filter(Boolean).length;
    return bCount - aCount;
  });
});

const filteredGroups = computed(() => {
  let groups = groupedServices.value.groups;

  // Filter by status
  if (filterStatus.value === "full") {
    groups = groups.filter((g) => g.stream_summary.has_full_correlation);
  } else if (filterStatus.value === "partial") {
    groups = groups.filter((g) => !g.stream_summary.has_full_correlation);
  }

  // Filter by search query
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    groups = groups.filter(
      (g) =>
        g.fqn.toLowerCase().includes(query) ||
        g.services.some((s) => s.service_name.toLowerCase().includes(query))
    );
  }

  return groups;
});

// Flat list of all services for "By Service Name" view
const flatServicesList = computed((): FlatService[] => {
  const services: FlatService[] = [];
  for (const group of groupedServices.value.groups) {
    for (const svc of group.services) {
      services.push({
        ...svc,
        fqn: group.fqn,
        uniqueKey: `${group.fqn}::${svc.service_name}`,
      });
    }
  }
  return services.sort((a, b) => a.service_name.localeCompare(b.service_name));
});

// Filtered flat services list
const filteredServicesList = computed((): FlatService[] => {
  let services = flatServicesList.value;

  // Filter by status (based on parent FQN group)
  if (filterStatus.value !== "all") {
    const fqnStatus = new Map<string, boolean>();
    for (const group of groupedServices.value.groups) {
      fqnStatus.set(group.fqn, group.stream_summary.has_full_correlation);
    }

    if (filterStatus.value === "full") {
      services = services.filter((s) => fqnStatus.get(s.fqn) === true);
    } else if (filterStatus.value === "partial") {
      services = services.filter((s) => fqnStatus.get(s.fqn) === false);
    }
  }

  // Filter by search query
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    services = services.filter(
      (s) =>
        s.service_name.toLowerCase().includes(query) ||
        s.fqn.toLowerCase().includes(query)
    );
  }

  return services;
});

// Services grouped by stream type and name for "By Stream" view
const streamGroups = computed((): StreamGroups => {
  const groups: StreamGroups = {
    logs: {},
    traces: {},
    metrics: {},
  };

  for (const svc of flatServicesList.value) {
    // Add to logs
    for (const stream of svc.streams.logs || []) {
      if (!groups.logs[stream]) {
        groups.logs[stream] = [];
      }
      groups.logs[stream].push(svc);
    }

    // Add to traces
    for (const stream of svc.streams.traces || []) {
      if (!groups.traces[stream]) {
        groups.traces[stream] = [];
      }
      groups.traces[stream].push(svc);
    }

    // Add to metrics
    for (const stream of svc.streams.metrics || []) {
      if (!groups.metrics[stream]) {
        groups.metrics[stream] = [];
      }
      groups.metrics[stream].push(svc);
    }
  }

  return groups;
});

// Filtered stream groups
const filteredStreamGroups = computed((): StreamGroups => {
  const groups = streamGroups.value;

  if (!searchQuery.value) {
    return groups;
  }

  const query = searchQuery.value.toLowerCase();
  const filtered: StreamGroups = {
    logs: {},
    traces: {},
    metrics: {},
  };

  // Filter logs
  for (const [streamName, services] of Object.entries(groups.logs)) {
    if (
      streamName.toLowerCase().includes(query) ||
      services.some((s) => s.service_name.toLowerCase().includes(query))
    ) {
      filtered.logs[streamName] = services;
    }
  }

  // Filter traces
  for (const [streamName, services] of Object.entries(groups.traces)) {
    if (
      streamName.toLowerCase().includes(query) ||
      services.some((s) => s.service_name.toLowerCase().includes(query))
    ) {
      filtered.traces[streamName] = services;
    }
  }

  // Filter metrics
  for (const [streamName, services] of Object.entries(groups.metrics)) {
    if (
      streamName.toLowerCase().includes(query) ||
      services.some((s) => s.service_name.toLowerCase().includes(query))
    ) {
      filtered.metrics[streamName] = services;
    }
  }

  return filtered;
});

// Reset pagination when search query changes
const resetStreamPagination = () => {
  streamPagination.value.logs.page = 1;
  streamPagination.value.traces.page = 1;
  streamPagination.value.metrics.page = 1;
};

// Watch for search query changes to reset pagination
watch(searchQuery, () => {
  resetStreamPagination();
});

// Watch for view mode changes to show loading state
watch(viewMode, async (newMode, oldMode) => {
  if (newMode === 'stream' && oldMode !== 'stream') {
    viewModeLoading.value = true;

    // Use requestAnimationFrame twice to ensure spinner animates
    // First frame: render the spinner
    await new Promise(resolve => requestAnimationFrame(resolve));
    // Second frame: allow spinner animation to start
    await new Promise(resolve => requestAnimationFrame(resolve));

    // Use setTimeout to defer heavy computation
    await new Promise(resolve => setTimeout(resolve, 50));

    viewModeLoading.value = false;
  } else {
    viewModeLoading.value = false;
  }
});

// Helper function to paginate a stream type
const getPaginatedStreamType = (streamType: 'logs' | 'traces' | 'metrics') => {
  const streamGroup = filteredStreamGroups.value[streamType];
  const streamNames = Object.keys(streamGroup);
  const pagination = streamPagination.value[streamType];

  // Calculate pagination
  const totalStreams = streamNames.length;
  const totalPages = Math.ceil(totalStreams / pagination.rowsPerPage);
  const startIndex = (pagination.page - 1) * pagination.rowsPerPage;
  const endIndex = startIndex + pagination.rowsPerPage;

  // Get paginated stream names
  const paginatedStreamNames = streamNames.slice(startIndex, endIndex);

  // Build paginated streams object
  const paginatedStreams: Record<string, FlatService[]> = {};
  for (const streamName of paginatedStreamNames) {
    paginatedStreams[streamName] = streamGroup[streamName];
  }

  return {
    streams: paginatedStreams,
    totalStreams,
    totalPages,
  };
};

// Separate computed properties for each stream type for better performance
const paginatedLogs = computed(() => getPaginatedStreamType('logs'));
const paginatedTraces = computed(() => getPaginatedStreamType('traces'));
const paginatedMetrics = computed(() => getPaginatedStreamType('metrics'));

// Combined object for template access
const paginatedStreamGroups = computed(() => ({
  logs: paginatedLogs.value,
  traces: paginatedTraces.value,
  metrics: paginatedMetrics.value,
}));

// Pagination handlers
const onStreamPageChange = async (streamType: 'logs' | 'traces' | 'metrics', newPage: number) => {
  paginationLoading.value[streamType] = true;

  // Use requestAnimationFrame for smoother UI updates
  requestAnimationFrame(() => {
    streamPagination.value[streamType].page = newPage;

    // Reset loading after next tick
    nextTick(() => {
      paginationLoading.value[streamType] = false;
    });
  });
};

const loadServices = async () => {
  loading.value = true;
  error.value = null;

  try {
    const orgId = store.state.selectedOrganization?.identifier;
    if (!orgId) {
      throw new Error("No organization selected");
    }

    const response = await serviceStreamsService.getGroupedServices(orgId);
    groupedServices.value = response.data;
  } catch (err: any) {
    console.error("Failed to load grouped services:", err);
    error.value = err?.message || "Failed to load services";
  } finally {
    loading.value = false;
  }
};

const getGroupHeaderClass = (group: ServiceFqnGroup) => {
  if (!group.stream_summary.has_full_correlation) {
    return "bg-warning-1";
  }
  return "";
};

const getDerivedFromColor = (derivedFrom: string) => {
  switch (derivedFrom) {
    case "k8s-deployment":
      return "blue";
    case "k8s-statefulset":
      return "purple";
    case "k8s-daemonset":
      return "teal";
    case "aws-ecs-task":
      return "orange";
    case "faas-name":
      return "pink";
    default:
      return "grey";
  }
};

const formatDerivedFrom = (derivedFrom: string) => {
  switch (derivedFrom) {
    case "k8s-deployment":
      return t("settings.correlation.deployment");
    case "k8s-statefulset":
      return t("settings.correlation.statefulSet");
    case "k8s-daemonset":
      return t("settings.correlation.daemonSet");
    case "aws-ecs-task":
      return t("settings.correlation.ecsTask");
    case "faas-name":
      return t("settings.correlation.faas");
    case "service":
      return t("settings.correlation.service");
    default:
      return derivedFrom;
  }
};

const getStreamTypeColor = (streamType: string) => {
  switch (streamType) {
    case "logs":
      return "blue";
    case "traces":
      return "orange";
    case "metrics":
      return "green";
    default:
      return "grey";
  }
};

const showDimensionsDialog = (service: ServiceInGroup | FlatService) => {
  selectedService.value = service;
  dimensionsDialog.value = true;
};

const showServicesDialog = (group: ServiceFqnGroup) => {
  selectedFqnGroup.value = group;
  servicesDialog.value = true;
};

// Get the correlation source (derived_from) from the first service in the group
const getCorrelationSource = (group: ServiceFqnGroup): string => {
  if (group.services.length > 0) {
    return group.services[0].derived_from;
  }
  return "service";
};

// Get the correlation dimension value that ties services together
const getCorrelationDimensionValue = (group: ServiceFqnGroup): string => {
  if (group.services.length === 0) return "";

  const service = group.services[0];
  const derivedFrom = service.derived_from;

  // Map derived_from to the actual dimension key
  const dimensionKey = derivedFrom; // e.g., "k8s-deployment", "k8s-statefulset"

  if (service.dimensions[dimensionKey]) {
    return service.dimensions[dimensionKey];
  }

  // Fallback: return service-fqn if available
  if (service.dimensions["service-fqn"]) {
    return service.dimensions["service-fqn"];
  }

  return group.fqn;
};

// Get shared dimensions across all services in a group
const getSharedDimensions = (group: ServiceFqnGroup): Record<string, string> => {
  if (group.services.length === 0) return {};
  if (group.services.length === 1) return group.services[0].dimensions;

  // Find dimensions that have the same value across all services
  const firstService = group.services[0];
  const shared: Record<string, string> = {};

  for (const [key, value] of Object.entries(firstService.dimensions)) {
    const isShared = group.services.every(
      (s) => s.dimensions[key] === value
    );
    if (isShared) {
      shared[key] = value;
    }
  }

  return shared;
};

onMounted(() => {
  loadServices();
});
</script>

<style scoped lang="scss">
.discovered-services {
  // Match parent card-container background
  background: var(--o2-card-bg);
}

.bg-warning-1 {
  background-color: rgba(255, 193, 7, 0.1);
}

:deep(.q-expansion-item__container) {
  border-bottom: 0.0625rem solid rgba(0, 0, 0, 0.12);
}

:deep(.q-table th) {
  font-weight: 600;
}

.dimensions-dialog-card {
  min-width: 31.25rem;
}

.services-dialog-card {
  min-width: 43.75rem;
  max-width: 56.25rem;
}

.suggestions-dialog-card {
  min-width: 43.75rem;
  max-width: 56.25rem;
}

.stream-type-section {
  :deep(.q-item) {
    border-bottom: 1px solid rgba(0, 0, 0, 0.12);
    background-color: #f5f5f5;
  }
}

body.body--dark .stream-type-section {
  :deep(.q-item) {
    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
    background-color: rgba(255, 255, 255, 0.05);
  }
}
</style>
