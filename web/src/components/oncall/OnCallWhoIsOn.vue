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
  Who this page is supposed to be reaching, and whether it reached them.

  "Who is on call" was answerable on the team screen and "did the page land" in
  the delivery ledger, and joining the two was left to the reader mid-incident.
  They are one question, so they are one card.

  Every name here is a ROTATION's holder. There is no derived secondary: a
  position exists because a rotation fills it, and each row names the rotation
  it came from so "why that person" is answerable on the screen itself.

  A rotation that resolves to nobody is ABSENT from the response, not present
  with a null holder — so a coverage gap is a row that is not drawn, which is
  why the count of rows is the count of people who would be paged.
-->
<template>
  <OCard variant="glass" data-test="oncall-who-is-on">
    <OCardSection role="header" dense>
      <OText variant="card-title">{{
        closed ? t("oncall.whoWasOnThis") : t("oncall.whoIsOnThis")
      }}</OText>
    </OCardSection>

    <OCardSection role="body" dense>
      <!-- An unstaffed rotation is an emergency while a page is open and a
           plain fact once it is closed, so the colour follows the state. -->
      <p
        v-if="!positions.length"
        class="text-sm"
        :class="closed ? 'text-text-secondary' : 'text-status-error-text'"
        data-test="oncall-who-is-on-nobody"
      >
        {{ closed ? t("oncall.nobodyWasOnCall") : t("oncall.nobodyOnCall") }}
      </p>

      <template v-else>
        <!-- The roster first, and only the roster: a reach tag pinned to the
             right edge gives every person the same two columns to read, which
             a tag trailing the address never does. -->
        <ODescriptionList dense>
          <ODescriptionItem :label="closed ? t('oncall.onCallThen') : t('oncall.onCallNow')">
            <span class="flex w-full items-center gap-2">
              <OUserCell class="min-w-0 truncate font-medium" :value="primary.user_email" />
              <OTag
                v-if="reachOf(primary.user_email)"
                :variant="reachOf(primary.user_email) === 'landed' ? 'success-soft' : 'error-soft'"
                size="sm"
                class="ml-auto shrink-0"
                data-test="oncall-who-is-on-primary-reach"
              >
                {{ reachLabel(primary.user_email) }}
              </OTag>
            </span>
          </ODescriptionItem>

          <!-- Every other staffed rotation, named by the ROTATION rather than
               called "backup": a team may staff three, and two of them called
               backup is a card that cannot be read. -->
          <ODescriptionItem
            v-for="entry in others"
            :key="entry.rotation_id"
            :label="raw(entry.rotation_name)"
          >
            <span class="flex w-full items-center gap-2">
              <OUserCell class="min-w-0 truncate" :value="entry.user_email" />
              <OTag
                v-if="reachOf(entry.user_email)"
                :variant="reachOf(entry.user_email) === 'landed' ? 'success-soft' : 'error-soft'"
                size="sm"
                class="ml-auto shrink-0"
                :data-test="`oncall-who-is-on-reach-${entry.user_email}`"
              >
                {{ reachLabel(entry.user_email) }}
              </OTag>
            </span>
          </ODescriptionItem>
        </ODescriptionList>

        <!-- Below the rule is the schedule around those people, not more
             people — the two were one run of rows, and the handover read as
             another seat somebody is sitting in. -->
        <template v-if="!closed && (handoverAt || upNext)">
          <OSeparator class="my-3" />

          <ODescriptionList dense>
            <!-- When the pager changes hands. A page still open at handover is one
                 the next person inherits without being told, unless a screen says
                 so before it happens. -->
            <ODescriptionItem v-if="handoverAt" :label="t('oncall.shiftHandover')">
              <span class="flex w-full flex-wrap items-center gap-x-2 gap-y-1">
                <OTimeCell :value="handoverAt" unit="us" />
                <template v-if="handoverTo">
                  <span class="text-text-secondary text-xs">{{ raw("→") }}</span>
                  <OUserCell class="min-w-0 truncate" :value="handoverTo" />
                </template>
              </span>
            </ODescriptionItem>

            <!-- Who takes the pager at the next handover. **Display only** —
                 nothing pages them, and they are not cover. It is set in the
                 quieter type below the rule because it is a fact about the
                 schedule, not another seat somebody is sitting in. This field
                 used to double as the secondary, which is exactly how one team
                 got two different people both correctly labelled that. -->
            <ODescriptionItem v-if="upNext" :label="t('oncall.upNextAfterHandover')">
              <span class="flex items-center gap-2">
                <OUserCell class="text-text-secondary min-w-0 truncate text-xs" :value="upNext" />
              </span>
            </ODescriptionItem>
          </ODescriptionList>
        </template>
      </template>

      <!-- How this page has gone so far: whether it moved, and how far up the
           ladder it got to make that happen. These used to be a stat strip of
           their own above the fold — read once, right after who is on the
           hook for them, rather than as a separate stop on the page. -->
      <OSeparator class="my-3" />

      <ODescriptionList dense>
        <ODescriptionItem :label="ackLabel">
          <span class="flex w-full flex-wrap items-center gap-x-2 gap-y-1">
            <span data-test="oncall-who-is-on-ack-value">{{ ackValue }}</span>
            <OUserCell
              v-if="ackedBy"
              class="text-text-secondary min-w-0 truncate text-xs"
              :value="ackedBy"
            />
          </span>
        </ODescriptionItem>

        <ODescriptionItem :label="resolveLabel">
          <span data-test="oncall-who-is-on-resolve-value">{{ resolveValue }}</span>
        </ODescriptionItem>

        <!-- How deep the ladder actually went. It was in every payload this
             page fetches and rendered nowhere, so "was anybody past the first
             rung ever called?" — the question that decides whether to
             escalate again — was only answerable by reading the timeline. -->
        <ODescriptionItem :label="t('oncall.statReachedRung')">
          <span data-test="oncall-who-is-on-reached-rung">{{ reachedRung }}</span>
        </ODescriptionItem>
      </ODescriptionList>
    </OCardSection>
  </OCard>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import OText from "@/lib/core/Typography/OText.vue";
