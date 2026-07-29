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
  Alert status page — replaces the row-click side panel.

  For a multi-alert (alerts_2.md §5.4) this is where the per-group state lives:
  a summary strip counting groups by level, the group table itself, and the
  per-group history that M-8 sources from the transitions table rather than the
  triggers stream.

  A note on the counts: everything in the summary strip comes from the rollup
  row's PRE-cap counters, never from the length of the group list. Past the M-6
  cap the list is truncated, so counting it would silently under-report exactly
  when the number matters most — the failure M-6 exists to forbid.
-->
<template>
  <OPageLayout
    :title="notFound ? t('alerts.groups.notFoundTitle') : alert?.name || alertId"
    icon="notifications"
    :subtitle="notFound ? '' : subtitle"
    :back="backTarget"
    title-data-test="alerts-alertdetail-title"
    bleed
  >
    <template #title-trail>
      <div v-if="!notFound" class="flex items-center gap-2">
        <OTag
          v-if="isMultiAlert"
          variant="purple-soft"
          icon="layers"
          size="sm"
          :label="t('alerts.multiAlert.badge')"
          data-test="alerts-alertdetail-multi-badge"
        />
        <OTag
          v-if="rollupLevel"
          type="alertLevel"
          :value="rollupLevel"
          size="sm"
          data-test="alerts-alertdetail-level-badge"
        />
        <span
          v-if="isMultiAlert && firingSummary"
          class="text-compact text-text-secondary"
          data-test="alerts-alertdetail-firing-summary"
        >
          {{ firingSummary }}
        </span>
      </div>
    </template>

    <template #actions>
      <OButton
        v-if="!notFound"
        variant="outline"
        size="sm-action"
        icon-left="edit"
        data-test="alerts-alertdetail-edit"
        @click="editAlert"
      >
        {{ t("alerts.edit") }}
      </OButton>
    </template>

    <template #header-tabs>
      <OTabs
        v-if="!notFound" v-model="activeTab" dense data-test="alerts-alertdetail-tabs">
        <OTab
          v-if="isMultiAlert"
          name="groups"
          :label="t('alerts.groups.tab')"
          icon="layers"
        />
        <OTab name="history" :label="t('alerts.history')" icon="history" />
        <OTab
          name="configuration"
          :label="t('alerts.configuration')"
          icon="settings"
        />
      </OTabs>
    </template>

    <OContent v-if="notFound" class="py-6">
      <OEmptyState
        size="hero"
        :title="t('alerts.groups.notFoundTitle')"
        :description="t('alerts.groups.notFoundDescription')"
        data-test="alerts-alertdetail-not-found"
      />
    </OContent>

    <div v-else class="flex h-full min-h-0 flex-col">
      <!-- M-6 forbids silent truncation: when the last evaluation observed more
           groups than the cap tracks, say so rather than quietly showing a
           partial table. -->
      <OBanner
        v-if="groupData?.capped"
        variant="warning"
        class="shrink-0"
        data-test="alerts-alertdetail-cap-banner"
      >
        {{
          t("alerts.groups.capBanner", {
            observed: groupData.groups_observed,
            cap: groupData.group_cap,
          })
        }}
      </OBanner>

      <OContent v-if="isMultiAlert" class="shrink-0 pt-3">
        <OStatStrip
          :items="groupStats"
          data-test="alerts-alertdetail-group-stats"
        />
      </OContent>

      <!-- A grouped alert that never opted in has no Groups tab, because it
           has no per-group state to show. Without saying so, the chart below
           showing one line per group makes that look like a bug rather than
           the deliberate opt-in it is (M-9). -->
      <OBanner
        v-if="isGroupedButSimple"
        variant="info"
        class="shrink-0"
        data-test="alerts-alertdetail-simple-grouped-banner"
      >
        {{
          t("alerts.multiAlert.groupedButSimple", {
            columns: (aggregation?.group_by || []).join(", "),
          })
        }}
        <template #actions>
          <OButton
            variant="outline"
            size="sm"
            data-test="alerts-alertdetail-enable-multi"
            @click="editAlert"
          >
            {{ t("alerts.multiAlert.enableCta") }}
          </OButton>
        </template>
      </OBanner>

      <!-- Above the tabs, not inside the Groups tab: the evaluation chart
           answers "what is this alert watching, and how close is it to the
           thresholds" for EVERY scheduled alert. A grouped alert that never
           opted in to per-group evaluation has no Groups tab, and burying the
           chart there left it with no chart at all. -->
      <OContent v-if="alert" class="shrink-0 py-3">
        <AlertGroupChart :alert="alert" />
      </OContent>

      <OTabPanels v-model="activeTab" class="flex-1 min-h-0">
        <OTabPanel v-if="isMultiAlert" name="groups" stretch>
          <AlertGroupsTable
            :groups="groupData?.list || []"
            :loading="loadingGroups"
            @refresh="fetchGroups"
            @show-history="openGroupHistory"
          />
        </OTabPanel>

        <OTabPanel name="history" stretch>
          <AlertGroupHistory
            v-if="isMultiAlert"
            :transitions="transitions"
            :loading="loadingTransitions"
            :group-filter="historyGroupFilter"
            @clear-filter="clearGroupFilter"
            @refresh="fetchTransitions"
          />
          <OContent v-else class="py-4">
            <p class="text-sm text-text-secondary">
              {{ t("alerts.groups.historyOnlyForMulti") }}
            </p>
          </OContent>
        </OTabPanel>

        <OTabPanel name="configuration" stretch>
          <OContent class="py-4">
            <AlertConfigSummary v-if="alert" :alert="alert" />
          </OContent>
        </OTabPanel>
      </OTabPanels>
    </div>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";

