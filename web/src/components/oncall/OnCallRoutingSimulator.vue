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

<!-- Test routing: describe an alert, read where the engine sends it. Every step is the server's answer. -->
<template>
  <div class="flex flex-col gap-5" data-test="oncall-routing-simulator">
    <OSelect
      v-if="startOptions.length"
      :model-value="startPick"
      :label="t('oncall.simulatorStartFrom')"
      :options="startOptions"
      :placeholder="t('oncall.ruleEditorStartPlaceholder')"
      size="sm"
      searchable
      icon-key="icon"
      data-test="oncall-simulator-start"
      @update:model-value="startFrom"
    />

    <div class="flex flex-col gap-2">
      <span class="flex items-center gap-1">
        <OText variant="label">{{ t("oncall.ruleEditorConditions") }}</OText>
        <OIcon name="info-outline" size="sm" class="text-text-secondary cursor-help">
          <OTooltip side="right" :content="t('oncall.simulatorInfo')" />
        </OIcon>
      </span>
      <OnCallConditionRows
        :key="seedKey"
        v-model="dimensions"
        :aliases="aliases"
        :catalogue="catalogue"
        :signals="signals"
        :services="services"
        :rules="rules"
        test-prefix="oncall-simulator"
      />
    </div>

    <OSelect
      :model-value="priority"
      :label="t('oncall.priority')"
      :options="priorityOptions"
      size="sm"
      width="xs"
      data-test="oncall-simulator-priority"
      @update:model-value="(v: unknown) => (priority = v === null ? 'P1' : String(v))"
    />

    <OText v-if="!hasConditions" variant="meta" data-test="oncall-simulator-empty">
      {{ t("oncall.simulatorPickCondition") }}
    </OText>

    <div
      v-else-if="preview"
      class="border-border-default rounded-surface flex flex-col gap-3 border px-4 py-3"
      :class="loading ? 'opacity-60' : ''"
      :aria-busy="loading"
      data-test="oncall-simulator-result"
    >
      <span class="flex min-w-0 items-baseline gap-1 text-sm" data-test="oncall-simulator-answer">
        <span class="text-text-heading shrink-0 font-semibold" data-test="oncall-simulator-team">
          {{ t("oncall.simulatorAnswerTeam", { team: teamLabel }) }}
        </span>
        <OTruncatedText v-if="preview.team_id" class="text-text-body flex-1">
          <span>{{ raw("· ") }}</span>
          <i18n-t
            v-if="wakes"
            keypath="oncall.simulatorWakesNow"
            tag="span"
            scope="global"
            :class="responderTone"
            data-test="oncall-simulator-responder"
          >
            <template #who>
              <OnCallPersonName
                :email="wakes.email"
                data-test="oncall-simulator-responder-person"
              />
            </template>
            <template #channels>{{ wakes.channels }}</template>
          </i18n-t>
          <span v-else :class="responderTone" data-test="oncall-simulator-responder">
            {{ responderNote }}
          </span>
          <template v-if="nextStep">
            <span>{{ raw(" · ") }}</span>
            <i18n-t
              keypath="oncall.simulatorNextStep"
              tag="span"
              scope="global"
              data-test="oncall-simulator-next"
            >
              <template #who>
                <template v-for="(email, index) in nextStep.emails" :key="email">
                  <span v-if="index">{{ raw(", ") }}</span>
                  <OnCallPersonName :email="email" data-test="oncall-simulator-next-person" />
                </template>
              </template>
              <template #after>{{ nextStep.after }}</template>
            </i18n-t>
          </template>
        </OTruncatedText>
      </span>

      <OCollapsible :label="t('oncall.simulatorWhy')" data-test="oncall-simulator-why">
        <div class="flex flex-col gap-1 pt-1">
          <OText variant="meta" data-test="oncall-simulator-won">
            {{ wonLine }}
          </OText>
          <OText
            v-for="other in preview.also_matched ?? []"
            :key="other.rule_id"
            variant="meta"
            :data-test="`oncall-simulator-also-${other.rule_id}`"
          >
            {{ alsoLine(other) }}
          </OText>
          <OText
            v-for="(note, index) in matchedNotes"
            :key="index"
            variant="meta"
            :data-test="`oncall-simulator-note-${index}`"
          >
            {{ raw(note) }}
          </OText>
        </div>
      </OCollapsible>

      <span v-if="preview.team_id" class="flex">
        <OButton
          variant="outline"
          size="sm"
          icon-left="notifications-active"
          :loading="sending"
          :disabled="!canConfigure"
          data-test="oncall-simulator-send-test"
          @click="sendTest(preview.team_id)"
        >
          {{ t("oncall.simulatorSendTest") }}
        </OButton>
      </span>

      <div
        v-if="testResult && sentFor === inputsKey"
        class="flex flex-col gap-1"
        data-test="oncall-simulator-test-result"
      >
        <template v-if="testResult.attempts.length">
          <OText variant="meta" data-test="oncall-simulator-test-count">
            {{
              t("oncall.testPageCount", { sent: sentAttempts, total: testResult.attempts.length })
            }}
          </OText>
          <span
            v-for="(attempt, index) in testResult.attempts"
            :key="index"
            :class="attempt.delivered ? 'text-text-secondary' : 'text-status-warning-text'"
            class="text-xs"
            :data-test="`oncall-simulator-test-attempt-${index}`"
            >{{ attemptLine(attempt) }}</span
          >
        </template>
        <span v-else class="text-status-warning-text text-xs">{{
          t("oncall.testPageNobody", {
            reason: raw(testResult.not_sent_because) || t("oncall.wouldPageNobody"),
          })
        }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useStore } from "vuex";

