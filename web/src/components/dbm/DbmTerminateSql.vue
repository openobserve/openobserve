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
  DbmTerminateSql — the end-a-session statement, to COPY rather than to run.

  The mockup put an inline `End session <pid>` button on every chain row. We
  deliberately did not build it. A destructive, irreversible action one click
  away in a table that re-samples every few seconds is a footgun: the row under
  the cursor can change identity between reading and clicking, and there is no
  undo for killing the wrong session. Executing it would also need a privileged
  write path into the customer's database that this feature does not have, so
  the button would have to lie about what it does.

  Copyable SQL still beats naming the category. Given only a pid, the operator
  retypes the statement from memory anyway. Handing over the exact
  text, already correct for their engine, removes the transcription error while
  leaving the decision with the human at the psql prompt.
-->
<template>
  <div v-if="statement" class="flex min-w-0 items-center gap-1.5" :data-test="dataTest">
    <code
      class="bg-surface-subtle text-text-code rounded-default text-2xs min-w-0 truncate px-1.5 py-0.5 font-mono"
      :title="statement"
      :data-test="`${dataTest}-statement`"
    >
      {{ raw(statement) }}
    </code>
    <OButton
      variant="ghost-muted"
      size="icon-xs"
      :icon-left="copied ? 'check' : 'content-copy'"
      class="shrink-0"
      :data-test="`${dataTest}-copy`"
      @click.stop="copy"
    >
      <!-- `left`, like every other icon-only action in a table row's trailing
           cells — this one sits directly beside the row's action buttons on
           Blocked queries, and the two opening on different sides read as
           unrelated controls. -->
      <OTooltip side="left" :content="tooltip" />
    </OButton>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";

import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { copyToClipboard } from "@/utils/clipboard";
import { terminateStatement } from "@/utils/dbm/blocking";

const props = withDefaults(
  defineProps<{
    /** Picks the engine's syntax — `pg_terminate_backend` vs `KILL`. */
    dbSystem: string;
    /** Backend pid (Postgres) or thread id (MySQL). */
    pid: number | null;
    /** Named in the tooltip so the operator knows WHERE to run it. */
    instance?: string | null;
    dataTest?: string;
  }>(),
  { instance: null, dataTest: "dbm-terminate-sql" },
);

const { t } = useI18nTyped();

const copied = ref(false);

const statement = computed(() => terminateStatement(props.dbSystem, props.pid));

/** Says plainly that O2 will not run it — the operator stays in control. */
const tooltip = computed<I18nText>(() =>
  copied.value
    ? t("dbm.blocked.terminate.copied")
    : props.instance
      ? t("dbm.blocked.terminate.hint", { instance: props.instance })
      : t("dbm.blocked.terminate.hintNoInstance"),
);

/**
 * The pending reset, so a second copy restarts the two seconds rather than
 * letting the first timer cut the second one short — and so unmount can cancel
 * it. A row action lives in a table that re-renders on every refresh, so the
 * callback would otherwise fire into a torn-down component.
 */
let resetTimer: number | undefined;

const copy = async () => {
  if (!statement.value) return;
  const ok = await copyToClipboard(statement.value, t);
  if (!ok) return;
  copied.value = true;
  window.clearTimeout(resetTimer);
  resetTimer = window.setTimeout(() => {
    copied.value = false;
  }, 2000);
};

onBeforeUnmount(() => window.clearTimeout(resetTimer));
</script>
