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
      <OText variant="card-title">{{ t("oncall.routingDetails") }}</OText>
    </OCardSection>

    <OCardSection role="body" dense>
      <ODescriptionList dense>
        <!-- The engine records why it picked this team. It was only ever
             readable by scrolling the timeline, which is not where somebody
             asks "why me". The winning rule draws as the same key|value chips
             the routing tab draws it with, not a hand-built equation, so a
             dimension reads the same wherever it appears. -->
        <ODescriptionItem v-if="showRoutingReason" :label="t('oncall.routedBy')">
          <span class="flex flex-col items-start gap-1">
            <span class="text-sm" data-test="oncall-about-routing-reason">
              <!-- A sentence parseRoutingReason doesn't recognise ("...as an
                   impacted caller of the failing service") still opens
                   "routed to <id>" — the id is the one fact worth trusting;
                   the prose around it is not, so it is dropped rather than
                   shown verbatim. -->
              <router-link
                v-if="fallbackRoutedId"
                class="text-accent font-medium"
                :to="{
                  name: 'onCallTeamDetail',
                  params: { teamId, tab: 'overview' },
                  query: { org_identifier: orgId },
                }"
                data-test="oncall-about-routing-id-link"
              >
                {{ raw(fallbackRoutedId) }}
              </router-link>
              <span
                v-else-if="routingDimensions.length"
                class="flex flex-wrap items-center gap-1.5"
                data-test="oncall-about-routing-dimensions"
              >
                <ODimensionChip
                  v-for="dimension in routingDimensions"
                  :key="dimension.name"
                  :dim-key="dimension.name"
                  :value="dimension.value"
                  tooltip
                />
                <span class="text-text-secondary">→</span>
                <span class="text-text-body font-medium">{{ raw(teamName) }}</span>
              </span>
              <span v-else class="text-text-body font-medium">{{ routedByPrimary }}</span>
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
          <span class="flex flex-col items-start gap-1" data-test="oncall-about-history">
            <span class="text-text-body text-sm font-medium">{{ historyPrimary }}</span>
            <span v-if="historySecondary" class="text-text-secondary text-xs">{{
              historySecondary
            }}</span>
          </span>
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

        <!-- The ids somebody pastes into a channel, boxed with their own copy
             control — the same shape the Incident Details card uses, so an id
             reads and copies the same way on both pages. -->
        <ODescriptionItem v-if="incidentId" :label="t('oncall.incident')">
          <span
            class="rounded-default border-border-default bg-surface-panel flex min-w-0 items-center gap-2 border px-2.5 py-1 text-xs"
          >
            <router-link
              class="text-accent min-w-0 flex-1 truncate font-mono"
              :to="{
                name: 'incidentDetail',
                params: { id: incidentId },
                query: { org_identifier: orgId },
              }"
              data-test="oncall-about-incident-link"
            >
              {{ raw(incidentId) }}
            </router-link>
            <OButton
              variant="ghost"
              size="icon-xs"
              icon-left="content-copy"
              :aria-label="t('common.copyToClipboard')"
              data-test="oncall-about-copy-incident"
              @click="copyIncidentId"
            />
          </span>
        </ODescriptionItem>

        <ODescriptionItem :label="subjectLabel">
          <span
            class="rounded-default border-border-default bg-surface-panel flex min-w-0 items-center gap-2 border px-2.5 py-1 text-xs"
            data-test="oncall-about-subject-id"
          >
            <!-- The id a responder reads here is the rule they then go and
                 change — the threshold that woke them at 3am. It links
                 straight to the editor rather than a paste into the alert
                 list's search box. -->
            <router-link
              v-if="alertEditRoute"
              class="text-accent min-w-0 flex-1 truncate font-mono"
              :to="alertEditRoute"
              data-test="oncall-about-subject-link"
            >
              {{ raw(sourceId) }}
            </router-link>
            <span v-else class="text-text-body min-w-0 flex-1 truncate font-mono">
              {{ raw(sourceId) }}
            </span>
            <OButton
              variant="ghost"
              size="icon-xs"
              icon-left="content-copy"
              :aria-label="t('common.copyToClipboard')"
              data-test="oncall-about-copy-subject"
              @click="copySubjectId"
            />
          </span>
        </ODescriptionItem>
      </ODescriptionList>
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

/// Text fallback for a recognised mechanism with no dimensions to draw as
/// chips — `context` naming a team, or the mechanism sentence itself.
const routedByPrimary = computed<I18nText>(() => {
  const parsed = routing.value;
  if (!parsed) return raw(props.routingReason);
  if (parsed.mechanism === "context" && parsed.namedTeam) {
    return raw(`team = ${parsed.namedTeam} → ${props.teamName}`);
  }
  return mechanismLine.value;
});

/// The id out of a routing sentence `parseRoutingReason` doesn't recognise —
/// every branch it DOES recognise opens "routed to <id>" too, so an
/// unrecognised one almost always still yields an id worth linking, without
/// the guesswork of interpreting prose the server might change at any time.
const fallbackRoutedId = computed(() => {
  if (!props.routingReason || routing.value) return null;
  const decision = props.routingReason.split("; ").pop()?.trim() ?? "";
  const match = /^routed to (\S+)/.exec(decision);
  return match ? match[1] : null;
});

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

async function copySubjectId() {
  await copyToClipboard(props.sourceId, t);
}

async function copyIncidentId() {
  if (props.incidentId) await copyToClipboard(props.incidentId, t);
}

/// The fact, then the detail behind it — "this has fired six times" is the
/// whole answer on its own; the dominant cause is the clarifying line under
/// it, not folded into the same sentence.
const historyPrimary = computed(() => {
  if (!props.priorFirings) return t("oncall.historyFirstPage");
  return t("oncall.historyFirings", { count: props.priorFirings }, props.priorFirings);
});

const historySecondary = computed<I18nText | null>(() => {
  if (!props.priorFirings) return t("oncall.historyNoCauses");
  const top = [...props.priorCauses].sort((a, b) => b.count - a.count)[0];
  if (!top) return null;
  return t("oncall.historyTopCauseLine", {
    causeCount: top.count,
    cause: t(`oncall.cause_${top.cause}`),
  });
});
</script>
