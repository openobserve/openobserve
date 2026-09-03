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

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { BrowserCheck, BrowserStep } from "@/types/synthetics";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { getUUID } from "@/utils/uuid";
import syntheticsService from "@/services/synthetics";
import SyntheticsInheritedVariables from "@/components/synthetics/variables/SyntheticsInheritedVariables.vue";
import {
  RESOLVED_VARIABLE_CAP,
  coverageGaps,
  effectiveVariables,
  type ResolvedVariablesGrouped,
} from "@/components/synthetics/variables/resolved";

type CheckVariable = NonNullable<BrowserCheck["variables"]>[number];

const props = defineProps<{ check: BrowserCheck }>();
const emit = defineEmits<{ "update:check": [value: BrowserCheck] }>();

const { t } = useI18nTyped();

const variables = computed(() => props.check.variables ?? []);

// ── Usage — exact {{name}} token match over each step's value and locators ──

function stepUsesToken(step: BrowserStep, token: string): boolean {
  if (step.value?.includes(token) || step.selector?.includes(token)) return true;
  return (step.locator?.candidates ?? []).some(
    (c) => c.value.includes(token) || (c.from ?? []).some((p) => p.value.includes(token)),
  );
}

function usageCount(name: string): number {
  const trimmed = name.trim();
  if (!trimmed) return 0;
  const token = `{{${trimmed}}}`;
  return props.check.journey.filter((step) => stepUsesToken(step, token)).length;
}

const usageCounts = computed(() => variables.value.map((v) => usageCount(v.name)));

function usageText(count: number): I18nText {
  return count > 0
    ? t("synthetics.variablesPanel.usedInSteps", { count }, count)
    : t("synthetics.variablesPanel.notReferenced");
}

// In script because `{{` in the template collides with Vue's delimiters. Static
// so a long variable name can't turn the syntax example into a value to copy.
const hintToken = "{{VARIABLE_NAME}}";

// ── Resolution — one environment on screen at a time ───────────────────────

const store = useStore();
/** Empty while the check is unsaved — there is nothing to resolve against yet. */
const checkId = computed(() => ((props.check as { id?: string }).id ?? "") as string);
const grouped = ref<ResolvedVariablesGrouped | null>(null);
/** `""` is the unscoped run, matching the server's key for it. */
const selectedEnv = ref("");

async function fetchGrouped() {
  if (!checkId.value) {
    grouped.value = null;
    return;
  }
  try {
    const org = store.state.selectedOrganization.identifier;
    const res = await syntheticsService.resolvedVariablesGrouped(org, checkId.value);
    grouped.value = res.data ?? null;
  } catch {
    // A failure here costs the author a hint, not their work — the panel and
    // the save path both stand on their own, so it stays silent.
    grouped.value = null;
  }
  const environments = grouped.value?.environments ?? [];
  if (!environments.includes(selectedEnv.value)) {
    selectedEnv.value = environments[0] ?? "";
  }
}

watch(checkId, fetchGrouped, { immediate: true });

const currentRows = computed(() => grouped.value?.resolved[selectedEnv.value] ?? []);
const gaps = computed(() => (grouped.value ? coverageGaps(grouped.value) : new Map()));

const envOptions = computed(() => {
  const environments = grouped.value?.environments ?? [];
  if (!environments.some((env) => env !== "")) return [];
  return environments.map((env) => ({
    label: env === "" ? t("synthetics.variablesPanel.noEnvironment") : raw(env),
    value: env,
  }));
});

/** The resolved count for the selected environment; declarations when unsaved. */
const headerCount = computed(() =>
  grouped.value ? effectiveVariables(currentRows.value).length : variables.value.length,
);
const headerCountText = computed<I18nText>(() =>
  headerCount.value >= RESOLVED_VARIABLE_CAP - 10
    ? t("synthetics.variablesPanel.countOfCap", {
        count: headerCount.value,
        cap: RESOLVED_VARIABLE_CAP,
      })
    : raw(String(headerCount.value)),
);

// ── Edit / add — one open form at a time; opening either closes the other ──

