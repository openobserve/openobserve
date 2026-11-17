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

<!-- The routing rules table, in the order the engine consults them; shared by org Routing and a team's Routing tab. -->
<template>
  <div class="flex min-h-0 flex-1 flex-col" data-test="oncall-ownership-rules">
    <OTable
      :data="ordered"
      :columns="columns"
      row-key="rule_id"
      :frame="false"
      :loading="loading"
      :pagination="showPager ? 'client' : 'none'"
      :global-filter="search"
      :show-global-filter="false"
      :table-id="teamId ? 'oncall-team-routing-rules' : 'oncall-ownership-rules'"
      :persist-columns="true"
      :enable-column-resize="true"
      data-test="oncall-ownership-table"
    >
      <template v-if="$slots.toolbar" #toolbar><slot name="toolbar" /></template>
      <template v-if="$slots['toolbar-trailing']" #toolbar-trailing>
        <slot name="toolbar-trailing" />
      </template>

      <template #cell-match="{ row }">
        <OnCallFitChips
          :items="conditionsOf(row)"
          :tooltip="conditionsTip(row)"
          :data-test="`oncall-routing-says-${row.rule_id}`"
        >
          <template #item="{ item }">
            <span
              v-if="item.name === SERVICE_DIMENSION && !item.prefix"
              class="min-w-0"
              :data-test="`oncall-routing-rule-service-${row.rule_id}`"
              ><ServiceNameLabel
                layout="chip"
                :key-label="item.label"
                v-bind="labelPropsForKey(item.value, servicesByKey.get(item.value))"
            /></span>
            <ODimensionChip
              v-else
              :dim-key="item.name"
              :key-label="item.label"
              :value="item.value"
            />
          </template>
        </OnCallFitChips>
      </template>

      <template #cell-team="{ row }">
        <OTruncatedText class="text-text-body" :data-test="`oncall-rule-team-${row.rule_id}`">
          {{ teamNameOf(row) }}
        </OTruncatedText>
      </template>

      <template #cell-specificity="{ row }">
        <OnCallFitChips
          :items="conditionsOf(row)"
          :tooltip="fieldsTip(row)"
          :data-test="`oncall-routing-specificity-${row.rule_id}`"
        >
          <template #item="{ item }">
            <OTag type="dimensionKey" :value="item.name" :label="raw(item.field)" size="sm" />
          </template>
        </OnCallFitChips>
      </template>

      <template #cell-caught="{ row }">
        <span class="text-text-body" :data-test="`oncall-routing-caught-${row.rule_id}`">
          {{ t("oncall.rulePagesCaught", { count: row.pages_caught }, row.pages_caught) }}
        </span>
      </template>

      <template #cell-last="{ row }">
        <OTimeCell
          :value="row.last_matched_at ?? null"
          unit="us"
          :timezone="timezone"
          :empty-label="t('oncall.ruleNeverMatched')"
        />
      </template>

      <!-- The server's verdict, never a recomputed one: "shadowed" is a claim about rules this screen may not see. -->
      <template #cell-health="{ row }">
        <OTag
          type="oncallRuleHealth"
          :value="row.health"
          size="sm"
          :data-test="`oncall-rule-health-${row.rule_id}`"
        >
          {{ healthLabel(row) }}
          <OTooltip v-if="row.health_summary" side="bottom" :content="raw(row.health_summary)" />
        </OTag>
      </template>

      <template #cell-actions="{ row }">
        <span class="flex items-center justify-end gap-1">
          <OButton
            v-if="testable"
            variant="ghost"
            size="icon-sm"
            icon-left="manage-search"
            class="max-md:hidden"
            :aria-label="t('oncall.routingTestRouting')"
            :data-test="`oncall-routing-test-${row.rule_id}`"
            @click.stop="emit('test', row)"
          >
            <OTooltip side="bottom" :content="t('oncall.routingTestRouting')" />
          </OButton>
          <OButton
            variant="ghost"
            size="icon-sm"
            icon-left="edit"
            class="max-md:hidden"
            :aria-label="t('oncall.edit')"
            :data-test="`oncall-routing-edit-${row.rule_id}`"
            @click.stop="emit('edit', row)"
          >
            <OTooltip side="bottom" :content="t('oncall.edit')" />
          </OButton>
          <OButton
            variant="ghost-destructive"
            size="icon-sm"
            icon-left="delete-outline"
            class="max-md:hidden"
            :aria-label="t('oncall.removeRule')"
            :data-test="`oncall-ownership-delete-${row.rule_id}`"
            @click.stop="emit('remove', row)"
          >
            <OTooltip side="bottom" :content="t('oncall.removeRule')" />
          </OButton>
          <ODropdown side="bottom" align="end">
            <template #trigger>
              <OButton
                icon-left="more-vert"
                variant="ghost"
                size="icon-xs-sq"
                class="md:hidden"
                :aria-label="t('oncall.moreActions')"
                :data-test="`oncall-routing-more-${row.rule_id}`"
                @click.stop
              />
            </template>
            <ODropdownItem
              v-if="testable"
              icon-left="manage-search"
              class="md:hidden"
              :data-test="`oncall-routing-test-${row.rule_id}-menu`"
              @select="emit('test', row)"
            >
              <span>{{ t("oncall.routingTestRouting") }}</span>
            </ODropdownItem>
            <ODropdownItem
              icon-left="edit"
              class="md:hidden"
              :data-test="`oncall-routing-edit-${row.rule_id}-menu`"
              @select="emit('edit', row)"
            >
              <span>{{ t("oncall.edit") }}</span>
            </ODropdownItem>
            <ODropdownItem
              icon-left="delete-outline"
              variant="destructive"
              class="md:hidden"
              :data-test="`oncall-ownership-delete-${row.rule_id}-menu`"
              @select="emit('remove', row)"
            >
              <span>{{ t("oncall.removeRule") }}</span>
            </ODropdownItem>
          </ODropdown>
        </span>
      </template>

      <!-- On a team's tab the catch-all is this team's last rule, so it reads as the last row rather than as pager chrome. -->
      <template v-if="catchAll === 'team'" #body-end>
        <tr data-test="oncall-routing-catch-all-row">
          <td :colspan="columns.length + 1" class="border-table-row-divider border-b px-4 py-2">
            <span
              class="flex flex-wrap items-center gap-2 max-md:sticky max-md:start-4 max-md:max-w-[80vw]"
              data-test="oncall-routing-catch-all"
            >
              <span class="text-text-body text-sm" data-test="oncall-routing-catch-all-team">
                {{ t("oncall.routingDefaultAlsoGets") }}
              </span>
              <OButton
                v-if="editable"
                variant="outline"
                size="xs"
                icon-left="alt-route"
                data-test="oncall-routing-catch-all-set"
                @click="emit('change-default')"
              >
                {{ catchAllAction }}
              </OButton>
            </span>
          </td>
        </tr>
      </template>

      <!-- Where an alert lands once every rule above has failed. -->
      <template v-else-if="catchAll" #footer-note>
        <span class="flex flex-wrap items-center gap-2" data-test="oncall-routing-catch-all">
          <span
            class="text-sm"
            :class="catchAll === 'unset' ? 'text-status-warning-text' : 'text-text-body'"
            data-test="oncall-routing-catch-all-team"
          >
            <i18n-t v-if="catchAll === 'org'" keypath="oncall.routingEverythingElse" scope="global">
              <template #team>
                <span class="text-text-heading font-semibold">{{ defaultTeamName }}</span>
              </template>
            </i18n-t>
            <template v-else>{{ t("oncall.routingEverythingElseNobody") }}</template>
          </span>
          <OButton
            v-if="editable"
            variant="outline"
            size="xs"
            icon-left="edit"
            data-test="oncall-routing-catch-all-set"
            @click="emit('change-default')"
          >
            {{ catchAllAction }}
          </OButton>
        </span>
      </template>

      <template #empty>
        <template v-if="!loading">
          <!-- A search that matched nothing is not an org without rules. -->
          <OEmptyState
            v-if="search"
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
            :hide-action="!editable"
            data-test="oncall-ownership-empty"
            @action="onEmptyAction"
          />
        </template>
      </template>
    </OTable>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";

