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
    data-test="settings-org-domain-blocklist-dialog"
    v-model:open="dialogOpen"
    persistent
    size="md"
    :form-id="FORM_ID"
    :title="
      isEditing
        ? t('settings.orgDomainMapping.editBlockedUsers')
        : t('settings.orgDomainMapping.blockUsers')
    "
    :secondary-button-label="t('common.cancel')"
    :primary-button-label="isEditing ? t('common.save') : t('settings.orgDomainMapping.block')"
    @click:secondary="dialogOpen = false"
  >
    <OForm :id="FORM_ID" :form="form" class="flex flex-col gap-5">
      <OFormSelect
        data-test="settings-org-domain-blocklist-domain-select"
        name="domain"
        :label="t('settings.orgDomainMapping.domain')"
        :options="domainOptions"
        :disabled="isEditing"
        required
        :help-text="t('settings.orgDomainMapping.blocklistDomainHelp')"
      />

      <div class="flex flex-col gap-1">
        <span class="text-sm font-medium">{{ t("settings.orgDomainMapping.blockedEmails") }}</span>
        <OFormTagInput
          data-test="settings-org-domain-blocklist-emails"
          name="blockedEmails"
          :placeholder="t('settings.blockedEmailPlaceholder', { domain: atDomain })"
        />
        <span class="text-text-secondary text-xs">
          {{ t("settings.orgDomainMapping.blocklistEmailsHelp") }}
        </span>
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
import type { DomainBlocklist } from "./orgDomainRestrictions";
import {
  domainBlocklistDefaults,
  makeDomainBlocklistSchema,
  type DomainBlocklistForm,
} from "./OrgDomainMapping.schema";

const FORM_ID = "org-domain-blocklist-form";

const props = defineProps<{
  open: boolean;
  /** The blocklist being edited; null adds a new one. */
  blocklist: DomainBlocklist | null;
  /** Verified domains of this org that have no blocklist yet. */
  domainOptions: SelectOption[];
  /** Resolves true once the blocklist is saved; the dialog stays open on false. */
  submit: (_blocklist: DomainBlocklist) => Promise<boolean>;
}>();

const emit = defineEmits<{
  (_e: "update:open", _value: boolean): void;
}>();

const { t } = useI18nTyped();

const dialogOpen = computed({
  get: () => props.open,
  set: (value: boolean) => emit("update:open", value),
});

const isEditing = computed(() => props.blocklist !== null);

const initialValues = (): DomainBlocklistForm =>
  props.blocklist
    ? { domain: props.blocklist.name, blockedEmails: [...props.blocklist.blockedEmails] }
    : domainBlocklistDefaults(String(props.domainOptions[0]?.value ?? ""));

const form = useOForm<DomainBlocklistForm>({
  defaultValues: initialValues(),
  schema: makeDomainBlocklistSchema(t),
  onSubmit,
});

const domain = form.useStore((s) => s.values.domain);
const atDomain = computed(() => raw(`@${domain.value || "…"}`));

// The form outlives the dialog body, so it is re-seeded on every open.
watch(
  () => props.open,
  (visible) => {
    if (visible) form.reset(initialValues());
  },
);

async function onSubmit(value: DomainBlocklistForm) {
  const saved = await props.submit({
    name: value.domain.trim().toLowerCase(),
    blockedEmails: [
      ...new Set(value.blockedEmails.map((email) => email.trim().toLowerCase()).filter(Boolean)),
    ],
  });
  if (saved) emit("update:open", false);
}
</script>
