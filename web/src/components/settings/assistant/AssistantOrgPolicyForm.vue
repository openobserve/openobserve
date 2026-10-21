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
  <div class="flex flex-col gap-4" data-test="settings-assistant-policy">
    <div
      v-if="state === 'loading'"
      class="flex flex-col gap-5"
      data-test="settings-assistant-policy-loading"
    >
      <OSkeleton v-for="n in 4" :key="n" type="rect" class="h-8 w-full max-w-120" />
    </div>
    <OEmptyState
      v-else-if="state === 'forbidden'"
      preset="no-access"
      size="block"
      hide-action
      :title="t('assistant.settings.forbidden')"
      data-test="settings-assistant-policy-forbidden"
    />
    <OEmptyState
      v-else-if="state === 'error'"
      preset="load-error"
      size="block"
      data-test="settings-assistant-policy-error"
      @action="refresh"
    />
    <template v-else>
      <div
        v-if="!supported"
        class="flex flex-col gap-3"
        data-test="settings-assistant-access-notice"
      >
        <OBanner variant="info" :content="t('assistant.settings.access.notice')" />
        <AssistantEnvValue
          :label="t('assistant.settings.status.agentEnabled')"
          :value="raw(String(page.aiEnabled.value))"
          env-name="O2_AI_ENABLED"
        />
        <AssistantEnvValue
          :label="t('assistant.settings.access.publicSharing')"
          :value="raw(String(page.publicLinksAllowed.value))"
          env-name="ZO_PUBLIC_AI_CHAT_ENABLED"
        />
      </div>
      <OForm :form="form" class="flex flex-col gap-5" data-test="settings-assistant-policy-form">
        <div class="flex flex-col gap-1">
          <div class="flex items-center gap-2">
            <OFormSwitch
              name="enabled"
              :label="t('assistant.settings.access.enabled')"
              :disabled="readOnly"
              :aria-describedby="ids.enabled"
              data-test="settings-assistant-enabled-switch"
            />
            <!-- The switch already exposes its state; the word is for sighted readers of a disabled control. -->
            <span
              v-if="readOnly"
              aria-hidden="true"
              class="text-text-secondary shrink-0 text-xs"
              data-test="settings-assistant-enabled-value"
              >{{ onOff(formValues.enabled) }}</span
            >
          </div>
          <p :id="ids.enabled" class="text-text-secondary text-xs">
            {{ t("assistant.settings.access.enabledLine", name) }}
          </p>
        </div>
        <div class="flex flex-col gap-1">
          <OFormToggleGroup
            name="permission_tier"
            :label="t('assistant.settings.access.tier')"
            label-position="top"
            mobile-dropdown
            :disabled="readOnly"
            :aria-describedby="ids.tier"
            data-test="settings-assistant-tier-group"
          >
            <OToggleGroupItem
              v-for="tier in TIERS"
              :key="tier.value"
              :value="tier.value"
              size="sm"
              :class="TOUCH_TARGET_CLASS"
              :disabled="tierLocked(tier.value)"
              :tooltip="
                tierLocked(tier.value) ? t('assistant.settings.access.tierNeedsAgent') : undefined
              "
              :data-test="`settings-assistant-tier-${tier.value}`"
              >{{ t(tier.labelKey) }}</OToggleGroupItem
            >
          </OFormToggleGroup>
          <p :id="ids.tier" class="text-text-secondary text-xs">{{ tierLine }}</p>
          <p
            v-if="tierLimited"
            class="text-text-secondary text-xs"
            data-test="settings-assistant-tier-needs-agent"
          >
            {{ t("assistant.settings.access.tierNeedsAgent") }}
          </p>
          <p
            v-if="storedTierLabel"
            class="text-text-secondary text-xs"
            data-test="settings-assistant-tier-stored"
          >
            {{ t("assistant.settings.access.tierStored", { tier: storedTierLabel }) }}
          </p>
        </div>
        <fieldset class="flex flex-col gap-3">
          <legend class="text-text-heading mb-1 text-sm font-semibold">
            {{ t("assistant.settings.access.sharing") }}
          </legend>
          <div class="flex items-center gap-2">
            <OFormSwitch
              name="org_sharing"
              :label="t('assistant.settings.access.orgSharing')"
              :disabled="readOnly"
              data-test="settings-assistant-org-sharing-switch"
            />
            <span
              v-if="readOnly"
              aria-hidden="true"
              class="text-text-secondary shrink-0 text-xs"
              data-test="settings-assistant-org-sharing-value"
              >{{ onOff(formValues.org_sharing) }}</span
            >
          </div>
          <div class="flex flex-col gap-1">
            <div class="flex items-center gap-2">
              <OFormSwitch
                v-if="page.publicLinksAllowed.value"
                name="public_sharing"
                :label="t('assistant.settings.access.publicSharing')"
                :disabled="readOnly"
                :aria-describedby="ids.public"
                data-test="settings-assistant-public-sharing-switch"
              />
              <OSwitch
                v-else
                :model-value="false"
                :label="t('assistant.settings.access.publicSharing')"
                disabled
                :aria-describedby="ids.public"
                data-test="settings-assistant-public-sharing-switch"
              />
              <span
                v-if="readOnly || !page.publicLinksAllowed.value"
                aria-hidden="true"
                class="text-text-secondary shrink-0 text-xs"
                data-test="settings-assistant-public-value"
                >{{ onOff(page.publicLinksAllowed.value && formValues.public_sharing) }}</span
              >
            </div>
            <p :id="ids.public" class="text-text-secondary text-xs">
              {{
                page.publicLinksAllowed.value
                  ? t("assistant.settings.access.publicSharingLine")
                  : t("assistant.settings.access.publicSharingDeploymentOff")
              }}
            </p>
          </div>
        </fieldset>
        <AssistantWhoCanUse />
        <div
          v-if="!readOnly"
          class="bg-surface-base flex justify-end gap-2 max-md:sticky max-md:bottom-0 max-md:py-2"
        >
          <OButton
            variant="outline"
            size="sm-action"
            type="button"
            :class="TOUCH_TARGET_CLASS"
            :disabled="!dirty || submitting"
            data-test="settings-assistant-policy-cancel"
            @click="cancel"
            >{{ t("assistant.settings.access.cancel") }}</OButton
          >
          <OButton
            ref="saveButton"
            variant="primary"
            size="sm-action"
            type="submit"
            :class="TOUCH_TARGET_CLASS"
            :loading="submitting"
            :disabled="!dirty || submitting"
            focusable-unavailable
            data-test="settings-assistant-policy-save"
            >{{ t("assistant.settings.access.save") }}</OButton
          >
        </div>
      </OForm>
    </template>
  </div>
