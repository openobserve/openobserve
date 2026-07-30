<!-- Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>. -->

<!--
  SLO status page (alerts_2.md §6b.10).

  The frozen banner is the most important element here. When coverage is below
  the floor the SLO's alerts neither fire nor resolve, and a user looking at a
  green-looking page needs to know that what they are seeing is stale rather
  than healthy. Every derived stat renders an em dash in that state.

  The per-group table excludes the rollup row: it is the EXACT overall (S-9),
  not a group, and listing it alongside the groups would double-count in any
  reading that sums the rows.
-->
<template>
  <OPageLayout
    :title="slo?.name || sloId"
    icon="track_changes"
    :subtitle="subtitle"
    :back="{ to: backTarget, label: t('slos.title') }"
    title-data-test="slos-slodetail-title"
    bleed
  >
    <template #title-trail>
      <div class="flex items-center gap-2">
        <OTag
          v-if="slo"
          :variant="healthVariant"
          :icon="healthIcon(health)"
          size="sm"
          :label="t(`slos.health.${health}`)"
          data-test="slos-slodetail-health"
        />
        <OTag
          v-for="tag in slo?.tags || []"
          :key="tag"
          variant="neutral-soft"
          size="xs"
          :label="tag"
        />
        <span v-if="slo" class="text-compact text-text-secondary">
          {{ t("slos.generation", { n: slo.definition_generation }) }}
        </span>
      </div>
    </template>

    <template #actions>
      <OButton
        variant="outline"
        size="sm-action"
        icon-left="notifications"
        data-test="slos-slodetail-new-alert"
        @click="goToNewAlert"
      >
        {{ t("slos.newAlert") }}
      </OButton>
      <OButton
        variant="primary"
        size="sm-action"
        icon-left="edit"
        data-test="slos-slodetail-edit"
        @click="goToEdit"
      >
        {{ t("common.edit") }}
      </OButton>
    </template>

    <!-- Not a subtle indicator: a frozen SLO's alerts neither fire nor
         resolve, and mistaking that for healthy is the failure mode. -->
    <OBanner
      v-if="status?.no_data"
      variant="warning"
      icon="ac_unit"
      class="mb-3"
      data-test="slos-slodetail-frozen-banner"
    >
      <span class="font-bold">{{ t("slos.frozen.title") }}</span>
      {{
        t("slos.frozen.body", {
          coverage: formatCoverage(status?.coverage),
          floor: coverageFloorLabel,
        })
      }}
    </OBanner>

    <OStatStrip v-if="slo" :items="stats" data-test="slos-slodetail-stats" />

    <OTabs v-model="tab" class="mt-4" data-test="slos-slodetail-tabs">
      <OTab name="groups" :label="t('slos.tab.groups')" icon="layers" v-if="isGrouped" />
      <OTab name="config" :label="t('slos.tab.configuration')" icon="settings" />
    </OTabs>

    <OTabPanels v-model="tab">
      <OTabPanel v-if="isGrouped" name="groups">
        <OTable
          :data="groups"
          :columns="groupColumns"
          row-key="group_key"
          :loading="groupsLoading"
          :frame="false"
          :page-size="25"
          :show-global-filter="false"
          table-id="slo-groups"
          data-test="slos-slodetail-groups-table"
        >
          <template #cell-group_key="{ row }">
            <span class="text-compact font-mono">{{ row.group_key }}</span>
          </template>
          <template #cell-sli="{ row }">
            <span v-if="!row.no_data" class="tabular-nums">{{ formatSli(row.sli) }}</span>
            <span v-else class="text-text-secondary">{{ ABSENT }}</span>
          </template>
          <template #cell-budget="{ row }">
            <span
              v-if="!row.no_data"
              class="tabular-nums"
              :class="(row.error_budget_remaining ?? 0) <= 0 ? 'text-negative font-semibold' : ''"
            >
              {{ formatBudget(row.error_budget_remaining) }}
            </span>
            <span v-else class="text-text-secondary">{{ ABSENT }}</span>
          </template>
          <template #cell-burn="{ row }">
            <span v-if="!row.no_data" class="tabular-nums">{{ formatBurn(row.burn_rate) }}</span>
            <span v-else class="text-text-secondary">{{ ABSENT }}</span>
          </template>
          <template #cell-coverage="{ row }">
            <span class="tabular-nums" :class="row.no_data ? 'text-warning font-semibold' : ''">
              {{ formatCoverage(row.coverage) }}
            </span>
          </template>
          <template #empty>
            <OEmptyState
              icon="layers"
              :title="t('slos.groups.emptyTitle')"
              :description="t('slos.groups.emptyDescription')"
            />
          </template>
        </OTable>
      </OTabPanel>

      <OTabPanel name="config">
        <OContent v-if="slo">
          <dl class="text-compact grid grid-cols-[10rem_1fr] gap-x-4 gap-y-2">
            <dt class="text-text-secondary">{{ t("slos.field.sliType") }}</dt>
            <dd>{{ sliTypeLabel(slo.sli_type) }}</dd>

            <dt class="text-text-secondary">{{ t("slos.field.target") }}</dt>
            <dd>
              {{ formatTarget(slo.target) }}
              <span class="text-text-secondary">
                {{ t("slos.overRolling", { window: formatWindow(slo.window_secs) }) }}
              </span>
            </dd>

            <dt class="text-text-secondary">{{ t("slos.field.sliceInterval") }}</dt>
            <dd>{{ formatSlice(slo.slice_interval_secs) }}</dd>

            <dt class="text-text-secondary">{{ t("slos.field.groupBy") }}</dt>
            <dd>
              <span v-if="isGrouped" class="font-mono">{{ slo.group_by?.join(", ") }}</span>
              <span v-else class="text-text-secondary">{{ t("slos.noGrouping") }}</span>
            </dd>

            <dt class="text-text-secondary">{{ t("slos.field.reservation") }}</dt>
            <dd>{{ t("slos.reservationValue", { groups: slo.groups_reserved }) }}</dd>

            <dt class="text-text-secondary">{{ t("slos.field.owner") }}</dt>
            <dd>{{ slo.owner || ABSENT }}</dd>
          </dl>

          <OCode class="mt-4" language="json" :code="configJson" />
        </OContent>
      </OTabPanel>
    </OTabPanels>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";

