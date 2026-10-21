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
    <template v-for="chip in chips" :key="chip.channel">
      <OButton
        v-if="chip.link"
        variant="dashed"
        size="icon-chip"
        :icon-left="chip.icon"
        :aria-label="chip.tip"
        :data-test="`oncall-channel-${email}-${chip.channel}-link`"
        @click="openMine"
      />
      <span
        v-else
        class="rounded-default flex size-6 shrink-0 items-center justify-center border"
        :class="chip.tone"
        :data-test="`oncall-channel-${email}-${chip.channel}`"
      >
        <OIcon :name="chip.icon" size="sm" />
      </span>
      <OTooltip side="bottom" :content="chip.tip" />
    </template>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import OButton from "@/lib/core/Button/OButton.vue";
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
    /** The signed-in user's own row: a blocked phone chip links to where they can add one (U2). */
    own?: boolean;
  }>(),
  { channels: () => [], wouldLand: true, own: false },
);

const { t } = useI18nTyped();
const router = useRouter();
const store = useStore();

/// The person channels in the order the chips read; webhook is the team's room, not a person's.
const PERSON_CHANNELS: Channel[] = ["email", "sms", "voice"];
const PHONE_CHANNELS = new Set<Channel>(["sms", "voice"]);

/// A closed map rather than a built key: an unknown channel must fail to
/// compile, not render a missing glyph next to a person's name.
const CHANNEL_ICON: Record<Channel, IconName> = {
  email: "mail",
  sms: "chat",
  voice: "smartphone",
  webhook: "webhook",
};

function channelLabel(channel: Channel): I18nText {
  switch (channel) {
    case "email":
      return t("oncall.channel_email");
    case "sms":
      return t("oncall.channel_sms");
    case "voice":
      return t("oncall.channel_voice");
    case "webhook":
      return t("oncall.channel_webhook");
  }
}

interface Chip {
  channel: Channel;
  icon: IconName;
  tone: string;
  tip: I18nText;
  link: boolean;
}

const chips = computed<Chip[]>(() =>
  PERSON_CHANNELS.flatMap((channel) => {
    const c = props.channels.find((r) => r.channel === channel);
    return c ? [chipOf(c)] : [];
  }),
);

function chipOf(c: ChannelReadiness): Chip {
  const label = channelLabel(c.channel);
  if (c.deliverable) {
    return {
      channel: c.channel,
      icon: CHANNEL_ICON[c.channel],
      tone: "border-transparent bg-icon-chip-success-bg text-icon-chip-success-text",
      tip: t("oncall.channelDelivers", { channel: label }),
      link: false,
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
  // Only the caller can add their own phone, so only their row links (R4b).
  const link = props.own && PHONE_CHANNELS.has(c.channel);
  return {
    channel: c.channel,
    icon: CHANNEL_ICON[c.channel],
    tone,
    tip: link ? t("oncall.channelAddPhone", { reason: tip }) : tip,
    link,
  };
}

function openMine() {
  router.push({
    name: "onCallMine",
    query: { org_identifier: store.state.selectedOrganization.identifier },
  });
}
</script>
