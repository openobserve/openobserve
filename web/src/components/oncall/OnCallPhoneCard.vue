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
  <div class="flex flex-col gap-2" data-test="oncall-phone-card">
    <OnCallReachRow :label="t('oncall.phoneTitle')" icon="smartphone">
      <template #value>
        <OText v-if="loadFailed" variant="meta" data-test="oncall-phone-load-failed">
          {{ t("oncall.phoneLoadFailed") }}
        </OText>
        <!-- No provider is an org fact the reader may not be able to change, so it is said once with who can fix it. -->
        <OText
          v-else-if="state === 'noProvider'"
          variant="meta"
          data-test="oncall-phone-no-provider"
        >
          {{ t("oncall.phoneNotAvailable") }}
        </OText>
        <OText
          v-else-if="contact?.phone && state !== 'empty'"
          variant="body-strong"
          as="span"
          data-test="oncall-phone-number"
        >
          {{ raw(contact.phone) }}
        </OText>
        <OText v-else-if="state === 'empty'" variant="meta">
          {{ t("oncall.phoneAddHint") }}
        </OText>
      </template>

      <template v-if="contact && state && !loadFailed" #status>
        <OTag
          v-if="state === 'verified'"
          variant="success-soft"
          size="sm"
          data-test="oncall-phone-state"
        >
          {{ t("oncall.phoneVerified") }}
          <OTooltip
            :content="
              contact.press4_available
                ? t('oncall.phoneVerifiedPress4')
                : t('oncall.phoneVerifiedAckLink')
            "
          />
        </OTag>
        <OnCallHint v-else-if="state === 'changed'" :hint="t('oncall.phoneChangedHint')">
          <OTag variant="amber-soft" size="sm" data-test="oncall-phone-state">
            {{ t("oncall.phoneNotVerified") }}
          </OTag>
        </OnCallHint>
        <OTag
          v-else-if="state === 'codeSent'"
          variant="default-soft"
          size="sm"
          data-test="oncall-phone-state"
        >
          {{ t("oncall.phoneNotVerified") }}
        </OTag>
        <OTag v-else variant="default-soft" size="sm" data-test="oncall-phone-state">
          {{ t("oncall.reachNotSetUp") }}
        </OTag>
      </template>

      <template v-if="contact && state && !loadFailed" #action>
        <OButton
          v-if="state === 'noProvider' && admin"
          variant="outline"
          size="xs"
          data-test="oncall-phone-telephony-link"
          @click="openTelephony"
        >
          <OIcon name="settings" size="sm" />{{ t("oncall.reachSetUp") }}
          <OTooltip :content="t('oncall.phoneSetUpHint')" />
        </OButton>
        <OnCallHint
          v-else-if="state === 'noProvider'"
          :hint="t('oncall.phoneAskAdmin')"
          data-test="oncall-phone-ask-admin"
        />
        <OButton
          v-if="state === 'verified' || state === 'codeSent'"
          variant="ghost"
          size="icon-sm"
          icon-left="edit"
          :aria-label="t('oncall.phoneChangeAction')"
          data-test="oncall-phone-change"
          @click="startChange"
        >
          <OTooltip :content="t('oncall.phoneChangeAction')" />
        </OButton>
        <!-- A saved number can always be taken off, verified or not, provider or not; while editing, Cancel is the way back. -->
        <OButton
          v-if="contact.phone && !editing"
          variant="ghost-destructive"
          size="icon-sm"
          icon-left="delete"
          :loading="removing"
          :aria-label="t('oncall.phoneRemoveAction')"
          data-test="oncall-phone-remove"
          @click="removeOpen = true"
        >
          <OTooltip :content="t('oncall.phoneRemoveAction')" />
        </OButton>
      </template>
    </OnCallReachRow>

    <template v-if="contact && state && !loadFailed">
      <span
        v-if="state === 'empty' || state === 'changed'"
        class="flex flex-wrap items-center gap-2 md:ps-31"
      >
        <OInput
          v-model="draftPhone"
          type="tel"
          width="md"
          autocomplete="tel"
          :placeholder="PHONE_EXAMPLE"
          :error="!!formatError"
          :error-message="formatError ?? undefined"
          data-test="oncall-phone-input"
          @blur="checkFormat"
        />
        <OButton
          variant="primary"
          size="sm-action"
          :disabled="!draftPhone.trim() || sendWaiting"
          :loading="sending"
          data-test="oncall-phone-send"
          @click="sendCode"
        >
          {{
            sendWaiting
              ? t("oncall.phoneResendIn", { time: raw(formatCountdown(resendLeft)) })
              : t("oncall.phoneSendCode")
          }}
        </OButton>
        <OButton
          v-if="editing && contact.phone"
          variant="outline"
          size="sm-action"
          data-test="oncall-phone-cancel"
          @click="cancelChange"
        >
          {{ t("common.cancel") }}
        </OButton>
      </span>

      <span v-if="state === 'codeSent'" class="flex flex-wrap items-center gap-2 md:ps-31">
        <OInput
          v-model="code"
          width="xs"
          autocomplete="one-time-code"
          :placeholder="CODE_EXAMPLE"
          data-test="oncall-phone-code"
        />
        <OButton
          variant="primary"
          size="sm-action"
          :loading="confirming"
          data-test="oncall-phone-confirm"
          @click="confirmCode"
        >
          {{ t("oncall.phoneConfirm") }}
        </OButton>
        <OButton
          variant="outline"
          size="sm-action"
          :disabled="resendLeft > 0"
          :loading="sending"
          data-test="oncall-phone-resend"
          @click="resend"
        >
          {{
            resendLeft > 0
              ? t("oncall.phoneResendIn", { time: raw(formatCountdown(resendLeft)) })
              : t("oncall.phoneResend")
          }}
        </OButton>
      </span>

      <p
        v-if="error"
        class="text-status-error-text text-sm md:ps-31"
        role="alert"
        data-test="oncall-phone-error"
      >
        {{ error }}
      </p>

      <OText
        v-if="state === 'codeSent'"
        variant="meta"
        class="md:ps-31"
        data-test="oncall-phone-code-sent-text"
      >
        {{ t("oncall.phoneCodeSentTo", { phone: raw(contact.phone) }) }}
      </OText>
    </template>

    <ConfirmDialog
      :model-value="removeOpen"
      :title="t('oncall.phoneRemoveTitle')"
      :message="t('oncall.phoneRemoveMessage')"
      :ok-label="t('oncall.phoneRemove')"
      ok-variant="destructive"
      focus-cancel
      @update:ok="removePhone"
      @update:cancel="removeOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { useMutation, useQuery } from "@tanstack/vue-query";

