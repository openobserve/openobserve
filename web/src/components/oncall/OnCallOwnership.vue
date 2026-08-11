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

<template>
  <div class="flex flex-col gap-4" data-test="oncall-ownership">
    <OCard>
      <OCardSection>
        <h2 class="text-text-heading mb-1 text-lg">{{ t("oncall.ownership") }}</h2>
        <p class="text-text-secondary mb-4 text-sm">{{ t("oncall.ownershipHint") }}</p>

        <OTable
          :data="rules"
          :columns="ruleColumns"
          row-key="id"
          :frame="false"
          pagination="client"
          :show-global-filter="false"
          table-id="oncall-ownership-rules"
          class="mb-4"
          data-test="oncall-ownership-table"
        >
          <template #empty>
            <OEmptyState
              size="compact"
              preset="no-data"
              :description="t('oncall.noOwnershipRules')"
              data-test="oncall-ownership-empty"
            />
          </template>
        </OTable>

        <!-- Pairs are built one at a time rather than typed as JSON: the
             vocabulary is a fixed set of alias ids, and free-text JSON is how
             a rule ends up with a dimension name nothing ever emits. -->
        <div class="border-border-default flex flex-col gap-3 rounded-surface border p-4">
          <span class="text-text-label text-xs">{{ t("oncall.addOwnershipRule") }}</span>

          <div v-if="draftPairs.length" class="flex flex-wrap gap-2">
            <div
              v-for="(pair, index) in draftPairs"
              :key="index"
              class="border-border-default flex items-center gap-1 rounded-default border px-2 py-1"
            >
              <code class="text-text-body text-compact">
                {{ raw(`${pair.name}=${pair.value}`) }}
              </code>
              <OButton
                variant="ghost"
                size="icon-xs"
                icon-left="close"
                :aria-label="t('oncall.removeDimension')"
                @click="draftPairs.splice(index, 1)"
              />
            </div>
          </div>

          <div class="flex flex-wrap items-end gap-2">
            <div class="w-56">
              <!-- A closed vocabulary, so a typo cannot save a rule that
                   silently matches nothing forever. -->
              <OSelect
                v-model="draftName"
                :options="dimensionOptions"
                :label="t('oncall.dimensionName')"
                :placeholder="t('oncall.dimensionNamePlaceholder')"
                searchable
                data-test="oncall-ownership-dimension-name"
              />
            </div>
            <div class="w-56">
              <OInput
                v-model="draftValue"
                :label="t('oncall.dimensionValue')"
                :placeholder="t('oncall.dimensionValuePlaceholder')"
                data-test="oncall-ownership-dimension-value"
              />
            </div>
            <OButton
              variant="outline"
              size="sm-action"
              :disabled="!canAddPair"
              data-test="oncall-ownership-add-dimension"
              @click="addPair"
            >
              {{ t("oncall.add") }}
            </OButton>
          </div>

          <!-- Values are lowercased on the server to match what the extractor
               pulls off a record. Showing the normalised form here means the
               rule a user reads back is the rule that will match. -->
          <p v-if="draftPairs.length" class="text-text-muted text-xs">
            {{ t("oncall.ownershipPreviewPath") }}
            <code class="text-text-body">{{ raw(draftPath) }}</code>
          </p>

          <div class="flex justify-end">
            <OButton
              variant="primary"
              size="sm-action"
              :disabled="!draftPairs.length"
              :loading="saving"
              data-test="oncall-ownership-save"
              @click="createRule"
            >
              {{ t("oncall.saveRule") }}
            </OButton>
          </div>
        </div>
      </OCardSection>
    </OCard>

    <OCard>
      <OCardSection>
        <h2 class="text-text-heading mb-1 text-lg">{{ t("oncall.routingTester") }}</h2>
        <p class="text-text-secondary mb-4 text-sm">{{ t("oncall.routingTesterHint") }}</p>

        <div v-if="testPairs.length" class="mb-3 flex flex-wrap gap-2">
          <div
            v-for="(pair, index) in testPairs"
            :key="index"
            class="border-border-default flex items-center gap-1 rounded-default border px-2 py-1"
          >
            <code class="text-text-body text-compact">
              {{ raw(`${pair.name}=${pair.value}`) }}
            </code>
            <OButton
              variant="ghost"
              size="icon-xs"
              icon-left="close"
              :aria-label="t('oncall.removeDimension')"
              @click="testPairs.splice(index, 1)"
            />
          </div>
        </div>

        <div class="flex flex-wrap items-end gap-2">
          <div class="w-56">
            <OInput
              v-model="testName"
              :label="t('oncall.dimensionName')"
              data-test="oncall-routing-test-name"
            />
          </div>
          <div class="w-56">
            <OInput
              v-model="testValue"
              :label="t('oncall.dimensionValue')"
              data-test="oncall-routing-test-value"
            />
          </div>
          <OButton
            variant="outline"
            size="sm-action"
            :disabled="!testName.trim() || !testValue.trim()"
            data-test="oncall-routing-test-add"
            @click="addTestPair"
          >
            {{ t("oncall.add") }}
          </OButton>
          <OButton
            variant="primary"
            size="sm-action"
            :disabled="!testPairs.length"
            :loading="testing"
            data-test="oncall-routing-test-run"
            @click="runPreview"
          >
            {{ t("oncall.testRouting") }}
          </OButton>
        </div>

        <div
          v-if="preview"
          class="border-border-default mt-3 flex flex-col gap-1 rounded-default border p-3"
          data-test="oncall-routing-test-result"
        >
          <div class="flex flex-wrap items-center gap-2">
            <OTag :variant="preview.team_id ? 'success-soft' : 'amber-soft'" size="sm">
              {{
                preview.team_id
                  ? teamNameOf(preview.team_id)
                  : t("oncall.wouldPageNobody")
              }}
            </OTag>
            <span
              v-if="preview.team_id === teamId"
              class="text-text-muted text-xs"
            >
              {{ t("oncall.thisTeam") }}
            </span>
          </div>
          <p class="text-text-secondary text-sm">{{ raw(preview.reason) }}</p>
        </div>
      </OCardSection>
    </OCard>

    <ConfirmDialog
      :model-value="!!ruleToDelete"
      :title="t('oncall.removeRuleTitle')"
      :message="t('oncall.removeRuleMessage')"
      @update:ok="deleteRule"
      @update:cancel="ruleToDelete = null"
      @update:model-value="(v: boolean) => { if (!v) ruleToDelete = null; }"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, ref } from "vue";