import ODescriptionList from "@/lib/lists/DescriptionList/ODescriptionList.vue";
import ODescriptionItem from "@/lib/lists/DescriptionList/ODescriptionItem.vue";
import type { DeliveryRecord, OnCallPosition } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    /**
     * `GET /teams/{id}/on-call` — one entry per rotation that resolves to
     * somebody. A rotation with a gap is absent rather than null-held.
     */
    positions?: OnCallPosition[];
    /** Every send this page attempted, for the reached/unreached tags. */
    deliveries?: DeliveryRecord[];
    /** Micros — when the first rotation's current span ends. */
    handoverAt?: number | null;
    /** Who holds it after that. */
    handoverTo?: string | null;
    /**
     * Micros — when this record closed, or null while it is still open.
     *
     * A closed record is read as history: the roster it carries was resolved
     * as of this instant rather than as of now, so the card says so in its
     * tense and drops the rows that are advice about a pager still being held.
     */
    closedAt?: number | null;
    /** "Time to ack" once acked, "Unacked for" (or "—") while still open. */
    ackLabel: I18nText;
    /** The duration itself, in the tense `ackLabel` names. */
    ackValue: I18nText | string;
    /** Who acked it, once somebody has. */
    ackedBy?: string | null;
    /** "Time to resolve" once closed, "Open for" (or "—") while still open. */
    resolveLabel: I18nText;
    resolveValue: I18nText | string;
    /** How far up the ladder this page got, as a rung rather than a delay. */
    reachedRung: I18nText | string;
  }>(),
  {
    positions: () => [],
    deliveries: () => [],
    handoverAt: null,
    handoverTo: null,
    closedAt: null,
    ackedBy: null,
  },
);

const { t } = useI18nTyped();

const closed = computed(() => Boolean(props.closedAt));

/// The first rotation the team staffs. Not a special one: the response is
/// ordered by the schedule, so this is "the position listed first" rather than
/// a keyword the way `primary` was — there is no default slot to look up any
/// more, and no derivation behind it.
const primary = computed<OnCallPosition>(
  () =>
    props.positions[0] ?? {
      rotation_id: "",
      rotation_name: "",
      rule: "",
      user_email: "",
    },
);

const others = computed(() => props.positions.filter((p) => p !== primary.value));

/// Who takes over at the next handover. Display only — nothing pages it.
const upNext = computed(() => primary.value.next_user_email ?? null);

/// What this page's own sends did for one address — never the team's general
/// reachability, which answers a different question and would contradict the
/// ledger sitting below it.
function reachOf(email: string): "landed" | "failed" | null {
  const sends = props.deliveries.filter((d) => d.recipient === email);
  if (!sends.length) return null;
  return sends.some((d) => d.delivered === true) ? "landed" : "failed";
}

function reachLabel(email: string) {
  return reachOf(email) === "landed" ? t("oncall.reachLanded") : t("oncall.reachUnreached");
}
</script>
