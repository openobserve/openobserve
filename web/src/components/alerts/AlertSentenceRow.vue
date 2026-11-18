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
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OSettingRow from "@/lib/core/SettingRow/OSettingRow.vue";

const props = defineProps<{
  label?: I18nText;
  description?: I18nText;
  dataTest: string;
  changeable?: boolean;
  removable?: boolean;
}>();

const emit = defineEmits<{
  (e: "change"): void;
  (e: "remove"): void;
}>();

const { t } = useI18nTyped();
const noLabel = raw("");
</script>

<!-- A setting that holds a value, read back as a sentence with its own Change and Remove. -->
<template>
  <OSettingRow
    :label="props.label ?? noLabel"
    :description="props.description"
    fill
    :data-test="props.dataTest"
  >
    <div class="text-text-body min-w-0 text-sm whitespace-normal">
      <slot />
    </div>
    <template v-if="props.changeable || props.removable" #actions>
      <OButton
        v-if="props.changeable"
        variant="ghost-primary"
        size="sm"
        :data-test="`${props.dataTest}-change`"
        @click="emit('change')"
      >
        {{ t("alerts.form.change") }}
      </OButton>
      <OButton
        v-if="props.removable"
        variant="ghost-primary"
        size="sm"
        :data-test="`${props.dataTest}-remove`"
        @click="emit('remove')"
      >
        {{ t("common.remove") }}
      </OButton>
    </template>
  </OSettingRow>
</template>