import ConfirmDialog from "@/components/ConfirmDialog.vue";
import OnCallHint from "@/components/oncall/OnCallHint.vue";
import OnCallReachRow from "@/components/oncall/OnCallReachRow.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import {
  confirmCodeMutation,
  contactQuery,
  sendCodeMutation,
  setContactMutation,
} from "@/services/oncall.queries";
import type { Contact, RefusalReason } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import {
  formatCountdown,
  isInternationalPhone,
  phoneCardState,
  phoneRefusalText,
  refusalOf,
  samePhone,
} from "@/utils/oncall";
import { licenseDeniedFeatures } from "@/utils/featureGate";

// The server's minimum gap between two codes for one number (R17).
const RESEND_SECS = 60;
// Refusals the server returns after storing the new code, so the old one no longer works.
const UNDELIVERED: ReadonlySet<RefusalReason> = new Set([
  "number_rejected",
  "number_not_allowed",
  "provider_unavailable",
]);
const PHONE_EXAMPLE = raw("+1 415 555 0134");
const CODE_EXAMPLE = raw("000000");

withDefaults(
  defineProps<{
    /** Whether to offer the Telephony setup button rather than "ask an admin"; the server is still the gate. */
    admin?: boolean;
  }>(),
  { admin: false },
);

const emit = defineEmits<{ licenseDenied: [features: string[]] }>();

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const orgId = computed(() => store.state.selectedOrganization.identifier);
const email = computed(() => String(store.state.userInfo?.email ?? ""));

const contactRead = useQuery(() =>
  Object.assign(contactQuery(orgId.value, email.value), {
    enabled: !!orgId.value && !!email.value,
  }),
);
const contact = computed(() => contactRead.data.value ?? null);
// A license denial is not a failed read: the license bar already says why.
const loadFailed = computed(
  () => contactRead.isError.value && !licenseDeniedFeatures(contactRead.error.value),
);
watch(contactRead.error, (err) => {
  const denied = licenseDeniedFeatures(err);
  if (denied) emit("licenseDenied", denied);
});

const saveContact = useMutation(() => setContactMutation(orgId.value, email.value));
const sendCodeWrite = useMutation(() => sendCodeMutation(orgId.value, email.value));
const confirmWrite = useMutation(() => confirmCodeMutation(orgId.value, email.value));

const draftPhone = ref("");
const code = ref("");
const editing = ref(false);
const codeSent = ref(false);
const error = ref<I18nText | null>(null);
const sending = ref(false);
const confirming = ref(false);
const resendAt = ref(0);
const countdownPhone = ref("");
const now = ref(Date.now());
const formatError = ref<I18nText | null>(null);
const removeOpen = ref(false);
const removing = ref(false);

