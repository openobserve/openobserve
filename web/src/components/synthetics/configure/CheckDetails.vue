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
import { computed, ref } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { BrowserCheck, SyntheticsFolder } from "@/types/synthetics";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

const props = defineProps<{
  check: BrowserCheck;
  folders?: SyntheticsFolder[];
  /** True while the parent is still fetching the folder list. */
  foldersLoading?: boolean;
  validationErrors?: Record<string, string>;
  /** Override the target field label/placeholder (protocol checks take a host, not a URL). */
  targetLabel?: I18nText;
  targetPlaceholder?: I18nText;
}>();
const emit = defineEmits<{ "update:check": [value: BrowserCheck] }>();

const { t } = useI18nTyped();

function update(patch: Partial<BrowserCheck>) {
  emit("update:check", { ...props.check, ...patch });
}

const name = computed({
  get: () => props.check.name,
  set: (v: string) => update({ name: v }),
});

const folder = computed({
  get: () => props.check.folder ?? "",
  set: (v: string | number | boolean | null | undefined) =>
    update({ folder: v != null ? String(v) : undefined }),
});

const enabled = computed({
  get: () => props.check.enabled,
  set: (v: boolean) => update({ enabled: v }),
});

const url = computed({
  get: () => props.check.url,
  set: (v: string) => update({ url: v }),
});

const description = computed({
  get: () => props.check.description ?? "",
  set: (v: string) => update({ description: raw(v) }),
});

const tagInput = ref("");

// No fabricated fallback option. The loaded list always carries a "default"
// entry (getFoldersListByType prepends one), so an empty list means the fetch
// has not landed — and standing a fake "Default" in for it made a failed load
// look identical to an org that only has the default folder, while the select
// rendered the unresolvable id verbatim.
const folderOptions = computed(() =>
  (props.folders ?? []).map((f) => ({ label: raw(f.name), value: f.folderId })),
);

function addTag() {
  const tag = tagInput.value.trim();
  if (!tag) return;
  if (props.check.tags.includes(tag)) {
    tagInput.value = "";
    return;
  }
  update({ tags: [...props.check.tags, tag] });
  tagInput.value = "";
}

function removeTag(index: number) {
  const tags = [...props.check.tags];
  tags.splice(index, 1);
  update({ tags });
}

function handleTagKeydown(event: KeyboardEvent) {
  if (event.key === "Enter") {
    event.preventDefault();
    addTag();
  }
}
</script>

<template>
  <div class="rounded-default border-border-default mb-4 border">
    <div class="border-border-default flex items-center border-b px-3 py-2.5">
      <div class="rounded-default bg-accent mr-2 h-4 w-[0.1875rem] shrink-0" />
      <h3 class="text-text-heading text-base font-semibold">
        {{ t("synthetics.checkDetails.title") }}
      </h3>
    </div>
    <div class="flex flex-col gap-4 px-3 py-2">
      <OInput
        v-model="name"
        :label="t('synthetics.checkDetails.name')"
        required
        :error="!!props.validationErrors?.name"
        :error-message="raw(props.validationErrors?.name)"
        :placeholder="t('synthetics.checkDetails.namePlaceholder')"
        data-test="synthetics-check-details-name-input"
      />

      <OSelect
        v-model="folder"
        :label="t('synthetics.checkDetails.folder')"
        :options="folderOptions"
        :loading="props.foldersLoading"
        :error="!!props.validationErrors?.folder"
        :error-message="props.validationErrors?.folder"
        :placeholder="t('synthetics.checkDetails.folderPlaceholder')"
        data-test="synthetics-check-details-folder-select"
      >
        <template #empty>{{
          props.foldersLoading
            ? t("synthetics.checkDetails.foldersLoading")
            : t("synthetics.checkDetails.foldersUnavailable")
        }}</template>
      </OSelect>

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
        :error-message="raw(props.validationErrors?.url)"
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
        <label class="text-text-body mb-1 block text-sm font-medium">{{
          t("synthetics.checkDetails.tags")
        }}</label>
        <div class="mb-2 flex items-center gap-2">
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
            {{ t("synthetics.checkDetails.add") }}
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
