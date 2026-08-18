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
  One list, read top to bottom: what arrives, who it pages, what it caught.

  The catch-all is the LAST ROW of the same list rather than a panel of its own,
  because that is where a reader already arrives after the rules above fail to
  match — and the queue of signals that landed there hangs directly off it, so
  "nobody was paged" reads as the consequence of having no catch-all instead of
  as an unrelated section further down the page.

  Three columns, not seven. Order is the row order (the engine's own precedence),
  specificity is a note that only appears where two rows overlap, and health is
  replaced by the evidence it was summarising — what the rule caught, and when.
-->
<template>
  <div class="flex flex-col gap-3" data-test="oncall-routing-list">
    <span class="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-3">
      <OText variant="panel-title">{{ t("oncall.routingListTitle") }}</OText>
      <OText variant="meta">{{ t("oncall.routingListHint") }}</OText>

      <OButton
        variant="outline"
        size="xs"
        class="ms-auto"
        :active="testerOpen"
        data-test="oncall-routing-list-test"
        @click="emit('toggle-tester')"
      >
        {{ testerOpen ? t("oncall.routingHideTest") : t("oncall.routingTestSignal") }}
      </OButton>

      <OButton
        variant="primary"
        size="xs"
        data-test="oncall-routing-list-add"
        @click="setEditor('new')"
      >
        {{ t("oncall.addRule") }}
      </OButton>
    </span>

    <div class="border-border-default rounded-surface overflow-hidden border">
      <!-- The column strip names the three questions once, so no row has to
           repeat them. -->
      <div
        class="border-border-default bg-surface-panel text-text-secondary text-2xs grid gap-x-4 border-b px-3 py-2 font-medium tracking-wide uppercase max-md:hidden"
        :class="GRID"
      >
        <span>{{ t("oncall.routingColWhen") }}</span>
        <span>{{ t("oncall.routingColPages") }}</span>
        <span>{{ t("oncall.routingColCaught") }}</span>
        <span aria-hidden="true"></span>
      </div>

      <OInnerLoading v-if="loading" showing />

      <template v-else>
        <!-- The rules scroll inside the card rather than growing it. The rows
             below this box are the ones a reader must not have to scroll to
             find: what happens when nothing matched, and what already didn't. -->
        <div class="max-h-96 overflow-y-auto" data-test="oncall-routing-rules-scroll">
          <div
            v-for="rule in ordered"
            :key="rule.rule_id"
            class="border-border-subtle grid items-center gap-x-4 gap-y-2 border-b px-3 py-3 last:border-b-0"
            :class="[GRID, editorFor === rule.rule_id ? 'bg-surface-accent-hover' : '']"
            :data-test="`oncall-routing-row-${rule.rule_id}`"
          >
            <span class="flex min-w-0 flex-col gap-1">
              <span class="flex flex-wrap gap-1.5">
                <code
                  v-for="(value, name) in rule.dimensions"
                  :key="name"
                  class="border-border-subtle bg-surface-panel rounded-default text-text-body text-compact border px-1.5 py-0.5"
                >
                  {{ raw(`${displayOf(String(name))} = ${value}`) }}
                </code>
              </span>
              <OText variant="meta" :data-test="`oncall-routing-note-${rule.rule_id}`">
                {{ noteFor(rule) }}
              </OText>
            </span>

            <span class="flex min-w-0 items-center gap-2">
              <OIcon
                name="arrow-right"
                size="xs"
                class="text-text-muted shrink-0"
                aria-hidden="true"
              />
              <span class="flex min-w-0 flex-col">
                <span class="text-text-heading truncate text-sm font-medium">
                  {{ teamNameOf(rule.team_id) }}
                </span>
                <OText variant="meta">{{ pagingNoteFor(rule.team_id) }}</OText>
              </span>
            </span>

            <!-- The evidence the health pill used to summarise. A rule that has
               caught nothing says so plainly; there is no state between. -->
            <span class="flex min-w-0 flex-col">
              <span
                :class="rule.pages_caught ? 'text-text-heading font-medium' : 'text-text-muted'"
                class="text-sm"
                :data-test="`oncall-routing-caught-${rule.rule_id}`"
              >
                {{ t("oncall.rulePagesCaught", { count: rule.pages_caught }, rule.pages_caught) }}
              </span>
              <span
                v-if="rule.last_matched_at"
                class="text-text-secondary flex items-center gap-1 text-xs"
              >
                {{ t("oncall.routingLastCaught") }}
                <OTimeCell :value="rule.last_matched_at" unit="us" />
              </span>
              <OText v-else variant="meta">{{ t("oncall.routingRuleNeverMatched") }}</OText>
            </span>

            <span class="flex items-center justify-end gap-1">
              <OButton
                variant="outline"
                size="xs"
                :data-test="`oncall-routing-edit-${rule.rule_id}`"
                @click="setEditor(rule.rule_id)"
              >
                {{ t("oncall.edit") }}
              </OButton>

              <ODropdown align="end">
                <template #trigger>
                  <OButton
                    variant="ghost"
                    size="icon-sm"
                    icon-left="more-vert"
                    :aria-label="t('oncall.actions')"
                    :data-test="`oncall-routing-more-${rule.rule_id}`"
                  />
                </template>
                <ODropdownItem
                  variant="destructive"
                  :data-test="`oncall-routing-delete-${rule.rule_id}`"
                  @select="emit('remove', rule)"
                >
                  <template #icon-left><OIcon size="sm" name="delete-outline" /></template>
                  {{ t("oncall.removeRule") }}
                </ODropdownItem>
              </ODropdown>
            </span>
          </div>
        </div>

        <!-- Tier 4: the explicitly nominated catch-all, as the row it behaves
             like. Nothing is auto-created, so the unset state is the warning. -->
        <div
          class="border-border-default grid items-center gap-x-4 gap-y-2 border-t px-3 py-3"
          :class="[GRID, defaultTeamId ? '' : 'bg-status-warning-bg']"
          data-test="oncall-routing-catch-all"
        >
          <span class="flex min-w-0 flex-col">
            <span class="text-text-heading text-sm font-medium">
              {{ t("oncall.routingEverythingElse") }}
            </span>
            <OText variant="meta">{{ t("oncall.routingEverythingElseHint") }}</OText>
          </span>

          <span class="flex min-w-0 items-center gap-2">
            <OIcon
              name="arrow-right"
              size="xs"
              class="text-text-muted shrink-0"
              aria-hidden="true"
            />
            <span class="flex min-w-0 flex-col">
              <span
                class="truncate text-sm font-medium"
                :class="defaultTeamId ? 'text-text-heading' : 'text-status-error-text'"
                data-test="oncall-routing-catch-all-team"
              >
                {{ defaultTeamId ? teamNameOf(defaultTeamId) : t("oncall.routingNobody") }}
              </span>
              <OText variant="meta">
                {{
                  defaultTeamId ? t("oncall.routingCatchAllNote") : t("oncall.routingWaitsInQueue")
                }}
              </OText>
            </span>
          </span>

          <span class="flex min-w-0 flex-col" data-test="oncall-routing-catch-all-volume">
            <span v-if="openSignals.length" class="text-text-heading text-sm font-medium">
              {{
                t("oncall.routingSignalCount", { count: openSignals.length }, openSignals.length)
              }}
            </span>
            <OText v-else variant="meta">{{ t("oncall.routingNothingLanded") }}</OText>
            <OText v-if="openSignals.length" variant="meta">
              {{ t("oncall.routingFiresWindow", { count: totalFires }, totalFires) }}
            </OText>
          </span>

          <span class="flex items-center justify-end">
            <OPopover
              :open="catchAllOpen"
              side="bottom"
              align="end"
              content-class="w-72"
              :aria-label="t('oncall.routingCatchAllTitle')"
              @update:open="(v: boolean) => (catchAllOpen = v)"
            >
              <template #trigger>
                <OButton
                  :variant="defaultTeamId ? 'outline' : 'primary'"
                  size="xs"
                  data-test="oncall-routing-catch-all-set"
                >
                  {{
                    defaultTeamId
                      ? t("oncall.routingChangeCatchAll")
                      : t("oncall.routingSetCatchAll")
                  }}
                </OButton>
              </template>

              <div class="flex flex-col gap-2 p-3">
                <OText variant="panel-title">{{ t("oncall.routingCatchAllTitle") }}</OText>
                <OText variant="meta">{{ t("oncall.defaultTeamHint") }}</OText>
                <OSelect
                  :model-value="catchAllDraft"
                  :options="catchAllOptions"
                  :placeholder="t('oncall.defaultTeamPlaceholder')"
                  data-test="oncall-routing-catch-all-select"
                  @update:model-value="(v: unknown) => (catchAllDraft = String(v))"
                />
                <span class="flex justify-end gap-2">
                  <OButton variant="outline" size="sm-action" @click="catchAllOpen = false">
                    {{ t("oncall.cancel") }}
                  </OButton>
                  <OButton
                    variant="primary"
                    size="sm-action"
                    :loading="savingDefault"
                    :disabled="catchAllDraft === (defaultTeamId ?? '')"
                    data-test="oncall-routing-catch-all-save"
                    @click="saveCatchAll"
                  >
                    {{ t("oncall.save") }}
                  </OButton>
                </span>
              </div>
            </OPopover>
          </span>
        </div>

        <!-- The queue, attached to the row that explains it. Claiming opens the
             rule editor pre-filled from the signal's identity path, so the
             click removed is the one where the user retypes what is on screen. -->
        <div
          v-if="openSignals.length"
          class="border-border-default border-t"
          data-test="oncall-routing-unclaimed"
        >
          <span
            class="border-border-subtle flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-2"
          >
            <OIcon name="warning" size="xs" class="text-status-error-text" aria-hidden="true" />
            <span class="text-status-error-text text-sm font-medium">
              {{ t("oncall.routingLandedHere", { count: openSignals.length }) }}
            </span>
            <OText variant="meta">
              {{ defaultTeamId ? t("oncall.routingSomeAbsorbed") : t("oncall.routingNobodyPaged") }}
            </OText>
            <OButton
              v-if="teamName"
              variant="outline"
              size="xs"
              class="ms-auto"
              :loading="claiming"
              data-test="oncall-routing-claim-all"
              @click="emit('claim-all', openSignals)"
            >
              {{
                t("oncall.routingClaimAllFor", { count: openSignals.length, team: raw(teamName) })
              }}
            </OButton>
          </span>

          <div
            v-for="signal in openSignals"
            :key="signal.id"
            class="border-border-subtle flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2 last:border-b-0"
            :data-test="`oncall-routing-signal-${signal.id}`"
          >
            <span class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="text-text-heading truncate text-sm font-medium">{{
                titleOf(signal)
              }}</span>
              <!-- The routable subset only: it is what a claim writes, and the
                   full evidence stays a hover away for whoever identifies it. -->
              <code class="text-text-secondary truncate text-xs" :title="fullPathOf(signal)">
                {{ raw(routablePathOf(signal)) }}
              </code>
            </span>

            <OTag
              v-if="signal.defaulted_team_id"
              variant="warning-soft"
              size="sm"
              class="shrink-0"
              :data-test="`oncall-routing-signal-absorbed-${signal.id}`"
            >
              {{
                t("oncall.unroutedAbsorbedBy", { team: raw(teamNameOf(signal.defaulted_team_id)) })
              }}
            </OTag>

            <span class="text-text-secondary shrink-0 text-xs">
              {{ t("oncall.unroutedFires", { count: signal.occurrences }, signal.occurrences) }}
            </span>

            <OButton
              variant="outline"
              size="xs"
              class="shrink-0"
              :data-test="`oncall-routing-claim-${signal.id}`"
              @click="setEditor(signal.id)"
            >
              {{
                teamName
                  ? t("oncall.unroutedClaimFor", { team: raw(teamName) })
                  : t("oncall.unroutedWriteRule")
              }}
            </OButton>

            <!-- Dismissing stamps the field and keeps the row — the evidence
                 that a page fell through outlives a tidy table. -->
            <OButton
              variant="ghost"
              size="xs"
              class="shrink-0"
              :data-test="`oncall-routing-dismiss-${signal.id}`"
              @click="emit('dismiss', signal)"
            >
              {{ t("oncall.routingNotOurs") }}
            </OButton>
          </div>
        </div>
      </template>
    </div>

    <OText v-if="!loading && !ordered.length" variant="meta" data-test="oncall-routing-no-rules">
      {{ t("oncall.routingNoRules") }}
    </OText>

    <!-- One dialog for add, edit and claim: a rule is conditions plus the team
         they page, whichever of the three opened it. -->
    <OnCallRuleEditor
      :open="!!editorFor"
      :rule="editingRule"
      :initial-dimensions="claimingDimensions"
      :team-id="teamId"
      :teams="teams"
      :aliases="aliases"
      :signals="openSignals"
      :ladder="ladder"
      :saving="saving"
      @update:open="
        (v: boolean) => {
          if (!v) setEditor(null);
        }
      "
      @save="save"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";

import OnCallRuleEditor from "@/components/oncall/OnCallRuleEditor.vue";
import type { RuleDraft } from "@/components/oncall/OnCallRuleEditor.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OInnerLoading from "@/lib/feedback/InnerLoading/OInnerLoading.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import type {
  OnCallSlot,
  OwnershipRuleStats,
  TeamRungSummary,
  UnroutedSignal,
} from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { compareRulePrecedence, dimensionsSentence, identityDimensions } from "@/utils/oncall";

/// One template for the strip and every row, so the columns line up without a
/// table. Fractions rather than fixed widths: the conditions column is the one
/// that must survive a long identity path.
const GRID = "md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_minmax(0,1fr)_auto]";

const props = withDefaults(
  defineProps<{
    rules?: OwnershipRuleStats[];
    /** Signals that reached no rule. The queue, and the editor's replay set. */
    signals?: UnroutedSignal[];
    /** The org's field vocabulary, so a condition reads as it does elsewhere. */
    aliases?: { id: string; display?: string }[];
    teamId?: string;
    teamName?: string;
    teams?: { id: string; name: string }[];
    /** The nominated catch-all, or null when the org has none. */
    defaultTeamId?: string | null;
    /** Who holds the pager right now, for the "it pages" column. */
    onCallNow?: OnCallSlot[];
    ladder?: TeamRungSummary[];
    loading?: boolean;
    saving?: boolean;
    savingDefault?: boolean;
    claiming?: boolean;
    testerOpen?: boolean;
  }>(),
  {
    rules: () => [],
    signals: () => [],
    aliases: () => [],
    teamId: "",
    teamName: "",
    teams: () => [],
    defaultTeamId: null,
    onCallNow: () => [],
    ladder: () => [],
    loading: false,
    saving: false,
    savingDefault: false,
    claiming: false,
    testerOpen: false,
  },
);

const emit = defineEmits<{
  (e: "save-rule", draft: RuleDraft & { rule?: OwnershipRuleStats | null }): void;
  (e: "remove", rule: OwnershipRuleStats): void;
  (e: "set-default", teamId: string | null): void;
  (e: "claim-all", signals: UnroutedSignal[]): void;
  (e: "dismiss", signal: UnroutedSignal): void;
  (e: "toggle-tester"): void;
}>();

const { t } = useI18nTyped();

/// Which editor is open, by the id of the thing it edits: `new`, a rule id, or
/// a signal id. One value rather than three booleans — two open popovers over
/// the same list is the bug this shape makes impossible.
const editorFor = ref<string | null>(null);
const catchAllOpen = ref(false);
const catchAllDraft = ref("");

/// Most specific first, which is the order the engine consults them in. The
/// endpoint hands them back in storage order, which would number the rows
/// misleadingly.
const ordered = computed(() => [...props.rules].sort(compareRulePrecedence));

/// Dismissed rows are the historical record, not the worklist. This list is
/// attached to the catch-all row, so it shows what is still outstanding.
const openSignals = computed(() => props.signals.filter((signal) => !signal.dismissed_at));

const totalFires = computed(() =>
  openSignals.value.reduce((total, signal) => total + signal.occurrences, 0),
);

const catchAllOptions = computed(() => [
  { label: t("oncall.defaultTeamNone"), value: "" },
  ...props.teams.map((team) => ({ label: raw(team.name), value: team.id })),
]);

/// What the open dialog is editing, if it is a rule at all — the same id also
/// names a queue signal (a claim) or `new`.
const editingRule = computed(
  () => props.rules.find((rule) => rule.rule_id === editorFor.value) ?? null,
);

/// A claim opens pre-filled from the signal's identity path, so the click
/// removed is the one where the user retypes what is on screen.
const claimingDimensions = computed(() => {
  const signal = openSignals.value.find((candidate) => candidate.id === editorFor.value);
  return signal ? claimableDimensions(signal) : null;
});

/// The identity axes this org actually routes on — taken from the rules and
/// signals in play rather than from the whole vocabulary, so the note names
/// dimensions a reader has seen on this screen.
const axes = computed(() => {
  const names = new Set<string>();
  for (const rule of props.rules) Object.keys(rule.dimensions ?? {}).forEach((n) => names.add(n));
  for (const signal of openSignals.value) {
    Object.keys(identityDimensions(signal.dimensions)).forEach((n) => names.add(n));
  }
  return [...names].sort();
});

/// `""` means "none" in the picker; the wire value is null. Re-seeded on open
/// so a cancelled edit does not come back as the draft next time.
watch(catchAllOpen, (open) => {
  if (open) catchAllDraft.value = props.defaultTeamId ?? "";
});

function setEditor(id: string | null) {
  editorFor.value = id;
}

function save(value: RuleDraft) {
  const rule = editingRule.value;
  setEditor(null);
  emit("save-rule", { ...value, rule });
}

function saveCatchAll() {
  catchAllOpen.value = false;
  emit("set-default", catchAllDraft.value || null);
}

function displayOf(name: string): string {
  return props.aliases.find((alias) => alias.id === name)?.display || name;
}

function teamNameOf(teamId: string): I18nText {
  const known = props.teams.find((team) => team.id === teamId)?.name;
  return raw(known || (teamId === props.teamId ? props.teamName : teamId));
}

/// What paging that team means right now: the ladder a page would run, and who
/// would answer it. Only this screen's team has that context to hand.
function pagingNoteFor(teamId: string): I18nText {
  if (teamId !== props.teamId) return t("oncall.simulatorOtherTeam");
  const entry = props.ladder.find((rung) => rung.pages_anyone);
  if (!entry) return t("oncall.routingNoLadder");
  const ladder = raw(String(t("oncall.simulatorLadder", { priority: raw(entry.priority) })));
  const holder = props.onCallNow[0]?.user_email;
  return holder
    ? t("oncall.routingOnNow", { ladder, who: raw(holder) })
    : t("oncall.routingNobodyOnNow", { ladder });
}

/// Specificity, but only where it changes an outcome: a rule the server says is
/// shadowed gets the server's own sentence, and everything else gets what it
/// leaves unpinned — which is the honest reading of how broad it is.
function noteFor(rule: OwnershipRuleStats): I18nText {
  if (rule.health === "shadowed") {
    const other = rule.shadowed_by[0];
    const overlap = String(t("oncall.routingRuleOverlaps"));
    return raw(other?.outcome ? `${overlap} · ${other.outcome}` : overlap);
  }
  const pinned = new Set(Object.keys(rule.dimensions ?? {}));
  const loose = axes.value.filter((name) => !pinned.has(name)).slice(0, 3);
  if (!loose.length) return t("oncall.routingRuleWildcard");
  return raw(
    loose
      .map((name) => String(t("oncall.routingAnyDimension", { name: raw(displayOf(name)) })))
      .join(" · "),
  );
}

function titleOf(signal: UnroutedSignal): I18nText {
  return raw(signal.last_title) || raw(signal.description);
}

function fullPathOf(signal: UnroutedSignal): string {
  return dimensionsSentence(signal.dimensions) || signal.path;
}

/// Identity only. A rule pinned to a pod name matches one incarnation of one
/// process, then nothing, forever — evidence stays on the signal.
function claimableDimensions(signal: UnroutedSignal): Record<string, string> {
  const kept = identityDimensions(signal.dimensions);
  return Object.keys(kept).length ? kept : signal.dimensions;
}

function routablePathOf(signal: UnroutedSignal): string {
  return dimensionsSentence(claimableDimensions(signal)) || signal.path;
}
</script>
