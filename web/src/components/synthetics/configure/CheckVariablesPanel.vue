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
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { BrowserCheck, BrowserStep } from "@/types/synthetics";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { getUUID } from "@/utils/uuid";

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
          variables.length
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
    </div>

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
      <ul v-if="variables.length" class="m-0 flex list-none flex-col gap-2 p-0">
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

          <!-- Display mode -->
          <div
            v-else
            class="rounded-default border-border-default flex flex-col gap-1 border px-3 py-2.5"
          >
            <div class="flex min-w-0 items-center gap-1.5">
              <OTooltip
                v-if="variable.secure"
                :content="t('synthetics.variablesPanel.secretTooltip')"
                side="top"
              >
                <OIcon name="lock" size="xs" class="text-text-muted shrink-0 cursor-help" />
              </OTooltip>
              <span class="text-text-heading min-w-0 truncate font-mono text-sm font-semibold">
                {{ variable.name }}
                <!-- Full name on hover — the row truncates long names -->
                <OTooltip :content="raw(variable.name)" side="top" />
              </span>
              <OBadge
                :variant="usageCounts[index] ? 'primary-soft' : 'default-soft'"
                size="sm"
                class="ml-1"
                :data-test="`synthetics-check-variables-panel-usage-${index}-badge`"
              >
                {{ usageCounts[index] }}
                <OTooltip :content="usageText(usageCounts[index] ?? 0)" side="top" />
              </OBadge>
              <span class="flex-1" aria-hidden="true" />
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
                :aria-label="t('synthetics.variablesPanel.removeVariable', { name: variable.name })"
                :data-test="`synthetics-check-variables-panel-remove-${index}-btn`"
                @click="pendingRemoveIndex = index"
              >
                <OTooltip :content="t('common.remove')" side="top" />
              </OButton>
            </div>
            <span
              class="text-text-secondary truncate font-mono text-xs"
              :data-test="`synthetics-check-variables-panel-value-${index}`"
            >
              {{
                variable.secure ? t("synthetics.authNetwork.passwordPlaceholder") : variable.value
              }}
              <!-- Full value on hover — the row truncates. Never for secrets. -->
              <OTooltip
                v-if="!variable.secure && variable.value"
                :content="raw(variable.value)"
                side="top"
              />
            </span>
            <span v-if="usageCounts[index]" class="text-text-muted flex items-center gap-1 text-xs">
              <OIcon name="stacked-line-chart" size="xs" aria-hidden="true" />
              {{ usageText(usageCounts[index] ?? 0) }}
            </span>
          </div>
        </li>
      </ul>

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
    </ODialog>
  </aside>
</template>
