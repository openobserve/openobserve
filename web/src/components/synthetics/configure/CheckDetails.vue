<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BrowserCheck, SyntheticsFolder } from '@/types/synthetics'
import OInput from '@/lib/forms/Input/OInput.vue'
import OSelect from '@/lib/forms/Select/OSelect.vue'
import OSwitch from '@/lib/forms/Switch/OSwitch.vue'
import OButton from '@/lib/core/Button/OButton.vue'
import OIcon from '@/lib/core/Icon/OIcon.vue'

const props = defineProps<{ check: BrowserCheck; folders?: SyntheticsFolder[] }>()
const emit = defineEmits<{ 'update:check': [value: BrowserCheck] }>()

const { t } = useI18n()

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
  <div class="rounded-lg border border-[var(--color-border-default)] mb-4">
    <div class="flex items-center border-b border-[var(--color-border-default)] py-[10px] px-3">
      <div class="w-[3px] h-4 rounded-sm mr-2 shrink-0 bg-[var(--color-primary-600)]" />
      <h3 class="text-base font-semibold text-[var(--color-text-heading)]">{{ t('synthetics.checkDetails.title') }}</h3>
    </div>
    <div class="px-3 py-2 flex flex-col gap-4">
      <OInput
        v-model="name"
        :label="t('synthetics.checkDetails.name')"
        required
        :placeholder="t('synthetics.checkDetails.namePlaceholder')"
        data-test="synthetics-check-details-name-input"
      />

      <OSelect
        v-model="folder"
        :label="t('synthetics.checkDetails.folder')"
        :options="folderOptions"
        :placeholder="t('synthetics.checkDetails.folderPlaceholder')"
        data-test="synthetics-check-details-folder-select"
      />

      <OSwitch
        v-model="enabled"
        :label="t('synthetics.checkDetails.enabled')"
        data-test="synthetics-check-details-enabled-switch"
      />

      <OInput
        v-model="url"
        :label="t('synthetics.checkDetails.startingUrl')"
        required
        :placeholder="t('synthetics.checkDetails.startingUrlPlaceholder')"
        data-test="synthetics-check-details-url-input"
      />

      <OInput
        v-model="description"
        type="textarea"
        :label="t('synthetics.checkDetails.description')"
        :placeholder="t('synthetics.checkDetails.descriptionPlaceholder')"
        :rows="3"
        data-test="synthetics-check-details-description-textarea"
      />

      <div>
        <label class="text-sm font-medium text-[var(--color-text-body)] mb-1 block">{{ t('synthetics.checkDetails.tags') }}</label>
        <div class="flex items-center gap-2 mb-2">
          <OInput
            v-model="tagInput"
            :placeholder="t('synthetics.checkDetails.tagPlaceholder')"
            data-test="synthetics-check-details-tag-input"
            class="flex-1"
            @keydown="handleTagKeydown"
          />
          <OButton
            variant="outline"
            size="sm"
            data-test="synthetics-check-details-add-tag-btn"
            @click="addTag"
          >
            {{ t('synthetics.checkDetails.add') }}
          </OButton>
        </div>
        <ul v-if="check.tags.length > 0" class="flex flex-wrap gap-2">
          <li
            v-for="(tag, index) in check.tags"
            :key="tag"
            class="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs border border-[var(--color-border-default)] text-[var(--color-text-body)]"
          >
            <span>{{ tag }}</span>
            <button
              type="button"
              :aria-label="t('synthetics.checkDetails.removeTag', { tag })"
              :data-test="`synthetics-check-details-remove-tag-${index}-btn`"
              class="flex items-center text-[var(--color-text-muted)] hover:text-[var(--color-text-body)] transition-colors"
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