import OnCallConditionRows from "@/components/oncall/OnCallConditionRows.vue";
import OnCallPersonName from "@/components/oncall/OnCallPersonName.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useOrgUserNames } from "@/composables/useOrgUserNames";
import { escalationPreviewQuery } from "@/services/oncall.queries";
import type {
  AlsoMatchedRule,
  Channel,
  DimensionCatalogue,
  DiscoveredService,
  OwnershipRuleStats,
  PreviewRung,
  RoutingPreview,
  TeamRungSummary,
  TestPageAttempt,
  TestPageResult,
  UnroutedSignal,
} from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatMicrosDuration } from "@/utils/formatters";
import {
  SERVICE_DIMENSION,
  claimableDimensions,
  dimensionsOfPath,
  ownershipPath,
  readableConditions,
} from "@/utils/oncall";

export interface SimulatorQuery {
  dimensions: Record<string, string>;
  priority: string;
}

const props = withDefaults(
  defineProps<{
    preview?: RoutingPreview | null;
    teams?: { id: string; name: string }[];
    aliases?: { id: string; display?: string }[];
    catalogue?: DimensionCatalogue;
    services?: DiscoveredService[];
    /** Signals that need an owner, offered as starting points. */
    signals?: UnroutedSignal[];
    rules?: OwnershipRuleStats[];
    /** Conditions to open with; a new object re-seeds the rows. */
    seed?: Record<string, string> | null;
    loading?: boolean;
    sending?: boolean;
    /** False once a configuration write was refused for this org. */
    canConfigure?: boolean;
    /** What the last real test page did, kept on screen until the inputs change. */
    testResult?: TestPageResult | null;
  }>(),
  {
    preview: null,
    teams: () => [],
    aliases: () => [],
    catalogue: () => ({ present: [], values: {} }),
    services: () => [],
    signals: () => [],
    rules: () => [],
    seed: null,
    loading: false,
    sending: false,
    canConfigure: true,
    testResult: null,
  },
);

const emit = defineEmits<{
  /** Debounced: the conditions or priority settled on a new question. */
  (e: "run", query: SimulatorQuery): void;
  (e: "send-test", value: { team_id: string; priority: string }): void;
}>();

const { t } = useI18nTyped();
const store = useStore();
const { nameOf } = useOrgUserNames();

const PRIORITIES = ["P1", "P2", "P3", "P4", "P5"];
const STARTS_SHOWN = 10;

const dimensions = ref<Record<string, string>>({});
const seedKey = ref(0);
const priority = ref("P1");
const startPick = ref<string | null>(null);

const hasConditions = computed(() => Object.keys(dimensions.value).length > 0);

const priorityOptions = PRIORITIES.map((value) => ({ label: raw(value), value }));

function seedWith(next: Record<string, string>) {
  dimensions.value = { ...next };
  seedKey.value += 1;
}

