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
  Describe an alert and see the whole path it would take, without firing one.

  The path is the point. "Which team owns this" is answerable from the rule
  table, but "does that actually wake somebody" is not: it runs through the
  winning rule, the team, that priority's ladder, and whoever holds the shift
  this instant. Every one of those steps is the server's answer — a client that
  recomputed precedence or resolved the roster would eventually disagree with
  the engine that pages people, and disagree silently.
-->
<template>
  <div
    class="card-container rounded-surface bg-surface-base border-border-default flex flex-col gap-3 border px-4 py-3"
    data-test="oncall-routing-simulator"
  >
    <span class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <OText variant="panel-title">{{ t("oncall.simulatorTitle") }}</OText>
      <OText variant="meta">{{ t("oncall.simulatorHint") }}</OText>
    </span>

    <!-- The query, as chips. A dimension is a fact about the alert; the
         priority picks which ladder that team would run. -->
    <span class="flex flex-wrap items-center gap-2">
      <span
        v-for="pair in pairs"
        :key="pair.name"
        class="border-border-default rounded-default flex items-center gap-1 border px-2 py-1"
        :data-test="`oncall-simulator-chip-${pair.name}`"
      >
        <span class="text-text-secondary text-xs">{{ displayOf(pair.name) }}</span>
        <span class="text-text-body text-compact font-medium">{{ raw(pair.value) }}</span>
        <OButton
          variant="ghost"
          size="icon-xs"
          icon-left="close"
          :aria-label="t('oncall.removeDimension')"
          @click="removePair(pair.name)"
        />
      </span>

      <span
        v-if="priority"
        class="border-border-default rounded-default flex items-center gap-1 border px-2 py-1"
        data-test="oncall-simulator-chip-priority"
      >
        <span class="text-text-secondary text-xs">{{ t("oncall.priority") }}</span>
        <span class="text-text-body text-compact font-medium">{{ raw(priority) }}</span>
        <OButton
          variant="ghost"
          size="icon-xs"
          icon-left="close"
          :aria-label="t('oncall.removeDimension')"
          @click="priority = ''"
        />
      </span>

      <OButton
        v-if="!adding"
        variant="outline"
        size="xs"
        data-test="oncall-simulator-add-dimension"
        @click="adding = true"
      >
        {{ t("oncall.addDimension") }}
      </OButton>

      <OButton
        variant="primary"
        size="xs"
        class="ms-auto"
        :disabled="!pairs.length"
        :loading="loading"
        data-test="oncall-simulator-run"
        @click="emit('run', query)"
      >
        {{ t("oncall.simulatorTest") }}
      </OButton>
    </span>

    <!-- A closed vocabulary: a typo here would produce a confident "nothing
         matches" for a dimension nothing ever emits. -->
    <span v-if="adding" class="flex flex-wrap items-end gap-2" data-test="oncall-simulator-adder">
      <OSelect
        v-model="draftName"
        :options="dimensionOptions"
        :label="t('oncall.dimensionName')"
        :placeholder="t('oncall.dimensionNamePlaceholder')"
        width="sm"
        searchable
        data-test="oncall-simulator-dimension-name"
      />
      <OInput
        v-model="draftValue"
        :label="t('oncall.dimensionValue')"
        :placeholder="t('oncall.dimensionValuePlaceholder')"
        width="sm"
        data-test="oncall-simulator-dimension-value"
      />
      <OButton
        variant="outline"
        size="sm-action"
        :disabled="!canAdd"
        data-test="oncall-simulator-dimension-confirm"
        @click="addPair"
      >
        {{ t("oncall.add") }}
      </OButton>
      <OButton variant="ghost" size="sm-action" @click="adding = false">
        {{ t("oncall.cancel") }}
      </OButton>
    </span>

    <!-- The resolved path: rule → team → ladder → person. -->
    <div
      v-if="preview"
      class="border-border-default rounded-default flex flex-wrap items-center gap-x-4 gap-y-3 border px-3 py-2.5"
      data-test="oncall-simulator-result"
    >
      <span class="flex flex-col">
        <span class="text-text-secondary text-xs">{{ matchedLabel }}</span>
        <code class="text-text-body text-compact">{{ matchedPath }}</code>
      </span>

      <OTag v-if="specificityNote" variant="primary-soft" size="sm" data-test="oncall-simulator-specificity">
        {{ specificityNote }}
      </OTag>

      <OIcon name="arrow-right" size="xs" class="text-text-muted" aria-hidden="true" />

      <span class="flex flex-col" data-test="oncall-simulator-team">
        <span class="text-text-heading text-sm font-medium">{{ teamLabel }}</span>
        <span class="text-text-secondary text-xs">{{ teamNote }}</span>
      </span>

      <template v-if="ladderEntry">
        <OIcon name="arrow-right" size="xs" class="text-text-muted" aria-hidden="true" />
        <span class="flex flex-col" data-test="oncall-simulator-ladder">
          <span class="text-text-heading text-sm font-medium">
            {{ t("oncall.simulatorLadder", { priority: raw(ladderEntry.priority) }) }}
          </span>
          <span :class="ladderEntry.pages_anyone ? 'text-text-secondary' : 'text-status-error-text'"
            class="text-xs">{{ ladderNote }}</span>
        </span>
      </template>

      <template v-if="responder">
        <OIcon name="arrow-right" size="xs" class="text-text-muted" aria-hidden="true" />
        <span class="flex flex-col" data-test="oncall-simulator-responder">
          <OUserCell :value="responder.user_email" />
          <!-- Channels that would carry it, or the server's reason none can. -->
          <span
            :class="responder.would_a_page_land ? 'text-status-success-text' : 'text-status-error-text'"
            class="text-xs"
          >
            {{ responderNote }}
          </span>
        </span>
      </template>

      <OButton
        v-if="preview.team_id"
        variant="outline"
        size="xs"
        class="ms-auto"
        :loading="sending"
        data-test="oncall-simulator-send-test"
        @click="emit('send-test', { team_id: preview.team_id, priority })"
      >
        {{ t("oncall.simulatorSendTest") }}
      </OButton>
    </div>

    <!-- Rules that matched and lost, in the server's words. Somebody reading
         this is usually asking why their rule did not win. -->
    <p
      v-for="other in preview?.also_matched ?? []"
      :key="other.rule_id"
      class="text-text-secondary text-xs"
      :data-test="`oncall-simulator-also-${other.rule_id}`"
    >
      {{ t("oncall.simulatorAlsoMatched", { path: raw(readable(other.path)) }) }}
      <span class="text-text-body">{{ alsoTarget(other) }}</span>
      {{ raw(other.lost_because) }}
    </p>

    <p
      v-for="(note, index) in preview?.notes ?? []"
      :key="index"
      class="text-text-secondary text-xs"
      :data-test="`oncall-simulator-note-${index}`"
    >
      {{ raw(note) }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { AlsoMatchedRule, RoutingPreview, TeamRungSummary } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatMicrosDuration } from "@/utils/formatters";
