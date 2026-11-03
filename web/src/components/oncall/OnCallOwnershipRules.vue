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

<!-- The routing rules as sentences, shared by org Routing and a team's Routing tab. -->
<template>
  <div class="relative flex flex-col gap-3" data-test="oncall-ownership-rules">
    <OInnerLoading v-if="loading" showing />

    <template v-else>
      <template v-if="groups.length">
        <section
          v-for="group in groups"
          :key="group.teamId"
          class="flex flex-col gap-2"
          :data-test="`oncall-rule-group-${group.teamId}`"
        >
          <OText v-if="!teamId" variant="label" class="text-text-secondary">
            {{ group.teamName }}
          </OText>

          <div
            v-for="row in group.rows"
            :key="row.rule.rule_id"
            class="border-border-default bg-surface-base rounded-surface flex flex-wrap items-center gap-x-4 gap-y-2 border px-4 py-3"
            :data-test="`oncall-routing-row-${row.rule.rule_id}`"
          >
            <span class="flex min-w-0 flex-1 flex-col gap-1">
              <i18n-t
                keypath="oncall.ruleSentence"
                tag="span"
                scope="global"
                class="text-text-body flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm"
                :data-test="`oncall-routing-says-${row.rule.rule_id}`"
              >
                <template #conditions>
                  <template v-for="(condition, index) in row.conditions" :key="condition.name">
                    <OText v-if="index" as="span" variant="meta">
                      {{ t("oncall.ruleEditorAnd") }}
                    </OText>
                    <ODimensionChip
                      :dim-key="condition.name"
                      :key-label="condition.label"
                      :value="condition.value"
                    />
                  </template>
                </template>
                <template #team>
                  <span
                    class="text-text-heading font-semibold"
                    :data-test="`oncall-rule-team-${row.rule.rule_id}`"
                  >
                    {{ teamNameOf(row.rule) }}
                  </span>
                </template>
              </i18n-t>

              <OText variant="meta" :data-test="`oncall-routing-caught-${row.rule.rule_id}`">
                {{ caughtOf(row.rule) }}
              </OText>
              <OText
                v-if="row.overlap"
                variant="meta"
                class="text-status-warning-text"
                :data-test="`oncall-routing-note-${row.rule.rule_id}`"
              >
                {{ row.overlap }}
              </OText>
            </span>

            <!-- Fixed slots [edit][more], so every row's icons line up with the catch-all's. -->
            <span v-if="editable" class="ms-auto flex w-17 shrink-0 items-center justify-end gap-1">
              <OButton
                variant="ghost"
                size="icon-sm"
                icon-left="edit"
                :aria-label="t('oncall.edit')"
                :data-test="`oncall-routing-edit-${row.rule.rule_id}`"
                @click="emit('edit', row.rule)"
              >
                <OTooltip side="bottom" :content="t('oncall.edit')" />
              </OButton>
              <ODropdown side="bottom" align="end">
                <template #trigger>
                  <OButton
                    variant="ghost"
                    size="icon-sm"
                    icon-left="more-horiz"
                    :aria-label="t('oncall.moreActions')"
                    :data-test="`oncall-routing-more-${row.rule.rule_id}`"
                  >
                    <OTooltip side="bottom" :content="t('oncall.moreActions')" />
                  </OButton>
                </template>
                <ODropdownItem
                  v-if="testable"
                  icon-left="manage-search"
                  :data-test="`oncall-routing-test-${row.rule.rule_id}`"
                  @select="emit('test', row.rule)"
                >
                  <span>{{ t("oncall.routingTestRouting") }}</span>
                </ODropdownItem>
                <ODropdownItem
                  icon-left="delete-outline"
                  variant="destructive"
                  :data-test="`oncall-ownership-delete-${row.rule.rule_id}`"
                  @select="emit('remove', row.rule)"
                >
                  <span>{{ t("oncall.removeRule") }}</span>
                </ODropdownItem>
              </ODropdown>
            </span>
          </div>
        </section>
      </template>

      <OEmptyState
        v-else-if="search"
        size="block"
        preset="no-oncall-rules"
        filtered
        data-test="oncall-ownership-empty"
        @action="onEmptyAction"
      />
      <OEmptyState
        v-else
        size="block"
        preset="no-oncall-rules"
        :description="emptyDescription"
        data-test="oncall-ownership-empty"
        @action="emit('add')"
      />

      <!-- Pinned last: the catch-all is where an alert lands once every rule above has failed. -->
      <div
        v-if="catchAll"
        class="border-border-default rounded-surface flex flex-wrap items-center gap-x-4 gap-y-2 border border-dashed px-4 py-3"
        data-test="oncall-routing-catch-all"
      >
        <span
          class="min-w-0 flex-1 text-sm"
          :class="catchAll === 'unset' ? 'text-status-warning-text' : 'text-text-body'"
          data-test="oncall-routing-catch-all-team"
        >
          <i18n-t v-if="catchAll === 'org'" keypath="oncall.routingEverythingElse" scope="global">
            <template #team>
              <span class="text-text-heading font-semibold">{{ defaultTeamName }}</span>
            </template>
          </i18n-t>
          <template v-else-if="catchAll === 'unset'">
            {{ t("oncall.routingEverythingElseNobody") }}
          </template>
          <template v-else>{{ t("oncall.routingDefaultAlsoGets") }}</template>
        </span>
        <span v-if="editable" class="ms-auto flex w-17 shrink-0 items-center justify-end gap-1">
          <OButton
            variant="ghost"
            size="icon-sm"
            :icon-left="teamId ? 'alt-route' : 'edit'"
            :aria-label="catchAllAction"
            data-test="oncall-routing-catch-all-set"
            @click="emit('change-default')"
          >
            <OTooltip side="bottom" :content="catchAllAction" />
          </OButton>
          <span class="w-8 shrink-0" aria-hidden="true" />
        </span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import ODimensionChip from "@/lib/core/Badge/ODimensionChip.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OInnerLoading from "@/lib/feedback/InnerLoading/OInnerLoading.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { OwnershipRuleStats } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { compareRulePrecedence } from "@/utils/oncall";