/// Three kinds of real starting point, each tagged by its source so one id space cannot collide with another.
const startOptions = computed<SelectOption[]>(() => {
  const signals = [...props.signals]
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, STARTS_SHOWN)
    .map((signal) => ({
      label: raw(readable(claimableDimensions(signal.dimensions)) || signal.path),
      value: `signal:${signal.id}`,
      icon: "notifications-active",
      subLabel: t("oncall.routingFiresWindow", { count: signal.occurrences }, signal.occurrences),
      subLabelInline: true,
    }));
  const rules = props.rules.slice(0, STARTS_SHOWN).map((rule) => ({
    label: raw(readable(rule.dimensions)),
    value: `rule:${rule.rule_id}`,
    icon: "alt-route",
    subLabel: raw(teamNameOf(rule.team_id) || rule.team_name || ""),
    subLabelInline: true,
  }));
  const services = props.services.slice(0, STARTS_SHOWN).map((service) => ({
    label: raw(service.name),
    value: `service:${service.name}`,
    icon: "group-work",
  }));
  const group = (label: I18nText, options: SelectOption[]): SelectOption[] =>
    options.length ? [{ label, header: true }, ...options] : [];
  return [
    ...group(t("oncall.routingTabNeedsOwnerPlain"), signals),
    ...group(t("oncall.routingTabRules"), rules),
    ...group(t("oncall.simulatorStartServices"), services),
  ];
});

/// Names the start a seed came from, so the picker never reads "Choose…" over rows it filled.
function startOf(seed: Record<string, string>): string | null {
  const path = ownershipPath(seed);
  const rule = props.rules.find((one) => ownershipPath(one.dimensions) === path);
  if (rule) return `rule:${rule.rule_id}`;
  const signal = props.signals.find(
    (one) => ownershipPath(claimableDimensions(one.dimensions)) === path,
  );
  return signal ? `signal:${signal.id}` : null;
}

watch(
  () => props.seed,
  (next) => {
    if (!next) return;
    const start = startOf(next);
    startPick.value = startOptions.value.some((option) => option.value === start) ? start : null;
    seedWith(next);
  },
  { immediate: true },
);

function startFrom(value: unknown) {
  const pick = String(value ?? "");
  const [kind, ...rest] = pick.split(":");
  const id = rest.join(":");
  let next: Record<string, string> | null = null;
  if (kind === "signal") {
    const signal = props.signals.find((one) => one.id === id);
    next = signal ? claimableDimensions(signal.dimensions) : null;
  } else if (kind === "rule") {
    next = props.rules.find((one) => one.rule_id === id)?.dimensions ?? null;
  } else if (kind === "service") {
    next = { [SERVICE_DIMENSION]: id };
  }
  if (!next) return;
  startPick.value = pick;
  seedWith(next);
}

const query = computed<SimulatorQuery>(() => ({
  dimensions: dimensions.value,
  priority: priority.value,
}));

let runTimer: ReturnType<typeof setTimeout> | undefined;
watch(
  query,
  (next) => {
    clearTimeout(runTimer);
    if (!Object.keys(next.dimensions).length) return;
    runTimer = setTimeout(() => emit("run", { ...next, dimensions: { ...next.dimensions } }), 300);
  },
  { deep: true, immediate: true },
);

function teamNameOf(teamId: string | null | undefined): string {
  if (!teamId) return "";
  return props.teams.find((team) => team.id === teamId)?.name || teamId;
}

function readable(dimensions: Record<string, string>): string {
  return readableConditions(dimensions, props.aliases, {
    and: String(t("oncall.ruleEditorAnd")),
    startsWith: (field) => String(t("oncall.ruleChipStartsWith", { field: raw(field) })),
  });
}

const teamLabel = computed<I18nText>(() =>
  props.preview?.team_id ? raw(teamNameOf(props.preview.team_id)) : t("oncall.wouldPageNobody"),
);

/// Plain words, never the engine's `k=v` notes: they restate this line in storage notation.
const wonLine = computed<I18nText>(() => {
  const path = props.preview?.decision?.path;
  if (typeof path === "string" && !props.preview?.landed_on_default) {
    return t("oncall.simulatorWonPlain", { conditions: raw(readable(dimensionsOfPath(path))) });
  }
  return props.preview?.team_id
    ? t("oncall.simulatorNoRuleDefault", { team: teamLabel.value })
    : t("oncall.simulatorNoRuleNobody");
});

