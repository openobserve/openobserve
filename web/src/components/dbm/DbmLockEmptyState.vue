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
  DbmLockEmptyState — the two ways Deadlocks and Blocked queries are empty, and
  they mean OPPOSITE things.

    • HEALTHY — the databases reported nothing because nothing went wrong. This
      is the good outcome, so it is green and it PROVES it looked: what we read,
      how recently, how much other traffic came through the same pipeline, and
      when this last was not empty. A grey "no data" here would train the
      operator to distrust the tab on the day it matters.

    • NOT COLLECTING — the prerequisite is missing, so the tab cannot ever fill
      in. This one must NAME the missing piece (the database's own log, the
      lock-table sampling) rather than saying "no data", and link the recipe.

  Telling them apart is the whole feature: an operator who reads "no deadlocks"
  when collection is broken is being actively misled. Same checklist grammar as
  DbmEmptyState so all three read as one system.
-->
<template>
  <!-- Built ON OEmptyState so these two states share the app's illustration,
       heading scale, backdrop and spacing with Traces/Metrics. The illustration
       carries the healthy-vs-broken distinction that the old icon badge did:
       `check` for "we looked and all is well", `data-scene` for "the pipeline
       is not delivering". The checklist and the healthy pill — the parts that
       are genuinely DBM's — ride in #extra and #actions. -->
  <OEmptyState
    :size="size"
    :illustration="healthy ? 'check' : 'data-scene'"
    :title="title"
    :description="description"
    :data-test="dataTest"
  >
    <template #actions>
      <!-- Healthy leads with the reassurance, not with a call to action: there
           is nothing for the reader to fix. -->
      <span
        v-if="healthy"
        class="bg-status-success-bg text-status-success-text text-2xs inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 font-semibold"
        :data-test="`${dataTest}-healthy-pill`"
      >
        <OIcon name="check-circle" class="size-3" />
        {{ collectionHealthyLabel }}
      </span>
      <OButton
        v-for="action in actions"
        :key="action.id"
        :variant="action.primary ? 'primary' : 'outline'"
        size="sm"
        :data-test="`${dataTest}-action-${action.id}`"
        @click="emit('action', action.id)"
      >
        {{ action.label }}
      </OButton>
    </template>

    <!-- The checklist grammar is shared with DbmEmptyState via DbmCheckList, so
         all of DBM's empty states read as one system. -->
    <template #extra>
      <DbmCheckList
        :title="checklistTitle"
        :checks="checks"
        :data-test="`${dataTest}-checks`"
        :row-test-prefix="`${dataTest}-check-`"
      />
    </template>
  </OEmptyState>
</template>

<script setup lang="ts">
import DbmCheckList, { type DbmCheckRow } from "./DbmCheckList.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { raw, type I18nText } from "@/types/i18n";

// Alias of the shared checklist row type, kept exported so callers keep typing
// their checks against THIS component's contract rather than its internals.
export type DbmLockCheck = DbmCheckRow;

export interface DbmLockEmptyAction {
  id: string;
  label: I18nText;
  primary?: boolean;
}

withDefaults(
  defineProps<{
    /**
     * `true` = nothing went wrong (green, reassuring); `false` = the
     * prerequisite is missing (neutral, instructive). Never conflate the two.
     */
    healthy: boolean;
    title: I18nText;
    description: I18nText;
    checklistTitle: I18nText;
    checks: DbmLockCheck[];
    actions?: DbmLockEmptyAction[];
    collectionHealthyLabel?: I18nText;
    dataTest?: string;
    /** Passed through to OEmptyState; these tabs fill a page, so "hero". */
    size?: "hero" | "block" | "inline";
  }>(),
  {
    actions: () => [],
    collectionHealthyLabel: () => raw(""),
    dataTest: "dbm-lock-empty-state",
    size: "hero",
  },
);

const emit = defineEmits<{ (e: "action", id: string): void }>();
</script>
