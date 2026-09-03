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

  Two labelled fields, the way every other form in the app asks its questions:
  the conditions a page has to match, and the team they hand it to. The rule
  was once written as a sentence filled in place — `When <field> is <value> →
  page <team>` — which read well at one condition and lost its shape at two:
  the row wrapped mid-clause, and whatever the form had to say about a field
  landed under a different one.

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
      <!-- Two labelled fields: what has to arrive, and who it pages. The
           conditions are chips under their own label, so adding a second one
           visibly narrows the same claim rather than opening another form. -->
      <div class="flex flex-col gap-5" data-test="oncall-rule-editor-sentence">
        <div class="flex flex-col gap-2" data-test="oncall-rule-editor-conditions">
          <!-- Conditions are ANDed and matched exactly. Neither is visible in a
               list of chips, and both change what the rule means. -->
          <span class="flex flex-wrap items-baseline gap-x-2">
            <span class="flex items-center gap-1">
              <OText variant="label">{{ t("oncall.ruleEditorConditions") }}</OText>
              <OIcon name="info-outline" size="sm" class="cursor-help">
                <OTooltip side="right" :content="t('oncall.ruleEditorConditionsHint')" />
              </OIcon>
            </span>

            <!-- The queue is where most rules come from, so its rows are one
                 click away rather than a section the reader has to close this
                 and scroll to. Printed open above the draft they were the first
                 thing met on a form nobody had filled in yet — three paths of
                 raw dimensions to read before the first field. Behind a menu
                 they are offered to whoever wants them and silent otherwise,
                 and the list is no longer paying for its own height, so it
                 holds twice the paths it did.

                 It stays an opening move: once the draft has a condition, that
                 draft is the thing being judged and this would only be noise. -->
            <ODropdown
              v-if="!rule && !pairs.length && startable.length"
              align="end"
              content-class="min-w-120"
            >
              <template #trigger>
                <OButton
                  variant="ghost-primary"
                  size="xs"
                  icon-right="expand-more"
                  class="ms-auto"
                  data-test="oncall-rule-editor-signals"
                >
                  {{ t("oncall.ruleEditorOrStartFrom") }}
                </OButton>
              </template>

              <ODropdownItem
                v-for="signal in startable"
                :key="signal.id"
                :text-value="routablePathOf(signal)"
                :data-test="`oncall-rule-editor-signal-${signal.id}`"
                @select="startFrom(signal.id)"
              >
                <span class="flex w-full min-w-0 items-center gap-2">
                  <code class="text-text-body min-w-0 flex-1 truncate text-xs">
                    {{ raw(routablePathOf(signal)) }}
                  </code>
                  <!-- Two different emergencies share this queue, and which one
                       a path is decides which way the rule fixes it. -->
                  <OTag :variant="outcomeVariant(signal)" size="sm" class="shrink-0">
                    {{ outcomeOf(signal) }}
                  </OTag>
                  <OText variant="meta" class="shrink-0">
                    {{
                      t(
                        "oncall.routingFiresWindow",
                        { count: signal.occurrences },
                        signal.occurrences,
                      )
                    }}
                  </OText>
                </span>
              </ODropdownItem>
            </ODropdown>
          </span>

          <!-- The conjunction is spelled out: chips sitting side by side read
               as an either/or just as easily. -->
          <span v-if="pairs.length" class="flex flex-wrap items-center gap-2">
            <template v-for="(pair, index) in pairs" :key="pair.name">
              <OText v-if="index" variant="meta" data-test="oncall-rule-editor-and">
                {{ t("oncall.ruleEditorAnd") }}
              </OText>
              <ODimensionChip
                :dim-key="pair.name"
                :key-label="displayOf(pair.name)"
                :value="pair.value"
                removable
                :remove-label="t('oncall.removeDimension')"
                :data-test="`oncall-rule-editor-condition-${pair.name}`"
                @remove="pairs.splice(index, 1)"
              />
            </template>
          </span>

          <!-- The front door: a level of the estate, not a row of the registry.
               Almost every claim is "this cluster", "this namespace" or "this
               service wherever it runs", and each of those writes exactly the
               dimensions the field builder below would have written by hand. -->
          <OnCallScopePicker
            v-if="scoped"
            :model-value="draftDimensions"
            :sets="sets"
            :catalogue="catalogue"
            :services="services"
            :aliases="aliases"
            data-test="oncall-rule-editor-scope"
            @update:model-value="applyScope"
            @advanced="useAdvanced"
          />

          <!-- A closed vocabulary for the dimension: free text is how a rule
               ends up pinned to a field nothing ever emits, which reads as
               "never matched". The value stays open — it is data — but the
               values already seen on this dimension are offered first. -->
          <div v-if="!scoped && adding" class="flex flex-wrap items-center gap-1">
            <OSelect
              v-model="draftName"
              :options="dimensionOptions"
              :placeholder="t('oncall.ruleEditorFieldPlaceholder')"
              size="sm"
              width="sm"
              searchable
              data-test="oncall-rule-editor-dimension-name"
            />
            <!-- Enter commits the pair: the hands are already on the value
                 field, and reaching for Add to add a second condition is the
                 slow half of writing a two-condition rule. -->
            <span class="w-48 min-w-0" @keyup.enter="addPair">
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
            <!-- Only once a condition exists: with none there is nothing to go
                 back to, and a rule cannot be saved without one. -->
            <OButton
              v-if="pairs.length"
              variant="ghost"
              size="sm"
              data-test="oncall-rule-editor-cancel-condition"
              @click="cancelPair"
            >
              {{ t("oncall.ruleEditorDiscardCondition") }}
            </OButton>
          </div>

          <OButton
            v-else-if="!scoped"
            variant="ghost-primary"
            size="sm"
            icon-left="add"
            class="self-start"
            data-test="oncall-rule-editor-add-condition"
            @click="adding = true"
          >
            {{ t("oncall.ruleEditorAddCondition") }}
          </OButton>

          <!-- The dialog used to go quiet here: no request, no message, and a
               disabled Save with nothing on screen saying what was missing. -->
          <OText
            v-if="!scoped && adding && addPairProblem"
            variant="meta"
            data-test="oncall-rule-editor-dimension-problem"
          >
            {{ addPairProblem }}
          </OText>

          <!-- The way back. Advanced is a mode somebody chose, so leaving it has
               to be as findable as entering it was — otherwise the only exit is
               cancelling the dialog and starting again. -->
          <OButton
            v-if="!scoped && scopeAvailable"
            variant="ghost-primary"
            size="sm"
            icon-left="arrow-back"
            class="self-start"
            data-test="oncall-rule-editor-leave-advanced"
            @click="useScoped"
          >
            {{ t("oncall.scopeOwns") }}
          </OButton>
        </div>

        <!-- The team is a picker even on a team's own tab: handing a path to
             the team that actually owns it is the common correction, and the
             alternative is deleting the rule and writing it again elsewhere.
             Its help text says what paging that team means, or the field is a
             team name with no consequence attached. -->
        <OSelect
          :model-value="team"
          :label="t('oncall.ruleEditorTeamLabel')"
          :options="teamOptions"
          :placeholder="t('oncall.ruleTeamPlaceholder')"
          :help-text="ladderNote"
          size="sm"
          width="sm"
          searchable
          data-test="oncall-rule-editor-team"
          @update:model-value="(v: unknown) => (team = String(v))"
        >
          <template #tooltip>
            <OTooltip side="right" :content="t('oncall.ruleEditorTeamHelp')" />
          </template>
        </OSelect>
      </div>

      <!-- Who holds this path today, answered by the engine rather than
           re-derived here. The draft's own conditions are replayed as if they
           were a signal, so this is the real decision — the same call the
           routing tester makes, on the path being written.

           It answers the question a rule editor otherwise leaves hanging: not
           "is this valid" but "what changes when I save it". -->
      <div
        v-if="conflict && pairs.length"
        class="rounded-default flex items-start gap-2 border px-2.5 py-2"
        :class="
          conflictIsContested
            ? 'border-warning-400 bg-warning-surface'
            : 'border-border-subtle bg-surface-panel'
        "
        data-test="oncall-rule-editor-conflict"
      >
        <OIcon
          :name="conflictIsContested ? 'warning-outline' : 'info-outline'"
          size="sm"
          :class="
            conflictIsContested
              ? 'text-warning-700 mt-0.5 shrink-0'
              : 'text-text-secondary mt-0.5 shrink-0'
          "
        />
        <span class="flex min-w-0 flex-col gap-0.5">
          <OText variant="meta" data-test="oncall-rule-editor-conflict-now">
            {{ conflictNow }}
          </OText>
          <!-- The server's own sentence about precedence. Rendered, never
               restated — a second copy of the ordering on this side is a second
               thing to keep in step with the engine. -->
          <OText
            v-if="conflictOutcome"
            variant="meta"
            class="font-medium"
            data-test="oncall-rule-editor-conflict-outcome"
          >
            {{ conflictOutcome }}
          </OText>
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
    </div>

    <!-- Two rules can both match, and which one wins is the single thing a
         reader cannot infer from the sentence above. Lives in the footer,
         left of Cancel/Save, since it qualifies the whole rule rather than
         any one field in the form above. -->
    <template #footer-left>
      <span class="flex items-center gap-1.5" data-test="oncall-rule-editor-precedence">
        <OIcon name="info-outline" size="sm" class="text-text-secondary shrink-0" />
        <OText variant="meta">{{ t("oncall.ruleEditorPrecedence") }}</OText>
      </span>
    </template>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";

