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
      class="text-text-heading pl-page-edge flex items-center justify-between gap-2 py-1.5 pr-1.5 text-sm font-semibold"
      data-test="synthetics-scope-rail-header"
    >
      {{ t("synthetics.variables.scope") }}
      <div>
        <OButton
          variant="ghost"
          size="icon"
          :title="t('synthetics.environments.newButton')"
          data-test="synthetics-scope-new-environment"
          @click.stop="$emit('new-environment')"
        >
          <OIcon name="add" size="sm" />
        </OButton>
      </div>
    </div>

    <div class="px-1.5 pb-1.5">
      <OSearchInput
        v-model="searchQuery"
        :placeholder="t('synthetics.environments.searchPlaceholder')"
        clearable
        class="w-full"
        data-test="synthetics-scope-search"
      />
    </div>

    <div class="flex-1 overflow-y-auto px-1.5">
      <OTabs
        orientation="vertical"
        dense
        :model-value="modelValue"
        data-test="synthetics-scope-tabs"
        @update:model-value="$emit('update:modelValue', String($event))"
      >
        <OTab
          v-if="globalMatches"
          :name="GLOBAL_SCOPE"
          class="min-h-6"
          data-test="synthetics-scope-global"
        >
          <div class="flex w-full flex-nowrap items-center gap-2">
            <OIcon name="public" size="sm" class="shrink-0" />
            <span class="min-w-0 flex-1 truncate text-left">{{
              t("synthetics.variables.global")
            }}</span>
            <span class="text-text-secondary shrink-0 tabular-nums">{{ globalCount }}</span>
          </div>
        </OTab>

        <OTab
          v-for="env in filteredEnvironments"
          :key="env.id"
          :name="env.name"
          class="min-h-6"
          :data-test="`synthetics-scope-${env.name}`"
        >
          <div class="group/row flex w-full flex-nowrap items-center gap-2">
            <OIcon name="layers" size="sm" class="shrink-0" />
            <span class="min-w-0 flex-1 truncate text-left" :title="env.name">{{ env.name }}</span>

            <!-- The count yields to the menu rather than sitting beside it, so
                 the row does not reflow when the pointer enters it. -->
            <span
              class="text-text-secondary shrink-0 tabular-nums group-hover/row:hidden group-has-[[data-state=open]]/row:hidden"
              >{{ env.variables.length }}</span
            >

            <div
              class="hidden shrink-0 items-center group-hover/row:flex has-[[data-state=open]]:flex"
            >
              <ODropdown side="bottom" align="start">
                <template #trigger>
                  <OButton
                    size="icon"
                    variant="ghost"
                    icon-left="more-vert"
                    class="h-5 w-5"
                    :data-test="`synthetics-scope-more-${env.name}`"
                  />
                </template>

                <ODropdownItem
                  :data-test="`synthetics-scope-edit-${env.name}`"
                  @select="$emit('edit', env)"
                >
                  <template #icon-left><OIcon name="edit" size="xs" /></template>
                  {{ t("common.edit") }}
                </ODropdownItem>

                <ODropdownItem
                  :data-test="`synthetics-scope-duplicate-${env.name}`"
                  @select="$emit('duplicate', env)"
                >
                  <template #icon-left><OIcon name="content-copy" size="xs" /></template>
                  {{ t("synthetics.duplicate.action") }}
                </ODropdownItem>

                <ODropdownSeparator />

                <!-- Checks and secrets are blocks the server refuses even with
                     force, so the item carries the reason instead of a tooltip:
                     a disabled item dispatches no hover to open one. -->
                <ODropdownItem
                  variant="destructive"
                  :disabled="Boolean(deleteBlockFor(env))"
                  :data-test="`synthetics-scope-delete-${env.name}`"
                  @select="$emit('delete', env)"
                >
                  <template #icon-left><OIcon name="delete" size="xs" /></template>
                  <span class="flex flex-col">
                    <span>{{ t("common.delete") }}</span>
                    <span v-if="deleteBlockFor(env)" class="text-text-secondary text-xs">{{
                      deleteBlockReason(env)
                    }}</span>
                  </span>
                </ODropdownItem>
              </ODropdown>
            </div>
          </div>
        </OTab>
      </OTabs>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import type { SyntheticsEnvironment } from "@/types/synthetics";
import { GLOBAL_SCOPE } from "./scope";
import { environmentDeleteBlock } from "./usage";

const props = defineProps<{
  /** `GLOBAL_SCOPE` or an environment NAME. */
  modelValue: string;
  environments: SyntheticsEnvironment[];
  globalCount: number;
}>();
defineEmits<{
  "update:modelValue": [value: string];
  "new-environment": [];
  edit: [env: SyntheticsEnvironment];
  duplicate: [env: SyntheticsEnvironment];
  delete: [env: SyntheticsEnvironment];
}>();

const { t } = useI18nTyped();
const searchQuery = ref("");

// Filtering stays local: the rail makes no request, so a search must not cost
// one either. The selection is held by the parent and survives being filtered
// out, which is what keeps the pane rendering while the rail is narrowed.
const needle = computed(() => searchQuery.value.trim().toLowerCase());
const globalMatches = computed(
  () => !needle.value || t("synthetics.variables.global").toLowerCase().includes(needle.value),
);
const filteredEnvironments = computed(() =>
  needle.value
    ? props.environments.filter((e) => e.name.toLowerCase().includes(needle.value))
    : props.environments,
);

// Pure, so the rail can answer this without a request and stay presentational.
function deleteBlockFor(env: SyntheticsEnvironment) {
  return environmentDeleteBlock(env.variables, env.checks_count);
}

function deleteBlockReason(env: SyntheticsEnvironment): string {
  return deleteBlockFor(env) === "checks"
    ? t("synthetics.environments.deleteBlockedChecks", { n: env.checks_count })
    : t("synthetics.environments.deleteBlockedSecrets");
}
</script>
