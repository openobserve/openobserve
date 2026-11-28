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
import { computed } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import type { BrowserCheck } from "@/types/synthetics";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import WriteOnlyField from "./WriteOnlyField.vue";
import SecretPicker from "@/views/Secrets/SecretPicker.vue";
import { useSecretPickerShown } from "@/views/Secrets/useSecretConsumer";
import { refText } from "@/views/Secrets/secretRefs";
import type { SecretPickerItem } from "@/services/secrets";
import { cookieHasSecret, isKept, setReplaced, slotKey } from "@/utils/synthetics/writeOnly";

const props = defineProps<{ check: BrowserCheck; validationErrors?: Record<string, string> }>();
const emit = defineEmits<{ "update:check": [value: BrowserCheck] }>();

const { t } = useI18nTyped();

// ── Header summary ─────────────────────────────────────────────────────────────
// Basic-auth only: variables moved to the always-visible CheckVariablesPanel.

const summary = computed(() =>
  props.check.auth ? t("synthetics.authNetwork.httpBasicAuth") : undefined,
);

// ── Auth ─────────────────────────────────────────────────────────────────────

const authEnabled = computed({
  get: () => !!props.check.auth,
  set: (v: boolean) =>
    emit("update:check", {
      ...props.check,
      auth: v ? { type: "basic" as const, username: "", password: "" } : undefined,
    }),
});

const authUsername = computed({
  get: () => props.check.auth?.username ?? "",
  set: (v: string) =>
    emit("update:check", {
      ...props.check,
      auth: props.check.auth
        ? { ...props.check.auth, username: v }
        : { type: "basic" as const, username: v, password: "" },
    }),
});

const authPassword = computed({
  get: () => props.check.auth?.password ?? "",
  set: (v: string) =>
    emit("update:check", {
      ...props.check,
      auth: props.check.auth
        ? { ...props.check.auth, password: v }
        : { type: "basic" as const, username: "", password: v },
    }),
});

const passwordKey = slotKey.authPassword();
function setPasswordKept(kept: boolean) {
  const next = setReplaced(props.check, passwordKey, !kept);
  emit("update:check", { ...next, auth: next.auth ? { ...next.auth, password: "" } : next.auth });
}

const pickerShown = useSecretPickerShown();
const checkId = computed(() => String(props.check.id ?? ""));

/** A password is one value, so a picked ref replaces it and the kept value with it. */
function pickPassword(item: SecretPickerItem) {
  const next = setReplaced(props.check, passwordKey, true);
  const password = refText(item.kind, item.name);
  emit("update:check", {
    ...next,
    auth: next.auth
      ? { ...next.auth, password }
      : { type: "basic" as const, username: "", password },
  });
}

// ── Browser secrets (write-only, V39) ─────────────────────────────────────────

const browserSecrets = computed(() => props.check.secrets ?? []);

function patchBrowserSecret(index: number, value: string, base: BrowserCheck = props.check) {
  const secrets = (base.secrets ?? []).map((s, i) => (i === index ? { ...s, value } : s));
  emit("update:check", { ...base, secrets });
}

function setBrowserSecretKept(index: number, kept: boolean) {
  const key = slotKey.browserSecret(browserSecrets.value[index].name);
  patchBrowserSecret(index, "", setReplaced(props.check, key, !kept));
}

function removeBrowserSecret(index: number) {
  emit("update:check", {
    ...props.check,
    secrets: browserSecrets.value.filter((_, i) => i !== index),
  });
}

// ── Headers ───────────────────────────────────────────────────────────────────

const headers = computed(() => props.check.headers ?? []);

function updateHeader(index: number, field: "key" | "value", val: string) {
  const updated = headers.value.map((item, i) => (i === index ? { ...item, [field]: val } : item));
  emit("update:check", { ...props.check, headers: updated });
}

function addHeader() {
  emit("update:check", {
    ...props.check,
    headers: [...headers.value, { id: crypto.randomUUID(), key: "", value: "" }],
  });
}

function removeHeader(index: number) {
  emit("update:check", {
    ...props.check,
    headers: headers.value.filter((_, i) => i !== index),
  });
}

// ── Cookies ───────────────────────────────────────────────────────────────────

const cookies = computed(() => props.check.cookies ?? []);