import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import ODimensionChip from "@/lib/core/Badge/ODimensionChip.vue";
import OnCallScopePicker from "./OnCallScopePicker.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OCombobox from "@/lib/forms/Combobox/OCombobox.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import type { IdentitySet } from "@/services/service_streams";
import type {
  RoutingPreview,
  DimensionCatalogue,
  DiscoveredService,
  OwnershipRuleStats,
  TeamRungSummary,
  UnroutedSignal,
} from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { SERVICE_DIMENSION, dimensionsSentence, identityDimensions, normalizeDimensionValue, priorityLabel, priorityTagVariant, ruleClaimsDimensions } from "@/utils/oncall";

export interface RuleDraft {
  dimensions: Record<string, string>;
  team_id: string;
}

/// The panel is a check, not a list: enough rows to recognise what the rule
/// took, with the remainder counted rather than scrolled.
const SHOWN_MATCHES = 4;

/// How much of the unrouted queue the "start from a signal" menu offers.
const STARTABLE_SHOWN = 6;

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
    /** What this org actually emits — see {@link DimensionCatalogue}. */
    catalogue?: DimensionCatalogue;
    /** Services discovery has seen, each claimable as one whole identity. */
    services?: DiscoveredService[];
    /** The org's identity sets — the ordered hierarchy the scope picker uses. */
    sets?: IdentitySet[];
    /** Who holds the drafted path today, straight from the routing engine.
     *  The host fetches it in response to `preview`; null while in flight. */
    conflict?: RoutingPreview | null;
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
    catalogue: () => ({ present: [], values: {} }),
    services: () => [],
    sets: () => [],
    conflict: null,
    signals: () => [],
    ladder: () => [],
    saving: false,
  },
);

