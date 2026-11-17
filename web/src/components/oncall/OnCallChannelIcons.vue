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
  <span class="inline-flex items-center gap-1.5" data-test="oncall-channel-icons">
    <OIcon
      v-for="channel in ordered"
      :key="channel"
      :name="CHANNEL_ICON[channel]"
      size="sm"
      class="text-text-secondary"
      :label="channelLabel(channel)"
      :data-test="`oncall-channel-icon-${channel}`"
    >
      <OTooltip side="bottom" :content="channelLabel(channel)" />
    </OIcon>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { Channel } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { useI18nTyped } from "@/types/i18n";

const props = defineProps<{ channels: readonly Channel[] }>();

const { t } = useI18nTyped();

const ORDER: Channel[] = ["email", "slack", "sms", "voice", "webhook"];

/// A closed map: an unknown channel must fail to compile, not render a missing glyph.
const CHANNEL_ICON: Record<Channel, IconName> = {
  email: "mail",
  slack: "forum",
  sms: "chat",
  voice: "smartphone",
  webhook: "webhook",
};

const ordered = computed(() => ORDER.filter((channel) => props.channels.includes(channel)));

function channelLabel(channel: Channel): I18nText {
  switch (channel) {
    case "email":
      return t("oncall.channel_email");
    case "slack":
      return t("oncall.channel_slack");
    case "sms":
      return t("oncall.channel_sms");
    case "voice":
      return t("oncall.channel_voice");
    case "webhook":
      return t("oncall.channel_webhook");
    default: {
      const never: never = channel;
      return never;
    }
  }
}
</script>
