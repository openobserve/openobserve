<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed } from 'vue'
import type { BrowserCheck } from '@/types/synthetics'
import OInput from '@/lib/forms/Input/OInput.vue'
import OSwitch from '@/lib/forms/Switch/OSwitch.vue'
import OButton from '@/lib/core/Button/OButton.vue'
import OBadge from '@/lib/core/Badge/OBadge.vue'
import OIcon from '@/lib/core/Icon/OIcon.vue'
import OCollapsible from '@/lib/core/Collapsible/OCollapsible.vue'
import OSeparator from '@/lib/core/Separator/OSeparator.vue'

const props = defineProps<{ check: BrowserCheck }>()
const emit = defineEmits<{ 'update:check': [value: BrowserCheck] }>()

// ── Header summary ─────────────────────────────────────────────────────────────

const summary = computed(() => {
  const parts: string[] = []
  const pluralize = (n: number, w: string) => `${n} ${w}${n > 1 ? 's' : ''}`
  // Variables, secrets and cookies are disabled for now.
  if (headers.value.length) parts.push(pluralize(headers.value.length, 'header'))
  return parts.join(' · ')
})

// ── Auth ─────────────────────────────────────────────────────────────────────

const basicAuthEnabled = computed({
  get: () => props.check.auth?.basicAuth?.enabled ?? false,
  set: (v: boolean) =>
    emit('update:check', {
      ...props.check,
      auth: {
        ...props.check.auth,
        basicAuth: {
          enabled: v,
          username: props.check.auth?.basicAuth?.username ?? '',
          passwordSecretRef: props.check.auth?.basicAuth?.passwordSecretRef ?? '',
        },
      },
    }),
})

const basicAuthUsername = computed({
  get: () => props.check.auth?.basicAuth?.username ?? '',
  set: (v: string) =>
    emit('update:check', {
      ...props.check,
      auth: {
        ...props.check.auth,
        basicAuth: {
          enabled: props.check.auth?.basicAuth?.enabled ?? false,
          username: v,
          passwordSecretRef: props.check.auth?.basicAuth?.passwordSecretRef ?? '',
        },
      },
    }),
})

const basicAuthPassword = computed({
  get: () => props.check.auth?.basicAuth?.passwordSecretRef ?? '',
  set: (v: string) =>
    emit('update:check', {
      ...props.check,
      auth: {
        ...props.check.auth,
        basicAuth: {
          enabled: props.check.auth?.basicAuth?.enabled ?? false,
          username: props.check.auth?.basicAuth?.username ?? '',
          passwordSecretRef: v,
        },
      },
    }),
})

// ── Variables (disabled for now) ────────────────────────────────────────────────

const variables = computed(() => props.check.variables ?? [])

function updateVariable(index: number, field: 'name' | 'value', val: string) {
  const updated = variables.value.map((item, i) =>
    i === index ? { ...item, [field]: val } : item,
  )
  emit('update:check', { ...props.check, variables: updated })
}

function addVariable() {
  emit('update:check', {
    ...props.check,
    variables: [...variables.value, { id: crypto.randomUUID(), name: '', value: '' }],
  })
}

function removeVariable(index: number) {
  emit('update:check', {
    ...props.check,
    variables: variables.value.filter((_, i) => i !== index),
  })
}

// ── Secrets (disabled for now) ──────────────────────────────────────────────────

const secrets = computed(() => props.check.secrets ?? [])

function updateSecret(index: number, field: 'name' | 'value', val: string) {
  const updated = secrets.value.map((item, i) =>
    i === index ? { ...item, [field]: val } : item,
  )
  emit('update:check', { ...props.check, secrets: updated })
}

function addSecret() {
  emit('update:check', {
    ...props.check,
    secrets: [...secrets.value, { id: crypto.randomUUID(), name: '', value: '' }],
  })
}