import { normalizeDimensionValue } from "@/utils/oncall";

export interface SimulatorQuery {
  dimensions: Record<string, string>;
  priority: string;
}

const props = withDefaults(
  defineProps<{
    preview?: RoutingPreview | null;
    /** The team whose screen this is, so the result can say "this team". */
    teamId?: string;
    teamName?: string;
    /** Resolves the team a foreign rule routes to. */
    teams?: { id: string; name: string }[];
    aliases?: { id: string; display?: string }[];
    loading?: boolean;
    sending?: boolean;
  }>(),
  {
    preview: null,
    teamId: "",
    teamName: "",
    teams: () => [],
    aliases: () => [],
    loading: false,
    sending: false,
  },
);

const emit = defineEmits<{
  (e: "run", query: SimulatorQuery): void;
  (e: "send-test", value: { team_id: string; priority: string }): void;
}>();

const { t } = useI18nTyped();

const pairs = ref<{ name: string; value: string }[]>([]);
const priority = ref("P1");
const adding = ref(false);
const draftName = ref("");
const draftValue = ref("");

const query = computed<SimulatorQuery>(() => ({
  dimensions: Object.fromEntries(pairs.value.map((pair) => [pair.name, pair.value])),
  priority: priority.value,
}));

const dimensionOptions = computed(() =>
  props.aliases.map((alias) => ({ label: raw(alias.display || alias.id), value: alias.id })),
);

