<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed, ref } from 'vue'
import type { BrowserCheck, SyntheticsFolder } from '@/types/synthetics'
import OInput from '@/lib/forms/Input/OInput.vue'
import OSelect from '@/lib/forms/Select/OSelect.vue'
import OSwitch from '@/lib/forms/Switch/OSwitch.vue'
import OButton from '@/lib/core/Button/OButton.vue'
import OIcon from '@/lib/core/Icon/OIcon.vue'
import CheckAuthNetwork from './CheckAuthNetwork.vue'

const props = defineProps<{ check: BrowserCheck; folders?: SyntheticsFolder[] }>()
const emit = defineEmits<{ 'update:check': [value: BrowserCheck] }>()

function update(patch: Partial<BrowserCheck>) {
  emit('update:check', { ...props.check, ...patch })
}

const name = computed({
  get: () => props.check.name,
  set: (v: string) => update({ name: v }),
})

const folder = computed({
  get: () => props.check.folder ?? '',
  set: (v: string | number | boolean | null | undefined) => update({ folder: v != null ? String(v) : undefined }),
})

const enabled = computed({
  get: () => props.check.enabled,
  set: (v: boolean) => update({ enabled: v }),
})

const url = computed({
  get: () => props.check.url,
  set: (v: string) => update({ url: v }),
})

const description = computed({
  get: () => props.check.description ?? '',
  set: (v: string) => update({ description: v }),
})

const tagInput = ref('')

const folderOptions = computed(() => {
  const opts = (props.folders ?? []).map((f) => ({ label: f.name, value: f.folderId }))
  // Defensive fallback so the bound value always has a matching option.
  return opts.length ? opts : [{ label: 'Default', value: 'default' }]
})

function addTag() {
  const tag = tagInput.value.trim()
  if (!tag) return
  if (props.check.tags.includes(tag)) {
    tagInput.value = ''
    return
  }
  update({ tags: [...props.check.tags, tag] })
  tagInput.value = ''
}

function removeTag(index: number) {
  const tags = [...props.check.tags]
  tags.splice(index, 1)
  update({ tags })
}

function handleTagKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault()
    addTag()
  }
}
</script>

<template>
  <div class="tw:rounded-lg tw:border tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-card-bg)] tw:p-6 tw:mb-4">
    <h3 class="tw:text-base tw:font-semibold tw:text-[var(--o2-text-heading)] tw:mb-4">Check Details</h3>
    <div class="tw:flex tw:flex-col tw:gap-4">
      <OInput
        v-model="name"
        label="Name"
        required
        placeholder="My browser check"
        data-test="synthetics-check-details-name-input"
      />

      <OSelect
        v-model="folder"
        label="Folder"
        :options="folderOptions"
        placeholder="Select folder"
        data-test="synthetics-check-details-folder-select"
      />

      <OSwitch
        v-model="enabled"
        label="Enabled"
        data-test="synthetics-check-details-enabled-switch"
      />

      <OInput
        v-model="url"
        label="Starting URL"
        required
        placeholder="https://example.com"
        data-test="synthetics-check-details-url-input"
      />

      <CheckAuthNetwork
        :check="check"
        data-test="synthetics-check-details-auth-network"
        @update:check="emit('update:check', $event)"
      />

      <OInput
        v-model="description"
        type="textarea"
        label="Description"
        placeholder="Optional description"
        :rows="3"
        data-test="synthetics-check-details-description-textarea"
      />

      <div>
        <label class="tw:text-sm tw:font-medium tw:text-[var(--o2-text-label)] tw:mb-1 tw:block">Tags</label>
        <div class="tw:flex tw:items-center tw:gap-2 tw:mb-2">
          <OInput
            v-model="tagInput"
            placeholder="Add a tag and press Enter"
            data-test="synthetics-check-details-tag-input"
            class="tw:flex-1"
            @keydown="handleTagKeydown"
          />
          <OButton
            variant="outline"
            size="sm"
            data-test="synthetics-check-details-add-tag-btn"
            @click="addTag"
          >
            Add
          </OButton>
        </div>
        <ul v-if="check.tags.length > 0" class="tw:flex tw:flex-wrap tw:gap-2">
          <li
            v-for="(tag, index) in check.tags"
            :key="tag"
            class="tw:inline-flex tw:items-center tw:gap-1 tw:rounded tw:px-2 tw:py-0.5 tw:text-xs tw:bg-[var(--o2-card-bg)] tw:border tw:border-[var(--o2-border-color)] tw:text-[var(--o2-text-body)]"
          >
            <span>{{ tag }}</span>
            <button
              type="button"
              :aria-label="`Remove tag ${tag}`"
              :data-test="`synthetics-check-details-remove-tag-${index}-btn`"
              class="tw:flex tw:items-center tw:text-[var(--o2-text-muted)] tw:hover:text-[var(--o2-text-body)] tw:transition-colors"
              @click="removeTag(index)"
            >
              <OIcon name="close" size="xs" />
            </button>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
