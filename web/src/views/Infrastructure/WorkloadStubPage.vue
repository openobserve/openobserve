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

<!--
  WorkloadStubPage — thin v1 Kubernetes / AWS pages (design 4.9): undetected
  renders setup guidance, detected lists this workload's dashboards plus an
  Import-templates door into the gallery drawer.
-->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { raw, useI18nTyped } from "@/types/i18n";
import dashboardsService from "@/services/dashboards";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import DataSourceSetupCard from "@/components/ingestion/setupCard/DataSourceSetupCard.vue";
import AddDashboardFromGitHub from "@/components/dashboards/AddDashboardFromGitHub.vue";
import { useWorkloadDetection } from "@/composables/useWorkloadDetection";
import { WORKLOAD_DEFS, type StubWorkloadId } from "./workloadDefs";

const props = defineProps<{
  workload: StubWorkloadId;
}>();

const store = useStore();
const router = useRouter();
const { t } = useI18nTyped();

const detection = useWorkloadDetection();
const def = computed(() => WORKLOAD_DEFS[props.workload]);
const state = computed(() => detection.states.value[props.workload]);

const orgId = computed(() => store.state.selectedOrganization?.identifier ?? "");

interface WorkloadDashboardRow {
  dashboardId: string;
  title: string;
  folderId: string;
}

const dashboards = ref<WorkloadDashboardRow[]>([]);
const dashboardsLoading = ref(false);
const showTemplateDrawer = ref(false);

// Responses tagged with a superseded generation (org switched mid-flight) are dropped.
let loadGeneration = 0;

// The list API wants folder IDs; non-default entries are NAMES with server-generated ids (AWS tile).
const resolveFolderIds = async (): Promise<string[]> => {
  const entries = def.value.folders;
  if (!entries.some((entry) => entry !== "default")) return [...entries];
  let idByName = new Map<string, string>();
  try {
    const res = await dashboardsService.list_Folders(orgId.value);
    idByName = new Map(
      (res?.data?.list ?? []).map((f: { name: string; folderId: string }) => [f.name, f.folderId]),
    );
  } catch {
    idByName = new Map();
  }
  return entries
    .map((entry) => (entry === "default" ? "default" : (idByName.get(entry) ?? "")))
    .filter((id) => id !== "");
};

const loadDashboards = async () => {
  const gen = ++loadGeneration;
  dashboardsLoading.value = true;
  try {
    const keyword = def.value.dashboardKeyword.toLowerCase();
    const folderIds = await resolveFolderIds();
    const results = await Promise.allSettled(
      folderIds.map((folder) =>
        dashboardsService.list(0, 1000, "name", false, "", orgId.value, folder, ""),
      ),
    );
    if (gen !== loadGeneration) return;
    const rows: WorkloadDashboardRow[] = [];
    results.forEach((result, index) => {
      if (result.status !== "fulfilled") return;
      for (const d of result.value?.data?.dashboards ?? []) {
        if (
          String(d.title ?? "")
            .toLowerCase()
            .includes(keyword)
        ) {
          rows.push({
            // LIST rows are snake_case on the wire (dashboard_id) — camelCase never arrives.
            dashboardId: d.dashboard_id ?? d.dashboardId ?? d.id,
            title: d.title,
            folderId: folderIds[index],
          });
        }
      }
    });
    dashboards.value = rows;
  } finally {
    if (gen === loadGeneration) dashboardsLoading.value = false;
  }
};

const openDashboard = (row: WorkloadDashboardRow) => {
  router.push({
    path: "/dashboards/view",
    query: { org_identifier: orgId.value, dashboard: row.dashboardId, folder: row.folderId },
  });
};

const openSetupRoute = () => {
  const setup = def.value.setup;
  if (setup.kind === "route") router.push({ name: setup.routeName });
};

onMounted(() => {
  detection.refresh();
  if (state.value === "detected") loadDashboards();
});

watch(state, (next, prev) => {
  if (next === "detected" && prev !== "detected") loadDashboards();
});

// The detected face of one org must never linger into the next (design 4.9).
watch(
  () => store.state.selectedOrganization?.identifier,
  async (next, prev) => {
    if (!next || next === prev) return;
    dashboards.value = [];
    // Awaited: the pre-refresh state is the PREVIOUS org's answer.
    await detection.refresh();
    if (state.value === "detected") loadDashboards();
  },
);
</script>

<template>
  <OPageLayout :title="t(def.titleKey)" :icon="def.icon">
    <div v-if="state === 'unknown'" class="flex min-h-60 items-center justify-center">
      <OSpinner size="lg" />
    </div>

    <!-- Undetected: a setup page, not a dead end. -->
    <div
      v-else-if="state !== 'detected'"
      class="mx-auto flex max-w-3xl flex-col gap-3 py-6"
      data-test="workload-setup-state"
    >
      <OText tag="h2" class="text-xl font-semibold">{{ t("infra.workload.setupHeadline") }}</OText>
      <DataSourceSetupCard
        v-if="def.setup.kind === 'card'"
        :slug="def.setup.slug"
        @detected="detection.refresh({ force: true })"
      />
      <div v-else>
        <OButton
          variant="primary"
          size="sm-action"
          icon-left="cloud"
          data-test="workload-setup-cta"
          @click="openSetupRoute"
        >
          {{ t("infra.workload.awsSetupCta") }}
        </OButton>
      </div>
    </div>

    <div v-else class="flex flex-col gap-4 py-2">
      <div>
        <OTag variant="success-soft" size="sm" data-test="workload-chip">{{ t(def.chipKey) }}</OTag>
      </div>

      <div class="flex items-center justify-between gap-2">
        <OText variant="label" class="font-semibold">{{
          t("infra.workload.dashboardsHeading")
        }}</OText>
        <OButton
          variant="outline"
          size="sm-action"
          icon-left="dashboard"
          data-test="workload-import-templates"
          @click="showTemplateDrawer = true"
        >
          {{ t("infra.workload.importTemplates") }}
        </OButton>
      </div>

      <div v-if="dashboardsLoading" class="flex justify-center py-6"><OSpinner size="md" /></div>
      <OText v-else-if="dashboards.length === 0" variant="meta">{{
        t("infra.workload.noDashboards")
      }}</OText>
      <div v-else class="flex flex-col">
        <OButton
          v-for="row in dashboards"
          :key="row.dashboardId"
          variant="ghost"
          size="sm-action"
          class="justify-start"
          :data-test="`workload-dashboard-row-${row.dashboardId}`"
          @click="openDashboard(row)"
        >
          {{ raw(row.title) }}
        </OButton>
      </div>
    </div>

    <AddDashboardFromGitHub
      v-model="showTemplateDrawer"
      :initial-search="def.gallerySearch"
      @added="loadDashboards"
    />
  </OPageLayout>
</template>
