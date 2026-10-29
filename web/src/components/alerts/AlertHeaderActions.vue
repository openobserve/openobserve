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
  <OButton
    v-if="showAcknowledge"
    variant="primary"
    size="sm-action"
    icon-left="check"
    :disabled="actions.pending.value"
    data-test="alerts-alertdetail-ack"
    @click="onAcknowledge"
  >
    {{ acknowledgeLabel }}
  </OButton>

  <template v-if="muteEnabled">
    <template v-if="downtime">
      <ODropdown align="end">
        <template #trigger>
          <OButton
            variant="outline"
            size="sm-action"
            icon-left="hourglass-empty"
            data-test="alerts-alertdetail-extend"
          >
            {{ t("alerts.downtimes.actions.extend") }}
          </OButton>
        </template>
        <MuteMenuItems
          labels="extend"
          until-clear
          data-test-prefix="alerts-alertdetail-extend"
          @preset="(secs) => onExtend({ minutes: secs / 60 })"
          @until-clear="onExtend({ untilClear: true })"
          @until="extendUntilOpen = true"
        />
      </ODropdown>
      <OButton
        variant="outline"
        size="sm-action"
        :disabled="actions.pending.value"
        data-test="alerts-alertdetail-end-mute"
        @click="onEndMute"
      >
        {{ t("alerts.downtimes.mute.endMute") }}
      </OButton>
    </template>
    <ODropdown v-else align="end">
      <template #trigger>
        <OButton
          variant="outline"
          size="sm-action"
          icon-left="notifications-paused"
          icon-right="arrow-drop-down"
          data-test="alerts-alertdetail-mute"
        >
          {{ t("alerts.downtimes.mute.bulk") }}
        </OButton>
      </template>
      <MuteMenuItems
        until-clear
        data-test-prefix="alerts-alertdetail-mute"
        @preset="(secs) => onMute({ minutes: secs / 60 })"
        @until-clear="onMute({ untilClear: true })"
        @until="muteDialogOpen = true"
      />
    </ODropdown>
  </template>

  <ODropdown v-if="ack" align="end">
    <template #trigger>
      <OButton
        variant="outline"
        size="icon-sm"
        icon-left="more-vert"
        :aria-label="t('alerts.moreActions')"
        data-test="alerts-alertdetail-ack-menu"
      />
    </template>
    <ODropdownItem icon-left="person" data-test="alerts-alertdetail-unack" @select="onUnack">
      {{ t("alerts.ack.unacknowledge") }}
    </ODropdownItem>
    <ODropdownItem
      v-if="ack.acked_by !== actions.me.value"
      icon-left="person"
      data-test="alerts-alertdetail-take-over"
      @select="onTakeOver"
    >
      {{ t("alerts.ack.takeOver") }}
    </ODropdownItem>
  </ODropdown>

  <QuickMuteDialog
    v-if="muteEnabled"
    v-model:open="muteDialogOpen"
    :selection="muteSelection"
    :alert="muteAlertContext"
    @muted="emit('changed')"
  />
  <AlertMuteUntilDialog
    v-if="muteEnabled && downtime"
    v-model:open="extendUntilOpen"
    :target="target"
    :downtime="downtime"
    @done="emit('changed')"
  />
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18nTyped } from "@/types/i18n";
import type { ActiveDowntime } from "@/services/downtimes";
import type { AckView, AlertGroup } from "@/ts/interfaces/alert";
import { useAlertActions, type AlertMuteRef } from "@/composables/alerts/useAlertActions";
import {
  groupOptionOf,
  type AlertMuteEnd,
  type QuickMuteAlertContext,
  type QuickMuteSelection,
} from "@/utils/downtimes/quickMute";
import OButton from "@/lib/core/Button/OButton.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import MuteMenuItems from "./downtimes/MuteMenuItems.vue";
import QuickMuteDialog from "./downtimes/QuickMuteDialog.vue";
import AlertMuteUntilDialog from "./AlertMuteUntilDialog.vue";

const props = withDefaults(
  defineProps<{
    alertId: string;
    name: string;
    folderId?: string;
    /** A single-row or composite alert is firing now. */
    firing: boolean;
    /** A multi-alert's firing groups nobody acknowledged; null for any other alert. */
    unackedGroups?: number | null;
    /** The ack in force on a single-row or composite alert. */
    ack?: Pick<AckView, "acked_by" | "acked_at" | "ack_source"> | null;
    downtime?: (ActiveDowntime & { version?: number }) | null;
    muteEnabled: boolean;
    /** A multi-alert's firing groups, which Until… offers to scope the mute to. */
    groups?: AlertGroup[];
  }>(),
  { folderId: undefined, unackedGroups: null, ack: null, downtime: null, groups: () => [] },
);

const emit = defineEmits<{ changed: [] }>();

const { t } = useI18nTyped();
const actions = useAlertActions();

const muteDialogOpen = ref(false);
const extendUntilOpen = ref(false);

const target = computed(() => ({
  alertId: props.alertId,
  name: props.name,
  folderId: props.folderId,
}));

const isMulti = computed(() => props.unackedGroups !== null);

const showAcknowledge = computed(() =>
  isMulti.value ? (props.unackedGroups ?? 0) > 0 : props.firing && !props.ack,
);

const acknowledgeLabel = computed(() => {
  const count = props.unackedGroups ?? 0;
  return isMulti.value
    ? t("alerts.ack.acknowledgeGroups", { count }, count)
    : t("alerts.ack.acknowledge");
});

const muteSelection = computed<QuickMuteSelection[]>(() => [
  { module: "alerts", ids: [props.alertId] },
]);

const muteAlertContext = computed<QuickMuteAlertContext>(() => ({
  ...target.value,
  groups: props.groups.length ? props.groups.map(groupOptionOf) : undefined,
}));

const muteRef = (): AlertMuteRef | null =>
  props.downtime
    ? { id: props.downtime.id, ends_at: props.downtime.ends_at, version: props.downtime.version }
    : null;

const after = (ok: boolean) => {
  if (ok) emit("changed");
};

const onAcknowledge = async () =>
  after(await actions.acknowledge(target.value, isMulti.value ? { allGroups: true } : {}));

const onUnack = async () => after(await actions.unacknowledge(target.value, { groupKey: "" }));

const onTakeOver = async () => after(await actions.takeOver(target.value, { groupKey: "" }));

const onMute = async (end: AlertMuteEnd) => after(await actions.mute(target.value, end));

const onExtend = async (end: AlertMuteEnd) => {
  const downtime = muteRef();
  if (downtime) after(await actions.extend(target.value, downtime, end));
};

const onEndMute = async () => {
  const downtime = muteRef();
  if (downtime) after(await actions.endMute(target.value, downtime.id));
};
</script>