import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCode from "@/lib/core/Code/OCode.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import type { Slo, SloStatus } from "@/ts/interfaces/slo";
import sloService from "@/services/slos";
import {
  ABSENT,
  formatBudget,
  formatBurn,
  formatCoverage,
  formatSli,
  formatSlice,
  formatTarget,
  formatTimeToExhaust,
  formatWindow,
  healthIcon,
  sliTypeLabel,
  sloHealth,
} from "@/composables/useSloFormat";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const store = useStore();

const slo = ref<Slo | null>(null);
const status = ref<SloStatus | null>(null);
const groups = ref<SloStatus[]>([]);
const groupsLoading = ref(false);
const tab = ref("config");

const sloId = computed(() => String(route.params.slo_id || ""));
const org = computed(() => store.state.selectedOrganization?.identifier);
const health = computed(() => sloHealth(status.value));
const isGrouped = computed(() => !!slo.value?.group_by && slo.value.group_by.length > 0);

/// Reads as "below the 80% floor" when the server exposes the value, and
/// "below the configured floor" when it does not — the sentence has to work
/// either way, which the literal "the configured floor" broke by producing
/// "below the the configured floor floor".
const coverageFloorLabel = computed(() => {
  const floor = store.state.zoConfig?.slo_min_coverage;
  return floor ? `${Math.round(Number(floor) * 100)}%` : "configured";
});

const backTarget = computed(() => ({
  name: "sloList",
  query: { org_identifier: org.value },
}));

const subtitle = computed(() => {
  if (!slo.value) return "";
  const parts = [
    sliTypeLabel(slo.value.sli_type),
    t("slos.overRolling", { window: formatWindow(slo.value.window_secs) }),
    formatSlice(slo.value.slice_interval_secs),
  ];
  return parts.join(" · ");
});

