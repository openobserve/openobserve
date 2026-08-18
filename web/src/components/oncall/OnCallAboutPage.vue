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
  <OCard data-test="oncall-about-page">
    <OCardSection>
      <OText variant="panel-title" class="mb-3 block">{{ t("oncall.aboutThisPage") }}</OText>

      <ODescriptionList dense>
        <!-- The engine records why it picked this team. It was only ever
             readable by scrolling the timeline, which is not where somebody
             asks "why me". -->
        <ODescriptionItem v-if="routingReason" :label="t('oncall.routedBecause')">
          <span class="flex flex-col gap-0.5">
            <span data-test="oncall-about-routing-reason">{{ raw(routingReason) }}</span>
            <router-link
              class="text-accent text-xs"
              :to="{ name: 'onCallRouting', query: { org_identifier: orgId } }"
              data-test="oncall-about-open-routing"
            >
              {{ t("oncall.openRouting") }}
            </router-link>
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
          <span data-test="oncall-about-subject-stream">{{ raw(subjectStream) }}</span>
        </ODescriptionItem>

        <ODescriptionItem v-if="ackedBy" :label="t('oncall.ackedBy')">
          <OUserCell :value="ackedBy" />
        </ODescriptionItem>

        <ODescriptionItem :label="t('oncall.openedAt')">
          <OTimeCell :value="openedAt" unit="us" />
        </ODescriptionItem>

        <ODescriptionItem v-if="cause" :label="t('oncall.resolveCause')">
          <span data-test="oncall-about-cause">
            {{ t(`oncall.cause_${cause}`) }}
            <span v-if="causeNote" class="text-text-muted">{{ raw(causeNote) }}</span>
          </span>
        </ODescriptionItem>

        <ODescriptionItem v-if="incidentId" :label="t('oncall.incident')">
          <router-link
            class="text-accent"
            :to="{
              name: 'incidentDetail',
              params: { id: incidentId },
              query: { org_identifier: orgId },
            }"
            data-test="oncall-about-incident-link"
          >
            {{ raw(incidentId) }}
          </router-link>
        </ODescriptionItem>

        <!-- The id somebody pastes into a channel. Selectable and wrapping,
             because a ksuid that truncates is a ksuid nobody can use. -->
        <ODescriptionItem :label="subjectLabel">
          <OCode copyable data-test="oncall-about-subject-id">{{ raw(sourceId) }}</OCode>
        </ODescriptionItem>
      </ODescriptionList>
    </OCardSection>
  </OCard>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OCode from "@/lib/core/Code/OCode.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import OText from "@/lib/core/Typography/OText.vue";
import ODescriptionList from "@/lib/lists/DescriptionList/ODescriptionList.vue";
import ODescriptionItem from "@/lib/lists/DescriptionList/ODescriptionItem.vue";
import type { CauseGroup, ResolutionCause, SubjectType } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    orgId: string;
    teamId: string;
    teamName: string;
    subjectType: SubjectType;
    sourceId: string;
    /** Micros. */
    openedAt: number;
    /** The engine's sentence for why this team was picked. */
    routingReason?: string | null;
    subjectStream?: string | null;
    ackedBy?: string | null;
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
    ackedBy: null,
    incidentId: null,
    cause: null,
    causeNote: null,
    priorCauses: () => [],
    priorFirings: 0,
  },
);

const { t } = useI18nTyped();

const subjectLabel = computed(() =>
  props.subjectType === "alert" ? t("oncall.alertId") : t("oncall.subject"),
);

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