interface RuleCondition {
  name: string;
  label: string;
  value: string;
}

const props = withDefaults(
  defineProps<{
    rules?: OwnershipRuleStats[];
    teams?: { id: string; name: string }[];
    /** The org's field vocabulary, so a dimension reads as it does elsewhere. */
    aliases?: { id: string; display?: string }[];
    /** Set on a team's tab: only that team's rules, no team headings. */
    teamId?: string;
    /** The org's catch-all team, or null when none is nominated. */
    defaultTeamId?: string | null;
    loading?: boolean;
    search?: string;
    /** Off for readers who cannot write routing, so no row offers a dead button. */
    editable?: boolean;
    /** The host carries Test routing, so a row can open it pre-filled. */
    testable?: boolean;
  }>(),
  {
    rules: () => [],
    teams: () => [],
    aliases: () => [],
    teamId: "",
    defaultTeamId: null,
    loading: false,
    search: "",
    editable: true,
    testable: false,
  },
);

const emit = defineEmits<{
  (e: "add"): void;
  (e: "edit", rule: OwnershipRuleStats): void;
  (e: "remove", rule: OwnershipRuleStats): void;
  (e: "change-default"): void;
  (e: "test", rule: OwnershipRuleStats): void;
  (e: "clear-search"): void;
}>();

const { t } = useI18nTyped();

const scoped = computed(() =>
  props.teamId ? props.rules.filter((rule) => rule.team_id === props.teamId) : props.rules,
);

const visible = computed(() => {
  const needle = props.search.trim().toLowerCase();
  if (!needle) return scoped.value;
  return scoped.value.filter((rule) => searchTextOf(rule).includes(needle));
});

