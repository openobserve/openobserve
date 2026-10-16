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
    :open="open"
    :title="
      mode === 'connect'
        ? t('telephony.connectTitle', { provider: PROVIDER })
        : t('telephony.updateTitle', { provider: PROVIDER })
    "
    :sub-title="t('telephony.dialogSubtitle')"
    :form-id="FORM_ID"
    :primary-button-label="primaryLabel"
    :secondary-button-label="t('common.cancel')"
    data-test="telephony-account-dialog"
    @update:open="$emit('update:open', $event)"
    @click:secondary="$emit('update:open', false)"
  >
    <OForm :id="FORM_ID" :form="form" class="flex flex-col gap-5">
      <OBanner v-if="refusal" variant="error" data-test="telephony-account-dialog-refusal">
        {{ refusal }}
      </OBanner>
      <OFormInput
        name="account_sid"
        :label="t('telephony.accountSid')"
        :placeholder="SID_PLACEHOLDER"
        autocomplete="off"
        required
        data-test="telephony-account-dialog-sid"
      />
      <OFormInput
        name="auth_token"
        type="password"
        :label="t('telephony.authToken')"
        :help-text="mode === 'update' ? t('telephony.tokenKeep') : undefined"
        autocomplete="new-password"
        :required="mode === 'connect'"
        data-test="telephony-account-dialog-token"
      />
      <OFormInput
        name="from_number"
        type="tel"
        :label="t('telephony.fromNumber')"
        :placeholder="FROM_EXAMPLE"
        :help-text="t('telephony.fromHelp', { provider: PROVIDER })"
        autocomplete="off"
        required
        data-test="telephony-account-dialog-from"
      />
    </OForm>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useStore } from "vuex";
import { useMutation } from "@tanstack/vue-query";

import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { saveTelephonyMutation } from "@/services/oncall.queries";
import type { OrgTelephonyView, PutTelephonyBody } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import {
  makeTelephonySchema,
  type TelephonyDialogMode,
  type TelephonyForm,
} from "./TelephonyAccountDialog.schema";
import {
  FROM_EXAMPLE,
  PROVIDER,
  isForbidden,
  telephonyRefusalOf,
  telephonyRefusalText,
} from "./telephony";

const FORM_ID = "telephony-account-form";
const SID_PLACEHOLDER = raw("ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");

const props = defineProps<{
  open: boolean;
  mode: TelephonyDialogMode;
  /** The org's saved account on update; mounted fresh per open, so it seeds the form once. */
  account: OrgTelephonyView | null;
}>();

const emit = defineEmits<{
  (_e: "update:open", _value: boolean): void;
  (_e: "denied"): void;
}>();

const { t } = useI18nTyped();
const store = useStore();
const orgId = computed<string>(() => store.state.selectedOrganization.identifier);
const save = useMutation(() => saveTelephonyMutation(orgId.value));
const refusal = ref<I18nText | null>(null);

const form = useOForm<TelephonyForm>({
  defaultValues: {
    account_sid: props.account?.account_sid ?? "",
    auth_token: "",
    from_number: props.account?.from_number ?? "",
  },
  schema: makeTelephonySchema(t, props.mode),
  onSubmit: submit,
});

const submitting = form.useStore((s) => s.isSubmitting);
const primaryLabel = computed<I18nText>(() => {
  if (submitting.value) return t("telephony.checking", { provider: PROVIDER });
  return props.mode === "connect" ? t("telephony.connect") : t("telephony.update");
});

function failureText(err: unknown): I18nText {
  const body = telephonyRefusalOf(err);
  if (body) return telephonyRefusalText(t, body.reason);
  const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return raw(message) || t("telephony.saveFailed");
}

async function submit(value: TelephonyForm) {
  refusal.value = null;
  const token = value.auth_token.trim();
  const body: PutTelephonyBody = {
    provider: "twilio",
    account_sid: value.account_sid.trim(),
    ...(token ? { auth_token: token } : {}),
    from_number: value.from_number.trim(),
  };
  try {
    await save.mutateAsync(body);
    emit("update:open", false);
  } catch (err) {
    if (isForbidden(err)) {
      emit("denied");
      emit("update:open", false);
      return;
    }
    refusal.value = failureText(err);
  }
}
</script>