function updateCookie(index: number, field: "name" | "value" | "domain", val: string) {
  const updated = cookies.value.map((item, i) => (i === index ? { ...item, [field]: val } : item));
  emit("update:check", { ...props.check, cookies: updated });
}

function addCookie() {
  emit("update:check", {
    ...props.check,
    cookies: [...cookies.value, { id: crypto.randomUUID(), name: "", value: "", domain: "" }],
  });
}

function removeCookie(index: number) {
  emit("update:check", {
    ...props.check,
    cookies: cookies.value.filter((_, i) => i !== index),
  });
}

const cookieKey = (c: { name: string; domain: string }) => slotKey.cookie(c.name, c.domain);

function setCookieKept(index: number, kept: boolean) {
  const next = setReplaced(props.check, cookieKey(cookies.value[index]), !kept);
  const updated = (next.cookies ?? []).map((c, i) => (i === index ? { ...c, value: "" } : c));
  emit("update:check", { ...next, cookies: updated });
}

function pickCookie(index: number, item: SecretPickerItem) {
  const current = cookies.value[index].value;
  updateCookie(index, "value", `${current}${refText(item.kind, item.name)}`);
}

function setCookieSecure(index: number, secure: boolean) {
  const updated = cookies.value.map((c, i) => (i === index ? { ...c, secure } : c));
  emit("update:check", { ...props.check, cookies: updated });
}
</script>

