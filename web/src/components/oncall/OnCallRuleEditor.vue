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

  The rule is one sentence, filled in place: `When <field> is <value> → page
  <team>`. Stacking the same three fields as labelled rows made a rule read as
  a form to complete rather than a claim to check, and the claim is what the
  reader has to judge.

  It carries its own verification: the draft is replayed against the unrouted
  queue, so "what would this catch" is answered before saving instead of by a
  separate tester somewhere above the list.
-->
<template>
  <ODialog
    :open="open"
    size="lg"
    :title="title"
    :sub-title="t('oncall.ruleEditorSubtitle')"
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
      <!-- The rule as one sentence. Conditions are chips inside it, so adding a
           second one visibly narrows the same claim rather than filling in
           another field somewhere else. -->
      <div
        class="border-border-default rounded-default flex flex-col gap-1.5 border px-3 py-2.5"
        data-test="oncall-rule-editor-sentence"
      >
        <!-- Two groups, so a wrap breaks the sentence between "what arrives"
             and "who it pages" rather than mid-clause. -->
        <span class="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span class="flex flex-wrap items-center gap-x-2 gap-y-2">
            <OText variant="label">{{ t("oncall.ruleEditorWhen") }}</OText>

            <ODimensionChip
              v-for="(pair, index) in pairs"
              :key="pair.name"
              :dim-key="pair.name"
              :key-label="displayOf(pair.name)"
              :value="pair.value"
              removable
              :remove-label="t('oncall.removeDimension')"
              :data-test="`oncall-rule-editor-condition-${pair.name}`"
              @remove="pairs.splice(index, 1)"
            />

            <!-- A closed vocabulary for the dimension: free text is how a rule
                 ends up pinned to a field nothing ever emits, which reads as
                 "never matched". The value stays open — it is data — but the
                 values already seen on this dimension are offered first. -->
            <template v-if="adding">
              <OSelect
                v-model="draftName"
                :options="dimensionOptions"
                :placeholder="t('oncall.ruleEditorFieldPlaceholder')"
                size="sm"
                width="xs"
                searchable
                data-test="oncall-rule-editor-dimension-name"
              />
              <OText variant="meta">{{ t("oncall.ruleEditorIs") }}</OText>
              <span class="w-36 min-w-0">
                <OCombobox
                  v-model="draftValue"
                  :items="valueOptions"
                  :placeholder="t('oncall.ruleEditorValuePlaceholder')"
                  size="sm"
                  data-test="oncall-rule-editor-dimension-value"
                />
              </span>
              <OButton
                variant="outline"
                size="sm"
                :disabled="!canAddPair"
                data-test="oncall-rule-editor-confirm-condition"
                @click="addPair"
              >
                {{ t("oncall.add") }}
              </OButton>
            </template>

            <OButton
              v-else
              variant="ghost"
              size="sm"
              icon-left="add"
              data-test="oncall-rule-editor-add-condition"
              @click="adding = true"
            >
              {{ pairs.length ? t("oncall.ruleEditorAnd") : t("oncall.addDimension") }}
            </OButton>
          </span>

          <!-- The team is a picker even on a team's own tab: handing a path to
               the team that actually owns it is the common correction, and the
               alternative is deleting the rule and writing it again elsewhere. -->
          <span class="flex items-center gap-2 whitespace-nowrap">
            <span aria-hidden="true" class="text-text-secondary">→</span>
            <OText variant="label">{{ t("oncall.ruleEditorPage") }}</OText>
            <OSelect
              :model-value="team"
              :options="teamOptions"
              :placeholder="t('oncall.ruleTeamPlaceholder')"
              size="sm"
              width="sm"
              searchable
              data-test="oncall-rule-editor-team"
              @update:model-value="(v: unknown) => (team = String(v))"
            />
          </span>
        </span>

        <!-- The dialog used to go quiet here: no request, no message, and a
             disabled Save with nothing on screen saying what was missing. It
             belongs under the field it is about, not adrift below the panel. -->
        <OText
          v-if="adding && addPairProblem"
          variant="meta"
          data-test="oncall-rule-editor-dimension-problem"
        >
          {{ addPairProblem }}
        </OText>

        <!-- "Page" has to say what paging means, or it is a team name with no
             consequence attached. -->
        <OText variant="meta" data-test="oncall-rule-editor-ladder">{{ ladderNote }}</OText>
      </div>

      <!-- The queue is where most rules come from, so its rows are one click
           away rather than a section the user has to close this and scroll to.
           It is an opening move: once the sentence has a condition, the draft
           is the thing being judged and these would only be noise. -->
      <div
        v-if="!rule && !pairs.length && startable.length"
        class="flex flex-col gap-1.5"
        data-test="oncall-rule-editor-signals"
      >
        <OText variant="section">{{ t("oncall.ruleEditorOrStartFrom") }}</OText>
        <span
          v-for="signal in startable"
          :key="signal.id"
          class="border-border-subtle rounded-default flex items-center gap-2 border px-2.5 py-1.5"
          :data-test="`oncall-rule-editor-signal-${signal.id}`"
        >
          <code class="text-text-body min-w-0 flex-1 truncate text-xs">
            {{ raw(routablePathOf(signal)) }}
          </code>
          <OTag :variant="outcomeVariant(signal)" size="sm" class="shrink-0">
            {{ outcomeOf(signal) }}
          </OTag>
          <OText variant="meta" class="shrink-0">
            {{ t("oncall.routingFiresWindow", { count: signal.occurrences }, signal.occurrences) }}
          </OText>
          <OButton
            variant="ghost"
            size="xs"
            :data-test="`oncall-rule-editor-use-${signal.id}`"
            @click="startFrom(signal.id)"
          >
            {{ t("oncall.ruleEditorUse") }}
          </OButton>
        </span>
      </div>

      <!-- The verification, in the same panel as the edit. Only the unrouted
           queue can be replayed on this side, so this is a floor on what the
           rule would take rather than a full replay of every page. -->
      <div
        class="border-border-subtle bg-surface-panel rounded-default flex flex-col gap-1.5 border px-2.5 py-2"
        data-test="oncall-rule-editor-catch"
      >
        <span class="flex flex-wrap items-baseline gap-x-2">
          <OText variant="label">{{ t("oncall.ruleEditorCatch") }}</OText>
          <OText variant="meta">{{ t("oncall.ruleEditorCatchHint") }}</OText>
          <OText
            v-if="matched.length"
            variant="label"
            class="text-success ms-auto"
            data-test="oncall-rule-editor-catch-count"
          >
            {{ matchCount }}
          </OText>
        </span>

        <p
          v-if="!matched.length"
          class="text-text-secondary text-sm"
          data-test="oncall-rule-editor-catch-summary"
        >
          {{ catchSummary }}
        </p>

        <span
          v-for="signal in matched.slice(0, SHOWN_MATCHES)"
          :key="signal.id"
          class="flex items-center gap-2"
          :data-test="`oncall-rule-editor-catch-${signal.id}`"
        >
          <OTag
            v-if="signal.last_priority"
            :variant="priorityTagVariant(signal.last_priority)"
            size="sm"
            class="shrink-0"
          >
            {{ raw(priorityLabel(signal.last_priority)) }}
          </OTag>
          <span class="text-text-body min-w-0 flex-1 truncate text-sm">{{ titleOf(signal) }}</span>
          <OTimeCell v-if="signal.last_seen_at" :value="signal.last_seen_at" unit="us" />
          <OText variant="meta" class="shrink-0">{{ outcomeOf(signal) }}</OText>
        </span>

        <OText
          v-if="matched.length > SHOWN_MATCHES"
          variant="meta"
          data-test="oncall-rule-editor-catch-more"
        >
          {{
            t("oncall.ruleEditorCatchMore", {
              count: matched.length - SHOWN_MATCHES,
              team: raw(teamNameOf(team)),
            })
          }}
        </OText>
      </div>

      <!-- Two rules can both match, and which one wins is the single thing a
           reader cannot infer from the sentence above. -->
      <span class="flex items-start gap-1.5" data-test="oncall-rule-editor-precedence">
        <OIcon name="info-outline" size="sm" class="text-text-secondary shrink-0" />
        <OText variant="meta">{{ t("oncall.ruleEditorPrecedence") }}</OText>
      </span>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";

