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
  One numbered list, read top to bottom: what arrives, and whether it landed.

  Each row leads with the sentence the rule makes — "signals from the
  fraud-scorer service on ap1cloud / risk" — and keeps the exact conditions
  underneath as evidence. The columns this replaced (who it pages, how specific
  it is, how healthy it is) all said the same thing on every row of a team's own
  tab, and the pulse strip above the tabs already answers who is holding the
  pager.

  The catch-all is the last row of the same list, because that is where a reader
  arrives after the rules above fail to match. What landed there is a strip
  below it that stays one line until somebody chooses to work the queue.
-->
<template>
  <div class="flex flex-col gap-3" data-test="oncall-routing-list">
    <div
      class="card-container rounded-surface bg-surface-base border-border-default overflow-hidden border"
    >
      <span
        class="border-border-default flex flex-wrap items-center gap-x-2 gap-y-2 border-b px-4 py-3"
      >
        <OText variant="panel-title">{{ t("oncall.routingListTitle") }}</OText>
        <OText variant="meta">{{ t("oncall.routingListHint") }}</OText>

        <OButton
          variant="primary"
          size="sm-action"
          class="ms-auto"
          data-test="oncall-routing-list-add"
          @click="setEditor('new')"
        >
          {{ t("oncall.newRule") }}
        </OButton>
      </span>

      <OInnerLoading v-if="loading" showing />

      <template v-else>
        <!-- The rules scroll inside the card rather than growing it: the two
             rows below must never be scrolled off to find. -->
        <div class="max-h-96 overflow-y-auto" data-test="oncall-routing-rules-scroll">
          <div
            v-for="(row, index) in rows"
            :key="row.rule.rule_id"
            class="border-border-subtle flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3 last:border-b-0"
            :class="editorFor === row.rule.rule_id ? 'bg-surface-accent-hover' : ''"
            :data-test="`oncall-routing-row-${row.rule.rule_id}`"
          >
            <!-- The order IS the rule: the engine consults them most specific
                 first, so the number is the only precedence device needed. -->
            <span
              class="bg-surface-panel text-text-secondary flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium"
              aria-hidden="true"
            >
              {{ index + 1 }}
            </span>

            <span class="flex min-w-0 flex-1 flex-col gap-1">
              <i18n-t
                :keypath="row.headline.key"
                tag="span"
                scope="global"
                class="text-text-heading text-sm"
                :data-test="`oncall-routing-says-${row.rule.rule_id}`"
              >
                <template #service>
                  <span class="font-semibold">{{ raw(row.headline.service) }}</span>
                </template>
                <template #scope>
                  <span class="font-semibold">{{ raw(row.headline.scope) }}</span>
                </template>
                <template #value>
                  <span class="font-semibold">{{ raw(row.headline.value) }}</span>
                </template>
                <template #noun>{{ raw(row.headline.noun) }}</template>
              </i18n-t>

              <!-- The same chip the error detail and incident screens use, so
                   a dimension is the same colour wherever it is read. -->
              <span class="flex flex-wrap gap-1.5">
                <ODimensionChip
                  v-for="(value, name) in row.rule.dimensions"
                  :key="name"
                  :dim-key="String(name)"
                  :key-label="displayOf(String(name))"
                  :value="value"
                />
              </span>

              <!-- Only where the server says the row cannot bite. Everything
                   else specificity used to say is now the row's position. -->
              <OText
                v-if="row.overlap"
                variant="meta"
                :data-test="`oncall-routing-note-${row.rule.rule_id}`"
              >
                {{ row.overlap }}
              </OText>
            </span>

            <!-- A rule repointed at another team stays visible until the list
                 refetches, and "it pages us" would be a lie on that row. -->
            <OTag
              v-if="row.rule.team_id !== teamId"
              variant="default-soft"
              size="sm"
              class="shrink-0"
              :data-test="`oncall-routing-elsewhere-${row.rule.rule_id}`"
            >
              {{ t("oncall.routingPagesTeam", { team: teamNameOf(row.rule.team_id) }) }}
            </OTag>

            <span class="shrink-0" :data-test="`oncall-routing-caught-${row.rule.rule_id}`">
              <OTag v-if="!row.rule.last_matched_at" variant="default-soft" size="sm">
                {{ t("oncall.routingRuleNeverMatched") }}
              </OTag>
              <i18n-t
                v-else
                keypath="oncall.routingCaughtLast"
                :plural="row.rule.pages_caught"
                tag="span"
                scope="global"
                class="text-text-secondary flex items-center gap-1 text-xs"
              >
                <template #count>{{ row.rule.pages_caught }}</template>
                <template #when>
                  <OTimeCell :value="row.rule.last_matched_at" unit="us" />
                </template>
              </i18n-t>
            </span>

            <OButton
              variant="ghost"
              size="icon-sm"
              icon-left="edit"
              class="shrink-0"
              :aria-label="t('oncall.edit')"
              :data-test="`oncall-routing-edit-${row.rule.rule_id}`"
              @click="setEditor(row.rule.rule_id)"
            >
              <OTooltip side="bottom" :content="t('oncall.edit')" />
            </OButton>
          </div>
        </div>

        <!-- Tier 4: the explicitly nominated catch-all, as the row it behaves
             like. Nothing is auto-created, so the unset state is the warning. -->
        <div
          class="border-border-default flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-4 py-3"
          :class="defaultTeamId ? '' : 'bg-status-warning-bg'"
          data-test="oncall-routing-catch-all"
        >
          <span
            class="border-border-default text-text-muted flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-dashed text-xs"
            aria-hidden="true"
          >
            {{ raw("∞") }}
          </span>

          <span class="flex min-w-0 flex-1 flex-col">
            <span
              class="text-sm font-medium"
              :class="defaultTeamId ? 'text-text-heading' : 'text-status-error-text'"
              data-test="oncall-routing-catch-all-team"
            >
              {{
                defaultTeamId
                  ? t("oncall.routingElseGoesTo", { team: teamNameOf(defaultTeamId) })
                  : t("oncall.routingElseNobody")
              }}
            </span>
            <OText variant="meta">{{ t("oncall.routingEverythingElseHint") }}</OText>
          </span>

          <OText variant="meta" class="shrink-0" data-test="oncall-routing-catch-all-volume">
            {{ openSignals.length ? volumeNote : t("oncall.routingNothingLanded") }}
          </OText>

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
                    : t("oncall.routingCatchAllRowSet")
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
        </div>
      </template>
    </div>

    <!-- What fell through, as one sentence naming the signals. The rows only
         unfold when somebody chooses to work the queue — until then the tab is
         a list of rules, not a list of rules and an inbox. -->
    <div
      v-if="!loading && openSignals.length"
      class="card-container rounded-surface bg-surface-base border-border-default flex flex-col gap-2 border px-4 py-3"
      data-test="oncall-routing-unclaimed"
    >
      <span class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <OTag variant="amber-soft" size="sm" class="shrink-0">
          {{ t("oncall.routingUnclaimedCount", { count: openSignals.length }, openSignals.length) }}
        </OTag>

        <template v-for="(part, index) in unclaimedNames" :key="index">
          <span v-if="part.strong" class="text-text-heading text-sm font-medium">
            {{ raw(part.text) }}
          </span>
          <OText v-else variant="meta" class="italic">{{ raw(part.text) }}</OText>
        </template>

        <OText variant="meta" class="italic">
          {{
            defaultTeamId
              ? t("oncall.routingUnclaimedAbsorbed")
              : t("oncall.routingUnclaimedNobody")
          }}
        </OText>

        <OButton
          variant="outline"
          size="sm-action"
          class="ms-auto shrink-0"
          :active="reviewOpen"
          data-test="oncall-routing-review-claim"
          @click="reviewOpen = !reviewOpen"
        >
          {{ reviewOpen ? t("oncall.routingHideQueue") : t("oncall.routingReviewClaim") }}
        </OButton>
      </span>

      <div
        v-if="reviewOpen"
        class="border-border-subtle flex flex-col border-t"
        data-test="oncall-routing-unclaimed-rows"
      >
        <div
          v-for="signal in openSignals"
          :key="signal.id"
          class="border-border-subtle flex flex-wrap items-center gap-x-3 gap-y-1 border-b py-2 last:border-b-0"
          :data-test="`oncall-routing-signal-${signal.id}`"
        >
          <span class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="text-text-heading truncate text-sm font-medium">{{
              titleOf(signal)
            }}</span>
            <!-- The routable subset only: it is what a claim writes, and the
                 full evidence stays a hover away for whoever identifies it. -->
            <span class="flex flex-wrap gap-1.5" :title="fullPathOf(signal)">
              <ODimensionChip
                v-for="(value, name) in claimableDimensions(signal)"
                :key="name"
                :dim-key="String(name)"
                :key-label="displayOf(String(name))"
                :value="value"
              />
            </span>
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

        <span v-if="teamName" class="flex justify-end pt-2">
          <OButton
            variant="outline"
            size="sm-action"
            :loading="claiming"
            data-test="oncall-routing-claim-all"
            @click="emit('claim-all', openSignals)"
          >
            {{ t("oncall.routingClaimAllFor", { count: openSignals.length, team: raw(teamName) }) }}
          </OButton>
        </span>
      </div>
    </div>

    <OText v-if="!loading && !rows.length" variant="meta" data-test="oncall-routing-no-rules">
      {{ t("oncall.routingNoRules") }}
    </OText>

    <!-- One dialog for add, edit and claim: a rule is conditions plus the team
         they page, whichever of the three opened it. Removal lives in there
         too, so the row keeps a single button. -->
    <OnCallRuleEditor
      :open="!!editorFor"
      :rule="editingRule"
      :initial-dimensions="claimingDimensions"
      :team-id="teamId"
      :teams="teams"
      :aliases="aliases"
      :catalogue="catalogue"
      :services="services"
      :sets="sets"
      :signals="openSignals"
      :ladder="ladder"
      :conflict="conflict"
      :saving="saving"
      @update:open="
        (v: boolean) => {
          if (!v) setEditor(null);
        }
      "
      @save="save"
      @remove="remove"
      @preview="(dimensions: Record<string, string>) => emit('preview', dimensions)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";

