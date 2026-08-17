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
  Alerts that fired and woke nobody, because no rule claimed them.

  These never became a page at all — nobody was called and nobody declined, so
  they appear in no incident list and no postmortem. The queue is org-wide by
  design: a path nobody owns is not any one team's problem to see, and the fix
  is for whichever team recognises the dimensions to claim it.

  Claiming writes an ownership rule for the exact dimensions that went
  unmatched, which is why the row drops out afterwards — the path is now owned,
  so it stops being unrouted.
-->
<template>
  <div class="flex flex-col gap-3" data-test="oncall-unrouted">
    <span class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <OText variant="panel-title">{{ t("oncall.unroutedTitle") }}</OText>
      <OText variant="meta">{{ t("oncall.unroutedHint") }}</OText>
      <!-- Bulk claim needs a team to claim FOR, so it only renders where the
           host screen supplies one. The org queue claims row by row, because
           "assign everything unowned to one team" is rarely the true intent. -->
      <OButton
        v-if="signals.length && teamName"
        variant="outline"
        size="xs"
        class="ms-auto"
        :loading="claiming"
        data-test="oncall-unrouted-claim-all"
        @click="emit('claim-all', signals)"
      >
        {{ t("oncall.unroutedClaimAll", { count: signals.length }) }}
      </OButton>
    </span>

    <!-- Server-side filters, offered only where the host wants the whole
         queue worked (the org screen). `landing` splits the two emergencies
         the row tags name; `include_dismissed` swaps the outstanding worklist
         for the raw historical record. -->
    <span v-if="filterable" class="flex flex-wrap items-center gap-3" data-test="oncall-unrouted-filters">
      <OToggleGroup
        :model-value="landing || 'both'"
        @update:model-value="setLanding"
      >
        <OToggleGroupItem value="both" size="sm" data-test="oncall-unrouted-filter-both">
          {{ t("oncall.unroutedFilterBoth") }}
        </OToggleGroupItem>
        <OToggleGroupItem value="nobody" size="sm" data-test="oncall-unrouted-filter-nobody">
          {{ t("oncall.unroutedPagedNobody") }}
        </OToggleGroupItem>
        <OToggleGroupItem
          value="default_team"
          size="sm"
          data-test="oncall-unrouted-filter-default"
        >
          {{ t("oncall.unroutedFilterDefault") }}
        </OToggleGroupItem>
      </OToggleGroup>

      <OSwitch
        :model-value="includeDismissed"
        :label="t('oncall.unroutedShowDismissed')"
        data-test="oncall-unrouted-show-dismissed"
        @update:model-value="setIncludeDismissed"
      />
    </span>

    <OInnerLoading v-if="loading" showing />

    <!-- Silence here is the good outcome, so it gets a sentence rather than an
         empty panel somebody has to interpret. -->
    <p v-else-if="!signals.length" class="text-text-secondary text-sm" data-test="oncall-unrouted-empty">
      {{ t("oncall.unroutedNone") }}
    </p>

    <ul v-else class="flex flex-col">
      <li
        v-for="signal in signals"
        :key="signal.id"
        class="border-border-subtle flex flex-wrap items-center gap-x-3 gap-y-1 border-b py-2 last:border-b-0"
        :class="signal.dismissed_at ? 'opacity-60' : ''"
        :data-test="`oncall-unrouted-row-${signal.id}`"
      >
        <!-- Dismissing stamps the field and keeps the row — the evidence that
             a page fell through is worth more than a tidy table. -->
        <OTag
          v-if="signal.dismissed_at"
          variant="default-soft"
          size="sm"
          class="shrink-0"
          :data-test="`oncall-unrouted-dismissed-${signal.id}`"
        >
          {{ t("oncall.unroutedDismissedTag") }}
        </OTag>
        <span class="flex min-w-0 flex-col gap-0.5">
          <span class="text-text-heading truncate text-sm font-medium">{{ titleOf(signal) }}</span>
          <!-- The dimensions a rule would be written against, and nothing
               else. Pod names, node names and status codes are evidence about
               ONE firing — showing them here made every row an unreadable dump
               and implied the claim would pin to them. The full set stays a
               hover away for whoever is identifying the alert. -->
          <code class="text-text-secondary truncate text-xs" :title="pathOf(signal)">
            {{ raw(routablePathOf(signal)) }}
          </code>
        </span>

        <!-- §G.3: two different emergencies share this queue. A row the default
             team absorbed is an ownership gap that PAGED somebody; a row with
             no `defaulted_team_id` woke nobody at all. An operator triages
             those in opposite orders, so the row must say which it is. -->
        <OTag
          v-if="signal.defaulted_team_id"
          variant="warning-soft"
          size="sm"
          class="shrink-0"
          :data-test="`oncall-unrouted-defaulted-${signal.id}`"
        >
          {{ t("oncall.unroutedAbsorbedBy", { team: raw(teamNameOf(signal.defaulted_team_id)) }) }}
        </OTag>
        <OTag
          v-else
          variant="error-soft"
          size="sm"
          class="shrink-0"
          :data-test="`oncall-unrouted-nobody-${signal.id}`"
        >
          {{ t("oncall.unroutedPagedNobody") }}
        </OTag>

        <span class="text-text-secondary ms-auto shrink-0 text-xs">
          {{ t("oncall.unroutedFires", { count: signal.occurrences }, signal.occurrences) }}
        </span>

        <OButton
          variant="outline"
          size="xs"
          class="shrink-0"
          :data-test="`oncall-unrouted-claim-${signal.id}`"
          @click="emit('claim', signal)"
        >
          {{
            teamName
              ? t("oncall.unroutedClaimFor", { team: raw(teamName) })
              : t("oncall.unroutedWriteRule")
          }}
        </OButton>

        <OButton
          variant="ghost"
          size="icon-sm"
          icon-left="close"
          :aria-label="t('oncall.unroutedDismiss')"
          :data-test="`oncall-unrouted-dismiss-${signal.id}`"
          @click="emit('dismiss', signal)"
        />
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OInnerLoading from "@/lib/feedback/InnerLoading/OInnerLoading.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import type { UnroutedSignal } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { dimensionsSentence, identityDimensions } from "@/utils/oncall";

