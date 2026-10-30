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

const props = withDefaults(
  defineProps<{
    header: AlertEditHeader;
    alertId: string;
    folderId?: string;
    orgId: string;
    /** `trail` sits after the title; `menu` is the below-lg copy of mute and history as items of the More menu. */
    part?: "trail" | "menu";
  }>(),
  { folderId: undefined, part: "trail" },
);

const { t } = useI18nTyped();
const router = useRouter();

const DEFAULT_PRESET = "1h";
const presetKey = ref<string>(DEFAULT_PRESET);
const preset = computed(
  () => QUICK_MUTE_PRESETS.find((p) => p.key === presetKey.value) ?? QUICK_MUTE_PRESETS[1],
);

const mute = () => props.header.muteFor(preset.value.secs);

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
  <div v-else class="flex min-w-0 items-center gap-2" data-test="add-alert-edit-status">
    <template v-if="header.muteEnabled.value">
      <div
        v-if="header.muted.value"
        class="flex items-center gap-1 max-lg:hidden"
        data-test="add-alert-muted"
      >
        <OTag
          variant="warning-soft"
          icon="notifications-paused"
          size="sm"
          :label="header.mutedUntilText.value"
          data-test="add-alert-muted-until"
        />
        <OButton
          variant="ghost-primary"
          size="xs"
          :disabled="header.pending.value"
          data-test="add-alert-unmute-btn"
          @click="header.unmute()"
          >{{ t("alerts.editMode.unmute") }}</OButton
        >
      </div>
      <div v-else class="flex items-center max-lg:hidden" data-test="add-alert-mute">
        <OButton
          variant="outline"
          size="sm-action"
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
              size="sm-action"
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
    <OTag
      v-if="header.state.value.kind === 'outcome'"
      type="alertState"
      :value="header.state.value.value"
      size="sm"
      data-test="add-alert-state-chip"
    />
    <OTag
      v-else-if="header.state.value.kind === 'disabled'"
      type="alertStatus"
      value="disabled"
      size="sm"
      data-test="add-alert-state-chip"
    />
    <OTag
      v-else
      variant="default-soft"
      size="sm"
      :label="t('alerts.editMode.state.notRun')"
      data-test="add-alert-state-chip"
    />
    <OButton
      variant="ghost-primary"
      size="sm"
      icon-left="history"
      class="max-lg:hidden"
      data-test="add-alert-history-link"
      @click="openHistory"
      >{{ t("alerts.editMode.history") }}</OButton
    >
  </div>
</template>
