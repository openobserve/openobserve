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
  <div data-test="metrics-detail-used-in">
    <OSkeleton
      v-if="status === 'loading'"
      class="h-24"
      animation="wave"
      data-test="metrics-detail-used-in-loading"
    />
    <OBanner
      v-else-if="status === 'error'"
      variant="error"
      :content="t('metrics.explorer.detail.usedIn.error')"
      data-test="metrics-detail-used-in-error"
    >
      <template #actions>
        <OButton
          variant="outline"
          size="sm"
          icon-left="replay"
          data-test="metrics-detail-used-in-retry"
          @click="emit('retry')"
          >{{ t("metrics.explorer.retry") }}</OButton
        >
      </template>
    </OBanner>
    <template v-else-if="usage">
      <OBanner
        v-if="usage.unparsed"
        variant="info"
        class="mb-3"
        :content="
          t('metrics.explorer.detail.usedIn.unparsed', { count: usage.unparsed }, usage.unparsed)
        "
        data-test="metrics-detail-used-in-unparsed"
      />
      <OEmptyState
        v-if="!groups.length"
        size="inline"
        icon="search-off"
        :title="t('metrics.explorer.detail.usedIn.empty')"
        data-test="metrics-detail-used-in-empty"
      />
      <section
        v-for="group in groups"
        :key="group.kind"
        class="mb-4"
        :data-test="`metrics-detail-used-in-${group.kind}`"
      >
        <h3 class="text-text-secondary mb-1 text-xs font-semibold">{{ group.label }}</h3>
        <ul class="flex flex-col gap-1">
          <li v-for="item in group.items" :key="item.id" class="flex items-center gap-2">
            <router-link
              :to="group.to(item)"
              class="text-text-link text-sm hover:underline"
              :data-test="`metrics-detail-used-in-link-${group.kind}-${item.id}`"
              >{{ item.title ?? item.name }}</router-link
            >
            <OTooltip
              v-if="item.match === 'text'"
              :content="t('metrics.explorer.detail.usedIn.textMatchHelp')"
              max-width="22.5rem"
            >
              <!-- Focusable so the explanation reaches a keyboard user too. -->
              <span
                tabindex="0"
                class="rounded-default focus-visible:outline-accent/40 inline-flex focus:outline-none focus-visible:outline-2"
              >
                <OBadge
                  variant="warning-outline"
                  size="xs"
                  :data-test="`metrics-detail-used-in-text-match-${group.kind}-${item.id}`"
                  >{{ t("metrics.explorer.detail.usedIn.textMatch") }}</OBadge
                >
              </span>
            </OTooltip>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { RouteLocationRaw } from "vue-router";
import { useStore } from "vuex";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { MetricUsage, MetricUsageEntry } from "@/services/metrics";

interface UsageGroup {
  kind: "dashboards" | "alerts" | "slos" | "pipelines";
  label: I18nText;
  items: MetricUsageEntry[];
  to: (item: MetricUsageEntry) => RouteLocationRaw;
}

const props = defineProps<{
  usage: MetricUsage | null;
  status: "idle" | "loading" | "done" | "error";
}>();

const emit = defineEmits<{ retry: [] }>();

const { t } = useI18nTyped();
const store = useStore();

const groups = computed<UsageGroup[]>(() => {
  const usage = props.usage;
  if (!usage) return [];
  const org = store.state.selectedOrganization?.identifier;
  const all: UsageGroup[] = [
    {
      kind: "dashboards",
      label: t("metrics.explorer.detail.usedIn.dashboards", { count: usage.dashboards.length }),
      items: usage.dashboards,
      to: (item) => ({
        name: "viewDashboard",
        query: { org_identifier: org, dashboard: item.id, folder: item.folder_id },
      }),
    },
    {
      kind: "alerts",
      label: t("metrics.explorer.detail.usedIn.alerts", { count: usage.alerts.length }),
      items: usage.alerts,
      to: (item) => ({
        name: "alertDetail",
        params: { alert_id: item.id },
        query: { org_identifier: org, folder: item.folder_id },
      }),
    },
    {
      kind: "slos",
      label: t("metrics.explorer.detail.usedIn.slos", { count: usage.slos.length }),
      items: usage.slos,
      to: (item) => ({
        name: "sloDetail",
        params: { slo_id: item.id },
        query: { org_identifier: org },
      }),
    },
    {
      kind: "pipelines",
      label: t("metrics.explorer.detail.usedIn.pipelines", { count: usage.pipelines.length }),
      items: usage.pipelines,
      to: (item) => ({
        name: "pipelineEditor",
        query: { id: item.id, name: item.name, org_identifier: org },
      }),
    },
  ];
  return all.filter((group) => group.items.length);
});
</script>
