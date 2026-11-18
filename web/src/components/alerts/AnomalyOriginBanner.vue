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

<!-- Logs, Traces and Metrics opened from an anomaly link; the values come from the link, so they stay the alert's. -->
<template>
  <OBanner
    v-if="link"
    variant="info"
    icon="insights"
    dense
    inline-actions
    :data-test="dataTest"
  >
    <div class="flex min-w-0 flex-col gap-0.5">
      <span class="text-text-heading text-sm font-semibold" :data-test="`${dataTest}-title`">
        {{ title }}
      </span>
      <span v-if="valuesLine" class="text-text-body text-sm" :data-test="`${dataTest}-values`">
        {{ valuesLine }}
      </span>
      <span
        v-if="!link.filterApplied"
        class="text-status-warning-text text-xs"
        :data-test="`${dataTest}-filter-not-applied`"
      >
        {{ t("alerts.anomaly.originFilterNotApplied") }}
      </span>
    </div>
    <template #actions>
      <div v-if="link" class="flex shrink-0 items-center gap-1">
        <OButton
          variant="ghost-primary"
          size="sm"
          icon-left="arrow-back"
          :data-test="`${dataTest}-back`"
          @click="backToAnomaly"
        >
          {{ t("alerts.anomaly.originBack") }}
        </OButton>
        <OButton
          variant="ghost"
          size="icon-xs-sq"
          icon-left="close"
          :aria-label="t('common.close')"
          :data-test="`${dataTest}-close`"
          @click="close"
        />
      </div>
    </template>
  </OBanner>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { useQuery } from "@tanstack/vue-query";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { anomalyExploreQuery } from "@/services/anomaly_detection.queries";
import { parseAnomalyLink, withoutAnomalyLinkParams } from "@/utils/alerts/anomalyLinkParams";
import { formatAnomalyNumber, formatUtcHm } from "@/utils/alerts/anomalyExploreView";

withDefaults(defineProps<{ dataTest?: string }>(), {
  dataTest: "alerts-anomalyoriginbanner",
});

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const store = useStore();

const link = computed(() => parseAnomalyLink(route.query as Record<string, unknown>));
const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");

// The name only: a refusal or a failure keeps the unnamed title, and the page stays usable.
const explore = useQuery(() =>
  Object.assign(
    anomalyExploreQuery(org.value, link.value?.anomalyId ?? "", {}, { silentForbidden: true }),
    { enabled: !!org.value && !!link.value?.anomalyId, retry: false },
  ),
);

const title = computed<I18nText>(() => {
  const name = explore.data.value?.name;
  return name
    ? t("alerts.anomaly.originTitle", { name: raw(name) })
    : t("alerts.anomaly.originTitleUnnamed");
});

const valuesLine = computed<I18nText | null>(() => {
  const l = link.value;
  if (!l || (l.kind !== "absence" && l.actual === null)) return null;
  const measure = l.measure ? raw(l.measure) : t("alerts.anomaly.originMeasureFallback");
  const span =
    l.startUs !== null && l.endUs !== null
      ? t("alerts.anomaly.originWindow", {
          start: formatUtcHm(l.startUs),
          end: formatUtcHm(l.endUs),
        })
      : null;
  if (l.kind === "absence") {
    return span
      ? t("alerts.anomaly.originValuesAbsence", { measure, window: span })
      : t("alerts.anomaly.originValuesAbsenceNoWindow", { measure });
  }
  const actual = formatAnomalyNumber(l.actual as number);
  if (l.kind !== "partial_drop" && l.lower !== null && l.upper !== null) {
    const params = {
      measure,
      actual,
      lower: formatAnomalyNumber(l.lower),
      upper: formatAnomalyNumber(l.upper),
    };
    return span
      ? t("alerts.anomaly.originValues", { ...params, window: span })
      : t("alerts.anomaly.originValuesNoWindow", params);
  }
  return span
    ? t("alerts.anomaly.originValuesActual", { measure, actual, window: span })
    : t("alerts.anomaly.originValuesActualNoWindow", { measure, actual });
});

const backToAnomaly = () => {
  if (!link.value) return;
  void router.push({
    name: "alertDetail",
    params: { alert_id: link.value.anomalyId },
    query: { org_identifier: org.value },
  });
};

/** Dropping the parameters is what hides it: a refresh keeps it closed, the next link shows it. */
const close = () => {
  void router.replace({ query: withoutAnomalyLinkParams({ ...route.query }) });
};
</script>
