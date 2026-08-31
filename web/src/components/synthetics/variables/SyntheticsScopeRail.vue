<!--
Copyright 2026 OpenObserve Inc.

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

The scope selector. Global sits above the environments with its own icon,
because "applies everywhere" is a different kind of thing from "applies in
staging" - but it is still just a filter over the same list, edited with the
same drawer.
-->

<template>
  <div class="bg-surface-panel border-border-default flex h-full flex-col border-r pb-1">
    <div
      class="text-text-heading pl-page-edge py-1.5 pr-1.5 text-sm font-semibold"
      data-test="synthetics-scope-rail-header"
    >
      {{ t("synthetics.variables.scope") }}
    </div>

    <div class="flex-1 overflow-y-auto px-1.5">
      <OTabs
        orientation="vertical"
        dense
        :model-value="modelValue"
        data-test="synthetics-scope-tabs"
        @update:model-value="$emit('update:modelValue', String($event))"
      >
        <OTab :name="GLOBAL_SCOPE" class="min-h-6" data-test="synthetics-scope-global">
          <div class="flex w-full items-center gap-2">
            <OIcon name="public" size="sm" />
            <span class="truncate">{{ t("synthetics.variables.global") }}</span>
            <span class="text-text-secondary ml-auto tabular-nums">{{ globalCount }}</span>
          </div>
        </OTab>

        <OTab
          v-for="env in environments"
          :key="env.id"
          :name="env.name"
          class="min-h-6"
          :data-test="`synthetics-scope-${env.name}`"
        >
          <div class="flex w-full items-center gap-2">
            <OIcon name="layers" size="sm" />
            <span class="truncate">{{ env.name }}</span>
            <span class="text-text-secondary ml-auto tabular-nums">{{ env.variables.length }}</span>
          </div>
        </OTab>
      </OTabs>
    </div>

    <div class="border-border-default border-t px-1.5 pt-1.5">
      <OButton
        variant="ghost"
        size="sm"
        icon-left="add"
        class="w-full justify-start"
        data-test="synthetics-scope-new-environment"
        @click="$emit('new-environment')"
        >{{ t("synthetics.environments.add") }}</OButton
      >
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import type { SyntheticsEnvironment } from "@/types/synthetics";
import { GLOBAL_SCOPE } from "./scope";

defineProps<{
  /** `GLOBAL_SCOPE` or an environment NAME. */
  modelValue: string;
  environments: SyntheticsEnvironment[];
  globalCount: number;
}>();
defineEmits<{ "update:modelValue": [value: string]; "new-environment": [] }>();

const { t } = useI18nTyped();
</script>