const emit = defineEmits<{
  (e: "update:open", open: boolean): void;
  (e: "save", draft: RuleDraft): void;
  /** The drafted conditions changed — ask the engine who holds them today.
   *  Debounced here so a host can answer it with a request per pause, not one
   *  per keystroke. Empty when there is nothing to ask about. */
  (e: "preview", dimensions: Record<string, string>): void;
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

/// Whether there is an estate to pick levels from at all.
///
/// A deployment that has discovered nothing has no clusters, no namespaces and
/// no services, so the scope picker would be a row of empty selects. The field
/// builder still works there — it always did — so that is where such a
/// deployment starts.
const scopeAvailable = computed(
  () =>
    props.services.length > 0 ||
    props.sets.some((set) =>
      set.distinguish_by.some(
        (dimension) => Object.keys(props.catalogue.values[dimension] ?? {}).length > 0,
      ),
    ),
);

/// Which of the two builders is on screen. Scope by default, because it is what
/// almost every rule needs; Advanced is reachable in one click and holds
/// everything scope deliberately cannot say.
const scoped = ref(true);

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
    // An existing rule opens in the builder that can express it. A rule the
    // levels cannot say — three conditions, a wildcard, a dimension outside the
    // identity sets — would otherwise be silently rewritten to whatever the
    // scope picker settled on, which is a rule nobody wrote.
    scoped.value = scopeAvailable.value && scopeCanExpress(dimensionsOf());
    adding.value = !scoped.value && !pairs.value.length;
    draftName.value = "";
    draftValue.value = "";
  },
  { immediate: true },
);

