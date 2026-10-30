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
  <section
    class="bg-surface-base border-border-default rounded-surface flex flex-col gap-3 border p-3"
    data-test="downtime-notify"
  >
    <header class="flex items-center gap-2">
      <OIcon name="notifications" size="sm" class="text-text-secondary" />
      <span class="text-text-heading text-sm font-semibold">
        {{ t("alerts.downtimes.notify.title") }}
      </span>
    </header>
    <p class="text-text-secondary text-xs">{{ t("alerts.downtimes.notify.caption") }}</p>

    <AlertDestinationsField
      :destinations="notify.destinations"
      :workflows="[]"
      :destination-options="destinationOptions"
      :label="t('alerts.downtimes.notify.destinations')"
      :required="false"
      tooltip=""
      :supports-workflows="false"
      data-test="downtime-notify-destinations"
      @update:destinations="pickDestinations"
      @refresh="refreshDestinations"
    />

    <div class="flex flex-col gap-3" data-test="downtime-notify-events">
      <div v-for="event in events" :key="event.value" class="flex flex-col gap-0.5">
        <OFormSwitch
          :name="`notifications.${event.value}`"
          :label="event.label"
          :disabled="!hasDestinations"
          :data-test="`downtime-notify-event-${event.value}`"
        />
        <span class="text-text-secondary text-xs">{{ event.help }}</span>
      </div>
    </div>

    <OFormInput
      v-if="notify.ending_soon"
      name="notifications.lead"
      :label="t('alerts.downtimes.notify.lead')"
      :placeholder="t('alerts.downtimes.scheduleForm.durationPlaceholder')"
      :help-text="t('alerts.downtimes.notify.leadHelp')"
      :disabled="!hasDestinations"
      width="sm"
      data-test="downtime-notify-lead"
    />

    <p class="text-text-secondary text-xs" data-test="downtime-notify-region">
      {{ t("alerts.downtimes.notify.regionNote") }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, inject } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import { useOrgId } from "@/composables/query";
import { destinationsQuery } from "@/services/alert_destination.queries";
import type { NotificationEvent } from "@/services/downtimes";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";
import {
  NOTIFICATION_EVENTS,
  notifyAfterPick,
  type DowntimeFormValues,
} from "@/utils/downtimes/downtimeForm";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import AlertDestinationsField from "@/components/alerts/AlertDestinationsField.vue";

const EVENT_KEYS = {
  started: {
    label: "alerts.downtimes.notify.events.started",
    help: "alerts.downtimes.notify.events.startedHelp",
  },
  ending_soon: {
    label: "alerts.downtimes.notify.events.ending_soon",
    help: "alerts.downtimes.notify.events.ending_soonHelp",
  },
  ended: {
    label: "alerts.downtimes.notify.events.ended",
    help: "alerts.downtimes.notify.events.endedHelp",
  },
  cancelled: {
    label: "alerts.downtimes.notify.events.cancelled",
    help: "alerts.downtimes.notify.events.cancelledHelp",
  },
  extended: {
    label: "alerts.downtimes.notify.events.extended",
    help: "alerts.downtimes.notify.events.extendedHelp",
  },
} as const satisfies Record<NotificationEvent, { label: I18nKey; help: I18nKey }>;

const { t } = useI18nTyped();
const orgId = useOrgId();
const form = inject(FORM_CONTEXT_KEY, null);

const notify = form.useStore((s: { values: DowntimeFormValues }) => s.values.notifications);
const hasDestinations = computed(() => notify.value.destinations.length > 0);

const destinationsList = useQuery(() =>
  Object.assign(destinationsQuery(orgId.value, "alert"), { enabled: !!orgId.value }),
);
const destinationOptions = computed(() =>
  (destinationsList.data.value ?? []).map((d: { name: string }) => d.name),
);
const refreshDestinations = () => void destinationsList.refetch();

const events = computed<{ value: NotificationEvent; label: I18nText; help: I18nText }[]>(() =>
  NOTIFICATION_EVENTS.map((value) => ({
    value,
    label: t(EVENT_KEYS[value].label),
    help: t(EVENT_KEYS[value].help),
  })),
);

const pickDestinations = (destinations: string[]) =>
  form.setFieldValue("notifications", notifyAfterPick(notify.value, destinations));
</script>
