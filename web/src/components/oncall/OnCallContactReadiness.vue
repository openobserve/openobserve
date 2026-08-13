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
  Would a page to each of these people actually land.

  Answered from evidence by `GET .../reachability` — a real user of the org, an
  address shaped like a mailbox, a transport that exists, a method somebody has
  verified — and every negative arrives with the server's own sentence. That
  sentence is rendered verbatim: the UI must not invent a reason a page failed.
-->
<template>
  <div
    class="card-container rounded-default bg-surface-base border-border-default flex flex-col gap-2 border px-3.5 py-3"
    data-test="oncall-contact-readiness"
  >
    <span class="flex flex-wrap items-baseline gap-x-2">
      <OText variant="panel-title">{{ t("oncall.contactReadinessTitle") }}</OText>
      <OText variant="meta">{{ t("oncall.contactReadinessHint") }}</OText>
      <OButton
        variant="outline"
        size="xs"
        class="ms-auto"
        :loading="testing"
        data-test="oncall-readiness-test-page"
        @click="emit('test-page')"
      >
        {{ t("oncall.contactSendTest") }}
      </OButton>
    </span>

    <!-- One `false` here explains every unreachable row beneath it, so it is
         said once at the top rather than repeated against each name. -->
    <OBanner
      v-if="reachability && !reachability.smtp_configured"
      variant="warning"
      data-test="oncall-readiness-no-smtp"
    >
      {{ t("oncall.contactNoTransport") }}
    </OBanner>

    <p
      v-if="!members.length"
      class="text-text-secondary text-sm"
      data-test="oncall-readiness-empty"
    >
      {{ t("oncall.contactNoMembers") }}
    </p>

    <ul v-else class="flex flex-col">
      <li
        v-for="member in members"
        :key="member.user_email"
        class="border-border-subtle flex items-center gap-3 border-b py-2 last:border-b-0"
        :data-test="`oncall-readiness-row-${member.user_email}`"
      >
        <span class="flex min-w-0 flex-col">
          <OUserCell :value="member.user_email" />
          <span class="text-text-secondary truncate text-xs">{{ channelSummary(member) }}</span>
        </span>

        <!-- Only the failure is coloured: a rail of green ticks trains people
             to stop reading it, and the one that matters is the red one. -->
        <OTag
          :variant="member.would_a_page_land ? 'default-soft' : 'error-soft'"
          size="sm"
          class="ms-auto shrink-0"
          :data-test="`oncall-readiness-verdict-${member.user_email}`"
        >
          {{
            member.would_a_page_land
              ? t("oncall.contactReachable")
              : t("oncall.contactUnreachable")
          }}
          <OTooltip
            v-if="!member.would_a_page_land && member.why_not"
            side="left"
            :content="raw(member.why_not)"
          />
        </OTag>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { MemberReachability, TeamReachability } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";

const props = withDefaults(
  defineProps<{ reachability?: TeamReachability | null; testing?: boolean }>(),
  { reachability: null, testing: false },
);

const emit = defineEmits<{ (e: "test-page"): void }>();

const { t } = useI18nTyped();

/// Unreachable first. A list where the problem is fourth is a list nobody
/// reads to the bottom.
const members = computed<MemberReachability[]>(() =>
  [...(props.reachability?.members ?? [])].sort(
    (a, b) => Number(a.would_a_page_land) - Number(b.would_a_page_land),
  ),
);

/// The channels that WOULD carry a page, or the reason none can. Never a bare
/// list of every channel the enum knows about — that reads as capability.
function channelSummary(member: MemberReachability): I18nText {
  if (member.deliverable_channels.length) {
    return raw(
      member.deliverable_channels.map((channel) => String(t(`oncall.channel_${channel}`))).join(", "),
    );
  }
  return raw(member.why_not) || t("oncall.contactNoChannel");
}
</script>
