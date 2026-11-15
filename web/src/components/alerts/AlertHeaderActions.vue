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
    icon="check"
    :disabled="actions.pending.value"
    data-test="alerts-alertdetail-ack"
    @click="onAcknowledge"
  >
    {{ t("alerts.ack.acknowledge") }}
  </OButton>
  <!-- A sibling, not a child: inside the button it would anchor to the icon alone. -->
  <OTooltip v-if="showAcknowledge && acknowledgeHint" :content="acknowledgeHint" />

  <!-- Mute, its extensions and the ack follow-ups live in one ⋯, so the header keeps two secondaries (H3). -->
  <ODropdown v-if="hasMenu" align="end">
    <template #trigger>
      <OButton
        icon-only
        variant="ghost"
        icon="more-horiz"
        :label="t('alerts.moreActions')"
        data-test="alerts-alertdetail-more"
      />
    </template>
    <template v-if="muteEnabled">
      <template v-if="downtime?.end_here">
        <MuteMenuItems
          labels="extend"
          until-clear
          data-test-prefix="alerts-alertdetail-extend"
          @preset="(secs) => onExtend({ minutes: secs / 60 })"
          @until-clear="onExtend({ untilClear: true })"
          @until="extendUntilOpen = true"
        />
        <ODropdownItem
          icon="notifications-active"
          :disabled="actions.pending.value"
          data-test="alerts-alertdetail-end-mute"
          @select="onEndMute"
        >
          {{ t("alerts.downtimes.mute.endMute") }}
        </ODropdownItem>
      </template>
      <ODropdownItem
        v-else-if="downtime"
        icon="open-in-new"
        data-test="alerts-alertdetail-muted-by"
        @select="openDowntime"
      >
        {{ t("alerts.downtimes.mute.mutedBy", { name: downtime.name }) }}
      </ODropdownItem>
      <MuteMenuItems
        v-else
        until-clear
        data-test-prefix="alerts-alertdetail-mute"
        @preset="(secs) => onMute({ minutes: secs / 60 })"
        @until-clear="onMute({ untilClear: true })"
        @until="muteDialogOpen = true"
      />
    </template>
    <template v-if="ack">
      <ODropdownSeparator v-if="muteEnabled" />
      <ODropdownItem icon="person" data-test="alerts-alertdetail-unack" @select="onUnack">
        {{ t("alerts.ack.unacknowledge") }}
      </ODropdownItem>
      <ODropdownItem
        v-if="ack.acked_by !== actions.me.value"
        icon="person"
        data-test="alerts-alertdetail-take-over"
        @select="onTakeOver"
      >
        {{ t("alerts.ack.takeOver") }}
      </ODropdownItem>
    </template>
  </ODropdown>

  <QuickMuteDialog
    v-if="muteEnabled"
    v-model:open="muteDialogOpen"
    :selection="muteSelection"
    :alert="muteAlertContext"
    @muted="emit('changed')"
  />
  <AlertMuteUntilDialog
    v-if="muteEnabled && downtime?.end_here"
    v-model:open="extendUntilOpen"
    :target="target"
    :downtime="downtime"
    @done="emit('changed')"
    @settled="emit('changed')"
  />
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useI18nTyped } from "@/types/i18n";
import { useOrgId } from "@/composables/query";
import type { ActiveDowntime } from "@/services/downtimes";
import type { AckView, AlertGroup } from "@/ts/interfaces/alert";
import { useAlertActions, type AlertMuteRef } from "@/composables/alerts/useAlertActions";
import { downtimeLink } from "@/utils/downtimes/link";
import type { MuteActionResult } from "@/utils/downtimes/muteResult";
import {
  groupOptionOf,
  type AlertMuteEnd,
  type QuickMuteAlertContext,
  type QuickMuteSelection,
} from "@/utils/downtimes/quickMute";
import OButton from "@/lib/core/Button/OButton.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
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
    downtime?: ActiveDowntime | null;
    muteEnabled: boolean;
    /** A multi-alert's firing groups, which Until… offers to scope the mute to. */
    groups?: AlertGroup[];
  }>(),
  { folderId: undefined, unackedGroups: null, ack: null, downtime: null, groups: () => [] },
);

const emit = defineEmits<{ changed: [] }>();

const { t } = useI18nTyped();
const actions = useAlertActions();
const router = useRouter();
const orgId = useOrgId();

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

const hasMenu = computed(() => props.muteEnabled || !!props.ack);

const acknowledgeHint = computed(() => {
  const count = props.unackedGroups ?? 0;
  return isMulti.value ? t("alerts.ack.acknowledgeGroups", { count }, count) : "";
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
    ? {
        id: props.downtime.id,
        ends_at: props.downtime.ends_at,
        version: props.downtime.version,
        folder_id: props.downtime.folder_id,
      }
    : null;

const after = (ok: boolean) => {
  if (ok) emit("changed");
};

const onAcknowledge = async () =>
  after(await actions.acknowledge(target.value, isMulti.value ? { allGroups: true } : {}));

const onUnack = async () => after(await actions.unacknowledge(target.value, { groupKey: "" }));

const onTakeOver = async () => after(await actions.takeOver(target.value, { groupKey: "" }));

const onMute = async (end: AlertMuteEnd) => after(await actions.mute(target.value, end));

// Any answer refreshes: a refused End or Extend means the header shows a stale mute.
const afterMute = (result: MuteActionResult) => {
  if (result !== "failed") emit("changed");
};

const onExtend = async (end: AlertMuteEnd) => {
  const downtime = muteRef();
  if (downtime) afterMute(await actions.extend(target.value, downtime, end));
};

const onEndMute = async () => {
  const downtime = muteRef();
  if (downtime) afterMute(await actions.endMute(target.value, downtime));
};

const openDowntime = () => {
  if (props.downtime) void router.push(downtimeLink(props.downtime, orgId.value));
};
</script>
