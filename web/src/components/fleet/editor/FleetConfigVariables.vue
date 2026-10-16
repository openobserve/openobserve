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

<template>
  <div class="flex flex-col gap-3" data-test="fleet-config-variables">
    <OBanner variant="info" dense :content="t('fleet.configs.variablesHint')" />
    <div
      v-for="name in names"
      :key="name"
      class="border-border-default flex flex-col gap-1 border-b pb-2.5 last:border-b-0"
      :data-test="`fleet-config-variables-${name}`"
    >
      <OText variant="mono" truncate>{{ name }}</OText>
      <OText variant="meta">{{ t("fleet.configs.sourceEnv") }}</OText>
    </div>
  </div>
</template>

<script setup lang="ts">
import OText from "@/lib/core/Typography/OText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { useI18nTyped } from "@/types/i18n";

defineProps<{ names: string[] }>();

const { t } = useI18nTyped();
</script>
