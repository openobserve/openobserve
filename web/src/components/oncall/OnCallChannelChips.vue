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

<!--
  The ways a page can actually reach one person, at a glance.

  Every state comes from the server's own `ChannelReadiness` — it delivers, it
  is on file but unverified, or nothing is behind it. Only a channel that fails
  on somebody the page cannot reach is coloured: a row of green ticks is a row
  nobody reads, and the red one has to survive being scanned past.
-->
<template>
  <span class="flex items-center gap-1" :data-test="`oncall-channels-${email}`">
    <span v-if="!chips.length" class="text-text-muted text-xs">{{ ABSENT }}</span>
    <span
      v-for="chip in chips"
      :key="chip.channel"
      class="rounded-default flex size-6 shrink-0 items-center justify-center border"
      :class="chip.tone"
      :data-test="`oncall-channel-${email}-${chip.channel}`"
    >
      <OIcon :name="chip.icon" size="sm" />
      <OTooltip side="bottom" :content="chip.tip" />
    </span>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.types";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { ABSENT } from "@/composables/useSloFormat";
import type { Channel, ChannelReadiness } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    email: string;
    channels?: ChannelReadiness[];
    /** The server's one verdict for this person. A dead channel is only worth
     *  colouring red when it is why nothing reaches them. */
    wouldLand?: boolean;
  }>(),
  { channels: () => [], wouldLand: true },
);

const { t } = useI18nTyped();

/// A closed map rather than a built key: an unknown channel must fail to
/// compile, not render a missing glyph next to a person's name.
const CHANNEL_ICON: Record<Channel, IconName> = {
  email: "mail",
  chat: "chat",
  webhook: "webhook",
  sms: "smartphone",
  voice: "call-made",
  push: "notifications",
  in_app: "notifications-active",
};

function channelLabel(channel: Channel): I18nText {
  switch (channel) {
    case "email":
      return t("oncall.channel_email");
    case "chat":
      return t("oncall.channel_chat");
    case "webhook":
      return t("oncall.channel_webhook");
    case "sms":
      return t("oncall.channel_sms");
    case "voice":
      return t("oncall.channel_voice");
    case "push":
      return t("oncall.channel_push");
    case "in_app":
      return t("oncall.channel_in_app");
  }
}

interface Chip {
  channel: Channel;
  icon: IconName;
  tone: string;
  tip: I18nText;
}

// voice, push, and sms have no backing provider yet (see
// Channel::is_deliverable on the server) — hide their icons here rather than
// show a promise nothing can fulfil.
const HIDDEN_CHANNELS: ReadonlySet<Channel> = new Set(["voice", "push", "sms"]);

const chips = computed<Chip[]>(() =>
  props.channels
    .filter((c) => !HIDDEN_CHANNELS.has(c.channel))
    .map((c) => {
      const label = channelLabel(c.channel);
      if (c.deliverable) {
        return {
          channel: c.channel,
          icon: CHANNEL_ICON[c.channel],
          tone: "border-transparent bg-icon-chip-success-bg text-icon-chip-success-text",
          tip: t("oncall.channelDelivers", { channel: label }),
        };
      }
      // The server's own sentence when it has one — this component must not
      // invent a reason a page would fail.
      const tip = c.blocked_because
        ? raw(c.blocked_because)
        : c.configured_but_unverified
          ? t("oncall.channelUnverified", { channel: label })
          : t("oncall.channelUnavailable", { channel: label });
      // Red is spent once, on the person nothing reaches. Everyone else's dead
      // channels are drawn as absent, because a fallback covered them.
      const tone = props.wouldLand
        ? "border-border-subtle border-dashed text-text-muted"
        : "border-transparent bg-icon-chip-error-bg text-icon-chip-error-text";
      return { channel: c.channel, icon: CHANNEL_ICON[c.channel], tone, tip };
    }),
);
</script>
