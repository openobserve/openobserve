// Copyright 2026 OpenObserve Inc.
<template>
  <OPageLayout
    :title="detail?.label || t('synthetics.privateLocations.detail.title')"
    icon="location-on"
    :back="{ label: t('synthetics.privateLocations.detail.back'), to: { name: 'synthetics', query: { section: 'private' } } }"
    bleed
  >
      <template #title-trail>
        <OBadge v-if="detail" :variant="statusVariant(detail.status)" :dot="true" size="sm">
          {{ t(`synthetics.privateLocations.status.${detail.status}`) }}
        </OBadge>
      </template>
      <template #actions>
        <OButton
          variant="outline"
          size="sm"
          icon-left="content-copy"
          :disabled="!detail"
          data-test="synthetics-private-location-detail-setup-btn"
          @click="openSetup"
        >
          {{ t("synthetics.privateLocations.copySetupCmd") }}
        </OButton>
        <OButton
          variant="outline"
          size="icon-sm"
          icon-left="refresh"
          :loading="loading"
          :title="t('common.refresh')"
          data-test="synthetics-private-location-detail-refresh-btn"
          @click="load"
        />
      </template>

    <div class="flex-1 min-h-0 overflow-y-auto">
      <div v-if="detail" class="flex flex-col gap-6 p-6">
        <!-- Summary strip -->
        <div class="flex flex-wrap items-center gap-6 rounded-default border border-border-default bg-surface-subtle px-4 py-3 text-sm">
          <div class="flex flex-col">
            <span class="text-xs text-text-muted">{{ t("synthetics.privateLocations.table.agents") }}</span>
            <span class="font-medium">{{ detail.live_agents }}/{{ detail.agents_total }}</span>
          </div>
          <div class="flex flex-col">
            <span class="text-xs text-text-muted">{{ t("synthetics.privateLocations.table.checks") }}</span>
            <span class="font-medium">{{ detail.monitors_count }}</span>
          </div>
          <div class="flex flex-col">
            <span class="text-xs text-text-muted">{{ t("synthetics.privateLocations.table.checksPerMin") }}</span>
            <span class="font-medium">~{{ detail.checks_per_min }}</span>
          </div>
          <div v-if="detail.version" class="flex flex-col">
            <span class="text-xs text-text-muted">{{ t("synthetics.privateLocations.detail.version") }}</span>
            <span class="font-medium">v{{ detail.version }}</span>
          </div>
          <div class="flex flex-col">
            <span class="text-xs text-text-muted">{{ t("synthetics.privateLocations.detail.pool") }}</span>
            <span class="font-mono text-xs">{{ detail.pool }}</span>
          </div>
          <div v-if="detail.last_seen_at" class="flex flex-col">
            <span class="text-xs text-text-muted">{{ t("synthetics.privateLocations.table.lastSeen") }}</span>
            <span class="font-medium">{{ formatTimeAgoUs(detail.last_seen_at) }}</span>
          </div>
        </div>

        <!-- Agents (read-only, self-registered) -->
        <div class="flex flex-col gap-2">
          <h3 class="text-sm font-medium text-text-heading">
            {{ t("synthetics.privateLocations.detail.agentsTitle") }}
          </h3>
          <p class="text-xs text-text-muted">
            {{ t("synthetics.privateLocations.detail.agentsSubtitle") }}
          </p>
          <OTable
            :data="detail.agents"
            :columns="agentColumns"
            row-key="id"
            pagination="client"
            :page-size="10"
            :show-global-filter="false"
            :empty-message="t('synthetics.privateLocations.detail.noAgents')"
            data-test="synthetics-private-location-agents-table"
          >
            <template #cell-live="{ row }">
              <OBadge :variant="(row as any).live ? 'success' : 'error'" :dot="true" size="sm">
                {{
                  (row as any).live
                    ? t("synthetics.privateLocations.status.online")
                    : t("synthetics.privateLocations.status.offline")
                }}
              </OBadge>
            </template>
            <template #cell-capabilities="{ row }">
              <div class="flex flex-wrap gap-1">
                <OTag
                  v-for="ty in (row as any).capabilities?.types ?? []"
                  :key="ty"
                  size="xs"
                  shape="rounded"
                  variant="default-soft"
                >
                  {{ String(ty).toUpperCase() }}
                </OTag>
              </div>
            </template>
            <template #cell-lastSeen="{ row }">
              {{ formatTimeAgoUs((row as any).last_seen_at) }}
            </template>
            <template #cell-actions="{ row }">
              <div class="flex items-center gap-1" @click.stop>
                <OButton
                  variant="ghost"
                  size="icon-sm"
                  icon-left="content-copy"
                  :title="t('synthetics.privateLocations.detail.recoverAgent')"
                  :data-test="`synthetics-private-location-agent-recover-btn-${(row as any).id}`"
                  @click="openSetup((row as any).name)"
                />
              </div>
            </template>
          </OTable>
        </div>

        <!-- Assigned checks -->
        <div class="flex flex-col gap-2">
          <h3 class="text-sm font-medium text-text-heading">
            {{ t("synthetics.privateLocations.detail.checksTitle") }}
          </h3>
          <OTable
            :data="detail.checks"
            :columns="checkColumns"
            row-key="id"
            pagination="client"
            :page-size="10"
            :show-global-filter="false"
            :empty-message="t('synthetics.privateLocations.detail.noChecks')"
            data-test="synthetics-private-location-checks-table"
            @row-click="openMonitor"
          >
            <template #cell-type="{ row }">
              <OTag size="xs" shape="rounded" variant="default-soft">
                {{ String((row as any).type).toUpperCase() }}
              </OTag>
            </template>
            <template #cell-interval="{ row }">
              {{ formatIntervalSecs((row as any).interval_secs) }}
            </template>
            <template #cell-lastStatus="{ row }">
              <OBadge
                :variant="resolveBadge('serviceStatus', (row as any).last_check_status).variant"
                :dot="true"
                size="sm"
              >
                {{ resolveBadge("serviceStatus", (row as any).last_check_status).label }}
              </OBadge>
            </template>
          </OTable>
        </div>
      </div>

      <div v-else-if="!loading" class="p-6">
        <OEmptyState
          size="block"
          :title="t('synthetics.privateLocations.detail.notFound')"
          data-test="synthetics-private-location-detail-empty"
        />
      </div>
    </div>

    <AgentSetupDrawer
      v-model:open="showSetup"
      :install="detail?.install"
      :location-name="detail?.label"
      :location-id="detail?.id"
      :agent-name="setupAgentName"
      :token="agentSetup?.token"
      :org="agentSetup?.org"
      :o2-url="agentSetup?.o2_url"
      :script-url="agentSetup?.script_url"
    />
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OButton from "@/lib/core/Button/OButton.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { resolveBadge } from "@/lib/core/Badge/badgeGroups";
import AgentSetupDrawer from "@/components/synthetic-monitoring/AgentSetupDrawer.vue";
import syntheticsService from "@/services/synthetics";
import type { AgentSetup, SyntheticLocationDetail } from "@/types/synthetics";
import { formatTimeAgoUs, formatIntervalSecs } from "@/utils/synthetics/format";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const store = useStore();

