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
  The rules that make this team the owner of something — and what each one has
  actually caught.

  A rule table without traffic cannot answer the only questions worth asking of
  it: is this rule doing anything, and is something else quietly taking its
  pages. Both come from `ownership/stats`, because deciding that rule A shadows
  rule B means comparing every rule against every other — including rules
  belonging to teams this screen cannot see.
-->
<template>
  <div class="flex min-h-0 flex-1 flex-col gap-3" data-test="oncall-ownership-rules">
    <span
      v-if="showHeader"
      class="flex flex-wrap items-baseline gap-x-2 gap-y-1"
      data-test="oncall-ownership-header"
    >
      <OText variant="panel-title">{{ t("oncall.ownershipRules") }}</OText>
      <OText variant="meta">{{ t("oncall.ownershipRulesHint") }}</OText>
      <OButton
        variant="outline"
        size="xs"
        class="ms-auto"
        data-test="oncall-ownership-add-rule"
        @click="emit('add')"
      >
        {{ t("oncall.addRule") }}
      </OButton>
    </span>

    <OTable
      :data="ordered"
      :columns="columns"
      row-key="rule_id"
      :frame="false"
      :loading="loading"
      :show-global-filter="false"
      table-id="oncall-ownership-rules"
      data-test="oncall-ownership-table"
    >
      <!-- The rule as the engine reads it, spaced to be read by a person. -->
      <template #cell-match="{ row }">
        <code class="text-text-body text-compact">{{ raw(sentenceOf(row)) }}</code>
      </template>

      <!-- Org view only: on a team's own tab every row routes to that team,
           and a column repeating it would be noise. -->
      <template #cell-team="{ row }">
        <span class="text-text-body" :data-test="`oncall-rule-team-${row.rule_id}`">
          {{ raw(row.team_name || row.team_id) }}
        </span>
      </template>

      <template #cell-specificity="{ row }">
        <span class="flex flex-wrap gap-1">
          <OTag v-for="name in dimensionNames(row)" :key="name" variant="purple-outline" size="sm">
            {{ displayOf(name) }}
          </OTag>
        </span>
      </template>

      <template #cell-caught="{ row }">
        <span class="text-text-body">
          {{ t("oncall.rulePagesCaught", { count: row.pages_caught }, row.pages_caught) }}
        </span>
      </template>

      <template #cell-last="{ row }">
        <OTimeCell v-if="row.last_matched_at" :value="row.last_matched_at" unit="us" />
        <span v-else class="text-text-body">{{ t("oncall.ruleNeverMatched") }}</span>
      </template>

      <!-- The server's own verdict, never a recomputed one. "Shadowed" in
           particular is a claim about rules this screen never fetched. -->
      <template #cell-health="{ row }">
        <OTag
          :variant="healthTone(row.health)"
          size="sm"
          :data-test="`oncall-rule-health-${row.rule_id}`"
        >
          {{ healthLabel(row) }}
        </OTag>
      </template>

      <template #cell-actions="{ row }">
        <span class="flex items-center justify-end gap-1">
          <OButton
            variant="outline"
            size="xs"
            :data-test="`oncall-ownership-edit-${row.rule_id}`"
            @click.stop="emit('edit', row)"
          >
            {{ t("oncall.edit") }}
          </OButton>
          <OButton
            variant="ghost"
            size="icon-sm"
            icon-left="delete-outline"
            :aria-label="t('oncall.removeRule')"
            :data-test="`oncall-ownership-delete-${row.rule_id}`"
            @click.stop="emit('remove', row)"
          />
        </span>
      </template>

      <template #empty>
        <OEmptyState
          size="block"
          preset="no-oncall-rules"
          :description="emptyDescription"
          data-test="oncall-ownership-empty"
          @action="emit('add')"
        />
      </template>
    </OTable>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OText from "@/lib/core/Typography/OText.vue";
import type { OwnershipRuleHealth, OwnershipRuleStats } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { compareRulePrecedence, dimensionsSentence } from "@/utils/oncall";

const props = withDefaults(
  defineProps<{
    rules?: OwnershipRuleStats[];
    /** The org's field vocabulary, so a dimension reads as it does elsewhere. */
    aliases?: { id: string; display?: string }[];
    loading?: boolean;
    /** Org-level view: rules span teams, so each row names where it routes. */
    showTeam?: boolean;
    /** Hosts that already name the section — a tab strip, a page header — turn
     *  the title row off rather than repeat themselves. */
    showHeader?: boolean;
  }>(),
  {
    rules: () => [],
    aliases: () => [],
    loading: false,
    showTeam: false,
    showHeader: true,
  },
);