const editingIndex = ref<number | null>(null);
const adding = ref(false);
const draft = ref<{ name: string; value: string; secure: boolean }>({
  name: "",
  value: "",
  secure: false,
});
/** The empty-name error only appears after a Save/Add attempt, so a freshly
 *  opened form doesn't start red. */
const attempted = ref(false);

const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const draftNameError = computed<I18nText | undefined>(() => {
  const name = draft.value.name.trim();
  if (!name) {
    return attempted.value ? t("synthetics.variablesPanel.nameRequired") : undefined;
  }
  if (!NAME_PATTERN.test(name)) return t("synthetics.variablesPanel.nameInvalid");
  const duplicate = variables.value.some(
    (v, i) => i !== editingIndex.value && v.name.trim() === name,
  );
  if (duplicate) return t("synthetics.variablesPanel.nameDuplicate");
  return undefined;
});

const isDraftValid = computed(() => {
  const name = draft.value.name.trim();
  return (
    !!name &&
    NAME_PATTERN.test(name) &&
    !variables.value.some((v, i) => i !== editingIndex.value && v.name.trim() === name)
  );
});

/** The add form renders at the end of the list, which can be off-screen. */
const addFormRef = ref<HTMLElement | null>(null);

function openAdd() {
  // Re-opening while the form is already up (its pinned button stays reachable
  // after the form scrolls away) only scrolls back to it — resetting would
  // discard whatever the author has typed.
  if (!adding.value) {
    editingIndex.value = null;
    adding.value = true;
    attempted.value = false;
    draft.value = { name: "", value: "", secure: false };
  }
  nextTick(() => {
    addFormRef.value?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  });
}

function openEdit(index: number) {
  const variable = variables.value[index];
  if (!variable) return;
  adding.value = false;
  editingIndex.value = index;
  attempted.value = false;
  draft.value = { name: variable.name, value: variable.value, secure: !!variable.secure };
}

function closeForm() {
  adding.value = false;
  editingIndex.value = null;
  attempted.value = false;
}

function commitAdd() {
  attempted.value = true;
  if (!isDraftValid.value) return;
  emit("update:check", {
    ...props.check,
    variables: [
      ...variables.value,
      {
        id: getUUID(),
        name: draft.value.name.trim(),
        value: draft.value.value,
        secure: draft.value.secure,
        example: "",
      },
    ],
  });
  closeForm();
}

function commitEdit() {
  attempted.value = true;
  if (editingIndex.value === null || !isDraftValid.value) return;
  const next = variables.value.map((v, i) =>
    i === editingIndex.value
      ? {
          ...v,
          name: draft.value.name.trim(),
          value: draft.value.value,
          secure: draft.value.secure,
        }
      : v,
  );
  emit("update:check", { ...props.check, variables: next });
  closeForm();
}

// ── Delete — confirmed, then a ~6s undo re-inserts in place ────────────────

const UNDO_MS = 6000;
const lastRemoved = ref<{ variable: CheckVariable; index: number } | null>(null);
let undoTimer: ReturnType<typeof setTimeout> | null = null;

/** Index awaiting confirmation, or null when the dialog is closed. */
const pendingRemoveIndex = ref<number | null>(null);
const pendingRemove = computed(() =>
  pendingRemoveIndex.value === null ? null : (variables.value[pendingRemoveIndex.value] ?? null),
);
/** How many steps break if this goes ahead — the reason to hesitate. */
const pendingRemoveUsage = computed(() =>
  pendingRemoveIndex.value === null ? 0 : (usageCounts.value[pendingRemoveIndex.value] ?? 0),
);
const removeDialogOpen = computed({
  get: () => pendingRemoveIndex.value !== null,
  set: (open: boolean) => {
    if (!open) pendingRemoveIndex.value = null;
  },
});

function confirmRemove() {
  const index = pendingRemoveIndex.value;
  pendingRemoveIndex.value = null;
  if (index !== null) removeVariable(index);
}

function removeVariable(index: number) {
  const removed = variables.value[index];
  if (!removed) return;
  if (editingIndex.value === index) closeForm();
  emit("update:check", {
    ...props.check,
    variables: variables.value.filter((_, i) => i !== index),
  });
  lastRemoved.value = { variable: removed, index };
  if (undoTimer) clearTimeout(undoTimer);
  undoTimer = setTimeout(() => (lastRemoved.value = null), UNDO_MS);
}