export interface UnroutedFilters {
  landing?: "default_team" | "nobody";
  include_dismissed: boolean;
}

const props = withDefaults(
  defineProps<{
    signals?: UnroutedSignal[];
    /** The team a claim would assign to — this screen's team. */
    teamName?: string;
    /** Resolves `defaulted_team_id` to a name the operator recognises. */
    teams?: { id: string; name: string }[];
    /** Offer the server-side filters. The host owns the fetch, so a change is
     *  emitted rather than applied — the filtering is the endpoint's. */
    filterable?: boolean;
    loading?: boolean;
    claiming?: boolean;
  }>(),
  {
    signals: () => [],
    teamName: "",
    teams: () => [],
    filterable: false,
    loading: false,
    claiming: false,
  },
);

const emit = defineEmits<{
  (e: "claim", signal: UnroutedSignal): void;
  (e: "claim-all", signals: UnroutedSignal[]): void;
  (e: "dismiss", signal: UnroutedSignal): void;
  (e: "change-filters", filters: UnroutedFilters): void;
}>();

const { t } = useI18nTyped();

const landing = ref<"" | "default_team" | "nobody">("");
const includeDismissed = ref(false);

function announceFilters() {
  emit("change-filters", {
    ...(landing.value ? { landing: landing.value } : {}),
    include_dismissed: includeDismissed.value,
  });
}

function setLanding(value: unknown) {
  landing.value = value === "default_team" || value === "nobody" ? value : "";
  announceFilters();
}

function setIncludeDismissed(value: unknown) {
  includeDismissed.value = !!value;
  announceFilters();
}

/// The alert's own title when the server captured one. Its `description` is
/// the fallback because the empty-path case reads nothing like the normal one,
/// and that is exactly the branch a client composing its own sentence gets
/// wrong.
function titleOf(signal: UnroutedSignal): I18nText {
  return raw(signal.last_title) || raw(signal.description);
}

/// The dimensions are the actionable part: they are what a rule would be
/// written against.
function pathOf(signal: UnroutedSignal): string {
  return dimensionsSentence(signal.dimensions) || signal.path;
}

/// The id is the honest fallback: it is what the wire said, and a renamed or
/// deleted team should not make the row lie about who was paged.
function teamNameOf(teamId: string): string {
  return props.teams.find((team) => team.id === teamId)?.name || teamId;
}

/// Only the identity dimensions — the ones the claim will write into a rule.
/// The row shows exactly what claiming does, and the full evidence stays a
/// hover away for whoever is identifying the alert.
function routablePathOf(signal: UnroutedSignal): string {
  const kept = identityDimensions(signal.dimensions);
  return Object.keys(kept).length ? dimensionsSentence(kept) : pathOf(signal);
}
</script>
