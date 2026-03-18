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
    <div v-else-if="services.length === 0" class="tw:text-center tw:py-8">
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
        @click="loadServices(true)"
        :loading="refreshing"
      />
    </div>

    <!-- Services List -->
    <div v-else>
      <!-- Summary Banner -->
      <div class="tw:flex tw:items-center tw:justify-between tw:mb-4 tw:p-3 tw:rounded-lg tw:bg-grey-2 dark:tw:bg-grey-9">
        <div class="tw:flex tw:items-center tw:gap-6">
          <div class="tw:flex tw:items-center tw:gap-2">
            <q-icon name="miscellaneous_services" size="1.25rem" color="primary" />
            <span class="tw:font-semibold text-primary">{{ services.length }}</span>
            <span class="text-caption">{{ t("settings.correlation.services") }}</span>
          </div>
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

      <!-- Search -->
      <div class="tw:flex tw:gap-4 tw:mb-4 tw:items-center">
        <q-input
          v-model="searchQuery"
          dense
          filled
          :placeholder="t('settings.correlation.searchServiceName')"
          class="tw:flex-1"
          clearable
        >
          <template #prepend>
            <q-icon name="search" />
          </template>
        </q-input>
      </div>

      <!-- Services Table -->
      <div class="app-table-container">
        <q-table
          :rows="filteredServices"
          :columns="columns"
          row-key="id"
          flat
          dense
          class="tw:rounded-lg tw:border"
          v-model:pagination="pagination"
        >
          <template #body-cell-service_name="props">
            <q-td :props="props">
              <div class="tw:flex tw:flex-col tw:gap-1">
                <span class="tw:font-medium">{{ props.row.service_name }}</span>
                <div v-if="Object.keys(props.row.disambiguation).length > 0" class="tw:flex tw:flex-wrap tw:gap-1">
                  <q-chip
                    v-for="(value, key) in props.row.disambiguation"
                    :key="key"
                    size="10px"
                    color="grey-4"
                    text-color="grey-9"
                    dense
                    class="tw:font-mono"
                  >
                    {{ key }}: {{ value }}
                  </q-chip>
                </div>
              </div>
            </q-td>
          </template>

          <template #body-cell-telemetry="props">
            <q-td :props="props">
              <div class="tw:flex tw:gap-1 tw:flex-wrap tw:items-center">
                <q-badge :color="props.row.logs_streams.length > 0 ? 'blue' : 'grey-8'"
                  :text-color="props.row.logs_streams.length > 0 ? 'white' : 'grey-1'">
                  {{ props.row.logs_streams.length }} {{ t("settings.correlation.logs") }}
                </q-badge>
                <q-badge :color="props.row.traces_streams.length > 0 ? 'orange' : 'grey-8'"
                  :text-color="props.row.traces_streams.length > 0 ? 'white' : 'grey-1'">
                  {{ props.row.traces_streams.length }} {{ t("settings.correlation.traces") }}
                </q-badge>
                <q-badge :color="props.row.metrics_streams.length > 0 ? 'green' : 'grey-8'"
                  :text-color="props.row.metrics_streams.length > 0 ? 'white' : 'grey-1'">
                  {{ props.row.metrics_streams.length }} {{ t("settings.correlation.metrics") }}
                </q-badge>

                <!-- Single ⓘ opens detail modal -->
                <q-btn
                  flat round dense unelevated
                  icon="info_outline"
                  size="9px"
                  color="grey-6"
                  class="tw:ml-0.5"
                  data-test="telemetry-detail-btn"
                  @click.stop="openStreamDetail(props.row)"
                />
              </div>
            </q-td>
          </template>

          <template #body-cell-last_seen="props">
            <q-td :props="props">
              <span class="tw:text-sm text-grey-7">{{ formatRelativeTime(props.row.last_seen) }}</span>
            </q-td>
          </template>
        </q-table>
      </div>
    </div>
  </div>

  <!-- Stream detail modal -->
  <q-dialog v-model="streamDetailDialog">
    <q-card style="min-width: 360px; max-width: 520px" class="tw:rounded-xl">
      <q-card-section class="tw:flex tw:items-center tw:justify-between tw:pb-2">
        <div>
          <div class="text-h6">{{ selectedService?.service_name }}</div>
          <div v-if="selectedService && Object.keys(selectedService.disambiguation).length > 0"
            class="tw:flex tw:flex-wrap tw:gap-1 tw:mt-1">
            <q-chip
              v-for="(val, key) in selectedService.disambiguation"
              :key="key"
              size="10px" dense color="grey-4" text-color="grey-9"
              class="tw:font-mono">
              {{ key }}: {{ val }}
            </q-chip>
          </div>
        </div>
        <q-btn flat round dense icon="close" v-close-popup />
      </q-card-section>

      <q-separator />

      <q-card-section class="tw:flex tw:flex-col tw:gap-4 tw:pt-4">
        <template v-for="[label, streams, color] in [
          [t('settings.correlation.logStreams'), selectedService?.logs_streams ?? [], 'blue'],
          [t('settings.correlation.traceStreams'), selectedService?.traces_streams ?? [], 'orange'],
          [t('settings.correlation.metricStreams'), selectedService?.metrics_streams ?? [], 'green'],
        ]" :key="label">
          <div v-if="streams.length > 0">
            <div class="tw:flex tw:items-center tw:gap-2 tw:mb-2">
              <q-badge :color="color">{{ streams.length }}</q-badge>
              <span class="tw:font-semibold tw:text-sm">{{ label }}</span>
            </div>
            <div class="tw:flex tw:flex-col tw:gap-0.5 tw:pl-2 tw:border-l-2"
              :class="color === 'blue' ? 'tw:border-blue-400' : color === 'orange' ? 'tw:border-orange-400' : 'tw:border-green-400'">
              <span v-for="s in streams" :key="s" class="tw:font-mono tw:text-sm">{{ s }}</span>
            </div>
          </div>
        </template>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import serviceStreamsService from "@/services/service_streams";