</template>

<script setup lang="ts">
import { useMutation, useQuery } from "@tanstack/vue-query";
import { computed, ref, useId, watch } from "vue";

import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import { useAssistantName } from "@/composables/assistant";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OFormToggleGroup from "@/lib/core/ToggleGroup/OFormToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import { capabilitiesQuery } from "@/services/assistant.queries";
import type { PermissionTier } from "@/services/assistant_settings";
import {
  assistantSettingsQuery,
  updateAssistantSettingsMutation,
} from "@/services/assistant_settings.queries";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";

import {
  assistantOrgPolicySchema,
  policyUpdate,
  policyValues,
  type AssistantOrgPolicyValues,
  type PolicyLocks,
} from "./AssistantOrgPolicy.schema";
import AssistantEnvValue from "./AssistantEnvValue.vue";
import AssistantWhoCanUse from "./AssistantWhoCanUse.vue";
import {
  readStateOf,
  useAssistantSettingsPage,
  useSettingsLeaveGuard,
} from "./useAssistantSettingsPage";

const TIERS: { value: PermissionTier; labelKey: I18nKey; lineKey: I18nKey }[] = [
  {
    value: "read",
    labelKey: "assistant.settings.access.tierRead",
    lineKey: "assistant.settings.access.tierReadLine",
  },
  {
    value: "propose",
    labelKey: "assistant.settings.access.tierPropose",
    lineKey: "assistant.settings.access.tierProposeLine",
  },
  {
    value: "act_with_approval",
    labelKey: "assistant.settings.access.tierAct",
    lineKey: "assistant.settings.access.tierActLine",
  },
];

const { t } = useI18nTyped();
const name = useAssistantName();
const page = useAssistantSettingsPage();
const { confirm } = useConfirmDialog();
const ids = { enabled: useId(), tier: useId(), public: useId() };
const saveButton = ref<InstanceType<typeof OButton> | null>(null);

const settings = useQuery(computed(() => assistantSettingsQuery(page.org.value)));
const capabilities = useQuery(
  computed(() => capabilitiesQuery(page.org.value, page.aiEnabled.value)),
);
const update = useMutation(() => updateAssistantSettingsMutation(page.org.value));