const detail = ref<SyntheticLocationDetail | null>(null);
const loading = ref(false);
const showSetup = ref(false);
const agentSetup = ref<AgentSetup | null>(null);
const setupAgentName = ref<string | null>(null);

/** Opens the setup drawer. With an agentName (from a specific Agents-table
 *  row's "Recover" action), the drawer pre-fills --agent-name so recovering
 *  a known — possibly offline — agent is a straight copy-paste. */
async function openSetup(agentName?: string) {
  setupAgentName.value = agentName ?? null;
  showSetup.value = true;
  if (agentSetup.value) return;
  try {
    const res = await syntheticsService.getAgentSetup(orgIdentifier.value);
    agentSetup.value = (res.data ?? null) as AgentSetup | null;
  } catch (err) {
    console.error("[synthetics] failed to load agent setup", err);
  }
}

const orgIdentifier = computed(() => store.state.selectedOrganization.identifier);

const statusVariant = (status: string) =>
  status === "online" ? "success" : status === "offline" ? "error" : "default";

async function load() {
  loading.value = true;
  try {
    const res = await syntheticsService.getLocation(
      orgIdentifier.value,
      String(route.params.id),
    );
    detail.value = res.data as SyntheticLocationDetail;
  } catch (err) {
    detail.value = null;
    console.error("[synthetics] failed to load location detail", err);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

const openMonitor = (row: { id: string; name: string }) => {
  router.push({
    name: "synthetic-monitor-results",
    params: { id: row.id },
    query: { name: row.name },
  });
};

const agentColumns = computed<OTableColumnDef[]>(() => [
  {
    id: "live",
    header: t("synthetics.table.status"),
    accessorKey: "live",
    size: 110,
    minSize: 90,
    sortable: true,
  },
  {
    id: "name",
    header: t("synthetics.privateLocations.detail.agentName"),
    accessorKey: "name",
    size: 220,
    minSize: 140,
    sortable: true,
    meta: { isName: true, flex: true },
  },
  {
    id: "version",
    header: t("synthetics.privateLocations.detail.version"),
    accessorKey: "version",
    size: 100,
    minSize: 80,
    sortable: true,
  },
  {
    id: "capabilities",
    header: t("synthetics.privateLocations.table.types"),
    accessorKey: "capabilities",
    size: 200,
    minSize: 120,
    sortable: false,
  },
  {
    id: "lastSeen",
    header: t("synthetics.privateLocations.table.lastSeen"),
    accessorKey: "last_seen_at",
    size: 110,
    minSize: 90,
    sortable: true,
  },
  {
    id: "actions",
    header: "",
    accessorKey: "id",
    size: 60,
    minSize: 60,
    sortable: false,
    isAction: true,
  },
]);

const checkColumns = computed<OTableColumnDef[]>(() => [
  {
    id: "name",
    header: t("synthetics.privateLocations.detail.checkName"),
    accessorKey: "name",
    size: 240,
    minSize: 140,
    sortable: true,
    meta: { isName: true, flex: true },
  },
  {
    id: "type",
    header: t("synthetics.table.type"),
    accessorKey: "type",
    size: 90,
    minSize: 70,
    sortable: true,
  },
  {
    id: "interval",
    header: t("synthetics.table.interval"),
    accessorKey: "interval_secs",
    size: 90,
    minSize: 70,
    sortable: true,
  },
  {
    id: "lastStatus",
    header: t("synthetics.table.lastCheck"),
    accessorKey: "last_check_status",
    size: 120,
    minSize: 90,
    sortable: true,
  },
]);
</script>
