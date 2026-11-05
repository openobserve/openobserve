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

<!-- One rule: the conditions an alert has to match, and the team it wakes. -->
<template>
  <ODialog
    :open="open"
    size="md"
    :title="title"
    :primary-button-label="t('oncall.saveRule')"
    :secondary-button-label="t('oncall.cancel')"
    :primary-button-disabled="!!saveProblem"
    :primary-button-loading="saving"
    data-test="oncall-rule-editor"
    @update:open="(v: boolean) => emit('update:open', v)"
    @click:primary="save"
    @click:secondary="emit('update:open', false)"
  >
    <div class="flex flex-col gap-5" data-test="oncall-rule-editor-sentence">
      <OSelect
        v-if="!rule && startable.length"
        :model-value="startSignal"
        :label="t('oncall.ruleEditorStartFrom')"
        :options="startOptions"
        :placeholder="t('oncall.ruleEditorStartPlaceholder')"
        size="sm"
        searchable
        icon-key="icon"
        :dropdown-style="START_PICKER_DROPDOWN_STYLE"
        data-test="oncall-rule-editor-signals"
        @update:model-value="startFrom"
      >
        <template #option="{ option }">
          <OnCallStartOption
            :option="option"
            :aliases="aliases"
            :data-test="`oncall-rule-editor-signals-option-${String(option.value)}`"
          />
        </template>
      </OSelect>

      <div class="flex flex-col gap-2">
        <span class="flex items-center gap-1">
          <OText variant="label">{{ t("oncall.ruleEditorConditions") }}</OText>
          <OTooltip side="right" :content="t('oncall.routingPrecedenceInfo')">
            <OIcon
              name="info-outline"
              size="sm"
              tabindex="0"
              :label="t('oncall.routingPrecedenceInfo')"
              class="text-text-secondary cursor-help"
              data-test="oncall-rule-editor-conditions-info"
            />
          </OTooltip>
          <OIcon
            v-if="correlationLocked"
            name="lock"
            size="sm"
            class="lock-chip"
            data-test="oncall-rule-editor-correlation-lock"
          >
            <OTooltip side="right" :content="correlationLockedReason" />
          </OIcon>
        </span>

        <OnCallConditionRows
          :key="seedKey"
          v-model="draftDimensions"
          :aliases="aliases"
          :catalogue="catalogue"
          :signals="signals"
          :services="services"
          :rules="rules"
          @update:incomplete="(v: boolean) => (conditionsIncomplete = v)"
        />
      </div>

      <div class="flex flex-col gap-1">
        <OSelect
          :model-value="team || null"
          :label="t('oncall.ruleEditorWake')"
          :options="teamOptions"
          :placeholder="t('oncall.ruleEditorWakePlaceholder')"
          size="sm"
          searchable
          data-test="oncall-rule-editor-team"
          @update:model-value="(v: unknown) => (team = v === null ? '' : String(v))"
        />
        <i18n-t
          v-if="onCallEmails.length"
          keypath="oncall.ruleEditorOnCallNow"
          tag="span"
          scope="global"
          class="text-text-secondary text-xs"
          data-test="oncall-rule-editor-on-call"
        >
          <template #names>
            <template v-for="(email, index) in onCallEmails" :key="email">
              <span v-if="index">{{ raw(", ") }}</span>
              <OnCallPersonName :email="email" data-test="oncall-rule-editor-on-call-person" />
            </template>
          </template>
        </i18n-t>
      </div>

      <OText v-if="outcome" variant="body" data-test="oncall-rule-editor-outcome">
        {{ outcome }}
      </OText>
    </div>

    <template #footer-left>
      <OText v-if="saveProblem" variant="meta" data-test="oncall-rule-editor-save-problem">
        {{ saveProblem }}
      </OText>
    </template>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useStore } from "vuex";

import OnCallConditionRows from "@/components/oncall/OnCallConditionRows.vue";
import OnCallPersonName from "@/components/oncall/OnCallPersonName.vue";
import OnCallStartOption from "@/components/oncall/OnCallStartOption.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { whoIsOnCallQuery } from "@/services/oncall.queries";
import type {
  DimensionCatalogue,
  DiscoveredService,
  OwnershipRuleStats,
  RoutingPreview,
  UnroutedSignal,
} from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { useLicenseLock } from "@/composables/useFeatureLock";
import { licenseDeniedFeatures } from "@/utils/featureGate";
import {
  START_PICKER_DROPDOWN_STYLE,
  claimableDimensions,
  readableConditions,
  ownershipPath,
  ruleClaimsDimensions,
} from "@/utils/oncall";

