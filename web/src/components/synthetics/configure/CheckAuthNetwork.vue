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
import { useI18nTyped } from "@/types/i18n";
import type { BrowserCheck } from "@/types/synthetics";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";

const props = defineProps<{ check: BrowserCheck }>();
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
            <OInput
              v-model="authPassword"
              type="password"
              :placeholder="t('synthetics.authNetwork.passwordPlaceholder')"
              data-test="synthetics-check-auth-network-password-input"
            />
          </div>
        </template>
      </div>

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
