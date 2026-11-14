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
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { EmailMeFailure } from "@/composables/starterPacks/useEmailMeDestination";
import type { StarterPackFlow } from "@/composables/starterPacks/useStarterPackFlow";
import StarterPackNextCard from "./StarterPackNextCard.vue";

/** What step 1 asked of the alerts, and how the Email me save went. */
export interface ReadyAlerts {
  turnOn: boolean;
  sendTo: boolean;
  /** The destination as the select showed it. */
  destination?: I18nText;
  /** The destination's own name, for the progress row. */
  name?: string;
  /** Set when the destination is the user's own Email me one. */
  email?: string;
  failure?: EmailMeFailure;
}

type LinkKind = "turnOn" | "addDestination";

interface SummaryLine {
  key: string;
  icon: IconName;
  iconClass: string;
  text: I18nText;
  link?: LinkKind;
}

const props = defineProps<{
  flow: StarterPackFlow;
  alerts: ReadyAlerts;
  /** Whether the pack's data has arrived; null when this surface has no signal. */
  data: "receiving" | "waiting" | null;
  clusters: string[];
}>();
const emit = defineEmits<{ "open-view": []; "open-dashboard": []; "turn-on": [] }>();

const { t } = useI18nTyped();

const OK = { icon: "check-circle" as IconName, iconClass: "text-status-positive" };
const OFF = { icon: "notifications-off" as IconName, iconClass: "text-text-secondary" };

const flow = props.flow;
const title = t(flow.pack.titleKey);
const createdOf = (kind: string) =>
  flow.items.value.filter((item) => item.kind === kind && item.status === "created");
const alertsMade = computed(() => createdOf("alert").length);
const alertsOn = computed(
  () => alertsMade.value > 0 && props.alerts.turnOn && !props.alerts.failure,
);
// The lookup found these and left them as they were, so the setup's choice never reached them.
const alreadyOff = computed(
  () =>
    flow.items.value.filter(
      ({ kind, status, id }) =>
        kind === "alert" && status === "existing" && !!id && !flow.enabledAlertIds.value.has(id),
    ).length,
);
const someOn = computed(
  () =>
    alertsOn.value ||
    flow.items.value.some(
      ({ kind, status, id }) =>
        kind === "alert" && status === "existing" && !!id && flow.enabledAlertIds.value.has(id),
    ),
);

const alertsLine = computed<SummaryLine | null>(() => {
  const count = alertsMade.value;
  if (!count) return null;
  const { turnOn, sendTo, destination, email, failure } = props.alerts;
  const base = { key: "alerts" };
  if (failure) {
    const reason = t(
      failure === "forbidden"
        ? "starterPacks.ready.offForbidden"
        : "starterPacks.ready.offEmailFailed",
    );
    return { ...base, ...OFF, text: t("starterPacks.ready.alertsOff", { reason }), link: "turnOn" };
  }
  if (turnOn && sendTo) {
    const text = email
      ? t("starterPacks.ready.alertsOnEmail", { count, email: raw(email) }, count)
      : t("starterPacks.ready.alertsOn", { count, destination: destination ?? raw("") }, count);
    return { ...base, ...OK, text };
  }
  if (turnOn) {
    return {
      ...base,
      ...OK,
      text: t("starterPacks.ready.alertsHistoryOnly", { count }, count),
      link: "addDestination",
    };
  }
  if (sendTo) {
    const target = email ? raw(email) : (destination ?? raw(""));
    return {
      ...base,
      ...OFF,
      text: t("starterPacks.ready.alertsOffWithDestination", { destination: target }),
      link: "turnOn",
    };
  }
  return { ...base, ...OFF, text: t("starterPacks.ready.alertsOffPlain"), link: "turnOn" };
});

const restLink = computed<boolean>(() => alertsLine.value?.link !== "turnOn");

const lines = computed<SummaryLine[]>(() => {
  const dashboards = createdOf("dashboard").length;
  const views = createdOf("savedView").length;
  return [
    ...(dashboards
      ? [
          {
            key: "dashboards",
            ...OK,
            text: t("starterPacks.ready.dashboards", { count: dashboards }, dashboards),
          },
        ]
      : []),
    ...(views
      ? [{ key: "views", ...OK, text: t("starterPacks.ready.views", { count: views }, views) }]
      : []),
    ...(alertsLine.value ? [alertsLine.value] : []),
  ];
});