const state = computed(() =>
  contact.value ? phoneCardState(contact.value, codeSent.value, editing.value) : null,
);
const resendLeft = computed(() => Math.max(0, Math.ceil((resendAt.value - now.value) / 1000)));
// The server's gap is per number, so a different number may be sent at once.
const sendWaiting = computed(
  () => resendLeft.value > 0 && samePhone(draftPhone.value, countdownPhone.value),
);

watch(
  () => contact.value?.phone,
  (phone) => {
    if (!editing.value) draftPhone.value = phone ?? "";
  },
  { immediate: true },
);

// Cleared as soon as the number reads right, so the hint never outlives the mistake.
watch(draftPhone, (typed) => {
  if (formatError.value && isInternationalPhone(typed)) formatError.value = null;
});

/// The server's own format rule, said before the round trip; an empty box is not a mistake yet.
function checkFormat(): boolean {
  const typed = draftPhone.value.trim();
  formatError.value = typed && !isInternationalPhone(typed) ? t("oncall.phoneFormatHint") : null;
  return !formatError.value;
}

let timer: ReturnType<typeof setInterval> | undefined;

function startCountdown(phone: string, secs: number) {
  countdownPhone.value = phone;
  now.value = Date.now();
  resendAt.value = now.value + secs * 1000;
  clearInterval(timer);
  timer = setInterval(() => {
    now.value = Date.now();
    if (now.value >= resendAt.value) clearInterval(timer);
  }, 1000);
}

function errorText(err: unknown, fallback: I18nText): I18nText {
  const refusal = refusalOf(err);
  if (refusal) return phoneRefusalText(t, refusal);
  const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return raw(message) || fallback;
}

function startChange() {
  draftPhone.value = contact.value?.phone ?? "";
  error.value = null;
  editing.value = true;
}

function cancelChange() {
  draftPhone.value = contact.value?.phone ?? "";
  error.value = null;
  editing.value = false;
}

async function requestCode(phone: string) {
  try {
    await sendCodeWrite.mutateAsync();
    code.value = "";
    codeSent.value = true;
    startCountdown(phone, RESEND_SECS);
  } catch (err) {
    const refusal = refusalOf(err);
    if (refusal?.retry_after_secs !== undefined) startCountdown(phone, refusal.retry_after_secs);
    // A code sent under a minute ago is still valid, so its box opens instead of an error.
    if (refusal?.reason === "too_soon" && refusal.retry_after_secs !== undefined) {
      codeSent.value = true;
      return;
    }
    // The server stored the undelivered code, so no code works yet the 60 s gap still runs.
    if (refusal && UNDELIVERED.has(refusal.reason)) {
      codeSent.value = false;
      startCountdown(phone, RESEND_SECS);
    }
    error.value = errorText(err, t("oncall.phoneSendFailed"));
  }
}

async function saveNumber(): Promise<Contact | null> {
  try {
    return (await saveContact.mutateAsync(draftPhone.value.trim())).data;
  } catch (err) {
    error.value = errorText(err, t("oncall.phoneSaveFailed"));
    return null;
  }
}

/// PUT then POST: there is no combined endpoint (§10).
async function sendCode() {
  if (!checkFormat()) return;
  error.value = null;
  codeSent.value = false;
  sending.value = true;
  try {
    const saved = await saveNumber();
    if (!saved) return;
    editing.value = false;
    // An unchanged number, or one proved in another org, keeps its proof (V5).
    if (saved.phone_is_pageable) return;
    await requestCode(saved.phone ?? "");
  } finally {
    sending.value = false;
  }
}

async function resend() {
  error.value = null;
  sending.value = true;
  try {
    await requestCode(contact.value?.phone ?? "");
  } finally {
    sending.value = false;
  }
}

async function confirmCode() {
  error.value = null;
  confirming.value = true;
  try {
    await confirmWrite.mutateAsync(code.value.trim());
    code.value = "";
  } catch (err) {
    error.value = errorText(err, t("oncall.phoneCodeFailed"));
  } finally {
    confirming.value = false;
  }
}

/// An empty number clears it (`set_contact`); only this org's copy goes, other orgs keep theirs.
async function removePhone() {
  removeOpen.value = false;
  error.value = null;
  removing.value = true;
  try {
    await saveContact.mutateAsync("");
    codeSent.value = false;
    editing.value = false;
    draftPhone.value = "";
  } catch (err) {
    error.value = errorText(err, t("oncall.phoneSaveFailed"));
  } finally {
    removing.value = false;
  }
}

function openTelephony() {
  router.push({ name: "telephonySettings", query: { org_identifier: orgId.value } });
}

/// Forced by the page's refresh, so the card never shows a stale verification.
async function refresh() {
  await contactRead.refetch();
}

defineExpose({ refresh });

onBeforeUnmount(() => clearInterval(timer));
</script>