import AlertConfigSummary from "@/components/alerts/AlertConfigSummary.vue";
import AlertGroupChart from "@/components/alerts/AlertGroupChart.vue";
import AlertGroupHistory from "@/components/alerts/AlertGroupHistory.vue";
import AlertGroupsTable from "@/components/alerts/AlertGroupsTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import alertsService from "@/services/alerts";
import type {
  AlertGroup,
  AlertGroupsResponse,
  AlertGroupTransition,
} from "@/ts/interfaces/alert";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const store = useStore();

const alertId = computed(() => String(route.params.alert_id || ""));
const orgId = computed(() => store.state.selectedOrganization?.identifier);

const alert = ref<any>(null);
const groupData = ref<AlertGroupsResponse | null>(null);
const transitions = ref<AlertGroupTransition[]>([]);
const loadingGroups = ref(false);
const loadingTransitions = ref(false);
const historyGroupFilter = ref<AlertGroup | null>(null);
// The alert could not be loaded — deleted, mistyped id, or no access. Without
// this the page rendered a phantom alert: the raw id as the title, live-looking
// tabs and a working Edit button for something that does not exist.
const notFound = ref(false);
const activeTab = ref<string | number>("history");

// The single-alert GET returns `query_condition`; the list endpoint calls the
// same object `condition`. Accept either so this page works from both shapes.
const aggregation = computed(
  () =>
    alert.value?.query_condition?.aggregation ||
    alert.value?.condition?.aggregation,
);

const isMultiAlert = computed(() => !!aggregation.value?.multi_alert);

// Grouped, but still evaluating as one collapsed result. The distinction the
// banner exists to explain: grouping produces the SERIES on the chart,
// `multi_alert` decides whether each group gets its own state and page.
const isGroupedButSimple = computed(
  () =>
    !isMultiAlert.value &&
    (aggregation.value?.group_by || []).some((c: string) => c && c.trim()),
);

// The GET response carries no rollup level, and M-2 defines the rollup as the
// most severe group — which is exactly the first row of the worst-first group
// list. Deriving it here beats showing nothing or re-fetching the list page.
const rollupLevel = computed(() => groupData.value?.list?.[0]?.level);

const backTarget = computed(() => ({
  label: t("alerts.header"),
  to: {
    name: "alertList",
    query: { org_identifier: orgId.value },
  },
}));

const subtitle = computed(() => {
  if (!alert.value) return "";
  const groupBy = aggregation.value?.group_by || [];
  const parts = [alert.value.stream_name].filter(Boolean);
  if (groupBy.length) {
    parts.push(t("alerts.groups.groupedBy", { columns: groupBy.join(", ") }));
  }
  return parts.join(" · ");
});

/** Render a count that may be a lower bound with the `≥` the marker demands. */
const withBound = (value?: number, isLowerBound?: boolean) => {
  if (value === undefined || value === null) return "—";
  return isLowerBound ? `≥${value}` : String(value);
};