import OnCallRuleEditor from "@/components/oncall/OnCallRuleEditor.vue";
import type { IdentitySet } from "@/services/service_streams";
import type { RoutingPreview } from "@/ts/interfaces/oncall";
import type { RuleDraft } from "@/components/oncall/OnCallRuleEditor.vue";
import ODimensionChip from "@/lib/core/Badge/ODimensionChip.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OInnerLoading from "@/lib/feedback/InnerLoading/OInnerLoading.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type {
  DimensionCatalogue,
  DiscoveredService,
  OwnershipRuleStats,
  TeamRungSummary,
  UnroutedSignal,
} from "@/ts/interfaces/oncall";
import type { I18nKey, I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { compareRulePrecedence, dimensionsSentence, identityDimensions } from "@/utils/oncall";

/// The order a scope reads in when a rule pins more than one place —
/// cluster before namespace, the way an operator says it out loud.
const SCOPE_ORDER = [
  "k8s-cluster",
  "k8s-namespace",
  "service-namespace",
  "environment",
  "region",
  "availability-zone",
  "host",
];

/// The short noun each identity axis is called in a sentence. Anything not
/// listed falls back to the org's own display name for the dimension.
const DIMENSION_NOUNS: Record<string, I18nKey> = {
  "k8s-cluster": "oncall.dimensionNounCluster",
  "k8s-namespace": "oncall.dimensionNounNamespace",
  "service-namespace": "oncall.dimensionNounNamespace",
  "k8s-deployment": "oncall.dimensionNounDeployment",
  environment: "oncall.dimensionNounEnvironment",
  region: "oncall.dimensionNounRegion",
  host: "oncall.dimensionNounHost",
  "cloud-account": "oncall.dimensionNounAccount",
  "db-name": "oncall.dimensionNounDatabase",
};

/// How many signal names the strip spells out before it counts the rest.
const NAMED_SIGNALS = 2;

/** The sentence a rule makes, as a key plus the fragments it interpolates. */
interface Headline {
  key: I18nKey;
  service?: string;
  scope?: string;
  value?: string;
  noun?: string;
}

const props = withDefaults(
  defineProps<{
    rules?: OwnershipRuleStats[];
    /** Signals that reached no rule. The queue, and the editor's replay set. */
    signals?: UnroutedSignal[];
    /** The org's field vocabulary, so a condition reads as it does elsewhere. */
    aliases?: { id: string; display?: string }[];
    /** What this org actually emits — see {@link DimensionCatalogue}. */
    catalogue?: DimensionCatalogue;
    /** Services discovery has seen, claimable whole. */
    services?: DiscoveredService[];
    /** The org's identity sets — the ordered hierarchy the scope picker uses. */
    sets?: IdentitySet[];
    /** Who holds the drafted path today, for the editor's conflict line. */
    conflict?: RoutingPreview | null;
    teamId?: string;
    teamName?: string;
    teams?: { id: string; name: string }[];
    /** The nominated catch-all, or null when the org has none. */
    defaultTeamId?: string | null;
    ladder?: TeamRungSummary[];
    loading?: boolean;
    saving?: boolean;
    savingDefault?: boolean;
    claiming?: boolean;
  }>(),
  {
    rules: () => [],
    signals: () => [],
    aliases: () => [],
    catalogue: () => ({ present: [], values: {} }),
    services: () => [],
    sets: () => [],
    conflict: null,
    teamId: "",
    teamName: "",
    teams: () => [],
    defaultTeamId: null,
    ladder: () => [],
    loading: false,
    saving: false,
    savingDefault: false,
    claiming: false,
  },
);

const emit = defineEmits<{
  (e: "save-rule", draft: RuleDraft & { rule?: OwnershipRuleStats | null }): void;
  (e: "remove", rule: OwnershipRuleStats): void;
  (e: "set-default", teamId: string | null): void;
  (e: "claim-all", signals: UnroutedSignal[]): void;
  (e: "dismiss", signal: UnroutedSignal): void;
  /** The drafted path changed — the host asks the engine who holds it today. */
  (e: "preview", dimensions: Record<string, string>): void;
}>();

const { t } = useI18nTyped();

/// Which editor is open, by the id of the thing it edits: `new`, a rule id, or
/// a signal id. One value rather than three booleans — two open popovers over
/// the same list is the bug this shape makes impossible.
const editorFor = ref<string | null>(null);
const catchAllOpen = ref(false);
const catchAllDraft = ref("");
const reviewOpen = ref(false);

/// Most specific first, which is the order the engine consults them in. The
/// endpoint hands them back in storage order, which would number the rows
/// misleadingly.
const ordered = computed(() => [...props.rules].sort(compareRulePrecedence));

/// Dismissed rows are the historical record, not the worklist.
const openSignals = computed(() => props.signals.filter((signal) => !signal.dismissed_at));

const totalFires = computed(() =>
  openSignals.value.reduce((total, signal) => total + signal.occurrences, 0),
);

/// One pass over the rules, so a row's sentence is not rebuilt four times by
/// the four slots that read it.
const rows = computed(() =>
  ordered.value.map((rule) => ({
    rule,
    headline: headlineOf(rule),
    overlap: overlapNoteFor(rule),
  })),
);

const volumeNote = computed<I18nText>(() =>
  t("oncall.routingCatchAllVolume", {
    signals: t(
      "oncall.routingSignalCount",
      { count: openSignals.value.length },
      openSignals.value.length,
    ),
    fires: t("oncall.routingFiresWindow", { count: totalFires.value }, totalFires.value),
  }),
);

/// The names of what fell through, with the conjunction styled apart from them
/// so the strip reads as a sentence rather than a run of bold tokens.
const unclaimedNames = computed<{ text: string; strong: boolean }[]>(() => {
  const named = openSignals.value.slice(0, NAMED_SIGNALS);
  const rest = openSignals.value.length - named.length;
  const parts: { text: string; strong: boolean }[] = [];
  named.forEach((signal, index) => {
    if (index) parts.push({ text: String(t("oncall.routingNamesAnd")), strong: false });
    parts.push({ text: String(titleOf(signal)), strong: true });
  });
  if (rest) {
    parts.push({ text: String(t("oncall.routingNamesMore", { count: rest })), strong: false });
  }
  return parts;
});

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

/// The editor closes before the confirmation opens: a dialog stacked on a
/// dialog is two surfaces asking about the same rule.
function remove() {
  const rule = editingRule.value;
  setEditor(null);
  if (rule) emit("remove", rule);
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

function nounOf(name: string): string {
  const key = DIMENSION_NOUNS[name];
  return key ? String(t(key)) : displayOf(name).toLowerCase();
}

/// The sentence a rule makes. A service is the subject when one is pinned and
/// everything else is where it runs; with no service the place itself is the
/// subject, which is how "anything from the introspection cluster" reads.
function headlineOf(rule: OwnershipRuleStats): Headline {
  const dimensions = rule.dimensions ?? {};
  const service = dimensions["service"];
  const places = Object.keys(dimensions)
    .filter((name) => name !== "service")
    .sort(byScope);
  const scope = places.map((name) => dimensions[name]).join(" / ");

  if (service && places.length) return { key: "oncall.routingSaysServiceIn", service, scope };
  if (service) return { key: "oncall.routingSaysService", service };
  if (places.length === 1) {
    return {
      key: "oncall.routingSaysPlace",
      value: dimensions[places[0]],
      noun: nounOf(places[0]),
    };
  }
  if (places.length) return { key: "oncall.routingSaysPlaces", scope };
  return { key: "oncall.routingSaysAnything" };
}

/// Known axes in speaking order, anything else alphabetically after them.
function byScope(a: string, b: string): number {
  const rankA = SCOPE_ORDER.indexOf(a);
  const rankB = SCOPE_ORDER.indexOf(b);
  if (rankA !== rankB)
    return (rankA < 0 ? SCOPE_ORDER.length : rankA) - (rankB < 0 ? SCOPE_ORDER.length : rankB);
  return a < b ? -1 : a > b ? 1 : 0;
}

/// The server's verdict, never a recomputed one — a row that cannot bite is
/// the only specificity fact worth a line of its own.
function overlapNoteFor(rule: OwnershipRuleStats): I18nText | null {
  if (rule.health !== "shadowed") return null;
  const other = rule.shadowed_by[0];
  const overlap = String(t("oncall.routingRuleOverlaps"));
  return raw(other?.outcome ? `${overlap} · ${other.outcome}` : overlap);
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
</script>
