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

        <div v-if="rules.length" class="mb-4 flex flex-col gap-2">
          <div
            v-for="rule in rules"
            :key="rule.id"
            class="border-border-default flex flex-wrap items-center gap-2 rounded-default border px-3 py-2"
            data-test="oncall-ownership-rule"
          >
            <OIcon name="account-tree" size="sm" class="text-text-muted" />
            <code class="text-text-body text-compact">{{ raw(pathOf(rule)) }}</code>
            <span class="text-text-muted text-xs">
              {{ t("oncall.ownershipDimensionCount", { count: dimensionCount(rule) }) }}
            </span>
            <div class="flex-1" />
            <OButton
              variant="ghost"
              size="icon-xs"
              icon-left="delete"
              :aria-label="t('oncall.removeRule')"
              data-test="oncall-ownership-delete-btn"
              @click="ruleToDelete = rule"
            />
          </div>
        </div>
        <p v-else class="text-text-secondary mb-4 text-sm">{{ t("oncall.noOwnershipRules") }}</p>

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
              <OInput
                v-model="draftName"
                :label="t('oncall.dimensionName')"
                :placeholder="t('oncall.dimensionNamePlaceholder')"
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
import { computed, onMounted, ref } from "vue";
import { useStore } from "vuex";

import ConfirmDialog from "@/components/ConfirmDialog.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OInput from "@/lib/forms/Input/OInput.vue";
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

onMounted(fetchRules);
</script>