const firingSummary = computed(() => {
  const d = groupData.value;
  if (!d || d.groups_observed === undefined) return "";
  return t("alerts.groups.nOfMFiring", {
    firing: withBound(d.groups_firing, d.groups_firing_is_lower_bound),
    observed: withBound(d.groups_observed, d.groups_observed_is_lower_bound),
  });
});

// Level counts come from the retained rows, which is honest for a per-level
// breakdown: the pre-cap totals are not broken down by level, so the strip
// labels the total separately rather than implying the breakdown is complete.
const groupStats = computed<StatItem[]>(() => {
  const rows = groupData.value?.list || [];
  const countOf = (level: string) =>
    rows.filter((g) => (g.level || "").toLowerCase() === level).length;
  const d = groupData.value;
  return [
    {
      key: "critical",
      label: t("alerts.groups.critical"),
      value: countOf("critical"),
      icon: "error",
      tone: "error",
      dataTest: "alerts-alertdetail-stat-critical",
    },
    {
      key: "warning",
      label: t("alerts.groups.warning"),
      value: countOf("warning"),
      icon: "warning",
      tone: "warning",
      dataTest: "alerts-alertdetail-stat-warning",
    },
    {
      key: "ok",
      label: t("alerts.groups.ok"),
      value: countOf("ok"),
      icon: "check_circle",
      tone: "success",
      dataTest: "alerts-alertdetail-stat-ok",
    },
    {
      key: "firing",
      label: t("alerts.groups.firingTotal"),
      value: withBound(d?.groups_firing, d?.groups_firing_is_lower_bound),
      icon: "notifications_active",
      tone: "orange",
      dataTest: "alerts-alertdetail-stat-firing",
    },
    {
      key: "observed",
      label: t("alerts.groups.observedTotal"),
      value: withBound(d?.groups_observed, d?.groups_observed_is_lower_bound),
      icon: "layers",
      tone: "neutral",
      dataTest: "alerts-alertdetail-stat-observed",
    },
  ];
});

const fetchAlert = async () => {
  if (!orgId.value || !alertId.value) return;
  try {
    const res = await alertsService.get_by_alert_id(orgId.value, alertId.value);
    alert.value = res.data;
    notFound.value = !res.data;
  } catch {
    alert.value = null;
    notFound.value = true;
  }
};

const fetchGroups = async () => {
  if (!orgId.value || !alertId.value) return;
  loadingGroups.value = true;
  try {
    const res = await alertsService.list_groups(orgId.value, alertId.value);
    groupData.value = res.data;
  } catch {
    groupData.value = null;
  } finally {
    loadingGroups.value = false;
  }
};

const fetchTransitions = async () => {
  if (!orgId.value || !alertId.value) return;
  loadingTransitions.value = true;
  try {
    const res = await alertsService.list_group_transitions(
      orgId.value,
      alertId.value,
      historyGroupFilter.value?.group_key,
    );
    transitions.value = res.data?.list || [];
  } catch {
    transitions.value = [];
  } finally {
    loadingTransitions.value = false;
  }
};

const openGroupHistory = (group: AlertGroup) => {
  historyGroupFilter.value = group;
  activeTab.value = "history";
  fetchTransitions();
};

const clearGroupFilter = () => {
  historyGroupFilter.value = null;
  fetchTransitions();
};

// The alert editor lives on the list route, opened by query params. The action
// value is `update` — `edit` is silently ignored, which just lands you on the
// list with nothing open.
const editAlert = () => {
  router.push({
    name: "alertList",
    query: {
      org_identifier: orgId.value,
      action: "update",
      alert_id: alertId.value,
      // The GET response carries no folder, so carry through the one the list
      // navigated with; "default" is the folder every org is created with.
      folder: route.query.folder || "default",
    },
  });
};

// Multi-alerts land on Groups (the reason the page exists for them); everything
// else has no groups tab, so History is the only sensible default.
watch(isMultiAlert, (multi) => {
  if (multi) {
    activeTab.value = "groups";
    fetchGroups();
  }
});

onMounted(async () => {
  await fetchAlert();
  if (isMultiAlert.value) {
    activeTab.value = "groups";
    await fetchGroups();
  }
  await fetchTransitions();
});
</script>
