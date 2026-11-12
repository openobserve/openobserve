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
    data-test="settings-org-link-domain-dialog"
    v-model:open="dialogOpen"
    persistent
    size="md"
    :form-id="FORM_ID"
    :title="t('settings.orgDomainMapping.linkDomain')"
    :secondary-button-label="t('common.cancel')"
    :primary-button-label="
      method === 'request'
        ? t('settings.orgDomainMapping.sendRequest')
        : t('settings.orgDomainMapping.linkDomain')
    "
    @click:secondary="dialogOpen = false"
  >
    <OForm :id="FORM_ID" :form="form" class="flex flex-col gap-5">
      <OFormInput
        data-test="settings-org-link-domain-input"
        name="domain"
        :label="t('settings.orgDomainMapping.domain')"
        required
        :placeholder="t('settings.domainPlaceholder', { example: raw('example.com') })"
        :help-text="
          method === 'request'
            ? t('settings.orgDomainMapping.domainHelpRequest', { at_sign: '@' })
            : t('settings.orgDomainMapping.domainHelp', { at_sign: '@' })
        "
      />

      <div class="flex flex-col gap-2">
        <div class="text-sm font-medium">{{ t("settings.orgDomainMapping.linkMethod") }}</div>
        <OFormRadioGroup
          name="method"
          class="grid grid-cols-1 gap-3"
          :label="t('settings.orgDomainMapping.linkMethod')"
          orientation="vertical"
        >
          <ORadio value="dns" variant="card" data-test="settings-org-link-domain-method-dns">
            <template #label>
              <span class="flex flex-col gap-1">
                <span>{{ t("settings.orgDomainMapping.method.dnsTitle") }}</span>
                <span class="text-text-secondary text-xs font-normal">
                  {{ t("settings.orgDomainMapping.method.dnsDesc") }}
                </span>
              </span>
            </template>
          </ORadio>
          <ORadio
            value="request"
            variant="card"
            data-test="settings-org-link-domain-method-request"
          >
            <template #label>
              <span class="flex flex-col gap-1">
                <span>{{ t("settings.orgDomainMapping.method.requestTitle") }}</span>
                <span class="text-text-secondary text-xs font-normal">
                  {{ t("settings.orgDomainMapping.method.requestDesc") }}
                </span>
              </span>
            </template>
          </ORadio>
        </OFormRadioGroup>
      </div>
    </OForm>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormRadioGroup from "@/lib/forms/Radio/OFormRadioGroup.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import {
  linkDomainDefaults,
  makeLinkDomainSchema,
  type LinkDomainForm,
  type LinkMethod,
} from "./OrgDomainMapping.schema";

const FORM_ID = "org-link-domain-form";

const props = withDefaults(
  defineProps<{
    open: boolean;
    initialMethod?: LinkMethod;
    /** Resolves true once the link or request is saved; the dialog stays open on false. */
    submit: (_domain: string, _method: LinkMethod) => Promise<boolean>;
  }>(),
  { initialMethod: "dns" },
);

const emit = defineEmits<{
  (_e: "update:open", _value: boolean): void;
}>();

const { t } = useI18nTyped();

const dialogOpen = computed({
  get: () => props.open,
  set: (value: boolean) => emit("update:open", value),
});

const form = useOForm<LinkDomainForm>({
  defaultValues: linkDomainDefaults(),
  schema: makeLinkDomainSchema(t),
  onSubmit,
});

const method = form.useStore((s) => s.values.method);

// The form outlives the dialog body, so it is re-seeded on every open.
watch(
  () => props.open,
  (visible) => {
    if (visible) form.reset({ ...linkDomainDefaults(), method: props.initialMethod });
  },
);

async function onSubmit(value: LinkDomainForm) {
  const saved = await props.submit(value.domain.trim().toLowerCase(), value.method);
  if (saved) emit("update:open", false);
}
</script>