export interface RuleDraft {
  dimensions: Record<string, string>;
  team_id: string;
}

/// How much of the unrouted queue the "start from a signal" picker offers.
const STARTABLE_SHOWN = 20;

// Discovered services and dimension values come from the correlation API; manual entry still works when it is locked.
const { locked: correlationLocked, lockedReason: correlationLockedReason } =
  useLicenseLock("correlation");

const props = withDefaults(
  defineProps<{
    open?: boolean;
    /** Editing an existing rule; absent means a new one. */
    rule?: OwnershipRuleStats | null;
    /** Pre-filled conditions — a claim arrives with the signal's identity path. */
    initialDimensions?: Record<string, string> | null;
    /** The default team of a new rule; a claim passes the team the signal already fell to. */
    teamId?: string;
    teams?: { id: string; name: string }[];
    aliases?: { id: string; display?: string }[];
    catalogue?: DimensionCatalogue;
    /** Services discovery has seen, offered as values of the service field. */
    services?: DiscoveredService[];
    /** Who holds the drafted path today, answered by the host in response to `preview`. */
    conflict?: RoutingPreview | null;
    /** Signals that need an owner: the "start from" list and the match count. */
    signals?: UnroutedSignal[];
    /** Every rule, so the fields they pin are pickable. */
    rules?: OwnershipRuleStats[];
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
    conflict: null,
    signals: () => [],
    rules: () => [],
    saving: false,
  },
);

const emit = defineEmits<{
  (e: "update:open", open: boolean): void;
  (e: "save", draft: RuleDraft): void;
  /** The complete conditions changed; debounced, empty when there is nothing to ask. */
  (e: "preview", dimensions: Record<string, string>): void;
  (e: "licenseDenied", features: string[]): void;
}>();

const { t } = useI18nTyped();
const store = useStore();

const draftDimensions = ref<Record<string, string>>({});
/// Bumped to re-seed the condition rows: on open, and when starting from a signal.
const seedKey = ref(0);
const team = ref("");
const startSignal = ref<string | null>(null);

/// A claim arrives with a signal's path and no rule: it names an owner rather than drafting a rule.
const claiming = computed(
  () => !props.rule && !!props.initialDimensions && !!Object.keys(props.initialDimensions).length,
);

const title = computed<I18nText>(() => {
  if (props.rule) return t("oncall.editOwnershipRule");
  if (!claiming.value) return t("oncall.newRule");
  return team.value
    ? t("oncall.ruleEditorClaimFor", { team: raw(teamNameOf(team.value)) })
    : t("oncall.ruleEditorClaimTitle");
});

/// Opening resets the form: one instance serves add, edit and claim.
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    draftDimensions.value = { ...(props.rule?.dimensions ?? props.initialDimensions ?? {}) };
    seedKey.value += 1;
    team.value = props.rule?.team_id || props.teamId;
    startSignal.value = props.rule ? null : claimedSignalId(props.initialDimensions);
  },
  { immediate: true },
);

/// A claim arrives as dimensions only, so the picker names the signal whose path they are.
function claimedSignalId(dimensions: Record<string, string> | null): string | null {
  if (!dimensions || !Object.keys(dimensions).length) return null;
  const wanted = JSON.stringify(Object.entries(dimensions).sort());
  const signal = props.signals.find(
    (one) => JSON.stringify(Object.entries(claimableDimensions(one.dimensions)).sort()) === wanted,
  );
  return signal?.id ?? null;
}

const conditionCount = computed(() => Object.keys(draftDimensions.value).length);

const teamOptions = computed(() =>
  props.teams.map((option) => ({ label: raw(option.name), value: option.id })),
);

function teamNameOf(teamId: string): string {
  return props.teams.find((option) => option.id === teamId)?.name || teamId;
}

