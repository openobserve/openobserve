<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BrowserCheck, SyntheticsFolder } from '@/types/synthetics'
import OInput from '@/lib/forms/Input/OInput.vue'
import OSelect from '@/lib/forms/Select/OSelect.vue'
import OSwitch from '@/lib/forms/Switch/OSwitch.vue'
import OButton from '@/lib/core/Button/OButton.vue'
import OTag from '@/lib/core/Badge/OTag.vue'
import OIcon from '@/lib/core/Icon/OIcon.vue'

const props = defineProps<{
  check: BrowserCheck
  folders?: SyntheticsFolder[]
  validationErrors?: Record<string, string>
  /** Override the target field label/placeholder (protocol checks take a host, not a URL). */
  targetLabel?: string
  targetPlaceholder?: string
}>()
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
  return opts.length ? opts : [{ label: t('synthetics.checkDetails.defaultFolder'), value: 'default' }]
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
  <div class="rounded-default border border-border-default mb-4">
    <div class="flex items-center border-b border-border-default py-2.5 px-3">
      <div class="w-[0.1875rem] h-4 rounded-default mr-2 shrink-0 bg-primary-600" />
      <h3 class="text-base font-semibold text-text-heading">{{ t('synthetics.checkDetails.title') }}</h3>
    </div>
    <div class="px-3 py-2 flex flex-col gap-4">
      <OInput
        v-model="name"
        :label="t('synthetics.checkDetails.name')"
        required
        :error="!!props.validationErrors?.name"
        :error-message="props.validationErrors?.name"
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
        :label="targetLabel ?? t('synthetics.checkDetails.startingUrl')"
        required
        :error="!!props.validationErrors?.url"
        :error-message="props.validationErrors?.url"
        :placeholder="targetPlaceholder ?? t('synthetics.checkDetails.startingUrlPlaceholder')"
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
        <label class="text-sm font-medium text-text-body mb-1 block">{{ t('synthetics.checkDetails.tags') }}</label>
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
        <div v-if="check.tags.length > 0" class="flex flex-wrap gap-2">
          <OTag
            v-for="(tag, index) in check.tags"
            :key="tag"
            size="xs"
            class="px-2"
            type="selectionChip"
          >
              <span class="px-0.5">{{ tag }}</span>
              <OButton
                variant="ghost"
                size="chip"
                :aria-label="t('synthetics.checkDetails.removeTag', { tag })"
                :data-test="`synthetics-check-details-remove-tag-${index}-btn`"
                class="text-text-muted hover:text-text-body transition-colors"
                @click="removeTag(index)"
              >
                <OIcon name="close" size="xs" />
              </OButton>
          </OTag>
        </div>
      </div>
    </div>
  </div>
</template>
