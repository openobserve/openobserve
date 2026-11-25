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
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useI18nTyped } from "@/types/i18n";
import { QUICK_MUTE_PRESETS } from "@/utils/downtimes/quickMute";
import type { AlertEditHeader } from "@/composables/alerts/useAlertEditHeader";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useViewerTimezone } from "@/composables/downtimes/useViewerTimezone";
import { realtimeRunChip, runClock } from "@/utils/alerts/recentRuns";

const props = withDefaults(
  defineProps<{
    header: AlertEditHeader;
    alertId: string;
    folderId?: string;
    orgId: string;
    /** `state` trails the title, `actions` sits with the header actions, `menu` is their below-lg copy in More. */
    part: "state" | "actions" | "menu";
  }>(),
  { folderId: undefined },
);

const { t } = useI18nTyped();
const router = useRouter();

const zone = useViewerTimezone();
const realtimeChip = computed(() => {
  const state = props.header.state.value;
  if (state.kind !== "realtime") return null;
  return realtimeRunChip(t, state.firedUs, (ms) => runClock(ms, zone.value, Date.now()));
});

const DEFAULT_PRESET = "1h";
const presetKey = ref<string>(DEFAULT_PRESET);
const preset = computed(
  () => QUICK_MUTE_PRESETS.find((p) => p.key === presetKey.value) ?? QUICK_MUTE_PRESETS[1],
);

const mute = () => props.header.muteFor(preset.value.secs);

const toggleEnabled = () => {
  if (!props.header.pending.value) void props.header.toggleEnabled();
};

const openHistory = () =>
  router.push({
    name: "alertDetail",
    params: { alert_id: props.alertId },
    query: { folder: props.folderId, org_identifier: props.orgId },
  });
</script>

<template>
  <template v-if="part === 'menu'">
    <template v-if="header.muteEnabled.value">
      <ODropdownItem
        v-if="header.muted.value"
        icon-left="notifications-active"
        :disabled="header.pending.value"
        data-test="add-alert-menu-unmute"
        @select="header.unmute()"
      >
        {{ t("alerts.editMode.unmute") }}
      </ODropdownItem>
      <ODropdownItem
        v-else
        icon-left="notifications-paused"
        :disabled="header.pending.value"
        data-test="add-alert-menu-mute"
        @select="mute"
      >
        {{ t("alerts.editMode.muteForPreset", { duration: t(preset.labelKey) }) }}
      </ODropdownItem>
    </template>
    <ODropdownItem icon-left="history" data-test="add-alert-menu-history" @select="openHistory">
      {{ t("alerts.editMode.history") }}
    </ODropdownItem>
  </template>
  <div
    v-else-if="part === 'state'"
    class="flex shrink-0 items-center gap-2"
    data-test="add-alert-edit-status"
  >
    <OTag
      v-if="header.muteEnabled.value && header.muted.value"
      variant="warning-soft"
      icon="notifications-paused"
      size="sm"
      :label="header.mutedUntilText.value"
      data-test="add-alert-muted-until"
    />
    <OTag
      v-if="header.state.value.kind === 'outcome'"
      type="alertState"
      :value="header.state.value.value"
      size="sm"
      data-test="add-alert-state-chip"
    />
    <OTooltip v-else-if="realtimeChip" :content="realtimeChip.tooltip">
      <OTag
        variant="default-soft"
        size="sm"
        :label="realtimeChip.label"
        data-test="add-alert-state-chip"
      />
    </OTooltip>
    <OTag
      v-else-if="header.state.value.kind === 'notRun'"
      variant="default-soft"
      size="sm"
      :label="t('alerts.editMode.state.notRun')"
      data-test="add-alert-state-chip"
    />
    <!-- OSwitch flips itself on click; taking the click first keeps it on the saved state until the write confirms. -->
    <span class="inline-flex" @click.capture.stop="toggleEnabled">
      <OSwitch
        :model-value="header.enabled.value"
        :aria-label="t('alerts.editMode.enabled')"
        state-text
        off-tone="neutral"
        :disabled="header.pending.value"
        :aria-busy="header.pending.value"
        data-test="add-alert-enabled-switch"
      />
    </span>
  </div>
  <template v-else>
    <OButton
      variant="outline"
      size="sm"
      icon-left="history"
      data-test="add-alert-history-link"
      @click="openHistory"
      >{{ t("alerts.editMode.history") }}</OButton
    >
    <template v-if="header.muteEnabled.value">
      <OButton
        v-if="header.muted.value"
        variant="outline"
        size="sm"
        icon-left="notifications-active"
        :disabled="header.pending.value"
        data-test="add-alert-unmute-btn"
        @click="header.unmute()"
        >{{ t("alerts.editMode.unmute") }}</OButton
      >
      <div v-else class="flex items-center" data-test="add-alert-mute">
        <OButton
          variant="outline"
          size="sm"
          icon-left="notifications-paused"
          class="rounded-e-none"
          :disabled="header.pending.value"
          data-test="add-alert-mute-btn"
          @click="mute"
          >{{ t("alerts.editMode.muteFor") }}</OButton
        >
        <ODropdown align="start">
          <template #trigger>
            <OButton
              variant="outline"
              size="sm"
              icon-right="arrow-drop-down"
              class="rounded-s-none border-s-0"
              :aria-label="t('alerts.editMode.muteDuration')"
              data-test="add-alert-mute-duration"
              >{{ t(preset.labelKey) }}</OButton
            >
          </template>
          <ODropdownItem
            v-for="option in QUICK_MUTE_PRESETS"
            :key="option.key"
            :icon-left="option.key === presetKey ? 'check' : undefined"
            :data-test="`add-alert-mute-duration-${option.key}`"
            @select="presetKey = option.key"
          >
            {{ t(option.labelKey) }}
          </ODropdownItem>
        </ODropdown>
      </div>
    </template>
  </template>
</template>
