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

  The secondary is DERIVED, not staffed: it is the same rotation walked
  `next_offset` further down, which is why the offset is printed beside the
  name — otherwise "why that person" has no answer on any screen.
-->
<template>
  <OCard variant="outlined" data-test="oncall-who-is-on">
    <OCardSection role="body">
      <OText variant="panel-title" class="mb-3 block">{{ t("oncall.whoIsOnThis") }}</OText>

      <p
        v-if="!slots.length"
        class="text-status-error-text text-sm"
        data-test="oncall-who-is-on-nobody"
      >
        {{ t("oncall.nobodyOnCall") }}
      </p>

      <template v-else>
        <!-- The roster first, and only the roster: a reach tag pinned to the
             right edge gives every person the same two columns to read, which
             a tag trailing the address never does. -->
        <ODescriptionList dense>
          <ODescriptionItem :label="t('oncall.onCallNow')">
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

          <!-- Every other staffed slot, named by the slot rather than called
               "backup": a team may staff three, and two of them called backup is
               a card that cannot be read. -->
          <ODescriptionItem
            v-for="entry in others"
            :key="entry.slot ?? entry.rotation"
            :label="slotLabel(entry)"
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
        <template v-if="handoverAt || nextOffset">
          <OSeparator class="my-3" />

          <ODescriptionList dense>
            <!-- When the pager changes hands. A page still open at handover is one
                 the next person inherits without being told, unless a screen says
                 so before it happens. -->
            <ODescriptionItem v-if="handoverAt" :label="t('oncall.shiftHandover')">
              <span class="flex w-full flex-wrap items-center gap-x-2 gap-y-1">
                <OTimeCell :value="handoverAt" unit="us" />
                <template v-if="handoverTo">
                  <span class="text-text-muted text-xs">{{ raw("→") }}</span>
                  <OUserCell class="min-w-0 truncate" :value="handoverTo" />
                </template>
              </span>
            </ODescriptionItem>

            <!-- The derived secondary's distance down the cycle. A footnote to the
                 roster above, so it is set in the quieter type — it explains a name
                 rather than adding one. Absent for a rotation that hands over to
                 nobody. -->
            <ODescriptionItem v-if="nextOffset" :label="t('oncall.secondaryOffset')">
              <span class="text-text-muted text-xs">
                {{ t("oncall.secondaryOffsetValue", { offset: nextOffset }) }}
              </span>
            </ODescriptionItem>
          </ODescriptionList>
        </template>
      </template>
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
import type { DeliveryRecord, OnCallSlot } from "@/ts/interfaces/oncall";
import { DEFAULT_SLOT, sameSlot } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    /** `GET /teams/{id}/on-call` — one entry per staffed slot. */
    slots?: OnCallSlot[];
    /** Every send this page attempted, for the reached/unreached tags. */
    deliveries?: DeliveryRecord[];
    /** Micros — when the default slot's current span ends. */
    handoverAt?: number | null;
    /** Who holds it after that. */
    handoverTo?: string | null;
  }>(),
  { slots: () => [], deliveries: () => [], handoverAt: null, handoverTo: null },
);

const { t } = useI18nTyped();

/// The default slot is the primary — every stored policy's unsuffixed target
/// means it, so it is what "on call now" refers to.
const primary = computed(
  () =>
    props.slots.find((s) => sameSlot(s.slot, DEFAULT_SLOT)) ??
    props.slots[0] ?? { rotation: "", user_email: "" },
);

const others = computed(() => props.slots.filter((s) => s !== primary.value));

const nextOffset = computed(() => primary.value.next_offset ?? null);

function slotLabel(entry: OnCallSlot) {
  return entry.slot ? raw(entry.slot) : t("oncall.nextOnCall");
}

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
