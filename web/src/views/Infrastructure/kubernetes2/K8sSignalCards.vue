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

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import type { Incident } from "@/services/incidents";
import { formatAge } from "./kubernetesModel";
import type { FiringAlert } from "./useOverviewSignals";

const ALERT_ROWS = 5;

const props = defineProps<{
  incidents: Incident[];
  incidentsVisible: boolean;
  incidentsLoading: boolean;
  alerts: FiringAlert[];
  alertsVisible: boolean;
  alertsLoading: boolean;
  // µs
  endUs: number;
}>();

const emit = defineEmits<{
  "open-incident": [id: string];
  "open-incidents": [];
  "open-alerts": [];
}>();

const { t } = useI18nTyped();

const incident = computed(() => props.incidents[0] ?? null);
const shownAlerts = computed(() => props.alerts.slice(0, ALERT_ROWS));

const ageOf = (us: number | null | undefined) =>
  us ? formatAge(Math.max(0, props.endUs - us)) : "—";
</script>

<template>
  <section
    v-if="incidentsVisible && (incidentsLoading || incident)"
    class="bg-surface-panel border-border-default rounded-surface flex min-w-0 flex-col gap-2 border p-3"
    data-test="k8s2-overview-incident-card"
  >
    <OText variant="card-title">{{ t("infra.k8s2.overviewIncidentTitle") }}</OText>
    <template v-if="incidentsLoading">
      <OSkeleton type="text" class="h-5 w-3/4" />
      <OSkeleton type="text" class="h-3 w-1/2" />
    </template>
    <template v-else-if="incident">
      <div class="flex min-w-0 items-center gap-2">
        <OTruncatedText class="text-text-heading text-sm font-medium">{{
          raw(incident.title || t("infra.k8s2.overviewIncidentUntitled"))
        }}</OTruncatedText>
        <OTag type="severity" :value="(incident.severity || 'p4').toLowerCase()" />
      </div>
      <OText variant="meta" class="text-text-secondary">{{
        t("infra.k8s2.overviewIncidentMeta", { age: ageOf(incident.first_alert_at) })
      }}</OText>
      <div class="flex items-center gap-2">
        <OButton
          variant="ghost-primary"
          size="sm"
          icon-right="arrow-forward"
          data-test="k8s2-overview-incident-open"
          @click="emit('open-incident', incident.id)"
        >
          {{ t("infra.k8s2.overviewIncidentOpen") }}
        </OButton>
        <OButton
          v-if="incidents.length > 1"
          variant="ghost"
          size="sm"
          data-test="k8s2-overview-incident-more"
          @click="emit('open-incidents')"
        >
          {{
            t(
              "infra.k8s2.overviewIncidentMore",
              { count: incidents.length - 1 },
              incidents.length - 1,
            )
          }}
        </OButton>
      </div>
    </template>
  </section>

  <section
    v-if="alertsVisible && (alertsLoading || alerts.length)"
    class="bg-surface-panel border-border-default rounded-surface flex min-w-0 flex-col gap-2 border p-3"
    data-test="k8s2-overview-alerts-card"
  >
    <OText variant="card-title">{{ t("infra.k8s2.overviewAlertsTitle") }}</OText>
    <template v-if="alertsLoading">
      <OSkeleton v-for="n in 2" :key="n" type="text" class="h-8" />
    </template>
    <template v-else>
      <ul class="m-0 flex list-none flex-col p-0">
        <li
          v-for="alert in shownAlerts"
          :key="alert.id"
          class="border-border-default flex min-w-0 items-baseline gap-2 border-t py-1.5 first:border-t-0"
          :data-test="`k8s2-overview-alert-${alert.id}`"
        >
          <OTruncatedText class="text-text-heading text-compact min-w-0 flex-1">{{
            raw(alert.name)
          }}</OTruncatedText>
          <span class="text-text-secondary shrink-0 text-xs tabular-nums">{{
            raw(ageOf(alert.lastTriggeredAt))
          }}</span>
        </li>
      </ul>
      <div class="flex items-center justify-between gap-2">
        <OText
          variant="meta"
          class="text-text-secondary"
          data-test="k8s2-overview-alerts-caption"
          >{{ t("infra.k8s2.overviewAlertsOrgWide") }}</OText
        >
        <OButton
          variant="ghost-primary"
          size="sm"
          class="shrink-0"
          data-test="k8s2-overview-alerts-open"
          @click="emit('open-alerts')"
        >
          {{
            alerts.length > shownAlerts.length
              ? t("infra.k8s2.overviewAlertsMore", { count: alerts.length - shownAlerts.length })
              : t("infra.k8s2.overviewAlertsViewAll")
          }}
        </OButton>
      </div>
    </template>
  </section>
</template>