const state = computed(() => readStateOf(settings));
const supported = computed(() => !!settings.data.value);
const readOnly = computed(() => !supported.value || !page.isAdmin.value);
// Without a server-enforced policy only the tier the agent already applies may be chosen.
const tierLimited = computed(
  () => supported.value && capabilities.data.value?.policy_enforced !== true,
);
const locks = computed<PolicyLocks>(() => ({
  tier: tierLimited.value,
  publicLinks: !page.publicLinksAllowed.value,
}));
const storedTierLabel = computed(() => {
  const stored = settings.data.value?.permission_tier;
  if (!tierLimited.value || !stored || stored === "act_with_approval") return undefined;
  const entry = TIERS.find((x) => x.value === stored);
  return entry ? t(entry.labelKey) : undefined;
});

const defaults = computed(() =>
  policyValues(
    settings.data.value,
    { aiEnabled: page.aiEnabled.value, publicLinksAllowed: page.publicLinksAllowed.value },
    locks.value,
  ),
);
// What the form last loaded; a save sends only what differs from it.
const baseline = ref<AssistantOrgPolicyValues>(defaults.value);

const form = useOForm<AssistantOrgPolicyValues>({
  defaultValues: defaults.value,
  schema: assistantOrgPolicySchema,
  onSubmit: save,
});
const formValues = form.useStore((s: { values: AssistantOrgPolicyValues }) => s.values);
const tier = computed(() => formValues.value.permission_tier);
const pristine = form.useStore((s: { isDefaultValue: boolean }) => s.isDefaultValue);
const submitting = form.useStore((s: { isSubmitting: boolean }) => s.isSubmitting);
const dirty = computed(() => !pristine.value && !readOnly.value);

const tierLine = computed(() =>
  t(TIERS.find((x) => x.value === tier.value)?.lineKey ?? TIERS[2].lineKey),
);

// A refetch only replaces values the admin has not started editing; an org switch always does.
watch(defaults, (next) => {
  if (!dirty.value) resetTo(next);
});
watch(page.org, () => resetTo(defaults.value));

useSettingsLeaveGuard(page, () => dirty.value);

function resetTo(next: AssistantOrgPolicyValues) {
  baseline.value = next;
  form.reset(next);
}

function onOff(value: boolean) {
  return value ? t("assistant.settings.access.valueOn") : t("assistant.settings.access.valueOff");
}

function tierLocked(value: PermissionTier): boolean {
  return tierLimited.value && value !== "act_with_approval";
}

function cancel() {
  resetTo(defaults.value);
}

function refresh() {
  return Promise.all([settings.refetch(), capabilities.refetch()]);
}

async function save(values: AssistantOrgPolicyValues) {
  const current = settings.data.value;
  if (!current || readOnly.value) return;
  const org = page.org.value;
  const orgName = raw(page.orgName.value);
  const turningOff = baseline.value.enabled && !values.enabled;
  if (turningOff) {
    const ok = await confirm({
      title: t("assistant.settings.access.turnOff.title", name),
      message: t("assistant.settings.access.turnOff.message", { ...name, org: orgName }),
      confirmLabel: t("assistant.settings.access.turnOff.confirm"),
      confirmVariant: "destructive",
      focusCancel: true,
    });
    if (!ok) return;
  }
  const links = current.public_link_count ?? 0;
  const publicOff =
    !locks.value.publicLinks && baseline.value.public_sharing && !values.public_sharing;
  if (publicOff && links > 0) {
    const ok = await confirm({
      title: t("assistant.settings.access.publicOff.title"),
      message: t("assistant.settings.access.publicOff.message", { count: links }, links),
      confirmLabel: t("assistant.settings.access.publicOff.confirm"),
      confirmVariant: "destructive",
      focusCancel: true,
    });
    if (!ok) return;
  }
  // The org that opened the form is the one written, even if the header switched meanwhile.
  if (org !== page.org.value) return;
  try {
    await update.mutateAsync(policyUpdate(values, baseline.value, locks.value));
  } catch {
    focusSave();
    return;
  }
  resetTo(values);
  toast({
    variant: "success",
    message: turningOff
      ? t("assistant.settings.access.turnOff.done", { ...name, org: orgName })
      : t("assistant.settings.access.saved"),
  });
}

function focusSave() {
  (saveButton.value?.$el as HTMLElement | undefined)?.focus();
}

defineExpose({ refresh });
</script>