import { useStore } from "vuex";

import ConfirmDialog from "@/components/ConfirmDialog.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ODimensionChip from "@/lib/core/Badge/ODimensionChip.vue";
import alertsService from "@/services/alerts";
import oncallService from "@/services/oncall";
import type { OnCallTeam, OwnershipRule, RoutingPreview } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";
import { normalizeDimensionValue, ownershipPath } from "@/utils/oncall";

const props = defineProps<{ teamId: string; teams: OnCallTeam[] }>();

const { t } = useI18nTyped();
const store = useStore();

const rules = ref<OwnershipRule[]>([]);
const draftPairs = ref<{ name: string; value: string }[]>([]);
const draftName = ref("");
const draftValue = ref("");
const saving = ref(false);
const ruleToDelete = ref<OwnershipRule | null>(null);

const testPairs = ref<{ name: string; value: string }[]>([]);
const testName = ref("");
const testValue = ref("");
const testing = ref(false);
const preview = ref<RoutingPreview | null>(null);

const orgId = computed(() => store.state.selectedOrganization.identifier);

const aliases = ref<{ id: string; display: string; group?: string }[]>([]);

/// The org's own field vocabulary — the same one alert correlation uses — so
/// a rule can only be written against a dimension something actually emits.
const dimensionOptions = computed(() =>
  aliases.value.map((a) => ({ label: raw(a.display || a.id), value: a.id })),
);

const ruleColumns = computed<OTableColumnDef<OwnershipRule>[]>(() => [
  {
    id: "match",
    header: t("oncall.ownershipMatch"),
    accessorFn: (row: OwnershipRule) => pathOf(row),
    meta: { isName: true },
    cell: (ctx: any) => {
      const rule = ctx.row.original as OwnershipRule;
      return h(
        "span",
        { class: "flex flex-wrap items-center gap-1" },
        Object.entries(rule.dimensions ?? {}).map(([name, value]) =>
          h(ODimensionChip, { key: name, name, value: String(value), size: "sm" }),
        ),
      );
    },
  },
  {
    // Specificity IS precedence: the longest prefix wins, so this column is
    // the order in which these rules are actually consulted.
    id: "dims",
    header: t("oncall.ownershipSpecificity"),
    size: 120,
    accessorFn: (row: OwnershipRule) => dimensionCount(row),
    sortable: true,
  },
  {
    id: "actions",
    header: t("oncall.actions"),
    isAction: true,
    sortable: false,
    size: 80,
    meta: { align: "center", cellClass: "actions-column", actionCount: 1 },
    cell: (ctx: any) =>
      h(OButton, {
        variant: "ghost",
        size: "icon-sm",
        iconLeft: "delete-outline",
        "aria-label": t("oncall.removeRule"),
        "data-test": `oncall-ownership-delete-${ctx.row.original.id}`,
        onClick: (e: MouseEvent) => {
          e?.stopPropagation();
          ruleToDelete.value = ctx.row.original;
        },
      }),
  },
]);

