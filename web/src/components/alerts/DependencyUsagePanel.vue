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
  "Where used" panel for the View-dependencies popover. The focused entity is the
  title (set by the wrapper); this body shows EVERY related entity, grouped by kind
  (Templates · Destinations · Alerts) with each a clickable row that can Open it or
  request a Delete (the wrapper owns the ConfirmDialog — a modal can't live inside
  the popover). A single search filters all groups; the alerts group pages so
  thousands stay responsive. Data via useDependencyGraph + buildFocusChain.
-->
<template>
  <div class="flex h-full min-h-0 flex-col text-left" data-test="dependency-usage-panel">
    <div
      v-if="loading"
      class="text-text-secondary flex flex-1 items-center justify-center gap-2 p-4 text-sm"
      data-test="dependency-usage-loading"
    >
      <OSpinner size="sm" />
      {{ t("alert_dependencies.loading") }}
    </div>

    <OBanner
      v-else-if="error"
      variant="error"
      icon="error"
      class="m-2"
      :content="t('alert_dependencies.failedToLoad', { error })"
      data-test="dependency-usage-error"
    />

    <template v-else>
      <div class="border-border-default border-b px-3 py-2">
        <OSearchInput
          v-model="search"
          data-test="dependency-usage-search"
          :placeholder="t('alert_dependencies.searchPlaceholder')"
        />
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-2 py-2" data-test="dependency-usage-list">
        <div
          v-if="isEmpty"
          class="text-text-muted px-1 py-2 text-sm"
          data-test="dependency-usage-empty"
        >
          {{ search ? t("alert_dependencies.noMatches") : t("alert_dependencies.noDependencies") }}
        </div>

        <!-- Templates -->
        <section
          v-if="filteredTemplates.length"
          class="mb-2"
          data-test="dependency-usage-templates"
        >
          <button
            class="text-text-secondary hover:text-text-heading mb-1 flex w-full items-center gap-1 px-1 text-xs font-semibold"
            data-test="dependency-usage-templates-toggle"
            @click="toggle('templates')"
          >
            <OIcon :name="caret('templates')" size="sm" class="text-text-muted" />
            {{ t("alert_dependencies.sectionTemplates") }}
            <span class="text-text-secondary font-normal">({{ filteredTemplates.length }})</span>
          </button>
          <DependencyUsageRow
            v-for="n in collapsed.templates ? [] : filteredTemplates"
            :key="n.id"
            :node="n"
            @open="openEntity"
            @delete="(n) => emit('requestDelete', n)"
          />
        </section>

        <!-- Destinations -->
        <section
          v-if="filteredDestinations.length"
          class="mb-2"
          data-test="dependency-usage-destinations"
        >
          <button
            class="text-text-secondary hover:text-text-heading mb-1 flex w-full items-center gap-1 px-1 text-xs font-semibold"
            data-test="dependency-usage-destinations-toggle"
            @click="toggle('destinations')"
          >
            <OIcon :name="caret('destinations')" size="sm" class="text-text-muted" />
            {{ t("alert_dependencies.sectionDestinations") }}
            <span class="text-text-secondary font-normal">({{ filteredDestinations.length }})</span>
          </button>
          <DependencyUsageRow
            v-for="n in collapsed.destinations ? [] : filteredDestinations"
            :key="n.id"
            :node="n"
            :count="n.alerts.length"
            @open="openEntity"
            @delete="(n) => emit('requestDelete', n)"
          />
        </section>

        <!-- Alerts (paged) — header sticks so its pager stays visible while scrolling. -->
        <section v-if="filteredAlerts.length" data-test="dependency-usage-alerts">
          <div
            class="bg-dropdown-bg sticky top-0 z-20 -mx-2 mb-1 flex items-center justify-between gap-2 px-3 py-1"
          >
            <button
              class="text-text-secondary hover:text-text-heading flex items-center gap-1 text-xs font-semibold"
              data-test="dependency-usage-alerts-toggle"
              @click="toggle('alerts')"
            >
              <OIcon :name="caret('alerts')" size="sm" class="text-text-muted" />
              {{ t("alert_dependencies.sectionAlerts") }}
              <span class="text-text-secondary font-normal">({{ filteredAlerts.length }})</span>
            </button>
            <div
              v-if="filteredAlerts.length > pageSize"
              class="flex shrink-0 items-center gap-1"
              data-test="dependency-usage-pager"
            >
              <OButton
                variant="ghost"
                size="icon-xs"
                :disabled="page === 0"
                data-test="dependency-usage-prev"
                @click="page = Math.max(0, page - 1)"
              >
                <OIcon name="chevron-left" size="sm" />
              </OButton>
              <span class="text-text-secondary text-2xs tabular-nums">
                {{
                  t("alert_dependencies.pageRange", {
                    from: pageStart + 1,
                    to: pageEnd,
                    total: filteredAlerts.length.toLocaleString(),
                  })
                }}
              </span>
              <OButton
                variant="ghost"
                size="icon-xs"
                :disabled="pageEnd >= filteredAlerts.length"
                data-test="dependency-usage-next"
                @click="page = page + 1"
              >
                <OIcon name="chevron-right" size="sm" />
              </OButton>
            </div>
          </div>
          <DependencyUsageRow
            v-for="n in collapsed.alerts ? [] : pagedAlerts"
            :key="n.id"
            :node="n"
            @open="openEntity"
            @delete="(n) => emit('requestDelete', n)"
          />
        </section>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import useDependencyGraph, { buildFocusChain } from "@/composables/alerts/useDependencyGraph";