import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import ODimensionChip from "@/lib/core/Badge/ODimensionChip.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OCombobox from "@/lib/forms/Combobox/OCombobox.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import type { OwnershipRuleStats, TeamRungSummary, UnroutedSignal } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import {
  dimensionsSentence,
  identityDimensions,
  normalizeDimensionValue,
  priorityLabel,
  priorityTagVariant,
  ruleClaimsDimensions,
} from "@/utils/oncall";

export interface RuleDraft {
  dimensions: Record<string, string>;
  team_id: string;
}

/// The panel is a check, not a list: enough rows to recognise what the rule
/// took, with the remainder counted rather than scrolled.
const SHOWN_MATCHES = 4;

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

/// The values this dimension has actually arrived with. A rule written against
/// a value nothing emits looks right and catches nothing, and the queue is the
/// only place the real spellings exist.
const valueOptions = computed(() => {
  if (!draftName.value) return [];
  const seen = new Set<string>();
  for (const signal of props.signals) {
    const value = signal.dimensions?.[draftName.value];
    if (value) seen.add(String(value));
  }
  return [...seen].sort().map((value) => ({ label: raw(value), value }));
});

/// The queue, heaviest first: the path that fell through most often is the one
/// worth claiming first.
const startable = computed(() =>
  [...props.signals].sort((a, b) => b.occurrences - a.occurrences).slice(0, 3),
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
/// somewhere is not in it, so this is a floor on what the rule would take.
const matched = computed(() =>
  pairs.value.length
    ? props.signals.filter((signal) => ruleClaimsDimensions(dimensionsOf(), signal.dimensions))
    : [],
);

/// Firings, not signals: one path that fell through nine times is nine pages
/// that would now land, and that is the number the reader is weighing.
const matchCount = computed<I18nText>(() => {
  const fires = matched.value.reduce((total, signal) => total + signal.occurrences, 0);
  return t("oncall.ruleEditorMatchCount", { count: fires }, fires);
});

const catchSummary = computed<I18nText>(() =>
  pairs.value.length ? t("oncall.ruleEditorCatchNone") : t("oncall.ruleEditorEmpty"),
);

function displayOf(name: string): string {
  return props.aliases.find((alias) => alias.id === name)?.display || name;
}

function titleOf(signal: UnroutedSignal): I18nText {
  return raw(signal.last_title) || raw(signal.description);
}

/// The id is the honest fallback: a renamed or deleted team should not make the
/// row lie about who was paged.
function teamNameOf(teamId: string): string {
  return props.teams.find((option) => option.id === teamId)?.name || teamId;
}

/// Two different emergencies share this queue. A signal the catch-all absorbed
/// paged somebody — the wrong somebody; one without a `defaulted_team_id` woke
/// nobody at all, and the rule fixes those in opposite senses.
function outcomeOf(signal: UnroutedSignal): I18nText {
  return signal.defaulted_team_id
    ? t("oncall.unroutedAbsorbedBy", { team: raw(teamNameOf(signal.defaulted_team_id)) })
    : t("oncall.unroutedPagedNobody");
}

function outcomeVariant(signal: UnroutedSignal): BadgeVariant {
  return signal.defaulted_team_id ? "warning-soft" : "error-soft";
}

/// Only the identity dimensions — the ones a rule would be written against.
/// Pod names and status codes are evidence about one firing.
function routablePathOf(signal: UnroutedSignal): string {
  const kept = identityDimensions(signal.dimensions);
  const source = Object.keys(kept).length ? kept : signal.dimensions;
  return dimensionsSentence(source) || signal.path;
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
