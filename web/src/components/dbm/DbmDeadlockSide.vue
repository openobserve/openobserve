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
  DbmDeadlockSide — one column of the face-off.

  Both sides render the SAME shape, because a deadlock is symmetric and any
  structural difference between the columns would imply one caused the other.
  The only thing that varies is tone: red for the cancelled session, green for
  the survivor — the single asymmetry the database itself created.

  Lock modes are translated: `ShareLock on transaction 1430` becomes "was
  waiting for transaction 1430 to finish", with the raw term kept alongside for
  the DBA who wants to grep it.
-->
<template>
  <div
    class="flex min-w-0 flex-col gap-1.5 px-3 py-2.5"
    :class="isVictim ? 'bg-status-error-bg' : 'bg-status-success-bg'"
    :data-test="dataTest"
  >
    <div class="text-2xs flex items-center gap-1.5 font-bold tracking-wide uppercase">
      <OIcon
        :name="isVictim ? 'error-outline' : 'check-circle'"
        class="size-3.5 shrink-0"
        :class="isVictim ? 'text-status-error-text' : 'text-status-success-text'"
      />
      <span :class="isVictim ? 'text-status-error-text' : 'text-status-success-text'">
        {{ roleLabel }}
      </span>
      <span class="flex-1"></span>
      <!-- The PID, in the form the operator will type. No kill button: see
           DbmTerminateSql for why the destructive action is copy-only. -->
      <span
        class="border-border-default bg-surface-base text-text-heading rounded-default shrink-0 border px-1.5 font-mono text-xs font-semibold normal-case"
        :data-test="`${dataTest}-pid`"
      >
        {{ pidLabel }}
      </span>
    </div>

    <div class="text-text-secondary text-2xs flex flex-wrap items-center gap-1.5">
      <span v-if="participant.application" class="text-text-body font-semibold">
        {{ raw(participant.application) }}
      </span>
      <template v-if="participant.user">
        <span class="opacity-45">·</span>
        <span>{{ raw(participant.user) }}</span>
      </template>
      <template v-if="participant.transaction_id">
        <span class="opacity-45">·</span>
        <span>{{ t("dbm.deadlocks.detail.transaction", { id: participant.transaction_id }) }}</span>
      </template>
    </div>

    <code
      v-if="participant.query"
      class="border-border-default bg-surface-base text-text-code rounded-default block px-2 py-1.5 font-mono text-xs leading-relaxed break-words"
      :data-test="`${dataTest}-sql`"
    >
      {{ raw(participant.query) }}
    </code>
    <span v-else class="text-text-label text-2xs italic">
      {{ t("dbm.deadlocks.detail.noQueryCaptured") }}
    </span>

    <!-- What it was waiting on, in words — with the raw lock term kept for the
         DBA rather than thrown away. -->
    <p v-if="waitSentence" class="text-text-secondary text-2xs leading-relaxed">
      {{ waitSentence }}
      <span
        v-if="rawLock"
        class="bg-surface-subtle text-text-body rounded-default text-3xs mt-1 inline-block px-1.5 py-0.5 font-mono"
      >
        {{ rawLock }}
      </span>
    </p>

    <div class="mt-px flex flex-wrap gap-1.5">
      <OButton
        v-for="action in actions"
        :key="action.id"
        variant="outline"
        size="sm"
        :icon-left="action.icon"
        :data-test="`${dataTest}-${action.id}`"
        @click="emit('action', action.id)"
      >
        {{ action.label }}
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { DeadlockParticipant } from "@/services/db_monitoring";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    participant: DeadlockParticipant;
    /** Picks the session vocabulary — Postgres has pids, MySQL has threads. */
    dbSystem: string;
    role: "victim" | "survivor";
    dataTest?: string;
  }>(),
  { dataTest: "dbm-deadlock-side" },
);

const emit = defineEmits<{ (e: "action", id: string): void }>();

const { t } = useI18nTyped();

const isVictim = computed(() => props.role === "victim");

const roleLabel = computed<I18nText>(() =>
  isVictim.value ? t("dbm.deadlocks.detail.victim") : t("dbm.deadlocks.detail.survivor"),
);

/** MySQL reports threads, not pids — using the wrong noun sends the DBA to the
 *  wrong system view. */
const pidLabel = computed<I18nText>(() => {
  const pid = props.participant.pid;
  if (pid == null) return raw("");
  return props.dbSystem?.toLowerCase().includes("mysql")
    ? t("dbm.deadlocks.detail.thread", { pid })
    : t("dbm.deadlocks.detail.pid", { pid });
});

/**
 * `ShareLock on transaction 1430` says nothing to most readers, so the target
 * is restated as a sentence. The raw pair stays visible beneath it.
 */
const waitSentence = computed<I18nText | null>(() => {
  const target = props.participant.lock_target;
  if (!target) return null;
  return t("dbm.deadlocks.detail.waitingForRow", { target });
});

const rawLock = computed<I18nText | null>(() => {
  const { lock_mode: mode, lock_target: target } = props.participant;
  if (!mode || !target) return null;
  return t("dbm.deadlocks.detail.rawLock", { mode, target });
});

/**
 * Row actions, each gated on the data it actually needs.
 *
 * A button that cannot work is worse than an absent one: both copy actions
 * operate on the statement, and "which service" resolves by fingerprint, so on
 * a side the engine logged WITHOUT its SQL (the `noQueryCaptured` state above)
 * they would silently copy an empty string or navigate to a 400. The engine
 * decides how much it tells us, so this genuinely varies per participant.
 */
const actions = computed<{ id: string; icon: IconName; label: I18nText }[]>(() => {
  const out: { id: string; icon: IconName; label: I18nText }[] = [];
  if (props.participant.query) {
    out.push({ id: "copy", icon: "content-copy", label: t("dbm.deadlocks.detail.copy") });
    out.push({
      id: "top-queries",
      icon: "filter-list",
      label: t("dbm.deadlocks.detail.seeInTopQueries"),
    });
  }
  if (props.participant.fingerprint) {
    out.push({
      id: "which-service",
      icon: "account-tree",
      label: t("dbm.deadlocks.detail.whichService"),
    });
  }
  return out;
});
</script>