// The picker degrades to free entry rather than blocking rule creation if the
// vocabulary cannot be read.
async function fetchAliases() {
  try {
    const res = await alertsService.getSemanticGroups(orgId.value);
    aliases.value = res.data ?? [];
  } catch {
    aliases.value = [];
  }
}

const canAddPair = computed(
  () =>
    !!draftName.value.trim() &&
    !!draftValue.value.trim() &&
    !draftPairs.value.some((p) => p.name === draftName.value.trim()),
);

const draftPath = computed(() =>
  ownershipPath(Object.fromEntries(draftPairs.value.map((p) => [p.name, p.value]))),
);

function pathOf(rule: OwnershipRule): string {
  return ownershipPath(rule.dimensions);
}

function dimensionCount(rule: OwnershipRule): number {
  return Object.keys(rule.dimensions ?? {}).length;
}

function teamNameOf(teamId: string): string {
  return props.teams.find((team) => team.id === teamId)?.name ?? teamId;
}

// Normalised on the way in so the chip a user reads back is the rule that will
// actually match — the server lowercases these anyway.
function addPair() {
  if (!canAddPair.value) return;
  draftPairs.value.push({
    name: draftName.value.trim(),
    value: normalizeDimensionValue(draftValue.value),
  });
  draftName.value = "";
  draftValue.value = "";
}

function addTestPair() {
  const name = testName.value.trim();
  if (!name || !testValue.value.trim()) return;
  testPairs.value = testPairs.value.filter((p) => p.name !== name);
  testPairs.value.push({ name, value: normalizeDimensionValue(testValue.value) });
  testName.value = "";
  testValue.value = "";
}

async function fetchRules() {
  try {
    const res = await oncallService.listOwnershipRules({
      org_identifier: orgId.value,
      team_id: props.teamId,
    });
    rules.value = res.data ?? [];
  } catch (err: any) {
    toast({
      variant: "error",
      message: raw(err?.response?.data?.message) || t("oncall.loadRulesFailed"),
    });
  }
}

async function createRule() {
  saving.value = true;
  try {
    await oncallService.createOwnershipRule({
      org_identifier: orgId.value,
      data: {
        team_id: props.teamId,
        dimensions: Object.fromEntries(draftPairs.value.map((p) => [p.name, p.value])),
      },
    });
    draftPairs.value = [];
    toast({ variant: "success", message: t("oncall.ruleCreated") });
    await fetchRules();
  } catch (err: any) {
    toast({
      variant: "error",
      message: raw(err?.response?.data?.message) || t("oncall.saveRuleFailed"),
    });
  } finally {
    saving.value = false;
  }
}

async function deleteRule() {
  const rule = ruleToDelete.value;
  ruleToDelete.value = null;
  if (!rule) return;
  try {
    await oncallService.deleteOwnershipRule({
      org_identifier: orgId.value,
      rule_id: rule.id,
    });
    await fetchRules();
  } catch (err: any) {
    toast({
      variant: "error",
      message: raw(err?.response?.data?.message) || t("oncall.deleteRuleFailed"),
    });
  }
}

async function runPreview() {
  testing.value = true;
  try {
    const res = await oncallService.previewRouting({
      org_identifier: orgId.value,
      data: {
        dimensions: Object.fromEntries(testPairs.value.map((p) => [p.name, p.value])),
      },
    });
    preview.value = res.data;
  } catch (err: any) {
    toast({
      variant: "error",
      message: raw(err?.response?.data?.message) || t("oncall.testRoutingFailed"),
    });
  } finally {
    testing.value = false;
  }
}

onMounted(() => {
  fetchRules();
  fetchAliases();
});
</script>
