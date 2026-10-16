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
  <ODialog
    data-test="settings-org-domain-rule-dialog"
    v-model:open="dialogOpen"
    persistent
    size="md"
    :form-id="FORM_ID"
    :title="
      isEditing ? t('settings.orgDomainMapping.editRule') : t('settings.orgDomainMapping.addRule')
    "
    :secondary-button-label="t('common.cancel')"
    :primary-button-label="isEditing ? t('common.save') : t('common.add')"
    @click:secondary="dialogOpen = false"
  >
    <OForm :id="FORM_ID" :form="form" class="flex flex-col gap-5">
      <OFormSelect
        data-test="settings-org-domain-rule-domain-select"
        name="domain"
        :label="t('settings.orgDomainMapping.domain')"
        :options="domainOptions"
        :disabled="isEditing"
        required
        :help-text="t('settings.orgDomainMapping.ruleDomainHelp')"
      />

      <OFormSelect
        data-test="settings-org-domain-rule-policy-select"
        name="policy"
        :label="t('settings.orgDomainMapping.ruleColumn')"
        :options="policyOptions"
        required
        :help-text="t(POLICY_HELP_KEYS[policy], { domain: atDomain })"
      />

      <div v-if="emailKinds.includes('allowed')" class="flex flex-col gap-1">
        <span class="text-sm font-medium">{{ t("settings.orgDomainMapping.allowedEmails") }}</span>
        <OFormTagInput
          data-test="settings-org-domain-rule-allowed-emails"
          name="allowedEmails"
          :placeholder="t('settings.emailPlaceholder', { domain: atDomain })"
        />
        <span
          v-if="policy === 'allow_specific' && allowedCount === 0"
          class="text-status-warning-text text-xs"
          data-test="settings-org-domain-rule-no-allowed"
        >
          {{ t("settings.orgDomainMapping.accessNoAllowedEmails", { domain: atDomain }) }}
        </span>
      </div>

      <div v-if="emailKinds.includes('blocked')" class="flex flex-col gap-1">
        <span class="text-sm font-medium">
          {{
            policy === "allow_all"
              ? t("settings.orgDomainMapping.blockedEmailsOptional")
              : t("settings.orgDomainMapping.blockedEmails")
          }}
        </span>
        <OFormTagInput
          data-test="settings-org-domain-rule-blocked-emails"
          name="blockedEmails"
          :placeholder="t('settings.blockedEmailPlaceholder', { domain: atDomain })"
        />
      </div>
    </OForm>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormTagInput from "@/lib/forms/TagInput/OFormTagInput.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import type { RestrictionCard } from "./orgDomainRestrictions";
import {
  RULE_POLICIES,
  domainRuleDefaults,
  makeDomainRuleSchema,
  ruleEmailKinds,
  type DomainRuleForm,
} from "./OrgDomainMapping.schema";

const FORM_ID = "org-domain-rule-form";

// Option names match the badges in the rules table.
const POLICY_LABEL_KEYS = {
  allow_all: "settings.orgDomainMapping.rulePolicy.allow_all",
  allow_specific: "settings.orgDomainMapping.rulePolicy.allow_specific",
  block_specific: "settings.orgDomainMapping.rulePolicy.block_specific",
  block_all: "settings.orgDomainMapping.rulePolicy.block_all",
} as const;

const POLICY_HELP_KEYS = {
  allow_all: "settings.orgDomainMapping.rulePolicyHelp.allow_all",
  allow_specific: "settings.orgDomainMapping.rulePolicyHelp.allow_specific",
  block_specific: "settings.orgDomainMapping.rulePolicyHelp.block_specific",
  block_all: "settings.orgDomainMapping.rulePolicyHelp.block_all",
} as const;

const props = defineProps<{
  open: boolean;
  /** The rule being edited; null adds a new one. */
  rule: RestrictionCard | null;
  /** Verified domains of this org that can take a rule. */
  domainOptions: SelectOption[];
  /** Resolves true once the rule is saved; the dialog stays open on false. */
  submit: (_rule: RestrictionCard) => Promise<boolean>;
}>();

const emit = defineEmits<{
  (_e: "update:open", _value: boolean): void;
}>();

const { t } = useI18nTyped();

const dialogOpen = computed({
  get: () => props.open,
  set: (value: boolean) => emit("update:open", value),
});

const isEditing = computed(() => props.rule !== null);

const initialValues = (): DomainRuleForm =>
  props.rule
    ? {
        domain: props.rule.name,
        policy: props.rule.policy,
        allowedEmails: [...props.rule.allowedEmails],
        blockedEmails: [...props.rule.blockedEmails],
      }
    : domainRuleDefaults(String(props.domainOptions[0]?.value ?? ""));

const form = useOForm<DomainRuleForm>({
  defaultValues: initialValues(),
  schema: makeDomainRuleSchema(t),
  onSubmit,
});

const domain = form.useStore((s) => s.values.domain);
const policy = form.useStore((s) => s.values.policy);
const allowedCount = form.useStore((s) => s.values.allowedEmails.length);
const atDomain = computed(() => raw(`@${domain.value || "…"}`));
const emailKinds = computed(() => ruleEmailKinds(policy.value));
const policyOptions = computed<SelectOption[]>(() =>
  RULE_POLICIES.map((value) => ({ label: t(POLICY_LABEL_KEYS[value]), value })),
);

// The form outlives the dialog body, so it is re-seeded on every open.
watch(
  () => props.open,
  (visible) => {
    if (visible) form.reset(initialValues());
  },
);

const clean = (emails: string[]) => [
  ...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean)),
];

async function onSubmit(value: DomainRuleForm) {
  const kinds = ruleEmailKinds(value.policy);
  const saved = await props.submit({
    name: value.domain.trim().toLowerCase(),
    policy: value.policy,
    allowedEmails: kinds.includes("allowed") ? clean(value.allowedEmails) : [],
    blockedEmails: kinds.includes("blocked") ? clean(value.blockedEmails) : [],
  });
  if (saved) emit("update:open", false);
}
</script>