const emit = defineEmits<{
  (e: "add"): void;
  (e: "edit", rule: OwnershipRuleStats): void;
  (e: "remove", rule: OwnershipRuleStats): void;
}>();

const { t } = useI18nTyped();

/// Most specific first, which is the order the engine consults them in.
/// `compareRulePrecedence` mirrors the server's comparator; the endpoint hands
/// them back in storage order, which would number the rows misleadingly.
const ordered = computed(() => [...props.rules].sort(compareRulePrecedence));

/// `showTeam` is also the signal for "org-scoped view" — no single team is in
/// context there, so the empty state cannot claim to speak for one.
const emptyDescription = computed(() =>
  t(props.showTeam ? "oncall.noOwnershipRulesOrg" : "oncall.noOwnershipRules"),
);

const columns = computed<OTableColumnDef<OwnershipRuleStats>[]>(() => [
  {
    id: "order",
    header: t("oncall.ruleOrder"),
    size: 70,
    sortable: false,
    accessorFn: (row: OwnershipRuleStats) => ordered.value.indexOf(row) + 1,
    meta: { align: "center" },
  },
  {
    id: "match",
    header: t("oncall.ownershipMatch"),
    accessorFn: (row: OwnershipRuleStats) => sentenceOf(row),
    meta: { isName: true },
  },
  ...(props.showTeam
    ? [
        {
          id: "team",
          header: t("oncall.ruleRoutesTo"),
          size: 150,
          sortable: true,
          accessorFn: (row: OwnershipRuleStats) => row.team_name || row.team_id,
        } as OTableColumnDef<OwnershipRuleStats>,
      ]
    : []),
  {
    id: "specificity",
    header: t("oncall.ruleSpecificity"),
    size: 150,
    sortable: false,
    accessorFn: (row: OwnershipRuleStats) => dimensionNames(row).join(", "),
  },
  {
    id: "caught",
    header: t("oncall.rulePagesCaughtHeader"),
    size: 150,
    sortable: true,
    accessorFn: (row: OwnershipRuleStats) => row.pages_caught,
  },
  {
    id: "last",
    header: t("oncall.ruleLastMatched"),
    size: 150,
    sortable: true,
    accessorFn: (row: OwnershipRuleStats) => row.last_matched_at ?? 0,
  },
  {
    id: "health",
    header: t("oncall.ruleHealth"),
    size: 180,
    sortable: false,
    accessorFn: (row: OwnershipRuleStats) => row.health,
  },
  {
    id: "actions",
    header: t("oncall.actions"),
    isAction: true,
    sortable: false,
    size: 70,
    meta: { align: "center", cellClass: "actions-column", actionCount: 2 },
  },
]);

function sentenceOf(rule: OwnershipRuleStats): string {
  return dimensionsSentence(rule.dimensions);
}

function dimensionNames(rule: OwnershipRuleStats): string[] {
  return Object.keys(rule.dimensions ?? {}).sort();
}

/// The org's own display name for the field, so a dimension is called the same
/// thing here as on the alert screens. Falls back to the id, which is what the
/// rule is actually written against.
function displayOf(name: string): I18nText {
  return raw(props.aliases.find((alias) => alias.id === name)?.display || name);
}

const HEALTH_TONES: Record<OwnershipRuleHealth, BadgeVariant> = {
  active: "success-soft",
  shadowed: "warning-soft",
  never_used: "default-soft",
};

function healthTone(health: OwnershipRuleHealth): BadgeVariant {
  return HEALTH_TONES[health] ?? "default-soft";
}

/// A shadowed rule names the team taking its pages, because "shadowed" alone
/// does not tell you who to go and talk to. The other two states are their own
/// explanation, and the server's fuller sentence sits in the tooltip.
function healthLabel(rule: OwnershipRuleStats): I18nText {
  if (rule.health === "shadowed") {
    const other = rule.shadowed_by[0];
    const who = other?.team_name || other?.path;
    if (who) return t("oncall.ruleAlsoClaimedBy", { team: raw(who) });
  }
  return rule.health === "never_used" ? t("oncall.ruleNeverUsed") : t("oncall.ruleActive");
}
</script>
