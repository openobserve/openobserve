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
      <OButton
        v-if="signals.length"
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
        :data-test="`oncall-unrouted-row-${signal.id}`"
      >
        <span class="flex min-w-0 flex-col">
          <span class="text-text-heading truncate text-sm font-medium">{{ titleOf(signal) }}</span>
          <code class="text-text-secondary truncate text-xs">{{ raw(pathOf(signal)) }}</code>
        </span>

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
          {{ t("oncall.unroutedClaimFor", { team: raw(teamName) }) }}
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
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OInnerLoading from "@/lib/feedback/InnerLoading/OInnerLoading.vue";
import type { UnroutedSignal } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { dimensionsSentence } from "@/utils/oncall";

withDefaults(
  defineProps<{
    signals?: UnroutedSignal[];
    /** The team a claim would assign to — this screen's team. */
    teamName?: string;
    loading?: boolean;
    claiming?: boolean;
  }>(),
  { signals: () => [], teamName: "", loading: false, claiming: false },
);

const emit = defineEmits<{
  (e: "claim", signal: UnroutedSignal): void;
  (e: "claim-all", signals: UnroutedSignal[]): void;
  (e: "dismiss", signal: UnroutedSignal): void;
}>();

const { t } = useI18nTyped();

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
</script>