const dataLine = computed<SummaryLine | null>(() => {
  if (props.data === "receiving" && props.clusters.length) {
    return {
      key: "data",
      ...OK,
      text: t("starterPacks.ready.receiving", { cluster: raw(props.clusters.join(", ")) }),
    };
  }
  if (props.data === "waiting") {
    return {
      key: "data",
      icon: "schedule",
      iconClass: "text-text-secondary",
      text: t("starterPacks.ready.waiting"),
    };
  }
  return null;
});

const viewShown = computed(() => !!flow.pack.nativeView && flow.licensed.value);
const dashboardName = computed(() => {
  const item = flow.dashboardItem.value;
  return item ? raw(flow.nameOf(item.itemId)) : undefined;
});
</script>

<template>
  <div class="flex flex-col gap-4 text-sm" data-test="starter-pack-ready">
    <div class="flex flex-col gap-2">
      <h3
        class="text-text-heading m-0 text-base font-semibold"
        data-test="starter-pack-ready-title"
      >
        {{ t("starterPacks.ready.title", { title }) }}
      </h3>
      <ul class="m-0 flex list-none flex-col gap-1.5 p-0">
        <li
          v-for="line in lines"
          :key="line.key"
          class="flex flex-col gap-0.5"
          :data-test="`starter-pack-ready-summary-${line.key}`"
        >
          <span class="flex items-start gap-2">
            <OIcon :name="line.icon" size="sm" :class="['mt-0.5 shrink-0', line.iconClass]" />
            <span class="text-text-body">{{ line.text }}</span>
          </span>
          <span v-if="line.link" class="ps-6">
            <OButton
              variant="ghost-primary"
              size="xs"
              :data-test="
                line.link === 'addDestination'
                  ? 'starter-pack-ready-add-destination-btn'
                  : 'starter-pack-ready-turn-on-rest-btn'
              "
              @click="emit('turn-on')"
            >
              {{
                line.link === "addDestination"
                  ? t("starterPacks.ready.addDestination")
                  : t("starterPacks.ready.turnOnThem")
              }}
            </OButton>
          </span>
          <span
            v-if="line.key === 'alerts' && alreadyOff"
            class="text-text-secondary flex flex-wrap items-center gap-x-2 ps-6 text-xs"
            data-test="starter-pack-ready-summary-alerts-rest"
          >
            <span>{{ t("starterPacks.ready.alreadyOff", { count: alreadyOff }, alreadyOff) }}</span>
            <OButton
              v-if="restLink"
              variant="ghost-primary"
              size="xs"
              data-test="starter-pack-ready-turn-on-rest-btn"
              @click="emit('turn-on')"
            >
              {{ someOn ? t("starterPacks.ready.turnOnRest") : t("starterPacks.ready.turnOnThem") }}
            </OButton>
          </span>
        </li>
        <li
          v-if="!alertsLine && alreadyOff"
          class="text-text-secondary flex flex-wrap items-center gap-x-2 text-xs"
          data-test="starter-pack-ready-summary-alerts-rest"
        >
          <span>{{ t("starterPacks.ready.alreadyOff", { count: alreadyOff }, alreadyOff) }}</span>
          <OButton
            variant="ghost-primary"
            size="xs"
            data-test="starter-pack-ready-turn-on-rest-btn"
            @click="emit('turn-on')"
          >
            {{ someOn ? t("starterPacks.ready.turnOnRest") : t("starterPacks.ready.turnOnThem") }}
          </OButton>
        </li>
        <li
          v-if="dataLine"
          class="flex items-start gap-2"
          data-test="starter-pack-ready-summary-data"
        >
          <OIcon :name="dataLine.icon" size="sm" :class="['mt-0.5 shrink-0', dataLine.iconClass]" />
          <span class="text-text-body">{{ dataLine.text }}</span>
        </li>
      </ul>
    </div>

    <div v-if="viewShown || dashboardName" class="flex flex-col gap-2">
      <span class="text-text-label text-xs font-semibold">{{
        t("starterPacks.ready.whereNext")
      }}</span>
      <StarterPackNextCard
        v-if="viewShown"
        icon="hub"
        :title="t('starterPacks.ready.openView', { view: t('starterPacks.drawer.view') })"
        :hint="t('starterPacks.ready.openViewHint')"
        recommended
        data-test="starter-pack-ready-next-native-view"
        @open="emit('open-view')"
      />
      <StarterPackNextCard
        v-if="dashboardName"
        icon="dashboard"
        :title="t('starterPacks.ready.openDashboard')"
        :hint="dashboardName"
        :recommended="!viewShown"
        data-test="starter-pack-ready-next-dashboard"
        @open="emit('open-dashboard')"
      />
    </div>
  </div>
</template>