function undoRemove() {
  if (!lastRemoved.value) return;
  const { variable, index } = lastRemoved.value;
  const next = [...variables.value];
  next.splice(Math.min(index, next.length), 0, variable);
  emit("update:check", { ...props.check, variables: next });
  lastRemoved.value = null;
  if (undoTimer) clearTimeout(undoTimer);
}

/** The scope whose value takes over if this override is removed. */
const pendingRemoveFallbackScope = computed(
  () =>
    currentRows.value.find((r) => r.name === pendingRemove.value?.name && r.scope !== "check")
      ?.scope ?? "",
);

onBeforeUnmount(() => {
  if (undoTimer) clearTimeout(undoTimer);
});
</script>

<template>
  <aside
    class="border-border-default bg-surface-base flex h-full min-h-0 flex-col border-l px-0.5 pt-4 pb-1"
    data-test="synthetics-check-variables-panel"
  >
    <!-- Header — pinned; h-8.5 matches the Journey toolbar row so the two
         headers sit on the same baseline across the splitter -->
    <div class="border-border-default shrink-0 border-b px-3">
      <div class="mb-3 flex h-8.5 items-center gap-2">
        <OIcon name="data-object" size="sm" class="text-text-secondary" aria-hidden="true" />
        <h3 class="text-text-heading m-0 text-base font-semibold">
          {{ t("synthetics.variablesPanel.title") }}
        </h3>
        <OBadge variant="default" size="sm" data-test="synthetics-check-variables-panel-count">{{
          headerCountText
        }}</OBadge>
        <OTooltip
          :content="t('synthetics.variablesPanel.referenceHint', { token: hintToken })"
          side="bottom"
        >
          <OIcon
            name="info"
            size="sm"
            class="text-text-secondary ml-1 cursor-help"
            data-test="synthetics-check-variables-panel-hint-icon"
          />
        </OTooltip>
      </div>

      <!-- One environment on screen at a time: every row, value and warning
           below describes the run this selects, never a union across runs. -->
      <div v-if="envOptions.length" class="mb-3">
        <OSelect
          :model-value="selectedEnv"
          :options="envOptions"
          :label="t('synthetics.variablesPanel.resolveAs')"
          size="sm"
          data-test="synthetics-check-variables-panel-resolve-as"
          @update:model-value="selectedEnv = String($event)"
        />
      </div>
    </div>

    <!-- Below the switch that selects what it shows; above the check's own
         cards, because the steps reference names from every scope. -->
    <!-- Scroll region -->
    <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3">
      <!-- Undo row -->
      <div
        v-if="lastRemoved"
        class="rounded-default bg-surface-subtle flex items-center gap-2 px-3 py-1.5"
        role="status"
        data-test="synthetics-check-variables-panel-undo-row"
      >
        <span class="text-text-secondary min-w-0 flex-1 truncate text-xs">{{
          t("synthetics.variablesPanel.removed", { name: lastRemoved.variable.name })
        }}</span>
        <OButton
          variant="ghost-primary"
          size="xs"
          data-test="synthetics-check-variables-panel-undo-btn"
          @click="undoRemove"
        >
          {{ t("synthetics.variablesPanel.undo") }}
        </OButton>
      </div>

      <!-- Empty state — its action is the only Add affordance while the list
           is empty (the standalone button below only renders alongside cards) -->
      <OEmptyState
        v-if="variables.length === 0 && !adding"
        size="block"
        illustration="function"
        :title="t('synthetics.variablesPanel.emptyTitle')"
        :description="t('synthetics.variablesPanel.emptyBody')"
        :action-label="t('synthetics.authNetwork.addVariable')"
        action-icon="add"
        data-test="synthetics-check-variables-panel-empty"
        @action="openAdd"
      />

      <!-- Variable cards -->
      <section v-if="variables.length" class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <h4 class="text-text-heading m-0 text-sm font-semibold">
            {{ t("synthetics.variablesPanel.thisCheck") }}
          </h4>
          <OBadge variant="default" size="sm">{{ variables.length }}</OBadge>
        </div>

        <ul class="m-0 flex list-none flex-col gap-1 p-0">
          <li
            v-for="(variable, index) in variables"
            :key="variable.id ?? index"
            :data-test="`synthetics-check-variables-panel-card-${index}`"
          >
            <!-- Edit mode — swaps the card in place, visually highlighted -->
            <div
              v-if="editingIndex === index"
              class="rounded-default border-accent flex flex-col gap-3 border px-3 py-2.5"
              :data-test="`synthetics-check-variables-panel-edit-form-${index}`"
            >
              <OInput
                v-model="draft.name"
                :placeholder="t('synthetics.variablesPanel.namePlaceholder')"
                :error="!!draftNameError"
                :error-message="draftNameError"
                :data-test="`synthetics-check-variables-panel-edit-name-${index}-input`"
              />
              <OInput
                v-model="draft.value"
                :type="draft.secure ? 'password' : 'text'"
                :placeholder="t('synthetics.authNetwork.variableValuePlaceholder')"
                :data-test="`synthetics-check-variables-panel-edit-value-${index}-input`"
              />
              <div class="flex items-center gap-2">
                <OButton
                  size="sm"
                  variant="outline"
                  class="gap-1.5"
                  :data-test="`synthetics-check-variables-panel-edit-secure-${index}-switch`"
                  @click="draft.secure = !draft.secure"
                >
                  <OSwitch :model-value="draft.secure" size="md" />
                  <OIcon name="lock" size="sm" />
                  <OTooltip
                    :content="
                      draft.secure
                        ? t('synthetics.authNetwork.variableSecureTooltipShow')
                        : t('synthetics.authNetwork.variableSecureTooltipHide')
                    "
                    side="top"
                  />
                </OButton>
                <span class="flex-1" aria-hidden="true" />
                <OButton
                  variant="outline"
                  size="sm-action"
                  :data-test="`synthetics-check-variables-panel-edit-cancel-${index}-btn`"
                  @click="closeForm"
                >
                  {{ t("common.cancel") }}
                </OButton>
                <OButton
                  variant="primary"
                  size="sm-action"
                  :data-test="`synthetics-check-variables-panel-edit-save-${index}-btn`"
                  @click="commitEdit"
                >
                  {{ t("common.save") }}
                </OButton>
              </div>
            </div>

            <!-- Display mode — one row, same shape as the inherited rows -->
            <div v-else class="flex min-w-0 items-center gap-2 text-sm">
              <span class="min-w-0 truncate font-mono">
                {{ variable.name }}
                <!-- Full name on hover — the row truncates long names -->
                <OTooltip :content="raw(variable.name)" side="top" />
              </span>
              <OTooltip
                v-if="variable.secure"
                :content="t('synthetics.variablesPanel.secretTooltip')"
                side="top"
              >
                <OIcon name="lock" size="xs" class="text-text-secondary shrink-0 cursor-help" />
              </OTooltip>
              <OBadge
                :variant="usageCounts[index] ? 'primary-soft' : 'default-soft'"
                size="sm"
                :data-test="`synthetics-check-variables-panel-usage-${index}-badge`"
              >
                {{ usageCounts[index] }}
                <OTooltip :content="usageText(usageCounts[index] ?? 0)" side="top" />
              </OBadge>
              <div class="ml-auto flex items-center gap-1">
                <OButton
                  icon-only
                  icon-left="edit"
                  variant="ghost"
                  size="icon"
                  :aria-label="t('synthetics.variablesPanel.editVariable', { name: variable.name })"
                  :data-test="`synthetics-check-variables-panel-edit-${index}-btn`"
                  @click="openEdit(index)"
                >
                  <OTooltip :content="t('common.edit')" side="top" />
                </OButton>
                <OButton
                  icon-only
                  icon-left="delete"
                  variant="ghost"
                  size="icon"
                  :aria-label="
                    t('synthetics.variablesPanel.removeVariable', { name: variable.name })
                  "
                  :data-test="`synthetics-check-variables-panel-remove-${index}-btn`"
                  @click="pendingRemoveIndex = index"
                >
                  <OTooltip :content="t('common.remove')" side="top" />
                </OButton>
              </div>
            </div>
          </li>
        </ul>
      </section>

      <!-- Add form — at the end of the list, scrolled into view on open -->
      <div
        v-if="adding"
        ref="addFormRef"
        class="rounded-default border-border-default bg-surface-subtle flex flex-col gap-3 border px-3 py-2.5"
        data-test="synthetics-check-variables-panel-add-form"
      >
        <h4 class="text-text-heading m-0 text-sm font-semibold">
          {{ t("synthetics.variablesPanel.newVariable") }}
        </h4>
        <OInput
          v-model="draft.name"
          :placeholder="t('synthetics.variablesPanel.namePlaceholder')"
          :error="!!draftNameError"
          :error-message="draftNameError"
          data-test="synthetics-check-variables-panel-add-name-input"
        />
        <OInput
          v-model="draft.value"
          :type="draft.secure ? 'password' : 'text'"
          :placeholder="t('synthetics.authNetwork.variableValuePlaceholder')"
          data-test="synthetics-check-variables-panel-add-value-input"
        />
        <div class="flex items-center gap-2">
          <OButton
            size="sm"
            variant="outline"
            class="gap-1.5"
            data-test="synthetics-check-variables-panel-add-secure-switch"
            @click="draft.secure = !draft.secure"
          >
            <OSwitch :model-value="draft.secure" size="md" />
            <OIcon name="lock" size="sm" />
            <OTooltip
              :content="
                draft.secure
                  ? t('synthetics.authNetwork.variableSecureTooltipShow')
                  : t('synthetics.authNetwork.variableSecureTooltipHide')
              "
              side="top"
            />
          </OButton>
          <span class="flex-1" aria-hidden="true" />
          <OButton
            variant="outline"
            size="sm-action"
            data-test="synthetics-check-variables-panel-add-cancel-btn"
            @click="closeForm"
          >
            {{ t("common.cancel") }}
          </OButton>
          <OButton
            variant="primary"
            size="sm-action"
            data-test="synthetics-check-variables-panel-add-btn"
            @click="commitAdd"
          >
            {{ t("common.add") }}
          </OButton>
        </div>
      </div>

      <SyntheticsInheritedVariables :rows="currentRows" :gaps="gaps" />
    </div>

    <!-- Add — pinned below the scroll region so the affordance never scrolls
         away with a long variable list. Hidden while the list is empty: the
         empty state's CTA is the sole Add affordance there. -->
    <div v-if="variables.length" class="border-border-default shrink-0 border-t px-4 pt-3">
      <OButton
        variant="outline"
        size="sm"
        icon-left="add"
        class="w-full"
        data-test="synthetics-check-variables-panel-add-variable-btn"
        @click="openAdd"
      >
        {{ t("synthetics.authNetwork.addVariable") }}
      </OButton>
    </div>

    <!-- Remove confirmation — names the steps that break, which is the whole
         reason to hesitate. Undo still backs it up afterwards. -->
    <ODialog
      v-model:open="removeDialogOpen"
      size="sm"
      :title="t('synthetics.variablesPanel.removeTitle')"
      :primary-button-label="t('common.ok')"
      :secondary-button-label="t('common.cancel')"
      data-test="synthetics-check-variables-panel-remove-dialog"
      @click:primary="confirmRemove"
      @click:secondary="pendingRemoveIndex = null"
    >
      <p class="py-2">
        {{ t("synthetics.variablesPanel.removeBody", { name: pendingRemove?.name ?? "" }) }}
        <template v-if="pendingRemoveUsage">
          {{
            t(
              "synthetics.variablesPanel.removeWarning",
              { count: pendingRemoveUsage },
              pendingRemoveUsage,
            )
          }}
        </template>
      </p>
      <!-- Removing an override is a silent value change, not a breakage —
           steps keep referencing the name and start resolving the fallback. -->
      <p v-if="pendingRemoveFallbackScope" class="pb-2">
        {{
          t("synthetics.variablesPanel.removeOverrideNote", {
            name: pendingRemove?.name ?? "",
            scope: pendingRemoveFallbackScope,
          })
        }}
      </p>
    </ODialog>
  </aside>
</template>