function dimensionsOf(): Record<string, string> {
  return Object.fromEntries(pairs.value.map((pair) => [pair.name, pair.value]));
}

/// The same map, memoised, because the scope picker watches it deeply.
///
/// Bound as a call it would be a fresh object on every render, so the picker's
/// watcher would fire on its own emit, publish again, and render again — a loop
/// with no new information in it.
const draftDimensions = computed(dimensionsOf);

/// Dimensions this org has actually emitted, in the order the registry
/// recommends, and nothing else.
///
/// The vocabulary lists every field name the product understands across every
/// platform — around thirty. An org running Kubernetes has eight of them. The
/// other twenty-two were offered anyway, so the commonest way to write a rule
/// that never matches was to pick one off the top of the list.
///
/// An empty catalogue means the registry has nothing to say yet, and the whole
/// vocabulary is better than an empty picker.
const dimensionOptions = computed(() => {
  const label = (id: string) =>
    raw(props.aliases.find((alias) => alias.id === id)?.display || id);
  const present = props.catalogue.present;
  if (!present.length) {
    return props.aliases.map((alias) => ({ label: label(alias.id), value: alias.id }));
  }
  // A condition already on the draft stays selectable even if the registry has
  // since stopped seeing it, or editing an old rule would silently drop it.
  const onDraft = pairs.value.map((pair) => pair.name).filter((name) => !present.includes(name));
  return [...present, ...onDraft].map((id) => ({ label: label(id), value: id }));
});

/// Whether the levels can state this claim exactly.
///
/// One level, or one level narrowed by a coarser one. Anything else — a
/// wildcard, a third condition, a dimension no identity set names — is a real
/// rule the levels have no words for, and pretending otherwise would rewrite it
/// on open. Empty counts as expressible: that is a new rule.
function scopeCanExpress(dimensions: Record<string, string>): boolean {
  const names = Object.keys(dimensions);
  if (!names.length) return true;
  // A wildcard is a family, not a path segment, and the picker has no way to
  // say one. Those rules stay in the builder that wrote them.
  if (Object.values(dimensions).some((value) => String(value).endsWith("*"))) return false;

  // Everything else has to sit on ONE platform's path, plus `service`, which
  // belongs to every platform. A rule mixing an ECS task with a Kubernetes
  // namespace describes no record that can exist, so the path cannot draw it —
  // and it must open in Advanced rather than be silently rewritten to whatever
  // path the picker settled on.
  const named = names.filter((name) => name !== SERVICE_DIMENSION);
  if (!named.length) return true;
  return props.sets.some((set) => named.every((name) => set.distinguish_by.includes(name)));
}

function useAdvanced() {
  scoped.value = false;
  adding.value = !pairs.value.length;
}

function useScoped() {
  scoped.value = true;
  adding.value = false;
}

/// The scope picker owns a whole claim, not one condition, so it replaces the
/// conditions rather than appending to them. Two levels at once is what its
/// own narrowing control is for.
function applyScope(dimensions: Record<string, string>) {
  pairs.value = Object.entries(dimensions).map(([name, value]) => ({
    name,
    value: String(value),
  }));
}

const teamOptions = computed(() =>
  props.teams.map((option) => ({ label: raw(option.name), value: option.id })),
);

/// The values this dimension has actually arrived with.
///
/// Two sources, and the second is why this stopped being a text box. The
/// unrouted queue only holds what has already fallen through, so a team writing
/// a rule *before* anything breaks got an empty list. The registry holds every
/// value discovery has seen, with the number of services carrying it — which is
/// also the only hint on this form about how broad a rule is about to be.
const valueOptions = computed(() => {
  if (!draftName.value) return [];
  const counts = props.catalogue.values[draftName.value] ?? {};
  const seen = new Map<string, number>(Object.entries(counts));
  for (const signal of props.signals) {
    const value = signal.dimensions?.[draftName.value];
    if (value && !seen.has(String(value))) seen.set(String(value), 0);
  }
  return [...seen.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, services]) => ({
      label: raw(value),
      value,
      description: services ? t("oncall.ruleEditorValueServices", { count: services }, services) : undefined,
    }));
});