import ODimensionChip from "@/lib/core/Badge/ODimensionChip.vue";
import OnCallFitChips from "./OnCallFitChips.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ServiceNameLabel from "@/components/shared/ServiceNameLabel.vue";
import type { DiscoveredService, OwnershipRuleStats } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { labelPropsForKey, serviceOptionParts } from "@/types/serviceRef";
import { SERVICE_DIMENSION, fieldLabel } from "@/utils/oncall";

interface RuleCondition {
  name: string;
  /** The field alone, for the Specificity column. */
  field: string;
  /** The chip's key segment, "starts with" folded in for a prefix claim. */
  label: string;
  value: string;
  prefix: boolean;
}

const props = withDefaults(
  defineProps<{
    rules?: OwnershipRuleStats[];
    teams?: { id: string; name: string }[];
    /** The org's field vocabulary, so a dimension reads as it does elsewhere. */
    aliases?: { id: string; display?: string }[];
    /** Set on a team's tab: only that team's rules, and no Routes to column. */
    teamId?: string;
    /** The org's catch-all team, or null when none is nominated. */
    defaultTeamId?: string | null;
    loading?: boolean;
    search?: string;
    /** Off for readers who cannot write routing, so no row offers a dead button. */
    editable?: boolean;
    /** The host carries Test routing, so a row can open it pre-filled. */
    testable?: boolean;
    /** Discovered services, so a service condition reads by its trace name. */
    services?: DiscoveredService[];
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
    services: () => [],
  },
);

