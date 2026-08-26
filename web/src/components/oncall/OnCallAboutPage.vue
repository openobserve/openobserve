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
  The provenance rail: why this team, what this has done before, and the ids
  worth pasting into a channel.

  It was a bare `<dl>` inside the view, which is why "routed because" and "how
  often has this fired" ended up on different screens from each other. One card
  so they can be read in one glance, and so the same block can be reused when
  an incident grows its own detail page.
-->
<template>
  <OCard variant="glass" data-test="oncall-about-page">
    <OCardSection role="header" dense>
      <OText variant="card-title">{{ t("oncall.aboutThisPage") }}</OText>
    </OCardSection>

    <OCardSection role="body" dense>
      <ODescriptionList dense>
        <!-- The engine records why it picked this team. It was only ever
             readable by scrolling the timeline, which is not where somebody
             asks "why me". Stacked: it is a sentence with a ksuid in it, and a
             sentence rationed to two thirds of a rail column wraps to four
             lines beside a label that needed one. -->
        <ODescriptionItem v-if="showRoutingReason" :label="t('oncall.routedBecause')" stacked>
          <span class="flex flex-col items-start gap-1">
            <!-- The mechanism in the UI's own words, then the rule as the same
                 key|value chips the routing tab draws it with. The server's
                 sentence spelled the winning rule as a path and the team as a
                 ksuid — the team is the row below this one, and a path is the
                 one thing on this card nobody reads as a sentence. -->
            <span class="text-text-body" data-test="oncall-about-routing-reason">
              {{ mechanismLine }}
            </span>

            <!-- Chips and the way out on one wrap row. Stacked, this single
                 row stood three lines tall and towered over every other row on
                 the card; the rule is the thing worth looking at, so the link
                 trails it rather than claiming a line of its own. -->
            <span class="flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <span
                v-if="routingDimensions.length"
                class="flex flex-wrap gap-1.5"
                data-test="oncall-about-routing-dimensions"
              >
                <ODimensionChip
                  v-for="dimension in routingDimensions"
                  :key="dimension.name"
                  :dim-key="dimension.name"
                  :value="dimension.value"
                  tooltip
                />
              </span>

              <router-link
                class="text-accent text-xs"
                :to="{ name: 'onCallRouting', query: { org_identifier: orgId } }"
                data-test="oncall-about-open-routing"
              >
                {{ t("oncall.openRouting") }}
              </router-link>
            </span>

            <!-- What routing considered and passed over on the way. Absent from
                 the card until now, and it is the half that answers "why NOT
                 the team I expected". -->
            <span
              v-for="(note, index) in routingNotes"
              :key="index"
              class="text-text-secondary text-xs"
              :data-test="`oncall-about-routing-note-${index}`"
            >
              {{ raw(note) }}
            </span>
          </span>
        </ODescriptionItem>

        <ODescriptionItem :label="t('oncall.team')">
          <router-link
            class="text-accent"
            :to="{
              name: 'onCallTeamDetail',
              params: { teamId, tab: 'overview' },
              query: { org_identifier: orgId },
            }"
            data-test="oncall-about-team-link"
          >
            {{ raw(teamName) }}
          </router-link>
        </ODescriptionItem>

        <!-- "Has this happened before, and what was it" — the single most
             useful thing to know before starting to look, and it used to be a
             tab away. -->
        <ODescriptionItem :label="t('oncall.history')">
          <span data-test="oncall-about-history">{{ historyLine }}</span>
        </ODescriptionItem>

        <ODescriptionItem v-if="subjectStream" :label="t('oncall.subjectStream')">
          <span
            class="block truncate"
            :title="subjectStream"
            data-test="oncall-about-subject-stream"
            >{{ raw(subjectStream) }}</span
          >
        </ODescriptionItem>

        <ODescriptionItem v-if="cause" :label="t('oncall.resolveCause')">
          <span data-test="oncall-about-cause">
            {{ t(`oncall.cause_${cause}`) }}
            <span v-if="causeNote" class="text-text-secondary">{{ raw(causeNote) }}</span>
          </span>
        </ODescriptionItem>
      </ODescriptionList>

      <!-- Below the rule are the two ids somebody pastes into a channel, not
           more prose about the page. The same key|value chip the routing rules
           are read as: the chip carries its own label, so the id gets the
           card's whole width rather than the value third of a description
           list, and a rail this narrow was truncating it to uselessness. -->
      <OSeparator class="my-3" />

      <!-- Stacked, not side by side: two 27-character ksuids sharing one
           narrow rail truncate each other into uselessness. -->
      <span class="flex flex-col items-start gap-2">
        <router-link
          v-if="incidentId"
          class="min-w-0"
          :to="{
            name: 'incidentDetail',
            params: { id: incidentId },
            query: { org_identifier: orgId },
          }"
          data-test="oncall-about-incident-link"
        >
          <ODimensionChip
            dim-key="incident"
            :key-label="incidentKeyLabel"
            :value="incidentId"
            tooltip
          />
        </router-link>

        <span class="flex w-full min-w-0 items-center gap-1">
          <!-- The id a responder reads here is the rule they then go and change
               — the threshold that woke them at 3am. It was a chip you could
               only copy, so the trip to the editor was a paste into the alert
               list's search box. -->
          <router-link
            v-if="alertEditRoute"
            class="min-w-0"
            :to="alertEditRoute"
            data-test="oncall-about-subject-link"
          >
            <ODimensionChip
              dim-key="alert-id"
              :key-label="subjectKeyLabel"
              :value="sourceId"
              tooltip
              data-test="oncall-about-subject-id"
            />
          </router-link>
          <ODimensionChip
            v-else
            dim-key="alert-id"
            :key-label="subjectKeyLabel"
            :value="sourceId"
            tooltip
            data-test="oncall-about-subject-id"
          />
          <!-- The id is here to be pasted somewhere, and the chip truncates it
               on a narrow rail — so the copy stays whatever the width. -->
          <OButton
            variant="ghost"
            size="icon-xs"
            icon-left="content-copy"
            :aria-label="t('common.copyToClipboard')"
            data-test="oncall-about-copy-subject"
            @click="copySubjectId"
          />
        </span>
      </span>
    </OCardSection>
  </OCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { RouteLocationRaw } from "vue-router";

