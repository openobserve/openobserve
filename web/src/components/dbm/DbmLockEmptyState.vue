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
  <div
    class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
    :data-test="dataTest"
  >
    <span
      class="rounded-surface grid size-11 place-items-center"
      :class="
        healthy
          ? 'bg-status-success-bg text-status-success-text'
          : 'bg-surface-subtle text-text-label'
      "
    >
      <OIcon :name="healthy ? 'check-circle' : 'table-chart'" size="lg" />
    </span>

    <h3 class="text-text-heading text-base font-semibold" :data-test="`${dataTest}-title`">
      {{ title }}
    </h3>
    <p class="text-text-secondary text-compact max-w-lg">{{ description }}</p>

    <div
      class="border-border-default rounded-surface w-full max-w-2xl overflow-hidden text-left"
      :data-test="`${dataTest}-checks`"
    >
      <p
        class="border-border-subtle bg-surface-panel text-text-label text-2xs border-b px-3 py-1.5 font-semibold tracking-wide uppercase"
      >
        {{ checklistTitle }}
      </p>
      <div
        v-for="check in checks"
        :key="check.id"
        class="border-border-subtle flex items-start gap-2 border-b px-3 py-1.5 not-last:border-b"
        :data-test="`${dataTest}-check-${check.id}`"
      >
        <span
          class="text-3xs mt-px grid size-3.5 shrink-0 place-items-center rounded-full font-bold text-white"
          :class="STATUS_TONES[check.status]"
        >
          {{ STATUS_GLYPHS[check.status] }}
        </span>
        <span class="min-w-0 flex-1">
          <span class="text-text-heading block text-xs font-semibold">{{ check.title }}</span>
          <span class="text-text-secondary text-2xs mt-px block leading-relaxed">
            {{ check.detail }}
          </span>
        </span>
      </div>
    </div>

    <div class="mt-1 flex flex-wrap items-center justify-center gap-2">
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
    </div>
  </div>
</template>

<script setup lang="ts">
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { raw, type I18nText } from "@/types/i18n";

export type DbmLockCheckStatus = "ok" | "fail" | "note";

export interface DbmLockCheck {
  id: string;
  status: DbmLockCheckStatus;
  title: I18nText;
  detail: I18nText;
}

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
  }>(),
  {
    actions: () => [],
    collectionHealthyLabel: () => raw(""),
    dataTest: "dbm-lock-empty-state",
  },
);

const emit = defineEmits<{ (e: "action", id: string): void }>();

const STATUS_TONES: Record<DbmLockCheckStatus, string> = {
  ok: "bg-status-success-text",
  fail: "bg-status-error-text",
  note: "bg-status-warning-text",
};

const STATUS_GLYPHS: Record<DbmLockCheckStatus, I18nText> = {
  ok: raw("✓"),
  fail: raw("✕"),
  note: raw("!"),
};
</script>