const servicesByKey = computed(
  () => new Map(props.services.map((service) => [service.name, service])),
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
const store = useStore();
const timezone = computed<string | undefined>(() => store.state.timezone || undefined);

/// The endpoint sends the org's rules in the engine's precedence, so a team's tab numbers by the org-wide place.
const ordered = computed(() =>
  props.teamId ? props.rules.filter((rule) => rule.team_id === props.teamId) : props.rules,
);

const columns = computed<OTableColumnDef<OwnershipRuleStats>[]>(() => [
  {
    id: "order",
    header: t("oncall.ruleOrder"),
    size: 70,
    sortable: false,
    accessorFn: (row: OwnershipRuleStats) => props.rules.indexOf(row) + 1,
    meta: { align: "center" },
  },
  {
    id: "match",
    header: t("oncall.ownershipMatch"),
    size: 260,
    minSize: 220,
    // Search matches what the chips read, not the stored `k=v` path.
    accessorFn: (row: OwnershipRuleStats) =>
      conditionsOf(row)
        .map((condition) => `${condition.label} ${condition.value}`)
        .join(" "),
    meta: { isName: true, cellOverflowTooltip: false },
  },
  ...(props.teamId
    ? []
    : [
        {
          id: "team",
          header: t("oncall.ruleRoutesTo"),
          size: 160,
          sortable: true,
          accessorFn: (row: OwnershipRuleStats) => String(teamNameOf(row)),
        } as OTableColumnDef<OwnershipRuleStats>,
      ]),
  {
    id: "specificity",
    header: t("oncall.ruleSpecificity"),
    size: 170,
    sortable: false,
    hideable: true,
    accessorFn: (row: OwnershipRuleStats) =>
      conditionsOf(row)
        .map((condition) => condition.field)
        .join(", "),
  },
  {
    id: "caught",
    header: t("oncall.rulePagesCaughtHeader"),
    size: 150,
    sortable: true,
    hideable: true,
    accessorFn: (row: OwnershipRuleStats) => row.pages_caught,
  },
  {
    id: "last",
    header: t("oncall.ruleLastMatched"),
    size: 140,
    sortable: true,
    hideable: true,
    accessorFn: (row: OwnershipRuleStats) => row.last_matched_at ?? 0,
  },
  {
    id: "health",
    header: t("oncall.ruleHealth"),
    size: 180,
    sortable: false,
    hideable: true,
    // The label, not the enum: search has to match what the cell shows.
    accessorFn: (row: OwnershipRuleStats) => String(healthLabel(row)),
  },
  ...(props.editable
    ? [
        {
          id: "actions",
          header: t("oncall.actions"),
          isAction: true,
          pinned: "right",
          sortable: false,
          size: props.testable ? 110 : 80,
          meta: {
            align: "center",
            cellClass: "actions-column",
            actionCount: props.testable ? 3 : 2,
          },
        } as OTableColumnDef<OwnershipRuleStats>,
      ]
    : []),
]);

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

/// An empty list has no page to turn; the org list keeps its bar while it carries the catch-all note.
const showPager = computed(() => props.loading || ordered.value.length > 0 || !props.teamId);

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
      const field = fieldLabel(name, props.aliases);
      return {
        name,
        field,
        label: prefix ? String(t("oncall.ruleChipStartsWith", { field: raw(field) })) : field,
        value: prefix ? value.slice(0, -1) : value,
        prefix,
      };
    });
}

/// Every condition in one line, for the "+N" chip that stands in for the ones that did not fit.
function conditionsTip(rule: OwnershipRuleStats): I18nText {
  return raw(
    conditionsOf(rule)
      .map((condition) => `${condition.label} = ${conditionValueText(condition)}`)
      .join(" · "),
  );
}

function conditionValueText(condition: RuleCondition): string {
  if (condition.name !== SERVICE_DIMENSION || condition.prefix) return condition.value;
  return serviceOptionParts(condition.value, servicesByKey.value.get(condition.value)).display;
}

function fieldsTip(rule: OwnershipRuleStats): I18nText {
  return raw(
    conditionsOf(rule)
      .map((condition) => condition.field)
      .join(" · "),
  );
}

/// A shadowed rule names the team taking its pages, because "shadowed" alone does not say who to talk to.
function healthLabel(rule: OwnershipRuleStats): I18nText {
  if (rule.health === "shadowed") {
    const other = rule.shadowed_by[0];
    const who = other?.team_name || other?.path;
    return who ? t("oncall.ruleAlsoClaimedBy", { team: raw(who) }) : t("oncall.ruleShadowed");
  }
  return rule.health === "never_used" ? t("oncall.ruleNeverMatchedYet") : t("oncall.ruleActive");
}

function onEmptyAction(id?: string) {
  if (id === "clear-filters") {
    emit("clear-search");
    return;
  }
  // A reader who cannot write routing gets no editor that would only answer 403.
  if (props.editable) emit("add");
}
</script>
