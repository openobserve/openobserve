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

<!-- RO-1/RO-2/RO-6: the team's Slack channel in the Delivery tab. It is set only from Slack. -->
<template>
  <div class="flex flex-wrap items-start gap-2" data-test="oncall-team-slack">
    <OText variant="label" class="w-32 shrink-0">{{ t("oncall.slackChannelTitle") }}</OText>
    <div class="flex min-w-0 flex-1 flex-col gap-2">
      <div v-if="channel.slack_channel_set" class="flex flex-wrap items-center gap-2">
        <OText
          variant="mono"
          :class="channel.slack_native ? 'text-text-heading' : 'text-text-secondary'"
          data-test="oncall-team-slack-name"
        >
          {{ raw(`#${channel.slack_channel_name ?? ""}`) }}
        </OText>
        <OButton
          v-if="channel.slack_native && canConfigure"
          variant="outline"
          size="sm-action"
          :loading="testWrite.isPending.value"
          data-test="oncall-team-slack-test"
          @click="sendTest"
        >
          {{ t("oncall.slackChannelSendTest") }}
        </OButton>
        <OButton
          v-if="canConfigure"
          variant="ghost"
          size="sm-action"
          :disabled="saving"
          data-test="oncall-team-slack-clear"
          @click="emit('save', { clear_slack: true })"
        >
          {{ t("oncall.slackChannelClear") }}
        </OButton>
      </div>

      <OBanner
        v-if="channel.slack_unavailable_reason"
        :variant="channel.slack_connected ? 'warning' : 'default'"
        data-test="oncall-team-slack-unavailable"
      >
        {{ raw(channel.slack_unavailable_reason) }}
      </OBanner>
      <div
        v-else-if="!channel.slack_channel_set"
        class="flex flex-col gap-1"
        data-test="oncall-team-slack-guidance"
      >
        <OText variant="meta">
          <i18n-t keypath="oncall.slackChannelSetWith" tag="span">
            <template #command>
              <OCode copyable>{{ raw(hereCommand) }}</OCode>
            </template>
          </i18n-t>
        </OText>
        <OText variant="meta">{{ t("oncall.slackChannelLinkHint") }}</OText>
      </div>

      <OBanner
        v-if="channel.slack_post_problem"
        variant="error"
        data-test="oncall-team-slack-post-problem"
      >
        {{ raw(channel.slack_post_problem) }}
      </OBanner>

      <span
        v-if="result"
        class="text-xs"
        :class="result.ok ? 'text-status-success-text' : 'text-status-error-text'"
        data-test="oncall-team-slack-result"
      >
        {{ result.advice }}
      </span>

      <span v-if="showBackup" class="flex flex-wrap items-center gap-2">
        <OCheckbox
          :model-value="ticked"
          :label="t('oncall.slackChannelBackup', { webhook: raw(picked) })"
          :disabled="!canConfigure || saving"
          data-test="oncall-team-slack-same-room"
          @update:model-value="onTick"
        />
        <span v-if="webhooks.length > 1" class="w-44">
          <OSelect
            :model-value="picked"
            :options="webhookOptions"
            size="sm"
            :disabled="!canConfigure || saving"
            data-test="oncall-team-slack-same-room-pick"
            @update:model-value="onPick"
          />
        </span>
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useMutation } from "@tanstack/vue-query";

import OButton from "@/lib/core/Button/OButton.vue";
import OCode from "@/lib/core/Code/OCode.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import type { CheckboxModelValue } from "@/lib/forms/Checkbox/OCheckbox.types";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { useOnCallPermissions } from "@/composables/useOnCallPermissions";
import { testTeamSlackChannelMutation } from "@/services/oncall.queries";
import type { SetTeamChannelBody, TeamChannel } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";

const props = defineProps<{
  orgId: string;
  teamId: string;
  teamName: string;
  channel: TeamChannel;
  /** A save the parent is carrying out, so the controls cannot send a second one. */
  saving?: boolean;
}>();
const emit = defineEmits<{
  /** The Slack part of a team-channel PUT; the parent adds the team's destination list. */
  save: [body: Omit<SetTeamChannelBody, "destinations">];
}>();

const { t } = useI18nTyped();
const { canConfigure, noteConfigurationDenied } = useOnCallPermissions();

const hereCommand = computed(() => `/o2 oncall here ${props.teamName}`);

const webhooks = computed(() => props.channel.destinations);
const webhookOptions = computed(() =>
  webhooks.value.map((name) => ({ label: raw(name), value: name })),
);
const ticked = computed(() => !!props.channel.slack_same_room_destination);
const showBackup = computed(
  () => props.channel.slack_channel_set && props.channel.slack_native && webhooks.value.length > 0,
);

// The picker's choice survives an untick, so ticking again restores it.
const picked = ref("");
watch(
  () => [props.channel.slack_same_room_destination, webhooks.value] as const,
  ([same, list]) => {
    picked.value = same ?? (list.includes(picked.value) ? picked.value : (list[0] ?? ""));
  },
  { immediate: true },
);

function onTick(value: CheckboxModelValue) {
  emit("save", { slack_same_room_destination: value === true ? picked.value : "" });
}

function onPick(value: unknown) {
  picked.value = String(value ?? "");
  if (ticked.value) emit("save", { slack_same_room_destination: picked.value });
}

const testWrite = useMutation(() => testTeamSlackChannelMutation(props.orgId, props.teamId));
const result = ref<{ ok: boolean; advice: I18nText } | null>(null);

// RO-6: the advice is the server's words; a refused request shows the server's message.
async function sendTest() {
  result.value = null;
  try {
    const res = await testWrite.mutateAsync();
    result.value = { ok: res.data.ok, advice: raw(res.data.advice) };
  } catch (err: any) {
    noteConfigurationDenied(err);
    result.value = {
      ok: false,
      advice: raw(err?.response?.data?.message) || t("oncall.slackChannelTestFailed"),
    };
  }
}
</script>