/// The chosen signal stays offered even outside the busiest few, so the picker never shows a value it does not list.
const startable = computed(() => {
  const top = [...props.signals]
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, STARTABLE_SHOWN);
  const chosen = props.signals.find((one) => one.id === startSignal.value);
  return chosen && !top.includes(chosen) ? [...top, chosen] : top;
});

const startOptions = computed(() =>
  startable.value.map((signal) => ({
    label: raw(
      readableConditions(claimableDimensions(signal.dimensions), props.aliases, {
        and: String(t("oncall.ruleEditorAnd")),
        startsWith: (field) => String(t("oncall.ruleChipStartsWith", { field: raw(field) })),
      }) || signal.path,
    ),
    value: signal.id,
    icon: "notifications-active",
    dimensions: claimableDimensions(signal.dimensions),
    meta: t("oncall.routingFiresWindow", { count: signal.occurrences }, signal.occurrences),
  })),
);

function startFrom(value: unknown) {
  const signal = props.signals.find((candidate) => candidate.id === value);
  if (!signal) return;
  startSignal.value = signal.id;
  draftDimensions.value = claimableDimensions(signal.dimensions);
  seedKey.value += 1;
}

const orgId = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");

const onCallQuery = useQuery(() =>
  Object.assign(whoIsOnCallQuery(orgId.value, team.value), {
    enabled: props.open && !!team.value && !!orgId.value,
    retry: false,
  }),
);
watch(onCallQuery.error, (err) => {
  const denied = licenseDeniedFeatures(err);
  if (denied) emit("licenseDenied", denied);
});

/// Hidden when the reader may not see the schedule: a wrong or empty name is worse than none.
const onCallEmails = computed<string[]>(() => {
  if (onCallQuery.isError.value) return [];
  return [...new Set((onCallQuery.data.value ?? []).map((one) => one.user_email))];
});

/// The live winner for the drafted path; the losers are `also_matched`, so the decision names the holder.
const holder = computed(() => {
  const decision = props.conflict?.decision as { path?: string } | undefined;
  if (!decision?.path || !props.conflict?.team_id) return null;
  return {
    path: String(decision.path),
    teamId: props.conflict.team_id,
    segments: String(decision.path).split("/").filter(Boolean).length,
  };
});

const matchedCount = computed(() =>
  conditionCount.value
    ? props.signals.filter((signal) =>
        ruleClaimsDimensions(draftDimensions.value, signal.dimensions),
      ).length
    : 0,
);

/// One line: who loses alerts to this rule if anyone, else how much of the queue it drains.
const outcome = computed<I18nText | "">(() => {
  if (!conditionCount.value) return "";
  const current = holder.value;
  // Editing a rule replays the rule itself; unchanged, that is no conflict.
  const isSelf = !!current && current.path === props.rule?.path && current.teamId === team.value;
  if (current && team.value && !isSelf) {
    const other = raw(teamNameOf(current.teamId));
    if (current.teamId === team.value) return t("oncall.ruleEditorConflictSameTeam");
    const samePath = current.path === ownershipPath(draftDimensions.value);
    if (samePath || conditionCount.value > current.segments) {
      return t("oncall.ruleEditorTakesFrom", { team: other });
    }
    if (conditionCount.value < current.segments) {
      return t("oncall.ruleEditorKeptBy", { team: other });
    }
    return t("oncall.ruleEditorContends", { team: other });
  }
  if (team.value) {
    // A claim is about this one signal, so counting the queue it drains says nothing new.
    const count = claiming.value ? 0 : matchedCount.value;
    return t("oncall.ruleEditorGoesTo", { team: raw(teamNameOf(team.value)), count }, count);
  }
  if (claiming.value || !props.signals.length) return "";
  return t("oncall.ruleEditorMatches", { count: matchedCount.value }, matchedCount.value);
});

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

const conditionsIncomplete = ref(false);

const saveProblem = computed<I18nText | "">(() => {
  if (!conditionCount.value) return t("oncall.ruleNeedsCondition");
  if (conditionsIncomplete.value) return t("oncall.ruleEditorPickValue");
  if (!team.value) return t("oncall.ruleNeedsTeam");
  return "";
});

function save() {
  if (saveProblem.value) return;
  emit("save", { dimensions: { ...draftDimensions.value }, team_id: team.value });
}
</script>
