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
  One rule: what has to arrive, and who it pages.

  An ODialog, like every other short form in the app — add, edit and claim are
  the same three fields, so they are the same surface rather than three.

  It carries its own verification: the draft is replayed against the unrouted
  queue, so "what would this catch" is answered before saving instead of by a
  separate tester somewhere above the list.
-->
<template>
  <ODialog
    :open="open"
    size="sm"
    :title="title"
    :primary-button-label="t('oncall.saveRule')"
    :secondary-button-label="t('oncall.cancel')"
    :primary-button-disabled="!pairs.length || !team"
    :primary-button-loading="saving"
    :neutral-button-label="rule ? t('oncall.removeRule') : undefined"
    neutral-button-variant="ghost-destructive"
    data-test="oncall-rule-editor"
    @update:open="(v: boolean) => emit('update:open', v)"
    @click:primary="save"
    @click:secondary="emit('update:open', false)"
    @click:neutral="emit('remove')"
  >
    <div class="flex flex-col gap-3">
      <!-- The queue is where most rules come from, so it is one field away
           rather than a section the user has to close this and scroll to. -->
      <OSelect
        v-if="!rule && signals.length"
        :model-value="''"
        :options="signalOptions"
        :label="t('oncall.ruleEditorStartFromSignal')"
        :placeholder="t('oncall.ruleEditorStartFromSignalPlaceholder')"
        searchable
        data-test="oncall-rule-editor-from-signal"
        @update:model-value="(v: unknown) => startFrom(String(v))"
      />

      <span class="flex flex-wrap items-baseline gap-x-2">
        <OText variant="label">{{ t("oncall.ruleEditorWhen") }}</OText>
        <OText variant="meta" class="ms-auto" data-test="oncall-rule-editor-count">
          {{ conditionCount }}
        </OText>
      </span>

      <div class="border-border-default rounded-default flex flex-wrap gap-1.5 border px-2 py-2">
        <span
          v-for="(pair, index) in pairs"
          :key="pair.name"
          class="border-border-subtle bg-surface-panel rounded-default flex items-center gap-1 border px-1.5 py-0.5"
          :data-test="`oncall-rule-editor-condition-${pair.name}`"
        >
          <code class="text-text-body text-compact">
            {{ raw(`${displayOf(pair.name)} = ${pair.value}`) }}
          </code>
          <OButton
            variant="ghost"
            size="icon-xs"
            icon-left="close"
            :aria-label="t('oncall.removeDimension')"
            @click="pairs.splice(index, 1)"
          />
        </span>

        <OButton
          v-if="!adding"
          variant="ghost"
          size="xs"
          icon-left="add"
          data-test="oncall-rule-editor-add-condition"
          @click="adding = true"
        >
          {{ t("oncall.addDimension") }}
        </OButton>
      </div>

      <!-- A closed vocabulary: free text is how a rule ends up pinned to a
           dimension nothing ever emits, which reads as "never matched". -->
      <span
        v-if="adding"
        class="flex flex-wrap items-end gap-2"
        data-test="oncall-rule-editor-adder"
      >
        <OSelect
          v-model="draftName"
          :options="dimensionOptions"
          :label="t('oncall.dimensionName')"
          :placeholder="t('oncall.dimensionNamePlaceholder')"
          width="sm"
          searchable
          data-test="oncall-rule-editor-dimension-name"
        />
        <OInput
          v-model="draftValue"
          :label="t('oncall.dimensionValue')"
          :placeholder="t('oncall.dimensionValuePlaceholder')"
          width="sm"
          data-test="oncall-rule-editor-dimension-value"
        />
        <OButton
          variant="outline"
          size="sm-action"
          :disabled="!canAddPair"
          data-test="oncall-rule-editor-confirm-condition"
          @click="addPair"
        >
          {{ t("oncall.add") }}
        </OButton>
      </span>

      <!-- The dialog used to go quiet here: no request, no message, and a
           disabled Save with nothing on screen saying what was missing. -->
      <p
        v-if="adding && addPairProblem"
        class="text-text-secondary text-xs"
        data-test="oncall-rule-editor-dimension-problem"
      >
        {{ addPairProblem }}
      </p>

      <OText variant="meta">{{ t("oncall.ruleEditorNarrow") }}</OText>

      <span class="flex flex-wrap items-baseline gap-x-2">
        <OText variant="label">{{ t("oncall.ruleEditorPage") }}</OText>
        <OText variant="meta">{{ t("oncall.ruleEditorPageHint") }}</OText>
      </span>

      <!-- The team is a picker even on a team's own tab: handing a path to the
           team that actually owns it is the common correction, and the
           alternative is deleting the rule and writing it again elsewhere. -->
      <span class="flex flex-wrap items-center gap-2">
        <span class="min-w-0 flex-1">
          <OSelect
            :model-value="team"
            :options="teamOptions"
            :placeholder="t('oncall.ruleTeamPlaceholder')"
            searchable
            data-test="oncall-rule-editor-team"
            @update:model-value="(v: unknown) => (team = String(v))"
          />
        </span>
        <OText variant="meta" data-test="oncall-rule-editor-ladder">{{ ladderNote }}</OText>
      </span>

      <!-- The verification, in the same panel as the edit. Only the unrouted
           queue can be replayed on this side, so the sentence says so rather
           than implying every page of the last 30 days was re-run. -->
      <div
        class="border-border-subtle bg-surface-panel rounded-default flex flex-col gap-1 border px-2.5 py-2"
        data-test="oncall-rule-editor-catch"
      >
        <span class="flex flex-wrap items-baseline gap-x-2">
          <OText variant="label">{{ t("oncall.ruleEditorCatch") }}</OText>
          <OText variant="meta">{{ t("oncall.ruleEditorCatchHint") }}</OText>
        </span>
        <p class="text-text-body text-sm" data-test="oncall-rule-editor-catch-summary">
          {{ catchSummary }}
        </p>
        <code
          v-for="signal in matched.slice(0, 3)"
          :key="signal.id"
          class="text-text-secondary truncate text-xs"
          :data-test="`oncall-rule-editor-catch-${signal.id}`"
        >
          {{ titleOf(signal) }}
        </code>
      </div>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";