const groups = computed(() => {
  const byTeam = new Map<string, OwnershipRuleStats[]>();
  for (const rule of visible.value) {
    const list = byTeam.get(rule.team_id);
    if (list) list.push(rule);
    else byTeam.set(rule.team_id, [rule]);
  }
  return [...byTeam.entries()]
    .map(([teamId, rules]) => ({
      teamId,
      teamName: teamNameOf(rules[0]),
      rows: [...rules].sort(compareRulePrecedence).map((rule) => ({
        rule,
        conditions: conditionsOf(rule),
        overlap: overlapOf(rule),
      })),
    }))
    .sort((a, b) => String(a.teamName).localeCompare(String(b.teamName)));
});

/// `org` / `unset` on the org page; `team` only on the tab of the team that IS the catch-all.
const catchAll = computed<"org" | "unset" | "team" | null>(() => {
  if (props.teamId) return props.defaultTeamId === props.teamId ? "team" : null;
  return props.defaultTeamId ? "org" : "unset";
});

const defaultTeamName = computed<I18nText>(() =>
  raw(props.teams.find((team) => team.id === props.defaultTeamId)?.name || props.defaultTeamId),
);

const catchAllAction = computed<I18nText>(() => {
  if (props.teamId) return t("oncall.routingChangeInRouting");
  return props.defaultTeamId
    ? t("oncall.routingChangeCatchAll")
    : t("oncall.routingCatchAllRowSet");
});

const emptyDescription = computed<I18nText>(() => {
  if (!props.teamId) return t("oncall.noOwnershipRulesOrg");
  const name = props.teams.find((team) => team.id === props.teamId)?.name;
  return name
    ? t("oncall.routingEmptyBodyNamed", { team: raw(name) })
    : t("oncall.noOwnershipRules");
});

function displayOf(name: string): string {
  return props.aliases.find((alias) => alias.id === name)?.display || name;
}

function teamNameOf(rule: OwnershipRuleStats): I18nText {
  return raw(
    props.teams.find((team) => team.id === rule.team_id)?.name || rule.team_name || rule.team_id,
  );
}

/// A trailing `*` is the engine's prefix claim, so it reads as "starts with" rather than a literal star.
function conditionsOf(rule: OwnershipRuleStats): RuleCondition[] {
  return Object.keys(rule.dimensions ?? {})
    .sort()
    .map((name) => {
      const value = String(rule.dimensions[name]);
      const prefix = value.endsWith("*");
      return {
        name,
        label: prefix
          ? String(t("oncall.ruleChipStartsWith", { field: raw(displayOf(name)) }))
          : displayOf(name),
        value: prefix ? value.slice(0, -1) : value,
      };
    });
}

function caughtOf(rule: OwnershipRuleStats): I18nText {
  if (!rule.last_matched_at) return t("oncall.ruleNeverMatchedYet");
  return t("oncall.rulePagesInWindow", { count: rule.pages_caught }, rule.pages_caught);
}

/// The server's verdict, never a recomputed one: only a shadowed rule earns the line.
function overlapOf(rule: OwnershipRuleStats): I18nText | null {
  if (rule.health !== "shadowed") return null;
  const other = rule.shadowed_by[0];
  const who = other?.team_name || other?.path;
  return who ? t("oncall.ruleAlsoClaimedBy", { team: raw(who) }) : raw(rule.health_summary);
}

function searchTextOf(rule: OwnershipRuleStats): string {
  const conditions = Object.entries(rule.dimensions ?? {})
    .map(([name, value]) => `${displayOf(name)} ${value}`)
    .join(" ");
  return `${conditions} ${String(teamNameOf(rule))}`.toLowerCase();
}

function onEmptyAction(id?: string) {
  if (id === "clear-filters") {
    emit("clear-search");
    return;
  }
  emit("add");
}
</script>
