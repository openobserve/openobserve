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

const props = defineProps<{ check: BrowserCheck }>()
const emit = defineEmits<{ 'update:check': [value: BrowserCheck] }>()

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

// ── Variables ─────────────────────────────────────────────────────────────────

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

// ── Secrets ───────────────────────────────────────────────────────────────────

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
  <div class="tw:rounded-lg tw:border tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-card-bg)] tw:p-6 tw:mb-4">
    <h3 class="tw:text-base tw:font-semibold tw:text-[var(--o2-text-heading)] tw:mb-4">Auth &amp; Network</h3>
    <div class="tw:flex tw:flex-col tw:gap-3">

      <!-- Authentication -->
      <OCollapsible
        title="Authentication"
        data-test="synthetics-check-auth-network-auth-collapsible"
      >
        <div class="tw:flex tw:flex-col tw:gap-3 tw:pt-3">
          <OSwitch
            v-model="basicAuthEnabled"
            label="HTTP Basic Auth"
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
                <OBadge variant="default" size="sm" class="tw:ml-1">secret</OBadge>
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
      </OCollapsible>

      <!-- Variables & Secrets -->
      <OCollapsible
        title="Variables &amp; Secrets"
        data-test="synthetics-check-auth-network-variables-collapsible"
      >
        <div class="tw:flex tw:flex-col tw:gap-4 tw:pt-3">
          <!-- Variables -->
          <div>
            <label class="tw:text-sm tw:font-medium tw:text-[var(--o2-text-label)] tw:mb-2 tw:block">Variables</label>
            <ul class="tw:flex tw:flex-col tw:gap-2">
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
                  <OIcon name="close" size="sm" />
                </button>
              </li>
            </ul>
            <OButton
              variant="outline"
              size="sm"
              class="tw:mt-2"
              data-test="synthetics-check-auth-network-add-variable-btn"
              @click="addVariable"
            >
              Add variable
            </OButton>
          </div>

          <!-- Secrets -->
          <div>
            <label class="tw:text-sm tw:font-medium tw:text-[var(--o2-text-label)] tw:mb-2 tw:block">Secrets</label>
            <ul class="tw:flex tw:flex-col tw:gap-2">
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
                <div class="tw:relative tw:flex-1 tw:flex tw:items-center tw:gap-1">
                  <OInput
                    :model-value="secret.value"
                    type="password"
                    placeholder="••••••••"
                    :data-test="`synthetics-check-auth-network-secret-value-${index}-input`"
                    class="tw:flex-1"
                    @update:model-value="updateSecret(index, 'value', String($event))"
                  />
                  <OIcon name="lock" size="sm" class="tw:text-[var(--o2-text-muted)] tw:shrink-0" />
                  <OBadge variant="default" size="sm">masked</OBadge>
                </div>
                <button
                  type="button"
                  :aria-label="`Remove secret ${index}`"
                  :data-test="`synthetics-check-auth-network-remove-secret-${index}-btn`"
                  class="tw:flex tw:items-center tw:text-[var(--o2-text-muted)] tw:hover:text-[var(--o2-text-body)] tw:transition-colors tw:shrink-0"
                  @click="removeSecret(index)"
                >
                  <OIcon name="close" size="sm" />
                </button>
              </li>
            </ul>
            <OButton
              variant="outline"
              size="sm"
              class="tw:mt-2"
              data-test="synthetics-check-auth-network-add-secret-btn"
              @click="addSecret"
            >
              Add secret
            </OButton>
          </div>
        </div>
      </OCollapsible>

      <!-- Custom HTTP Headers -->
      <OCollapsible
        title="Custom HTTP headers"
        data-test="synthetics-check-auth-network-headers-collapsible"
      >
        <div class="tw:flex tw:flex-col tw:gap-2 tw:pt-3">
          <ul class="tw:flex tw:flex-col tw:gap-2">
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
                <OIcon name="close" size="sm" />
              </button>
            </li>
          </ul>
          <OButton
            variant="outline"
            size="sm"
            data-test="synthetics-check-auth-network-add-header-btn"
            @click="addHeader"
          >
            Add header
          </OButton>
        </div>
      </OCollapsible>

      <!-- Pre-set Cookies -->
      <OCollapsible
        title="Pre-set cookies"
        data-test="synthetics-check-auth-network-cookies-collapsible"
      >
        <div class="tw:flex tw:flex-col tw:gap-2 tw:pt-3">
          <ul class="tw:flex tw:flex-col tw:gap-2">
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
                <OIcon name="close" size="sm" />
              </button>
            </li>
          </ul>
          <OButton
            variant="outline"
            size="sm"
            data-test="synthetics-check-auth-network-add-cookie-btn"
            @click="addCookie"
          >
            Add cookie
          </OButton>
        </div>
      </OCollapsible>

    </div>
  </div>
</template>