import ODimensionChip from "@/lib/core/Badge/ODimensionChip.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OText from "@/lib/core/Typography/OText.vue";
import ODescriptionList from "@/lib/lists/DescriptionList/ODescriptionList.vue";
import ODescriptionItem from "@/lib/lists/DescriptionList/ODescriptionItem.vue";
import type { CauseGroup, ResolutionCause, SubjectType } from "@/ts/interfaces/oncall";
import type { RoutingMechanism } from "@/utils/oncall";
import { parseRoutingReason } from "@/utils/oncall";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import { copyToClipboard } from "@/utils/clipboard";

const props = withDefaults(
  defineProps<{
    orgId: string;
    teamId: string;
    teamName: string;
    subjectType: SubjectType;
    sourceId: string;
    /** The engine's sentence for why this team was picked. */
    routingReason?: string | null;
    subjectStream?: string | null;
    incidentId?: string | null;
    cause?: ResolutionCause | null;
    causeNote?: string | null;
    /** What earlier firings of this subject turned out to be. */
    priorCauses?: CauseGroup[];
    /** How many times this subject has paged anybody before, this one aside. */
    priorFirings?: number;
  }>(),
  {
    routingReason: null,
    subjectStream: null,
    incidentId: null,
    cause: null,
    causeNote: null,
    priorCauses: () => [],
    priorFirings: 0,
  },
);

const { t } = useI18nTyped();

/// The sentence read back into its parts, or null when the wording drifted —
/// in which case the card prints what the server sent rather than a guess.
const routing = computed(() => parseRoutingReason(props.routingReason));

const MECHANISM_COPY = {
  ownership: "oncall.routedByOwnership",
  explicit: "oncall.routedByAlert",
  context: "oncall.routedByContext",
  default: "oncall.routedToDefault",
  unrouted: "oncall.routedNowhere",
} as const satisfies Record<RoutingMechanism, I18nKey>;

const mechanismLine = computed<I18nText>(() => {
  const parsed = routing.value;
  if (!parsed) return raw(props.routingReason);
  if (parsed.mechanism === "context" && parsed.namedTeam) {
    return t("oncall.routedByContextNamed", { team: raw(parsed.namedTeam) });
  }
  return t(MECHANISM_COPY[parsed.mechanism]);
});

const routingDimensions = computed(() =>
  Object.entries(routing.value?.dimensions ?? {}).map(([name, value]) => ({ name, value })),
);

const routingNotes = computed(() => routing.value?.notes ?? []);

/// A page routed `explicit` was not routed at all — the alert names its team,
/// no rule was consulted and none could have changed the outcome. With no
/// dimensions and no notes to show, the row is a label, a sentence that says
/// "nothing happened here", and a link to rules that had no say, so the whole
/// row goes. Every other mechanism is the engine's own account of a decision —
/// which rule matched, or why none did — and that is the answer to "why me".
const showRoutingReason = computed(
  () =>
    Boolean(props.routingReason) &&
    (routing.value?.mechanism !== "explicit" ||
      routingDimensions.value.length > 0 ||
      routingNotes.value.length > 0),
);

const subjectLabel = computed(() =>
  props.subjectType === "alert" ? t("oncall.alertId") : t("oncall.subject"),
);

/// The chip's key segment takes a plain display string, not translated text —
/// its other callers pass a dimension name straight off a rule.
/// The alert's editor, which lives on the LIST route behind `action=update`
/// rather than on a route of its own — `AlertDetail.editAlert` navigates the
/// same way, including the "default" folder, because neither screen is told
/// which folder the alert sits in and the list fetches it by id regardless.
const alertEditRoute = computed<RouteLocationRaw | null>(() =>
  props.subjectType === "alert" && props.sourceId
    ? {
        name: "alertList",
        query: {
          org_identifier: props.orgId,
          action: "update",
          alert_id: props.sourceId,
          folder: "default",
        },
      }
    : null,
);

const subjectKeyLabel = computed(() => String(subjectLabel.value));
const incidentKeyLabel = computed(() => String(t("oncall.incident")));

async function copySubjectId() {
  await copyToClipboard(props.sourceId, t);
}

/// One line rather than a panel: "this has fired six times and four of them
/// were a deploy" is the whole answer; the per-firing detail lives below.
const historyLine = computed(() => {
  if (!props.priorFirings) return t("oncall.historyFirstPage");
  const top = [...props.priorCauses].sort((a, b) => b.count - a.count)[0];
  if (!top) return t("oncall.historyFirings", { count: props.priorFirings }, props.priorFirings);
  return t("oncall.historyFiringsCause", {
    count: props.priorFirings,
    cause: t(`oncall.cause_${top.cause}`),
    causeCount: top.count,
  });
});
</script>