function removeSecret(index: number) {
  emit('update:check', {
    ...props.check,
    secrets: secrets.value.filter((_, i) => i !== index),
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
  <div class="tw:rounded-lg tw:border tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-card-bg)] tw:p-0">
    <OCollapsible
      :default-open="true"
      data-test="synthetics-check-auth-network-collapsible"
    >
      <!-- Rich header -->
      <template #trigger="{ open }">
        <div class="tw:flex tw:items-center tw:gap-3 tw:w-full">
          <OIcon name="lock" size="xs" class="tw:text-[var(--o2-text-heading)] tw:shrink-0" />
          <div class="tw:flex tw:flex-col tw:min-w-0">
            <div class="tw:flex tw:items-center tw:gap-2">
              <h4 class="tw:text-xs! tw:font-normal">Authentication &amp; network</h4>
              <OBadge variant="default-soft" size="sm">Optional</OBadge>
            </div>
          </div>
          <div class="tw:flex tw:items-center tw:gap-2 tw:ml-auto tw:shrink-0">
            <span v-if="summary" class="tw:text-xs! tw:text-[var(--o2-text-muted)]">{{ summary }}</span>
            <OIcon
              name="expand-more"
              size="md"
              class="tw:text-[var(--o2-text-muted)] tw:transition-transform tw:duration-200"
              :class="open ? 'tw:rotate-180' : 'tw:rotate-0'"
            />
          </div>
        </div>
      </template>
      <OSeparator></OSeparator>

      <div class="tw:flex tw:flex-col tw:gap-6 tw:py-3 tw:px-3">
        <!-- HTTP Basic auth -->
        <div class="tw:flex tw:flex-col tw:gap-3">
          <OSwitch
            v-model="basicAuthEnabled"
            label="HTTP Basic auth"
            data-test="synthetics-check-auth-network-basic-auth-switch"
          />
          <template v-if="check.auth?.basicAuth?.enabled">
            <OInput
              v-model="basicAuthUsername"
              label="Username"
              placeholder="username"
              data-test="synthetics-check-auth-network-username-input"
            />
            <div>
              <label class="tw:text-sm tw:font-medium tw:text-[var(--o2-text-label)] tw:mb-1 tw:block">
                Password
                <OBadge variant="default-soft" size="sm" class="tw:ml-1">secret</OBadge>
              </label>
              <OInput
                v-model="basicAuthPassword"
                type="password"
                placeholder="••••••••"
                data-test="synthetics-check-auth-network-password-input"
              />
            </div>
          </template>
        </div>
        
        <!-- Variables & secrets — disabled for now -->
        <template v-if="false">
        <OSeparator></OSeparator>

        <div class="tw:flex tw:flex-col tw:gap-3">
          <div class="tw:flex tw:items-center tw:gap-2">
            <h5 class="tw:text-sm tw:font-semibold tw:text-[var(--o2-text-heading)]">Variables &amp; secrets</h5>
            <OBadge variant="warning-soft" size="sm" icon="key">masked</OBadge>
          </div>

          <!-- Variables -->
          <ul v-if="variables.length" class="tw:flex tw:flex-col tw:gap-2">
            <li
              v-for="(variable, index) in variables"
              :key="variable.id ?? index"
              class="tw:flex tw:items-center tw:gap-2"
            >
              <OInput
                :model-value="variable.name"
                placeholder="Name"
                :data-test="`synthetics-check-auth-network-variable-name-${index}-input`"
                class="tw:flex-1"
                @update:model-value="updateVariable(index, 'name', String($event))"
              />
              <span class="tw:text-[var(--o2-text-muted)] tw:shrink-0">=</span>
              <OInput
                :model-value="variable.value"
                placeholder="Value"
                :data-test="`synthetics-check-auth-network-variable-value-${index}-input`"
                class="tw:flex-1"
                @update:model-value="updateVariable(index, 'value', String($event))"
              />
              <button
                type="button"
                :aria-label="`Remove variable ${index}`"
                :data-test="`synthetics-check-auth-network-remove-variable-${index}-btn`"
                class="tw:flex tw:items-center tw:text-[var(--o2-text-muted)] tw:hover:text-[var(--o2-text-body)] tw:transition-colors tw:shrink-0"
                @click="removeVariable(index)"
              >
                <OIcon name="delete-outline" size="sm" class="tw:text-[var(--o2-text-muted)]" />
              </button>
            </li>
          </ul>
          <OButton
            variant="ghost"
            size="sm"
            icon-left="add"
            class="tw:self-start"
            data-test="synthetics-check-auth-network-add-variable-btn"
            @click="addVariable"
          >
            Add variable
          </OButton>

          <!-- Secrets -->
          <ul v-if="secrets.length" class="tw:flex tw:flex-col tw:gap-2">
            <li
              v-for="(secret, index) in secrets"
              :key="secret.id ?? index"
              class="tw:flex tw:items-center tw:gap-2"
            >
              <OInput
                :model-value="secret.name"
                placeholder="Name"
                :data-test="`synthetics-check-auth-network-secret-name-${index}-input`"
                class="tw:flex-1"
                @update:model-value="updateSecret(index, 'name', String($event))"
              />
              <span class="tw:text-[var(--o2-text-muted)] tw:shrink-0">=</span>
              <OInput
                :model-value="secret.value"
                type="password"
                placeholder="••••••••"
                :data-test="`synthetics-check-auth-network-secret-value-${index}-input`"
                class="tw:flex-1"
                @update:model-value="updateSecret(index, 'value', String($event))"
              />
              <button
                type="button"
                :aria-label="`Remove secret ${index}`"
                :data-test="`synthetics-check-auth-network-remove-secret-${index}-btn`"
                class="tw:flex tw:items-center tw:text-[var(--o2-text-muted)] tw:hover:text-[var(--o2-text-body)] tw:transition-colors tw:shrink-0"
                @click="removeSecret(index)"
              >
                <OIcon name="delete-outline" size="sm" class="tw:text-[var(--o2-text-muted)]" />
              </button>
            </li>
          </ul>
          <OButton
            variant="ghost"
            size="sm"
            icon-left="add"
            class="tw:self-start"
            data-test="synthetics-check-auth-network-add-secret-btn"
            @click="addSecret"
          >
            Add secret
          </OButton>
        </div>
        </template>

        <!-- Custom headers -->
        <div v-if="false" class="tw:flex tw:flex-col tw:gap-3">
          <h5 class="tw:text-sm tw:font-semibold tw:text-[var(--o2-text-heading)]">Custom headers</h5>
          <ul v-if="headers.length" class="tw:flex tw:flex-col tw:gap-2">
            <li
              v-for="(header, index) in headers"
              :key="header.id ?? index"
              class="tw:flex tw:items-center tw:gap-2"
            >
              <OInput
                :model-value="header.key"
                placeholder="Header key"
                :data-test="`synthetics-check-auth-network-header-key-${index}-input`"
                class="tw:flex-1"
                @update:model-value="updateHeader(index, 'key', String($event))"
              />
              <span class="tw:text-[var(--o2-text-muted)] tw:shrink-0">:</span>
              <OInput
                :model-value="header.value"
                placeholder="Header value"
                :data-test="`synthetics-check-auth-network-header-value-${index}-input`"
                class="tw:flex-1"
                @update:model-value="updateHeader(index, 'value', String($event))"
              />
              <button
                type="button"
                :aria-label="`Remove header ${index}`"
                :data-test="`synthetics-check-auth-network-remove-header-${index}-btn`"
                class="tw:flex tw:items-center tw:text-[var(--o2-text-muted)] tw:hover:text-[var(--o2-text-body)] tw:transition-colors tw:shrink-0"
                @click="removeHeader(index)"
              >
                <OIcon name="delete-outline" size="sm" class="tw:text-[var(--o2-text-muted)]" />
              </button>
            </li>
          </ul>
          <OButton
            variant="ghost"
            size="sm"
            icon-left="add"
            class="tw:self-start"
            data-test="synthetics-check-auth-network-add-header-btn"
            @click="addHeader"
          >
            Add header
          </OButton>
        </div>

        <!-- Pre-set cookies — disabled for now -->
        <template v-if="false">
        <OSeparator></OSeparator>

        <div class="tw:flex tw:flex-col tw:gap-3">
          <h5 class="tw:text-sm tw:font-semibold tw:text-[var(--o2-text-heading)]">Pre-set cookies</h5>
          <ul v-if="cookies.length" class="tw:flex tw:flex-col tw:gap-2">
            <li
              v-for="(cookie, index) in cookies"
              :key="cookie.id ?? index"
              class="tw:flex tw:items-center tw:gap-2"
            >
              <OInput
                :model-value="cookie.name"
                placeholder="Name"
                :data-test="`synthetics-check-auth-network-cookie-name-${index}-input`"
                class="tw:flex-1"
                @update:model-value="updateCookie(index, 'name', String($event))"
              />
              <OInput
                :model-value="cookie.value"
                placeholder="Value"
                :data-test="`synthetics-check-auth-network-cookie-value-${index}-input`"
                class="tw:flex-1"
                @update:model-value="updateCookie(index, 'value', String($event))"
              />
              <OInput
                :model-value="cookie.domain"
                placeholder="Domain"
                :data-test="`synthetics-check-auth-network-cookie-domain-${index}-input`"
                class="tw:flex-1"
                @update:model-value="updateCookie(index, 'domain', String($event))"
              />
              <button
                type="button"
                :aria-label="`Remove cookie ${index}`"
                :data-test="`synthetics-check-auth-network-remove-cookie-${index}-btn`"
                class="tw:flex tw:items-center tw:text-[var(--o2-text-muted)] tw:hover:text-[var(--o2-text-body)] tw:transition-colors tw:shrink-0"
                @click="removeCookie(index)"
              >
                <OIcon name="delete-outline" size="sm" class="tw:text-[var(--o2-text-muted)]" />
              </button>
            </li>
          </ul>
          <OButton
            variant="ghost"
            size="sm"
            icon-left="add"
            class="tw:self-start"
            data-test="synthetics-check-auth-network-add-cookie-btn"
            @click="addCookie"
          >
            Add cookie
          </OButton>
        </div>
        </template>

      </div>
    </OCollapsible>
  </div>
</template>