/// The queue, heaviest first: the path that fell through most often is the one
/// worth claiming first. Six rather than the three it printed inline — in a menu
/// the list costs no height on the form, and three was the space, not the answer.
const startable = computed(() =>
  [...props.signals].sort((a, b) => b.occurrences - a.occurrences).slice(0, STARTABLE_SHOWN),
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

/// How many segments the current holder's path pins.
///
/// `path()` is `k=v/k=v`, so counting segments counts conditions — which is the
/// FIRST term of the engine's ordering and the only one that can be read off a
/// string. The finer terms (which level, exact versus wildcard) are the
/// server's to decide, and this deliberately does not guess at them.
function segmentsOf(path: string): number {
  return path.split("/").filter(Boolean).length;
}

/// The rule that holds this path today, if any. `also_matched` lists the losers,
/// so the winner is the decision itself — which is why this reads `decision`
/// rather than picking the first of the list.
const conflictHolder = computed(() => {
  const decision = props.conflict?.decision as { path?: string; rule_id?: string } | undefined;
  if (!decision?.path) return null;
  return {
    path: String(decision.path),
    teamId: props.conflict?.team_id ?? "",
    segments: segmentsOf(String(decision.path)),
  };
});

/// Whether saving this would change who gets paged for the path.
const conflictIsContested = computed(
  () => !!conflictHolder.value && conflictHolder.value.teamId !== team.value,
);

/// What happens today — always stated, because "nothing claims this yet" is as
/// useful an answer as naming the holder.
const conflictNow = computed<I18nText>(() => {
  const holder = conflictHolder.value;
  if (!holder) return t("oncall.ruleEditorConflictUnclaimed");
  return t("oncall.ruleEditorConflictHeldBy", {
    team: raw(teamNameOf(holder.teamId)),
    path: raw(holder.path),
  });
});

/// What changes when this is saved.
///
/// Only claimed where the answer is certain. Specificity is the first term of
/// the ordering, so a strictly longer path wins and a strictly shorter one
/// loses whatever the finer terms say. At equal length the depth ranking
/// decides, and that lives on the server — so this says the two contend and
/// stops, rather than guessing and being wrong about which team gets woken.
const conflictOutcome = computed<I18nText | "">(() => {
  const holder = conflictHolder.value;
  if (!holder || !pairs.value.length) return "";
  if (holder.teamId === team.value) return t("oncall.ruleEditorConflictSameTeam");
  if (pairs.value.length > holder.segments) {
    return t("oncall.ruleEditorConflictTakesOver", { team: raw(teamNameOf(holder.teamId)) });
  }
  if (pairs.value.length < holder.segments) {
    return t("oncall.ruleEditorConflictKeptBy", { team: raw(teamNameOf(holder.teamId)) });
  }
  return t("oncall.ruleEditorConflictEqual");
});

/// Ask the host who holds the drafted path, one request per pause rather than
/// one per keystroke. The dialog is short-lived, so the timer is cleared on
/// close rather than tracked across the component's whole life.
let previewTimer: ReturnType<typeof setTimeout> | undefined;
watch(
  [draftDimensions, () => props.open],
  ([dimensions, isOpen]) => {
    clearTimeout(previewTimer);
    if (!isOpen) return;
    previewTimer = setTimeout(() => emit("preview", dimensions), 300);
  },
  { deep: true },
);

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
/// Abandoning a half-written condition, without having to complete it first:
/// the only other way out of the builder was to add something.
function cancelPair() {
  draftName.value = "";
  draftValue.value = "";
  adding.value = false;
}

/// The row stays open after a commit — Add is how a multi-condition rule gets
/// written, and closing it every time would turn "and" into a second click
/// per condition instead of one.
function addPair() {
  if (!canAddPair.value) return;
  pairs.value.push({
    name: draftName.value.trim(),
    value: normalizeDimensionValue(draftValue.value),
  });
  draftName.value = "";
  draftValue.value = "";
}

function save() {
  if (!pairs.value.length || !team.value) return;
  emit("save", { dimensions: dimensionsOf(), team_id: team.value });
}
</script>
