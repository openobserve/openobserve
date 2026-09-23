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

 Unauthenticated standalone viewer — no app shell, no store user, no OPageLayout
 (deliberate: this page renders for anonymous visitors outside the authed app).
 Panels stack in a single column; faithful x/y/w/h grid placement would need the
 shared dashboard grid-layout engine adapted to read snapshots, a follow-up.
-->
<template>
  <div class="min-h-screen bg-surface-subtle px-4 pt-3 pb-8">
    <div
      v-if="state === 'loading' || state === 'preparing'"
      class="flex min-h-[60vh] flex-col items-center justify-center gap-3"
      data-test="dashboards-public-dashboard-loading"
    >
      <OSpinner variant="dots" size="lg" />
      <div v-if="state === 'preparing'" class="text-sm text-text-secondary">
        {{ t("dashboard.publicDashboard.preparing") }}
      </div>
    </div>

    <div
      v-else-if="state === 'notfound' || state === 'unavailable'"
      class="flex min-h-[60vh] flex-col items-center justify-center"
      data-test="dashboards-public-dashboard-error"
    >
      <div class="text-sm text-text-secondary">
        {{
          state === "unavailable"
            ? t("dashboard.publicDashboard.unavailable")
            : t("dashboard.publicDashboard.notAvailable")
        }}
      </div>
    </div>

    <template v-else>
      <header class="flex items-center justify-between gap-3 pb-2">
        <div class="text-lg font-semibold text-text-heading">
          {{ config.title }}
        </div>
        <div class="flex items-center gap-3">
          <OSelect
            v-if="timeEditable && presetOptions.length"
            v-model="selectedPreset"
            :options="presetOptions"
            :label="t('dashboard.publicDashboard.timeRange')"
            label-position="left"
            data-test="dashboards-public-dashboard-preset-select"
            @update:model-value="loadData"
          />
          <span v-if="builtAtLabel" class="text-xs text-text-secondary">
            {{ builtAtLabel }}
          </span>
        </div>
      </header>

      <OTabs
        v-if="tabs.length > 1"
        v-model="activeTab"
        dense
        align="left"
        class="mb-2 border-b border-border-default"
      >
        <OTab
          v-for="tab in tabs"
          :key="tab.tabId"
          :name="tab.tabId"
          :label="raw(tab.name)"
        />
      </OTabs>

      <div class="flex flex-col gap-2">
        <div
          v-for="panel in activePanels"
          :key="panel.id"
          class="flex min-h-80 flex-col overflow-hidden rounded-surface border border-border-default bg-surface-panel"
          :data-test="`dashboards-public-dashboard-panel-${panel.id}`"
        >
          <div
            class="border-b border-border-default px-2 py-1.5 text-compact font-medium text-text-heading"
          >
            {{ panel.title }}
          </div>
          <div class="relative min-h-0 flex-1">
            <PublicPanelRenderer
              v-if="panelReady(panel)"
              :panel-schema="panel"
              :snapshot="snapshotFor(panel)"
            />
            <div
              v-else
              class="flex h-full items-center justify-center text-xs text-text-placeholder"
            >
              {{ t("dashboard.publicDashboard.panelNotAvailable") }}
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRoute } from "vue-router";
import { useI18nTyped, raw, type I18nText } from "@/types/i18n";
import PublicPanelRenderer from "@/components/dashboards/PublicPanelRenderer.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import publicDashboardsService from "@/services/public_dashboards";

interface PresetOption {
  label: I18nText;
  value: number;
}

const route = useRoute();
const { t } = useI18nTyped();
const slug = String(route.params.slug || "");

const state = ref<"loading" | "ready" | "preparing" | "notfound" | "unavailable">(
  "loading",
);
const config = ref<Record<string, any>>({});
const snapshot = ref<Record<string, any>>({});
const activeTab = ref<string>("");
const selectedPreset = ref<number | null>(null);

const tabs = computed<any[]>(() =>
  Array.isArray(config.value.layout) ? config.value.layout : [],
);
const timeEditable = computed(() => !!config.value?.time_range?.editable);
const presetOptions = computed<PresetOption[]>(() =>
  (config.value?.available_presets ?? [])
    .slice()
    .sort((a: number, b: number) => a - b)
    .map((secs: number) => ({ value: secs, label: presetLabel(secs) })),
);
const builtAtLabel = computed<I18nText | "">(() =>
  config.value?.built_at
    ? t("dashboard.publicDashboard.updatedAt", {
        time: raw(new Date(config.value.built_at / 1000).toLocaleString()),
      })
    : "",
);
const activePanels = computed<any[]>(() => {
  const tab = tabs.value.find((tb) => tb.tabId === activeTab.value);
  return tab?.panels ?? [];
});

const snapshotFor = (panel: any) => snapshot.value?.panels?.[panel.id] ?? null;
const panelReady = (panel: any) => snapshotFor(panel)?.state?.state === "ok";

function presetLabel(secs: number): I18nText {
  const range =
    secs % 86400 === 0
      ? `${secs / 86400}d`
      : secs % 3600 === 0
        ? `${secs / 3600}h`
        : secs % 60 === 0
          ? `${secs / 60}m`
          : `${secs}s`;
  return t("dashboard.publicDashboard.past", { range: raw(range) });
}

const pickDefaultPreset = (): number | null => {
  const def = config.value?.time_range?.default_range_secs;
  const presets: number[] = config.value?.available_presets ?? [];
  if (def && presets.includes(def)) return def;
  return presets.slice().sort((a, b) => a - b)[0] ?? null;
};

const mapError = (e: unknown) => {
  const status = (e as { response?: { status?: number } })?.response?.status;
  state.value = status === 503 ? "unavailable" : "notfound";
};

const loadData = async () => {
  // No preset resolved yet means no snapshot has been built — show "preparing"
  // rather than hanging on the loading spinner forever.
  if (selectedPreset.value == null) {
    state.value = "preparing";
    return;
  }
  try {
    const res = await publicDashboardsService.getData(slug, selectedPreset.value);
    if (res.status === 202) {
      state.value = "preparing";
      return;
    }
    snapshot.value = res.data ?? {};
    state.value = "ready";
  } catch (e: unknown) {
    mapError(e);
  }
};

const load = async () => {
  try {
    const res = await publicDashboardsService.getConfig(slug);
    config.value = res.data ?? {};
    activeTab.value = tabs.value[0]?.tabId ?? "";
    selectedPreset.value = pickDefaultPreset();
    await loadData();
  } catch (e: unknown) {
    mapError(e);
  }
};

onMounted(load);
</script>