import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import type { OwnershipRuleStats, TeamRungSummary, UnroutedSignal } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { identityDimensions, normalizeDimensionValue, ruleClaimsDimensions } from "@/utils/oncall";

export interface RuleDraft {
  dimensions: Record<string, string>;
  team_id: string;
}

const props = withDefaults(
  defineProps<{
    open?: boolean;
    /** Editing an existing rule; absent means a new one. */
    rule?: OwnershipRuleStats | null;
    /** Pre-filled conditions — a claim arrives with the signal's identity path. */
    initialDimensions?: Record<string, string> | null;
    /** The team this screen belongs to, and the default target of a new rule. */
    teamId?: string;
    teams?: { id: string; name: string }[];
    /** The org's field vocabulary, so a condition reads as it does elsewhere. */
    aliases?: { id: string; display?: string }[];
    /** Replayed against the draft to answer "what would this catch". */
    signals?: UnroutedSignal[];
    /** The target team's ladder, so "page" says what paging means. */
    ladder?: TeamRungSummary[];
    saving?: boolean;
  }>(),
  {
    open: false,
    rule: null,
    initialDimensions: null,
    teamId: "",
    teams: () => [],
    aliases: () => [],
    signals: () => [],
    ladder: () => [],
    saving: false,
  },
);

const emit = defineEmits<{
  (e: "update:open", open: boolean): void;
  (e: "save", draft: RuleDraft): void;
  /** Removal lives here so a row keeps one button; the host confirms it. */
  (e: "remove"): void;
}>();

const { t } = useI18nTyped();

const pairs = ref<{ name: string; value: string }[]>([]);
const team = ref("");
const adding = ref(false);
const draftName = ref("");
const draftValue = ref("");

const title = computed<I18nText>(() =>
  props.rule ? t("oncall.editOwnershipRule") : t("oncall.newRule"),
);

/// Opening is what resets the form — one instance serves add, edit and claim,
/// and a stale draft from the last open would silently be saved as this one.
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    pairs.value = Object.entries(props.rule?.dimensions ?? props.initialDimensions ?? {}).map(
      ([name, value]) => ({ name, value: String(value) }),
    );
    team.value = props.rule?.team_id || props.teamId;
    adding.value = !pairs.value.length;
    draftName.value = "";
    draftValue.value = "";
  },
  { immediate: true },
);

