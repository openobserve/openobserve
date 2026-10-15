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
  <div class="flex flex-col gap-2" data-test="oncall-team-slack">
    <div class="flex flex-wrap items-center gap-2">
      <OText variant="label" class="w-32 shrink-0">
        {{ t("oncallSlack.teamChannelTitle") }}
      </OText>
      <template v-if="channel.slack_channel_set">
        <OText class="text-text-heading font-medium" data-test="oncall-team-slack-name">
          {{ raw(`#${channel.slack_channel_name ?? ""}`) }}
        </OText>
        <OButton
          v-if="channel.slack_native"
          variant="outline"
          size="sm-action"
          :loading="testing"
          :disabled="!canConfigure"
          data-test="oncall-team-slack-test"
          @click="sendTest"
        >
          {{ t("oncallSlack.teamChannelSendTest") }}
        </OButton>
        <OButton
          variant="ghost"
          size="sm-action"
          :disabled="!canConfigure || saving"
          data-test="oncall-team-slack-clear"
          @click="emit('save', { clear_slack: true })"
        >
          {{ t("oncallSlack.teamChannelClear") }}
        </OButton>
      </template>
      <OText v-else-if="!channel.slack_connected" variant="meta" data-test="oncall-team-slack-off">
        {{ t("oncallSlack.teamChannelNotConnected") }}
      </OText>
      <OText v-else variant="meta" data-test="oncall-team-slack-unset">
        {{ t("oncallSlack.teamChannelNotSet") }}
      </OText>
    </div>

    <div
      v-if="!channel.slack_channel_set && channel.slack_connected"
      class="ms-34 flex flex-col gap-1"
      data-test="oncall-team-slack-guidance"
    >
      <span class="flex items-center gap-1">
        <OText variant="meta">{{
          t("oncallSlack.teamChannelGuidance", { team: raw(teamName) })
        }}</OText>
        <OButton
          variant="ghost"
          size="icon-xs"
          icon-left="content-copy"
          :aria-label="t('common.copyToClipboard')"
          data-test="oncall-team-slack-copy"
          @click="copyToClipboard(hereCommand, t)"
        />
      </span>
      <OText variant="meta">{{ t("oncallSlack.teamChannelLinkHint") }}</OText>
    </div>

    <OBanner
      v-if="channel.slack_channel_set && !channel.slack_native"
      variant="warning"
      class="ms-34"
      data-test="oncall-team-slack-mismatch"
    >
      {{ t("oncallSlack.teamChannelMismatch") }}
    </OBanner>

    <div
      v-if="channel.slack_native && webhooks.length"
      class="ms-34 flex flex-col gap-1"
      data-test="oncall-team-slack-same-room"
    >
      <span class="flex flex-wrap items-center gap-2">
        <OCheckbox
          :model-value="ticked"
          size="sm"
          :label="stopLabel"
          :disabled="!canConfigure || saving"
          data-test="oncall-team-slack-stop"
          @update:model-value="onTick"
        />
        <span v-if="webhooks.length > 1" class="w-44">
          <OSelect
            :model-value="picked"
            :options="webhookOptions"
            size="sm"
            :disabled="!canConfigure || saving"
            data-test="oncall-team-slack-stop-pick"
            @update:model-value="onPick"
          />
        </span>
        <OIcon
          v-if="!ticked"
          name="info-outline"
          size="sm"
          class="cursor-help"
          data-test="oncall-team-slack-stop-risk"
        >
          <OTooltip side="right" :content="t('oncallSlack.teamChannelStopRisk')" />
        </OIcon>
      </span>
      <OText variant="meta">{{ t("oncallSlack.teamChannelStopHelp") }}</OText>
    </div>

    <div v-if="result" class="ms-34" data-test="oncall-team-slack-result">
      <span v-if="result.ok" class="text-status-success-text flex items-center gap-1 text-xs">
        <OIcon name="check" size="sm" />
        {{
          t("oncallSlack.teamChannelTestSent", {
            channel: raw(`#${channel.slack_channel_name ?? ""}`),
          })
        }}
      </span>
      <span v-else class="text-status-error-text text-xs">{{ result.advice }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";

import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import type { CheckboxModelValue } from "@/lib/forms/Checkbox/OCheckbox.types";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useOnCallPermissions } from "@/composables/useOnCallPermissions";
import oncallService from "@/services/oncall";
import type { SetTeamChannelBody, TeamChannel } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { copyToClipboard } from "@/utils/clipboard";

const props = defineProps<{
  orgId: string;
  teamId: string;
  teamName: string;
  channel: TeamChannel;
  /** A save the parent is carrying out, so the controls cannot send a second one. */
  saving?: boolean;
}>();
const emit = defineEmits<{
  /** The Slack part of a team-channel PUT; the parent adds the team's own destination list. */
  save: [body: Omit<SetTeamChannelBody, "destinations">];
}>();

const { t } = useI18nTyped();
const { canConfigure, noteConfigurationDenied } = useOnCallPermissions();

const webhooks = computed(() => props.channel.destinations);
const webhookOptions = computed(() =>
  webhooks.value.map((name) => ({ label: raw(name), value: name })),
);
const ticked = computed(() => !!props.channel.slack_same_room_destination);
const hereCommand = computed(() => `/oncall here ${props.teamName}`);

// The picker's choice survives an untick, so ticking again restores it.
const picked = ref("");
watch(
  () => [props.channel.slack_same_room_destination, webhooks.value] as const,
  ([same, list]) => {
    picked.value = same ?? (list.includes(picked.value) ? picked.value : (list[0] ?? ""));
  },
  { immediate: true },
);

const stopLabel = computed(() =>
  webhooks.value.length > 1
    ? t("oncallSlack.teamChannelStopPick")
    : t("oncallSlack.teamChannelStop", { destination: raw(webhooks.value[0] ?? "") }),
);

function onTick(value: CheckboxModelValue) {
  emit("save", value === true ? { slack_same_room_destination: picked.value } : {});
}

function onPick(value: unknown) {
  picked.value = String(value ?? "");
  if (ticked.value) emit("save", { slack_same_room_destination: picked.value });
}

const testing = ref(false);
const result = ref<{ ok: boolean; advice: I18nText } | null>(null);

// RO-7: the answer is shown under the row; a refusal with no class is worded by the server.
async function sendTest() {
  testing.value = true;
  result.value = null;
  try {
    const res = await oncallService.testTeamSlackChannel({
      org_identifier: props.orgId,
      team_id: props.teamId,
    });
    result.value = { ok: res.data.ok, advice: raw(res.data.advice ?? "") };
  } catch (err: any) {
    noteConfigurationDenied(err);
    result.value = {
      ok: false,
      advice: raw(err?.response?.data?.message) || t("oncallSlack.teamChannelTestFailed"),
    };
  } finally {
    testing.value = false;
  }
}
</script>