const healthVariant = computed(() => {
  switch (health.value) {
    case "budget_blown":
      return "error-soft";
    case "at_risk":
      return "warning-soft";
    case "meeting":
      return "success-soft";
    default:
      return "neutral-soft";
  }
});

const configJson = computed(() =>
  slo.value ? JSON.stringify(slo.value.config ?? {}, null, 2) : "{}",
);

const stats = computed<StatItem[]>(() => {
  const s = status.value;
  const frozen = !s || s.no_data;
  return [
    {
      key: "sli",
      label: t("slos.stat.status", { window: formatWindow(slo.value?.window_secs ?? 0) }),
      value: frozen ? ABSENT : formatSli(s!.sli),
      tone: frozen ? "neutral" : health.value === "meeting" ? "success" : "error",
    },
    {
      key: "target",
      label: t("slos.stat.target"),
      value: slo.value ? formatTarget(slo.value.target) : ABSENT,
      tone: "primary",
    },
    {
      key: "budget",
      label: t("slos.stat.budgetRemaining"),
      value: frozen ? ABSENT : formatBudget(s!.error_budget_remaining),
      tone: frozen ? "neutral" : (s!.error_budget_remaining ?? 0) <= 0 ? "error" : "success",
    },
    {
      key: "burn",
      label: t("slos.stat.burnRate"),
      value: frozen ? ABSENT : formatBurn(s!.burn_rate),
      tone: frozen ? "neutral" : (s!.burn_rate ?? 0) > 1 ? "error" : "success",
    },
    {
      key: "exhaust",
      label: t("slos.stat.timeToExhaust"),
      value: frozen ? ABSENT : formatTimeToExhaust(s!.time_to_exhaust_secs),
      tone: "neutral",
    },
    {
      key: "coverage",
      label: t("slos.stat.coverage"),
      value: formatCoverage(s?.coverage),
      tone: frozen ? "warning" : "neutral",
    },
  ];
});

const groupColumns = computed<OTableColumnDef<SloStatus>[]>(() => [
  {
    id: "group_key",
    header: t("slos.column.group"),
    accessor: (r) => r.group_key,
    sortable: true,
    size: 280,
  },
  {
    id: "sli",
    header: t("slos.column.sli"),
    accessor: (r) => r.sli ?? -1,
    sortable: true,
    size: 130,
  },
  {
    id: "budget",
    header: t("slos.column.budgetRemaining"),
    accessor: (r) => r.error_budget_remaining ?? null,
    sortable: true,
    size: 160,
  },
  {
    id: "burn",
    header: t("slos.column.burnRate"),
    accessor: (r) => r.burn_rate ?? -1,
    sortable: true,
    size: 120,
  },
  {
    id: "coverage",
    header: t("slos.column.coverage"),
    accessor: (r) => r.coverage,
    sortable: true,
    size: 120,
  },
]);

async function load() {
  if (!org.value || !sloId.value) return;
  const res = await sloService.get(org.value, sloId.value);
  const body = res.data ?? {};
  status.value = body.status ?? null;
  // The API flattens the SLO alongside `status`; strip it back out so the
  // config tab renders the definition and nothing else.
  const { status: _ignored, ...rest } = body;
  slo.value = rest as Slo;

  if (rest.group_by?.length) {
    tab.value = "groups";
    await loadGroups();
  }
}

async function loadGroups() {
  groupsLoading.value = true;
  try {
    const res = await sloService.groups(org.value, sloId.value);
    groups.value = res.data?.list ?? [];
  } finally {
    groupsLoading.value = false;
  }
}

function goToEdit() {
  router.push({
    name: "editSlo",
    params: { slo_id: sloId.value },
    query: { org_identifier: org.value },
  });
}

function goToNewAlert() {
  // SLO alerts are ordinary alerts with query_type = slo (D28), so this lands
  // in the normal alert form rather than a parallel one.
  router.push({
    name: "alertList",
    query: { org_identifier: org.value, slo_id: sloId.value },
  });
}

onMounted(load);
</script>