/// The no-match note only restates `wonLine` in `k=v` form; a matched route's notes are real caveats.
const matchedNotes = computed<string[]>(() => {
  const kind = props.preview?.decision?.kind;
  return kind === "ownership" || kind === "explicit" ? (props.preview?.notes ?? []) : [];
});

const ladderEntry = computed<TeamRungSummary | null>(
  () => props.preview?.ladder?.find((entry) => entry.priority === priority.value) ?? null,
);

const responder = computed(() => props.preview?.current_responder ?? null);

/// What they can receive narrowed to what the chosen priority sends.
const sentChannels = computed<Channel[]>(() => {
  const person = responder.value;
  if (!person) return [];
  const entry = ladderEntry.value;
  if (!entry) return person.deliverable_channels;
  return person.deliverable_channels.filter((channel) => entry.channels.includes(channel));
});

/// The person and channels when a page would land, so the name renders with its email tooltip.
const wakes = computed<{ email: string; channels: string } | null>(() => {
  if (ladderEntry.value && !ladderEntry.value.pages_anyone) return null;
  const person = responder.value;
  if (!person?.would_a_page_land || !sentChannels.value.length) return null;
  const channels = sentChannels.value
    .map((channel) => String(t(`oncall.channel_${channel}`)))
    .join(", ");
  return { email: person.user_email, channels };
});

const responderNote = computed<I18nText>(() => {
  if (ladderEntry.value && !ladderEntry.value.pages_anyone) return t("oncall.reachPagesNobody");
  const person = responder.value;
  if (!person) return t("oncall.simulatorNobodyOnCall");
  if (!person.would_a_page_land) return raw(person.why_not) || t("oncall.contactNoChannel");
  return t("oncall.simulatorSendsNothing");
});

const responderTone = computed(() => {
  if (ladderEntry.value && !ladderEntry.value.pages_anyone) return "text-text-secondary";
  if (!responder.value?.would_a_page_land) return "text-status-error-text";
  return sentChannels.value.length ? "text-text-body" : "text-status-warning-text";
});

const orgId = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");

const escalation = useQuery(() =>
  Object.assign(
    escalationPreviewQuery(
      orgId.value,
      props.preview?.team_id ?? "",
      Number(priority.value.slice(1)) || 1,
    ),
    { enabled: !!props.preview?.team_id && !!orgId.value, retry: false },
  ),
);

/// The next step that wakes somebody new; hidden when the reader may not see the ladder.
const nextStep = computed<{ emails: string[]; after: string } | null>(() => {
  if (escalation.isError.value) return null;
  const woken = responder.value?.user_email.toLowerCase();
  const fresh = (rung: PreviewRung) =>
    rung.recipients.map((one) => one.user_email).filter((email) => email.toLowerCase() !== woken);
  const step = (escalation.data.value?.rungs ?? []).slice(1).find((rung) => fresh(rung).length);
  if (!step) return null;
  return {
    emails: [...new Set(fresh(step))],
    after: formatMicrosDuration(step.after_micros),
  };
});

/// A result is shown only beside the inputs it was sent for.
const inputsKey = computed(() =>
  JSON.stringify([props.preview?.team_id, priority.value, dimensions.value]),
);
const sentFor = ref<string | null>(null);

function sendTest(teamId: string) {
  sentFor.value = inputsKey.value;
  emit("send-test", { team_id: teamId, priority: priority.value });
}

const sentAttempts = computed(
  () => props.testResult?.attempts.filter((attempt) => attempt.delivered).length ?? 0,
);

function attemptLine(attempt: TestPageAttempt): I18nText {
  const params = {
    person: raw(nameOf(attempt.recipient)),
    channel: t(`oncall.channel_${attempt.channel}`),
  };
  if (attempt.delivered) return t("oncall.testPageAttemptSent", params);
  return attempt.detail
    ? t("oncall.testPageAttemptNotSent", { ...params, reason: raw(attempt.detail) })
    : t("oncall.testPageAttemptNotSentBare", params);
}

/// A loser pointing at the same team changes nothing; one pointing elsewhere is a page on another team's phone.
function alsoLine(other: AlsoMatchedRule): I18nText {
  const conditions = raw(readable(dimensionsOfPath(other.path)));
  if (other.same_team) return t("oncall.simulatorLostSameTeam", { conditions });
  const team = raw(other.team_name || teamNameOf(other.team_id) || other.team_id);
  return t("oncall.simulatorLostOtherTeam", { conditions, team });
}
</script>