import GroupHeader from "@/components/common/GroupHeader.vue";

const { t } = useI18n();

interface ServiceRecord {
  id: string;
  org_id: string;
  service_name: string;
  disambiguation: Record<string, string>;
  logs_streams: string[];
  traces_streams: string[];
  metrics_streams: string[];
  last_seen: number; // microseconds epoch
}

const store = useStore();

const loading = ref(true);   // true only on initial mount (shows spinner, hides table)
const refreshing = ref(false); // true on manual refresh (keeps table visible)
const error = ref<string | null>(null);
const services = ref<ServiceRecord[]>([]);
const searchQuery = ref("");
const streamDetailDialog = ref(false);
const selectedService = ref<ServiceRecord | null>(null);

function openStreamDetail(row: ServiceRecord) {
  selectedService.value = row;
  streamDetailDialog.value = true;
}

function unique(arr: string[]): string[] {
  return [...new Set(arr)];
}

const pagination = ref({
  page: 1,
  rowsPerPage: 20,
});

const columns = computed(() => [
  {
    name: "service_name",
    label: t("settings.correlation.serviceName"),
    field: "service_name",
    align: "left" as const,
    sortable: true,
  },
  {
    name: "telemetry",
    label: t("settings.correlation.telemetryCoverage"),
    field: "logs_streams",
    align: "left" as const,
  },
  {
    name: "last_seen",
    label: t("settings.correlation.lastSeen"),
    field: "last_seen",
    align: "left" as const,
    sortable: true,
  },
]);

const filteredServices = computed((): ServiceRecord[] => {
  if (!searchQuery.value) {
    return services.value;
  }
  const query = searchQuery.value.toLowerCase();
  return services.value.filter((s) =>
    s.service_name.toLowerCase().includes(query)
  );
});

const formatRelativeTime = (microseconds: number): string => {
  if (!microseconds) return "—";
  const nowMs = Date.now();
  const thenMs = microseconds / 1000;
  const diffSeconds = Math.floor((nowMs - thenMs) / 1000);

  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes !== 1 ? "s" : ""} ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
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
    // Deduplicate stream lists — backend compacts on next write but old rows may still have dupes
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

onMounted(() => {
  loadServices();
});
</script>

<style scoped lang="scss">
.discovered-services {
  // Match parent card-container background
  background: var(--o2-card-bg);
}

:deep(.q-table th) {
  font-weight: 600;
}
</style>