import type { DepNode, DepFocus } from "@/composables/alerts/useDependencyGraph";
import DependencyUsageRow from "./DependencyUsageRow.vue";

const props = defineProps<{ focus: DepFocus }>();
// Delete is confirmed + performed by the wrapper (a modal can't live in the
// popover), so the panel only asks for it.
const emit = defineEmits<{ (e: "requestDelete", node: DepNode): void }>();

const pageSize = 50;

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const { graph, loading, error, loadGraph } = useDependencyGraph();

const search = ref("");
const page = ref(0);
// Per-section collapse state.
const collapsed = ref({ templates: false, destinations: false, alerts: false });
const toggle = (key: "templates" | "destinations" | "alerts") => {
  collapsed.value[key] = !collapsed.value[key];
};
const caret = (key: "templates" | "destinations" | "alerts") =>
  collapsed.value[key] ? "chevron-right" : "expand-more";

const org = () => store.state.selectedOrganization.identifier;
const refresh = async () => {
  await loadGraph(org());
};

onMounted(refresh);
watch(
  () => props.focus,
  () => {
    search.value = "";
    page.value = 0;
    refresh();
  },
);
watch(search, () => (page.value = 0));

const chain = computed(() => buildFocusChain(graph.value, props.focus));
const matches = (n: { name: string }) => {
  const term = search.value.trim().toLowerCase();
  return !term || n.name.toLowerCase().includes(term);
};

const filteredTemplates = computed(() => chain.value.templates.filter(matches));
const filteredDestinations = computed(() => chain.value.destinations.filter(matches));
const filteredAlerts = computed(() => chain.value.alerts.filter(matches));
const isEmpty = computed(
  () =>
    !filteredTemplates.value.length &&
    !filteredDestinations.value.length &&
    !filteredAlerts.value.length,
);

const pageStart = computed(() => page.value * pageSize);
const pageEnd = computed(() => Math.min(pageStart.value + pageSize, filteredAlerts.value.length));
const pagedAlerts = computed(() => filteredAlerts.value.slice(pageStart.value, pageEnd.value));

const openEntity = (n: DepNode) => {
  if (n.missing) return;
  const org_identifier = org();
  if (n.kind === "destination") {
    router.push({
      name: "alertDestinations",
      query: { action: "update", name: n.name, org_identifier },
    });
  } else if (n.kind === "template") {
    router.push({
      name: "alertTemplates",
      query: { action: "update", name: n.name, org_identifier },
    });
  } else if (n.kind === "alert" && n.alertId) {
    router.push({
      name: "alertDetail",
      params: { alert_id: n.alertId },
      query: { org_identifier, ...(n.folderId ? { folder: n.folderId } : {}) },
    });
  }
};
</script>
