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
  <div
    class="card-container rounded-surface bg-surface-base border-border-default flex flex-col gap-2 border px-4 py-3"
    data-test="oncall-phone-card"
  >
    <span class="flex flex-wrap items-center gap-2">
      <OIcon name="smartphone" size="sm" class="text-text-secondary" />
      <OText variant="panel-title">{{ t("oncall.phoneTitle") }}</OText>
      <OTag
        v-if="state === 'verified'"
        variant="success-soft"
        size="sm"
        data-test="oncall-phone-state"
      >
        {{ t("oncall.phoneVerified") }}
      </OTag>
      <OTag
        v-else-if="state === 'codeSent'"
        variant="default-soft"
        size="sm"
        data-test="oncall-phone-state"
      >
        {{ t("oncall.phoneNotVerified") }}
      </OTag>
      <!-- Amber, not red: email still reaches the person. -->
      <OTag
        v-else-if="state === 'changed'"
        variant="amber-soft"
        size="sm"
        data-test="oncall-phone-state"
      >
        {{ t("oncall.phoneNotVerified") }}
      </OTag>
      <OText v-if="state === 'empty'" variant="meta">{{ t("oncall.phoneIntro") }}</OText>
    </span>

    <OText v-if="loadFailed" variant="meta" data-test="oncall-phone-load-failed">
      {{ t("oncall.phoneLoadFailed") }}
    </OText>

    <template v-else-if="contact && state">
      <span
        v-if="state === 'verified' || state === 'codeSent'"
        class="flex flex-wrap items-center gap-2"
      >
        <OText variant="body-strong" as="span" data-test="oncall-phone-number">
          {{ raw(contact.phone) }}
        </OText>
        <OButton
          variant="ghost-primary"
          size="xs"
          data-test="oncall-phone-change"
          @click="startChange"
        >
          {{ t("oncall.phoneChange") }}
        </OButton>
      </span>

      <span v-else class="flex flex-wrap items-center gap-2">
        <OInput
          v-model="draftPhone"
          type="tel"
          width="md"
          autocomplete="tel"
          :placeholder="PHONE_EXAMPLE"
          :disabled="state === 'noProvider'"
          data-test="oncall-phone-input"
        />
        <OButton
          variant="primary"
          size="sm-action"
          :disabled="state === 'noProvider'"
          :loading="sending"
          data-test="oncall-phone-send"
          @click="sendCode"
        >
          {{ t("oncall.phoneSendCode") }}
        </OButton>
        <OText v-if="state === 'empty'" variant="meta">{{ t("oncall.phoneSendHint") }}</OText>
      </span>

      <span v-if="state === 'codeSent'" class="flex flex-wrap items-center gap-2">
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
        class="text-status-error-text text-sm"
        role="alert"
        data-test="oncall-phone-error"
      >
        {{ error }}
      </p>

      <OText v-if="state === 'codeSent'" variant="meta">
        {{ t("oncall.phoneCodeSentTo", { phone: raw(contact.phone) }) }}
      </OText>
      <OText v-else-if="state === 'verified'" variant="meta">
        {{
          contact.press4_available
            ? t("oncall.phoneVerifiedPress4")
            : t("oncall.phoneVerifiedAckLink")
        }}
      </OText>
      <OText v-else-if="state === 'changed'" variant="meta">
        {{ t("oncall.phoneChangedHint") }}
      </OText>
      <OBanner
        v-else-if="state === 'noProvider'"
        variant="info"
        data-test="oncall-phone-no-provider"
      >
        {{ t("oncall.phoneNoProvider") }}
        <OButton
          variant="ghost-primary"
          size="xs"
          data-test="oncall-phone-telephony-link"
          @click="openTelephony"
        >
          {{ t("oncall.phoneNoProviderLink") }}
        </OButton>
      </OBanner>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { useMutation, useQuery } from "@tanstack/vue-query";

import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import {
  confirmCodeMutation,
  contactQuery,
  sendCodeMutation,
  setContactMutation,
} from "@/services/oncall.queries";
import type { Contact } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatCountdown, phoneCardState, phoneRefusalText, refusalOf } from "@/utils/oncall";

// The server's minimum gap between two codes for one number (R17).
const RESEND_SECS = 60;
const PHONE_EXAMPLE = raw("+1 415 555 0134");
const CODE_EXAMPLE = raw("000000");

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
const loadFailed = computed(() => contactRead.isError.value);

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
const now = ref(Date.now());

const state = computed(() =>
  contact.value ? phoneCardState(contact.value, codeSent.value, editing.value) : null,
);
const resendLeft = computed(() => Math.max(0, Math.ceil((resendAt.value - now.value) / 1000)));

watch(
  () => contact.value?.phone,
  (phone) => {
    if (!editing.value) draftPhone.value = phone ?? "";
  },
  { immediate: true },
);

let timer: ReturnType<typeof setInterval> | undefined;

function startCountdown(secs: number) {
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

async function requestCode() {
  try {
    await sendCodeWrite.mutateAsync();
    code.value = "";
    codeSent.value = true;
    startCountdown(RESEND_SECS);
  } catch (err) {
    const refusal = refusalOf(err);
    if (refusal?.retry_after_secs !== undefined) startCountdown(refusal.retry_after_secs);
    // A code sent under a minute ago is still valid, so its box opens instead of an error.
    if (refusal?.reason === "too_soon" && refusal.retry_after_secs !== undefined) {
      codeSent.value = true;
      return;
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
  error.value = null;
  codeSent.value = false;
  sending.value = true;
  try {
    const saved = await saveNumber();
    if (!saved) return;
    editing.value = false;
    // An unchanged number, or one proved in another org, keeps its proof (V5).
    if (saved.phone_is_pageable) return;
    await requestCode();
  } finally {
    sending.value = false;
  }
}

async function resend() {
  error.value = null;
  sending.value = true;
  try {
    await requestCode();
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