const canAdd = computed(
  () =>
    !!draftName.value.trim() &&
    !!draftValue.value.trim() &&
    !pairs.value.some((pair) => pair.name === draftName.value.trim()),
);

/// Normalised on the way in, because the server lowercases these before
/// matching — showing the un-normalised form would mean testing one string and
/// reading back another.
function addPair() {
  if (!canAdd.value) return;
  pairs.value.push({
    name: draftName.value.trim(),
    value: normalizeDimensionValue(draftValue.value),
  });
  draftName.value = "";
  draftValue.value = "";
  adding.value = false;
}

function removePair(name: string) {
  pairs.value = pairs.value.filter((pair) => pair.name !== name);
}

function displayOf(name: string): I18nText {
  return raw(props.aliases.find((alias) => alias.id === name)?.display || name);
}

/// `k8s-namespace=payments` as stored, spaced out for reading.
function readable(path: string): string {
  return path.split("/").join(" · ").split("=").join(" = ");
}

const matchedPath = computed<I18nText>(() => {
  const path = props.preview?.decision?.path;
  return raw(typeof path === "string" ? readable(path) : "");
});

const matchedLabel = computed<I18nText>(() =>
  props.preview?.landed_on_default ? t("oncall.simulatorDefaultTeam") : t("oncall.simulatorMatchedRule"),
);

/// Only worth a badge when something else also matched — otherwise "most
/// specific of 1" is noise dressed as a finding.
const specificityNote = computed<I18nText | "">(() => {
  const others = props.preview?.also_matched?.length ?? 0;
  return others ? t("oncall.simulatorMostSpecific", { count: others + 1 }) : "";
});

const teamLabel = computed<I18nText>(() => {
  const id = props.preview?.team_id;
  if (!id) return t("oncall.wouldPageNobody");
  const known = props.teams.find((team) => team.id === id)?.name;
  return raw(known || (id === props.teamId ? props.teamName : id));
});

const teamNote = computed<I18nText>(() => {
  const id = props.preview?.team_id;
  if (!id) return t("oncall.simulatorNoOwner");
  if (id === props.teamId) return t("oncall.thisTeam");
  return t("oncall.simulatorOtherTeam");
});

const ladderEntry = computed<TeamRungSummary | null>(() => {
  if (!priority.value) return null;
  return props.preview?.ladder?.find((entry) => entry.priority === priority.value) ?? null;
});

/// "3 rungs, ends at 20m" — or the finding, when the priority wakes nobody.
const ladderNote = computed<I18nText>(() => {
  const entry = ladderEntry.value;
  if (!entry) return raw("");
  if (!entry.pages_anyone) return t("oncall.reachPagesNobody");
  const rungs = String(t("oncall.reachRungs", { count: entry.rungs }, entry.rungs));
  return entry.nobody_after_micros
    ? t("oncall.simulatorLadderEnds", {
        rungs: raw(rungs),
        at: raw(formatMicrosDuration(entry.nobody_after_micros)),
      })
    : raw(rungs);
});

const responder = computed(() => props.preview?.current_responder ?? null);

const responderNote = computed<I18nText>(() => {
  const person = responder.value;
  if (!person) return raw("");
  if (!person.would_a_page_land) return raw(person.why_not) || t("oncall.contactNoChannel");
  const channels = person.deliverable_channels
    .map((channel) => String(t(`oncall.channel_${channel}`)))
    .join(", ");
  return t("oncall.simulatorReachableNow", { channels: raw(channels) });
});

/// A losing rule that points at the same team changes nothing; one pointing
/// elsewhere is the case worth naming, because that is a page going to another
/// team's phone.
function alsoTarget(other: AlsoMatchedRule): I18nText {
  if (other.same_team) return t("oncall.simulatorSameTeam");
  const name = other.team_name || props.teams.find((team) => team.id === other.team_id)?.name;
  return t("oncall.simulatorOtherTeamNamed", { team: raw(name || other.team_id) });
}
</script>
