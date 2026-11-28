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

<!-- First-use pin (V38) and "Allow this destination" (§3.6.1): confirmed in the consumer's own save. -->
<template>
  <div class="flex flex-col gap-3" data-test="secret-bind-box">
    <div
      v-for="item in items"
      :key="item.id"
      class="border-border-default rounded-surface flex flex-col gap-2 border p-4"
      :data-test="`secret-bind-box-${item.name}`"
    >
      <div class="flex items-center gap-2">
        <OIcon name="lock" size="sm" class="text-text-secondary shrink-0" />
        <span class="text-text-heading min-w-0 flex-1 text-sm font-medium">
          {{
            item.pin_mode === "none"
              ? t("secrets.consumer.needsPin", { name: item.name })
              : t("secrets.consumer.notAllowedYet", { name: item.name })
          }}
        </span>
        <OTag size="xs" variant="warning-soft" icon="" :label="t('secrets.consumer.required')" />
      </div>
      <template v-if="item.rights?.manage_access === true">
        <template v-if="item.pin_mode === 'none'">
          <OTagInput
            :model-value="pins[item.id] ?? []"
            :label="t('secrets.consumer.pinTo')"
            :placeholder="t('secrets.policy.hostsPlaceholder')"
            :data-test="`secret-bind-box-${item.name}-hosts`"
            @update:model-value="(v: string[]) => emit('update:pins', { ...pins, [item.id]: v })"
          />
          <span class="text-text-secondary text-xs">{{ t("secrets.consumer.pinSuggested") }}</span>
        </template>
        <OCheckbox
          v-if="!item.allowed_here"
          :model-value="allow[item.id] !== false"
          :label="t('secrets.consumer.allowThis')"
          :data-test="`secret-bind-box-${item.name}-allow`"
          @update:model-value="(v) => emit('update:allow', { ...allow, [item.id]: v === true })"
        />
      </template>
      <span v-else class="text-text-body text-sm" :data-test="`secret-bind-box-${item.name}-ask`">
        {{
          item.pin_mode === "none"
            ? t("secrets.consumer.askToPin", {
                name: item.name,
                hosts: (pins[item.id] ?? []).join(", ") || t("secrets.none"),
              })
            : t("secrets.consumer.askToAllow", { name: item.name })
        }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OTagInput from "@/lib/forms/TagInput/OTagInput.vue";
import type { SecretPickerItem } from "@/services/secrets";

defineProps<{
  items: SecretPickerItem[];
  pins: Record<string, string[]>;
  allow: Record<string, boolean>;
}>();
const emit = defineEmits<{
  "update:pins": [value: Record<string, string[]>];
  "update:allow": [value: Record<string, boolean>];
}>();
const { t } = useI18nTyped();
</script>
