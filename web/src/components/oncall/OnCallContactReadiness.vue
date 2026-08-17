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
      v-if="transportMissing"
      variant="warning"
      data-test="oncall-readiness-no-smtp"
    >
      {{ t("oncall.contactNoTransport") }}
    </OBanner>

    <!-- A reason that stops three people is one finding about the deployment,
         not three findings about three people. Said once, with the names it
         costs — each row keeps the server's exact sentence on its verdict, so
         nothing is lost by not printing it three times.

         Suppressed when the transport is missing: the banner above is already
         that sentence, and every unreachable row is downstream of it. -->
    <p
      v-for="(cause, index) in sharedCauses"
      :key="cause.reason"
      class="text-text-secondary text-xs"
      :data-test="`oncall-readiness-cause-${index}`"
    >
      {{ causeLine(cause) }}
    </p>

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
          <span class="text-text-secondary truncate text-xs">
            {{ channelSummary(member) }}
            <OTooltip side="bottom" :content="channelSummary(member)" />
          </span>
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

const transportMissing = computed(
  () => !!props.reachability && !props.reachability.smtp_configured,
);

/// How many names a shared cause prints before it starts counting instead. A
/// list of every unreachable member is the repetition this collapsing exists to
/// remove, just moved onto one line.
const MAX_NAMED = 3;

interface SharedCause {
  reason: string;
  who: string[];
}

/// Reasons that stop more than one person. Grouped by the server's sentence
/// verbatim — never by parsing it — so a deployment-level fact reported per
/// member ("… is on the P1 ladder and no page can reach them") lands here as
/// one finding rather than one per name.
const sharedCauses = computed<SharedCause[]>(() => {
  // The banner already IS the shared cause when there is no transport, and
  // every unreachable row is downstream of it.
  if (transportMissing.value) return [];

  const byReason = new Map<string, string[]>();
  for (const member of members.value) {
    if (member.would_a_page_land || !member.why_not) continue;
    const who = byReason.get(member.why_not) ?? [];
    who.push(member.user_email);
    byReason.set(member.why_not, who);
  }
  return [...byReason.entries()]
    .filter(([, who]) => who.length > 1)
    .map(([reason, who]) => ({ reason, who }));
});

const sharedReasons = computed(() => new Set(sharedCauses.value.map((cause) => cause.reason)));

/// Whether this row's reason is already stated once above it — either by the
/// missing-transport banner or by a shared-cause line.
function isSharedCause(member: MemberReachability): boolean {
  if (transportMissing.value) return true;
  return !!member.why_not && sharedReasons.value.has(member.why_not);
}

function affectedLabel(who: string[]): I18nText {
  const names = raw(who.slice(0, MAX_NAMED).join(", "));
  return who.length > MAX_NAMED
    ? t("oncall.contactAndMore", { names, count: who.length - MAX_NAMED })
    : t("oncall.contactAffects", { names });
}

function causeLine(cause: SharedCause): I18nText {
  return raw(`${cause.reason} · ${String(affectedLabel(cause.who))}`);
}

/// The channels that WOULD carry a page, or the reason none can. Never a bare
/// list of every channel the enum knows about — that reads as capability.
///
/// A reason stated once above the list is not repeated here: three rows each
/// carrying the same sentence was most of I4's eleven printings of one fact.
/// The verdict tag keeps the server's exact words in its tooltip, so the
/// per-person answer is still one hover away.
function channelSummary(member: MemberReachability): I18nText {
  if (member.deliverable_channels.length) {
    return raw(
      member.deliverable_channels.map((channel) => String(t(`oncall.channel_${channel}`))).join(", "),
    );
  }
  if (isSharedCause(member)) return t("oncall.contactNoChannel");
  return raw(member.why_not) || t("oncall.contactNoChannel");
}
</script>
