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
// The `icon` field of the Add/Edit Folder form. Renders inside <OForm> and
// binds by name like any OForm* field, but adds one behaviour a plain field
// cannot: while the user has not chosen an icon themselves, it keeps the icon
// in step with whatever they are typing into `name`. The first deliberate pick
// (or clear) freezes it for good — see `touched`.

import { inject, ref, watch } from "vue";
import OEmojiPicker from "@/lib/forms/EmojiPicker/OEmojiPicker.vue";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";
import { suggestFolderIcon } from "@/utils/folderIcons";
import { useI18nTyped, type I18nText } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    /** Field label. Defaults to the generic "Icon". */
    label?: I18nText;
    /**
     * Start frozen — pass true when editing a folder that already has an icon,
     * so renaming it never silently swaps the icon the user chose.
     */
    startTouched?: boolean;
  }>(),
  { label: undefined, startTouched: false },
);

const { t } = useI18nTyped();

const form = inject(FORM_CONTEXT_KEY, null);

if (import.meta.env.DEV && !form) {
  console.warn("[FolderIconField] must be rendered inside <OForm>. No form context found.");
}

const touched = ref(props.startTouched);

// Not `immediate` on purpose: merely opening the Edit dialog must not assign an
// icon to a folder that never had one. Only real typing suggests.
if (form) {
  const nameValue = form.useStore((state: { values: { name?: string } }) => state.values.name);
  watch(nameValue, (name: string | undefined) => {
    if (touched.value) return;
    const suggested = suggestFolderIcon(name ?? "");
    if (form.state.values.icon !== suggested) form.setFieldValue("icon", suggested);
  });
}
</script>

<template>
  <div class="flex flex-col gap-1" data-test="folder-icon-field">
    <span class="text-compact text-input-label-text leading-tight font-medium">
      {{ label ?? t("dashboard.folderIcon") }}
    </span>
    <component v-if="form" :is="form.Field" name="icon">
      <template #default="{ field }">
        <OEmojiPicker
          size="md"
          :model-value="(field.state.value as string | null) ?? null"
          :aria-label="t('dashboard.folderIconAria')"
          data-test="folder-icon-picker"
          @update:model-value="(value: string | null) => field.handleChange(value)"
          @select="touched = true"
        />
      </template>
    </component>
  </div>
</template>
