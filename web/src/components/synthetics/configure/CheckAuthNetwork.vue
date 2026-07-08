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
import OTooltip from '@/lib/overlay/Tooltip/OTooltip.vue'
import { getUUID } from '@/utils/uuid'

const props = defineProps<{ check: BrowserCheck }>()
const emit = defineEmits<{ 'update:check': [value: BrowserCheck] }>()

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
  <div class="rounded-lg border border-[var(--o2-border-color)] bg-[var(--o2-card-bg)] p-0">
    <OCollapsible
      :default-open="true"
      data-test="synthetics-check-auth-network-collapsible"
    >
      <!-- Rich header -->
      <template #trigger="{ open }">
        <div class="flex items-center gap-3 w-full">
          <OIcon name="lock" size="xs" class="text-[var(--o2-text-heading)] shrink-0" />
          <div class="flex flex-col min-w-0">
            <div class="flex items-center gap-2">
              <h4 class="text-xs! font-normal">Authentication &amp; network</h4>
              <OBadge variant="default-soft" size="sm">Optional</OBadge>
            </div>
          </div>
          <div class="flex items-center gap-2 ml-auto shrink-0">
            <span v-if="summary" class="text-xs! text-[var(--o2-text-muted)]">{{ summary }}</span>
            <OIcon
              name="expand-more"
              size="md"
              class="text-[var(--o2-text-muted)] transition-transform duration-200"
              :class="open ? 'rotate-180' : 'rotate-0'"
            />
          </div>
        </div>
      </template>
      <OSeparator></OSeparator>

      <div class="flex flex-col gap-6 py-3 px-3">
        <!-- HTTP Basic auth -->
        <div class="flex flex-col gap-3">
          <OSwitch
            v-model="authEnabled"
            label="HTTP Basic auth"
            data-test="synthetics-check-auth-network-basic-auth-switch"
          />
          <template v-if="check.auth">
            <OInput
              v-model="authUsername"
              label="Username"
              placeholder="username"
              data-test="synthetics-check-auth-network-username-input"
            />
            <div>
              <label class="text-sm font-medium text-[var(--o2-text-label)] mb-1 block">
                Password
                <OBadge variant="default-soft" size="sm" class="ml-1">secret</OBadge>
              </label>
              <OInput
                v-model="authPassword"
                type="password"
                placeholder="••••••••"
                data-test="synthetics-check-auth-network-password-input"
              />
            </div>
          </template>
        </div>
        
        <!-- Variables -->
        <OSeparator></OSeparator>

        <div class="flex flex-col gap-3">
          <div class="flex items-center gap-2">
            <h5 class="text-sm font-semibold text-[var(--o2-text-heading)]">Variables</h5>
          </div>

          <!-- Variables -->
          <ul v-if="variables.length" class="flex flex-col gap-2">
            <li
              v-for="(variable, index) in variables"
              :key="variable.id ?? index"
              class="flex flex-col gap-2"
            >
              <!-- Main row: name = value [secure toggle] [remove] -->
              <div class="flex items-center gap-2">
                <OInput
                  :model-value="variable.name"
                  placeholder="Name"
                  :data-test="`synthetics-check-auth-network-variable-name-${index}-input`"
                  class="flex-1"
                  @update:model-value="updateVariable(index, 'name', String($event))"
                />
                <span class="text-[var(--o2-text-muted)] shrink-0">=</span>
                <OInput
                  :model-value="variable.value"
                  :type="variable.secure ? 'password' : 'text'"
                  :placeholder="variable.secure && !variable.value ? variable.example || '••••••••' : 'Value'"
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
                    :content="variable.secure ? 'Value is masked. Click to show.' : 'Mask this value as sensitive data.'"
                    side="top"
                  />
                </OButton>
 
                <OButton
                  icon-only
                  icon-left="delete"
                  variant="ghost"
                  size="sm"
                  :aria-label="`Remove variable ${index}`"
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
            Add variable
          </OButton>

        </div>

        <!-- Custom headers -->
        <div v-if="false" class="flex flex-col gap-3">
          <h5 class="text-sm font-semibold text-[var(--o2-text-heading)]">Custom headers</h5>
          <ul v-if="headers.length" class="flex flex-col gap-2">
            <li
              v-for="(header, index) in headers"
              :key="header.id ?? index"
              class="flex items-center gap-2"
            >
              <OInput
                :model-value="header.key"
                placeholder="Header key"
                :data-test="`synthetics-check-auth-network-header-key-${index}-input`"
                class="flex-1"
                @update:model-value="updateHeader(index, 'key', String($event))"
              />
              <span class="text-[var(--o2-text-muted)] shrink-0">:</span>
              <OInput
                :model-value="header.value"
                placeholder="Header value"
                :data-test="`synthetics-check-auth-network-header-value-${index}-input`"
                class="flex-1"
                @update:model-value="updateHeader(index, 'value', String($event))"
              />
              <button
                type="button"
                :aria-label="`Remove header ${index}`"
                :data-test="`synthetics-check-auth-network-remove-header-${index}-btn`"
                class="flex items-center text-[var(--o2-text-muted)] hover:text-[var(--o2-text-body)] transition-colors shrink-0"
                @click="removeHeader(index)"
              >
                <OIcon name="delete-outline" size="sm" class="text-[var(--o2-text-muted)]" />
              </button>
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
            Add header
          </OButton>
        </div>

        <!-- Pre-set cookies — disabled for now -->
        <template v-if="false">
        <OSeparator></OSeparator>

        <div class="flex flex-col gap-3">
          <h5 class="text-sm font-semibold text-[var(--o2-text-heading)]">Pre-set cookies</h5>
          <ul v-if="cookies.length" class="flex flex-col gap-2">
            <li
              v-for="(cookie, index) in cookies"
              :key="cookie.id ?? index"
              class="flex items-center gap-2"
            >
              <OInput
                :model-value="cookie.name"
                placeholder="Name"
                :data-test="`synthetics-check-auth-network-cookie-name-${index}-input`"
                class="flex-1"
                @update:model-value="updateCookie(index, 'name', String($event))"
              />
              <OInput
                :model-value="cookie.value"
                placeholder="Value"
                :data-test="`synthetics-check-auth-network-cookie-value-${index}-input`"
                class="flex-1"
                @update:model-value="updateCookie(index, 'value', String($event))"
              />
              <OInput
                :model-value="cookie.domain"
                placeholder="Domain"
                :data-test="`synthetics-check-auth-network-cookie-domain-${index}-input`"
                class="flex-1"
                @update:model-value="updateCookie(index, 'domain', String($event))"
              />
              <button
                type="button"
                :aria-label="`Remove cookie ${index}`"
                :data-test="`synthetics-check-auth-network-remove-cookie-${index}-btn`"
                class="flex items-center text-[var(--o2-text-muted)] hover:text-[var(--o2-text-body)] transition-colors shrink-0"
                @click="removeCookie(index)"
              >
                <OIcon name="delete-outline" size="sm" class="text-[var(--o2-text-muted)]" />
              </button>
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
            Add cookie
          </OButton>
        </div>
        </template>

      </div>
    </OCollapsible>
  </div>
</template>
