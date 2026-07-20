<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BrowserCheck } from '@/types/synthetics'
import OInput from '@/lib/forms/Input/OInput.vue'
import OSwitch from '@/lib/forms/Switch/OSwitch.vue'
import OButton from '@/lib/core/Button/OButton.vue'
import OBadge from '@/lib/core/Badge/OBadge.vue'
import OIcon from '@/lib/core/Icon/OIcon.vue'
import OSeparator from '@/lib/core/Separator/OSeparator.vue'
import OTooltip from '@/lib/overlay/Tooltip/OTooltip.vue'
import { getUUID } from '@/utils/uuid'

const props = defineProps<{ check: BrowserCheck }>()
const emit = defineEmits<{ 'update:check': [value: BrowserCheck] }>()

const { t } = useI18n()

// ── Header summary ─────────────────────────────────────────────────────────────

const summary = computed(() => {
  const parts: string[] = []
  const pluralize = (n: number, w: string) => `${n} ${w}${n > 1 ? 's' : ''}`
  if (variables.value.length) parts.push(pluralize(variables.value.length, 'variable'))
  if (headers.value.length) parts.push(pluralize(headers.value.length, 'header'))
  return parts.join(' · ')
})

// ── Auth ─────────────────────────────────────────────────────────────────────

const authEnabled = computed({
  get: () => !!props.check.auth,
  set: (v: boolean) =>
    emit('update:check', {
      ...props.check,
      auth: v ? { type: 'basic' as const, username: '', password: '' } : undefined,
    }),
})

const authUsername = computed({
  get: () => props.check.auth?.username ?? '',
  set: (v: string) =>
    emit('update:check', {
      ...props.check,
      auth: props.check.auth
        ? { ...props.check.auth, username: v }
        : { type: 'basic' as const, username: v, password: '' },
    }),
})

const authPassword = computed({
  get: () => props.check.auth?.password ?? '',
  set: (v: string) =>
    emit('update:check', {
      ...props.check,
      auth: props.check.auth
        ? { ...props.check.auth, password: v }
        : { type: 'basic' as const, username: '', password: v },
    }),
})

// ── Variables ────────────────────────────────────────────────────────────────

const variables = computed(() => props.check.variables ?? [])

function updateVariable(index: number, field: 'name' | 'value' | 'secure' | 'example', val: string | boolean) {
  const updated = variables.value.map((item, i) =>
    i === index ? { ...item, [field]: val } : item,
  )
  emit('update:check', { ...props.check, variables: updated })
}

function addVariable() {
  emit('update:check', {
    ...props.check,
    variables: [...variables.value, { id: getUUID(), name: '', value: '', secure: false, example: '' }],
  })
}

function removeVariable(index: number) {
  emit('update:check', {
    ...props.check,
    variables: variables.value.filter((_, i) => i !== index),
  })
}

// ── Headers ───────────────────────────────────────────────────────────────────

const headers = computed(() => props.check.headers ?? [])

function updateHeader(index: number, field: 'key' | 'value', val: string) {
  const updated = headers.value.map((item, i) =>
    i === index ? { ...item, [field]: val } : item,
  )
  emit('update:check', { ...props.check, headers: updated })
}

function addHeader() {
  emit('update:check', {
    ...props.check,
    headers: [...headers.value, { id: crypto.randomUUID(), key: '', value: '' }],
  })
}

function removeHeader(index: number) {
  emit('update:check', {
    ...props.check,
    headers: headers.value.filter((_, i) => i !== index),
  })
}

// ── Cookies ───────────────────────────────────────────────────────────────────

const cookies = computed(() => props.check.cookies ?? [])

function updateCookie(index: number, field: 'name' | 'value' | 'domain', val: string) {
  const updated = cookies.value.map((item, i) =>
    i === index ? { ...item, [field]: val } : item,
  )
  emit('update:check', { ...props.check, cookies: updated })
}

function addCookie() {
  emit('update:check', {
    ...props.check,
    cookies: [...cookies.value, { id: crypto.randomUUID(), name: '', value: '', domain: '' }],
  })
}

function removeCookie(index: number) {
  emit('update:check', {
    ...props.check,
    cookies: cookies.value.filter((_, i) => i !== index),
  })
}
</script>