function dimensionsOf(): Record<string, string> {
  return Object.fromEntries(pairs.value.map((pair) => [pair.name, pair.value]));
}

const dimensionOptions = computed(() =>
  props.aliases.map((alias) => ({ label: raw(alias.display || alias.id), value: alias.id })),
);

const teamOptions = computed(() =>
  props.teams.map((option) => ({ label: raw(option.name), value: option.id })),
);

const signalOptions = computed(() =>
  props.signals.map((signal) => ({ label: titleOf(signal), value: signal.id })),
);

/// Why `Add` is refused, in the reader's terms. A disabled button beside a
/// select whose placeholder was a real dimension key read as a filled form
/// that simply would not save — no request, no validation message, nothing on
/// screen saying what was missing.
const addPairProblem = computed<I18nText | "">(() => {
  const name = draftName.value.trim();
  if (!name) return t("oncall.dimensionNeedsName");
  if (!draftValue.value.trim()) return t("oncall.dimensionNeedsValue");
  if (pairs.value.some((pair) => pair.name === name))
    return t("oncall.dimensionAlreadyUsed", { name: raw(name) });
  return "";
});

const canAddPair = computed(() => !addPairProblem.value);

const conditionCount = computed<I18nText>(() =>
  pairs.value.length
    ? t("oncall.ruleEditorConditionCount", { count: pairs.value.length }, pairs.value.length)
    : t("oncall.ruleEditorNoConditions"),
);

/// What paging this team actually runs. The lowest priority that wakes anybody
/// is the one a new rule will be judged by.
const ladderNote = computed<I18nText>(() => {
  const entry = props.ladder.find((rung) => rung.pages_anyone);
  if (!entry) return t("oncall.routingNoLadder");
  const ladder = String(t("oncall.simulatorLadder", { priority: raw(entry.priority) }));
  const rungs = String(t("oncall.reachRungs", { count: entry.rungs }, entry.rungs));
  return raw(`${ladder} · ${rungs}`);
});

/// Only the unrouted queue can be replayed here — a signal that already routes
/// somewhere is not in it, so this is a floor on what the rule would take, and
/// the copy says "currently page nobody" rather than claiming a full replay.
const matched = computed(() =>
  pairs.value.length
    ? props.signals.filter((signal) => ruleClaimsDimensions(dimensionsOf(), signal.dimensions))
    : [],
);

const catchSummary = computed<I18nText>(() => {
  if (!pairs.value.length) return t("oncall.ruleEditorEmpty");
  if (!matched.value.length) return t("oncall.ruleEditorCatchNone");
  const fires = matched.value.reduce((total, signal) => total + signal.occurrences, 0);
  return t("oncall.ruleEditorCatchSome", {
    signals: raw(
      String(t("oncall.routingSignalCount", { count: matched.value.length }, matched.value.length)),
    ),
    fires: raw(String(t("oncall.routingFireCount", { count: fires }, fires))),
  });
});

function displayOf(name: string): string {
  return props.aliases.find((alias) => alias.id === name)?.display || name;
}

function titleOf(signal: UnroutedSignal): I18nText {
  return raw(signal.last_title) || raw(signal.description);
}

/// The dimensions a claim would actually write: identity only. A rule pinned to
/// a pod name matches one incarnation of one process, then nothing, forever —
/// evidence stays on the signal.
function claimableOf(signal: UnroutedSignal): Record<string, string> {
  const kept = identityDimensions(signal.dimensions);
  return Object.keys(kept).length ? kept : signal.dimensions;
}

function startFrom(signalId: string) {
  const signal = props.signals.find((candidate) => candidate.id === signalId);
  if (!signal) return;
  pairs.value = Object.entries(claimableOf(signal)).map(([name, value]) => ({
    name,
    value: String(value),
  }));
  adding.value = false;
}

/// Normalised on the way in, because the server lowercases these before
/// matching — writing one string and reading back another is how a rule that
/// looks right catches nothing.
function addPair() {
  if (!canAddPair.value) return;
  pairs.value.push({
    name: draftName.value.trim(),
    value: normalizeDimensionValue(draftValue.value),
  });
  draftName.value = "";
  draftValue.value = "";
  adding.value = false;
}

function save() {
  if (!pairs.value.length || !team.value) return;
  emit("save", { dimensions: dimensionsOf(), team_id: team.value });
}
</script>