<template>
  <div class="rounded-default border-border-default mb-4 border">
    <div class="border-border-default flex items-center border-b px-3 py-2.5">
      <div class="rounded-default bg-accent me-2 h-4 w-[0.1875rem] shrink-0" />
      <h3 class="text-text-heading text-base font-semibold">
        {{ t("synthetics.authNetwork.title") }}
      </h3>
      <OBadge variant="default-soft" size="sm" class="ms-2">{{
        t("synthetics.authNetwork.optional")
      }}</OBadge>
      <div class="flex-1" />
      <span v-if="summary" class="text-text-muted text-xs">{{ summary }}</span>
    </div>
    <div class="flex flex-col gap-4 px-3 py-2">
      <!-- HTTP Basic auth -->
      <div class="flex flex-col gap-3">
        <OSwitch
          v-model="authEnabled"
          :label="t('synthetics.authNetwork.httpBasicAuth')"
          data-test="synthetics-check-auth-network-basic-auth-switch"
        />
        <template v-if="check.auth">
          <OInput
            v-model="authUsername"
            :label="t('synthetics.authNetwork.username')"
            :placeholder="t('synthetics.authNetwork.usernamePlaceholder')"
            data-test="synthetics-check-auth-network-username-input"
          />
          <div>
            <label class="text-text-body mb-1 block text-sm font-medium">
              {{ t("synthetics.authNetwork.password") }}
              <OBadge variant="default-soft" size="sm" class="ms-1">{{
                t("synthetics.authNetwork.secret")
              }}</OBadge>
            </label>
            <WriteOnlyField
              v-model="authPassword"
              :meta="check.writeOnly?.[passwordKey]"
              :kept="isKept(check, passwordKey)"
              :placeholder="t('synthetics.authNetwork.passwordPlaceholder')"
              :error="raw(validationErrors?.['auth.password'])"
              data-test="synthetics-check-auth-network-password-input"
              @update:kept="setPasswordKept"
            >
              <template v-if="pickerShown" #append>
                <SecretPicker
                  consumer-type="synthetics_check"
                  :consumer-id="checkId"
                  :locations="check.locations"
                  data-test="synthetics-check-auth-network-password-secret-picker"
                  @pick="pickPassword"
                />
              </template>
            </WriteOnlyField>
            <span class="text-text-secondary text-xs">{{
              t("synthetics.secretFields.keptHint")
            }}</span>
          </div>
        </template>
      </div>

      <!-- Browser secrets and cookies saved on the check: values are write-only (V39). -->
      <template v-if="browserSecrets.length">
        <OSeparator />
        <div class="flex flex-col gap-2" data-test="synthetics-check-auth-network-browser-secrets">
          <h4 class="text-text-body text-sm font-medium">
            {{ t("synthetics.secretFields.browserSecrets") }}
          </h4>
          <div
            v-for="(secret, index) in browserSecrets"
            :key="secret.id ?? secret.name"
            class="flex items-start gap-2"
          >
            <div class="w-48 shrink-0">
              <OInput
                :model-value="secret.name"
                readonly
                :data-test="`synthetics-check-auth-network-browser-secret-name-${index}`"
              />
            </div>
            <WriteOnlyField
              class="min-w-0 flex-1"
              :model-value="secret.value"
              :meta="check.writeOnly?.[slotKey.browserSecret(secret.name)]"
              :kept="isKept(check, slotKey.browserSecret(secret.name))"
              :data-test="`synthetics-check-auth-network-browser-secret-${index}`"
              @update:model-value="(v: string) => patchBrowserSecret(index, v)"
              @update:kept="(kept: boolean) => setBrowserSecretKept(index, kept)"
            />
            <OButton
              variant="ghost"
              size="icon-sm"
              icon-left="close"
              :aria-label="t('synthetics.secretFields.removeBrowserSecret', { name: secret.name })"
              :data-test="`synthetics-check-auth-network-remove-browser-secret-${index}-btn`"
              @click="removeBrowserSecret(index)"
            />
          </div>
        </div>
      </template>

      <template v-if="cookies.length">
        <OSeparator />
        <div class="flex flex-col gap-2" data-test="synthetics-check-auth-network-cookies">
          <h4 class="text-text-body text-sm font-medium">
            {{ t("synthetics.authNetwork.preSetCookies") }}
          </h4>
          <div
            v-for="(cookie, index) in cookies"
            :key="cookie.id ?? index"
            class="flex flex-col gap-1"
          >
            <div class="flex items-start gap-2">
              <div class="w-40 shrink-0">
                <OInput
                  :model-value="cookie.name"
                  :readonly="isKept(check, cookieKey(cookie)) && !cookie.value"
                  :placeholder="t('synthetics.authNetwork.cookieNamePlaceholder')"
                  :data-test="`synthetics-check-auth-network-cookie-name-${index}-input`"
                  @update:model-value="updateCookie(index, 'name', String($event))"
                />
              </div>
              <WriteOnlyField
                class="min-w-0 flex-1"
                :model-value="cookie.value"
                :meta="check.writeOnly?.[cookieKey(cookie)]"
                :kept="isKept(check, cookieKey(cookie))"
                :placeholder="t('synthetics.authNetwork.cookieValuePlaceholder')"
                :data-test="`synthetics-check-auth-network-cookie-value-${index}`"
                @update:model-value="(v: string) => updateCookie(index, 'value', v)"
                @update:kept="(kept: boolean) => setCookieKept(index, kept)"
              >
                <template v-if="pickerShown" #append>
                  <SecretPicker
                    consumer-type="synthetics_check"
                    :consumer-id="checkId"
                    :locations="check.locations"
                    :data-test="`synthetics-check-auth-network-cookie-${index}-secret-picker`"
                    @pick="(item: SecretPickerItem) => pickCookie(index, item)"
                  />
                </template>
              </WriteOnlyField>
              <div class="w-40 shrink-0">
                <OInput
                  :model-value="cookie.domain"
                  :readonly="isKept(check, cookieKey(cookie)) && !cookie.value"
                  :placeholder="t('synthetics.authNetwork.cookieDomainPlaceholder')"
                  :data-test="`synthetics-check-auth-network-cookie-domain-${index}-input`"
                  @update:model-value="updateCookie(index, 'domain', String($event))"
                />
              </div>
              <OButton
                variant="ghost"
                size="icon-sm"
                icon-left="close"
                :aria-label="t('synthetics.authNetwork.removeCookie', { index })"
                :data-test="`synthetics-check-auth-network-remove-cookie-${index}-btn`"
                @click="removeCookie(index)"
              />
            </div>
            <span
              v-if="isKept(check, cookieKey(cookie)) && !cookie.value"
              class="text-text-secondary text-xs"
              :data-test="`synthetics-check-auth-network-cookie-rename-${index}-hint`"
            >
              {{ t("synthetics.secretFields.cookieRenameNeedsValue") }}
            </span>
            <div class="flex items-center gap-2">
              <OSwitch
                :model-value="cookieHasSecret(cookie.value) || !!cookie.secure"
                :disabled="cookieHasSecret(cookie.value)"
                :label="t('synthetics.secretFields.secure')"
                :data-test="`synthetics-check-auth-network-cookie-secure-${index}`"
                @update:model-value="
                  (v: boolean | string | number) => setCookieSecure(index, v === true)
                "
              />
              <span v-if="cookieHasSecret(cookie.value)" class="text-text-secondary text-xs">
                {{ t("synthetics.secretFields.cookieSecureAlways") }}
              </span>
            </div>
          </div>
        </div>
      </template>
      <!-- Custom headers -->
      <template v-if="false">
        <OSeparator />

        <div class="flex flex-col gap-3">
          <h4 class="text-text-body text-sm font-medium">
            {{ t("synthetics.authNetwork.customHeaders") }}
          </h4>
          <ul v-if="headers.length" class="flex flex-col gap-2">
            <li
              v-for="(header, index) in headers"
              :key="header.id ?? index"
              class="flex items-center gap-2"
            >
              <OInput
                :model-value="header.key"
                :placeholder="t('synthetics.authNetwork.headerKeyPlaceholder')"
                :data-test="`synthetics-check-auth-network-header-key-${index}-input`"
                class="flex-1"
                @update:model-value="updateHeader(index, 'key', String($event))"
              />
              <span class="text-text-muted shrink-0">:</span>
              <OInput
                :model-value="header.value"
                :placeholder="t('synthetics.authNetwork.headerValuePlaceholder')"
                :data-test="`synthetics-check-auth-network-header-value-${index}-input`"
                class="flex-1"
                @update:model-value="updateHeader(index, 'value', String($event))"
              />
              <OButton
                variant="ghost"
                size="icon-sm"
                icon-left="close"
                :aria-label="t('synthetics.authNetwork.removeHeader', { index })"
                :data-test="`synthetics-check-auth-network-remove-header-${index}-btn`"
                @click="removeHeader(index)"
              />
            </li>
          </ul>
          <OButton
            variant="ghost"
            size="sm"
            icon-left="add"
            class="self-start"
            data-test="synthetics-check-auth-network-add-header-btn"
            @click="addHeader"
          >
            {{ t("synthetics.authNetwork.addHeader") }}
          </OButton>
        </div>

        <!-- Pre-set cookies -->
        <OSeparator />

        <div class="flex flex-col gap-3">
          <h4 class="text-text-body text-sm font-medium">
            {{ t("synthetics.authNetwork.preSetCookies") }}
          </h4>
          <ul v-if="cookies.length" class="flex flex-col gap-2">
            <li
              v-for="(cookie, index) in cookies"
              :key="cookie.id ?? index"
              class="flex items-center gap-2"
            >
              <OInput
                :model-value="cookie.name"
                :placeholder="t('synthetics.authNetwork.cookieNamePlaceholder')"
                :data-test="`synthetics-check-auth-network-cookie-name-${index}-input`"
                class="flex-1"
                @update:model-value="updateCookie(index, 'name', String($event))"
              />
              <OInput
                :model-value="cookie.value"
                :placeholder="t('synthetics.authNetwork.cookieValuePlaceholder')"
                :data-test="`synthetics-check-auth-network-cookie-value-${index}-input`"
                class="flex-1"
                @update:model-value="updateCookie(index, 'value', String($event))"
              />
              <OInput
                :model-value="cookie.domain"
                :placeholder="t('synthetics.authNetwork.cookieDomainPlaceholder')"
                :data-test="`synthetics-check-auth-network-cookie-domain-${index}-input`"
                class="flex-1"
                @update:model-value="updateCookie(index, 'domain', String($event))"
              />
              <OButton
                variant="ghost"
                size="icon-sm"
                icon-left="close"
                :aria-label="t('synthetics.authNetwork.removeCookie', { index })"
                :data-test="`synthetics-check-auth-network-remove-cookie-${index}-btn`"
                @click="removeCookie(index)"
              />
            </li>
          </ul>
          <OButton
            variant="ghost"
            size="sm"
            icon-left="add"
            class="self-start"
            data-test="synthetics-check-auth-network-add-cookie-btn"
            @click="addCookie"
          >
            {{ t("synthetics.authNetwork.addCookie") }}
          </OButton>
        </div>
      </template>
    </div>
  </div>
</template>