<template>
  <div class="rounded-lg border border-border-default mb-4">
    <div class="flex items-center border-b border-border-default py-[0.625rem] px-3">
      <div class="w-[0.1875rem] h-4 rounded-sm mr-2 shrink-0 bg-primary-600" />
      <h3 class="text-base font-semibold text-text-heading">
        {{ t('synthetics.authNetwork.title') }}
      </h3>
      <OBadge variant="default-soft" size="sm" class="ml-2">{{ t('synthetics.authNetwork.optional') }}</OBadge>
      <div class="flex-1" />
      <span v-if="summary" class="text-xs text-text-muted">{{ summary }}</span>
    </div>
    <div class="px-3 py-2 flex flex-col gap-4">

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
            <label class="text-sm font-medium text-text-body mb-1 block">
              {{ t('synthetics.authNetwork.password') }}
              <OBadge variant="default-soft" size="sm" class="ml-1">{{ t('synthetics.authNetwork.secret') }}</OBadge>
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

      <!-- Variables -->
      <OSeparator />

      <div class="flex flex-col gap-3">
        <h4 class="text-sm font-medium text-text-body">{{ t('synthetics.authNetwork.variables') }}</h4>

        <ul v-if="variables.length" class="flex flex-col gap-2">
          <li
            v-for="(variable, index) in variables"
            :key="variable.id ?? index"
            class="flex flex-col gap-2"
          >
            <div class="flex items-center gap-2">
              <OInput
                :model-value="variable.name"
                :placeholder="t('synthetics.authNetwork.variableNamePlaceholder')"
                :data-test="`synthetics-check-auth-network-variable-name-${index}-input`"
                class="flex-1"
                @update:model-value="updateVariable(index, 'name', String($event))"
              />
              <span class="text-text-muted shrink-0">=</span>
              <OInput
                :model-value="variable.value"
                :type="variable.secure ? 'password' : 'text'"
                :placeholder="variable.secure && !variable.value ? variable.example || t('synthetics.authNetwork.passwordPlaceholder') : t('synthetics.authNetwork.variableValuePlaceholder')"
                :data-test="`synthetics-check-auth-network-variable-value-${index}-input`"
                class="flex-1"
                @update:model-value="updateVariable(index, 'value', String($event))"
              />

              <OButton
                :data-test="`synthetics-check-auth-network-variable-secure-${index}-switch`"
                size="sm"
                variant="outline"
                class="gap-1.5"
                @click="updateVariable(index, 'secure', !variable.secure)"
              >
                <OSwitch
                  v-model="variable.secure"
                  size="md"
                />
                <OIcon name="lock" size="sm" />
                <OTooltip
                  :content="variable.secure ? t('synthetics.authNetwork.variableSecureTooltipShow') : t('synthetics.authNetwork.variableSecureTooltipHide')"
                  side="top"
                />
              </OButton>

              <OButton
                icon-only
                icon-left="close"
                variant="ghost"
                size="sm"
                :aria-label="t('synthetics.authNetwork.removeVariable', { index })"
                :data-test="`synthetics-check-auth-network-remove-variable-${index}-btn`"
                @click="removeVariable(index)"
              />
            </div>
          </li>
        </ul>
        <OButton
          variant="outline"
          size="sm"
          icon-left="add"
          class="self-start"
          data-test="synthetics-check-auth-network-add-variable-btn"
          @click="addVariable"
        >
          {{ t('synthetics.authNetwork.addVariable') }}
        </OButton>
      </div>

      <!-- Custom headers -->
      <template v-if="false">
        <OSeparator />

        <div class="flex flex-col gap-3">
          <h4 class="text-sm font-medium text-text-body">{{ t('synthetics.authNetwork.customHeaders') }}</h4>
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
            {{ t('synthetics.authNetwork.addHeader') }}
          </OButton>
        </div>

        <!-- Pre-set cookies -->
        <OSeparator />

        <div class="flex flex-col gap-3">
          <h4 class="text-sm font-medium text-text-body">{{ t('synthetics.authNetwork.preSetCookies') }}</h4>
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
            {{ t('synthetics.authNetwork.addCookie') }}
          </OButton>
        </div>
      </template>

    </div>
  </div>
</template>
