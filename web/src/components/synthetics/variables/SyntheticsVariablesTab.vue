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

One tab for every scope. The rail selects; the pane shows that scope's
variables. Both scopes load in one pass, so switching between staging and
production - the most frequent movement here - costs no network call.
-->

<template>
  <div class="flex min-h-0 flex-1 overflow-hidden">
    <div class="w-rail shrink-0 overflow-y-auto">
      <SyntheticsScopeRail
        v-model="selectedScope"
        :environments="environments"
        :global-count="globals.length"
        @new-environment="openCreateEnvironment"
      />
    </div>

    <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
      <div
        class="border-border-default flex items-start justify-between gap-3 border-b px-4 py-3"
        data-test="synthetics-scope-header"
      >
        <div class="min-w-0">
          <h2 class="text-text-heading m-0 truncate text-lg font-semibold">
            {{ scope.isGlobal ? t("synthetics.variables.global") : scope.environment?.name }}
          </h2>
          <p class="text-text-secondary m-0 text-sm">
            {{
              scope.isGlobal
                ? t("synthetics.variables.globalSubtitle")
                : t("synthetics.environments.usedByChecks", {
                    n: scope.environment?.checks_count ?? 0,
                  })
            }}
          </p>
        </div>

        <!-- Global's actions are ABSENT, not disabled: there is no entity
             behind it, and a disabled control implies one that exists. -->
        <div class="flex shrink-0 items-center gap-2">
          <template v-if="!scope.isGlobal">
            <OButton
              variant="outline"
              size="sm"
              icon-left="edit"
              data-test="synthetics-scope-edit-btn"
              @click="openEditEnvironment"
              >{{ t("common.edit") }}</OButton
            >
            <OButton
              variant="outline"
              size="sm"
              icon-left="content-copy"
              data-test="synthetics-scope-duplicate-btn"
              @click="duplicateDialogOpen = true"
              >{{ t("synthetics.duplicate.action") }}</OButton
            >
          </template>
          <OButton
            variant="primary"
            size="sm"
            icon-left="add"
            data-test="synthetics-scope-add-variable-btn"
            @click="addVariable"
            >{{ t("synthetics.variables.add") }}</OButton
          >
        </div>
      </div>

      <div class="bg-card-glass-bg min-h-0 flex-1 overflow-hidden">
        <SyntheticsVariablesList
          ref="listRef"
          :variables="scope.variables"
          :loading="loading"
          :environment="scope.isGlobal ? null : (scope.environment?.name ?? null)"
          :environments="environments"
          @refresh="refresh"
        />
      </div>
    </div>

    <SyntheticsEnvironmentForm
      v-model:open="environmentDrawer.show"
      :is-edit="environmentDrawer.isEdit"
      :data="environmentDrawer.data"
      @update:list="refresh"
    />

    <SyntheticsDuplicateEnvironmentDialog
      v-model:open="duplicateDialogOpen"
      :source="scope.environment"
      @done="onDuplicated"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import syntheticsService from "@/services/synthetics";
import type { SyntheticsEnvironment, SyntheticsVariable } from "@/types/synthetics";
import SyntheticsScopeRail from "./SyntheticsScopeRail.vue";
import SyntheticsVariablesList from "./SyntheticsVariablesList.vue";
import SyntheticsEnvironmentForm from "./SyntheticsEnvironmentForm.vue";
import SyntheticsDuplicateEnvironmentDialog from "./SyntheticsDuplicateEnvironmentDialog.vue";
import { GLOBAL_SCOPE, resolveScope } from "./scope";

const { t } = useI18nTyped();
const store = useStore();

const environments = ref<SyntheticsEnvironment[]>([]);
const globals = ref<SyntheticsVariable[]>([]);
const loading = ref(false);
// Held by NAME, not object: a refetch replaces every row, and an object-held
// reference would keep rendering the pre-refresh variable list.
const selectedScope = ref<string>(GLOBAL_SCOPE);
const environmentDrawer = ref({
  show: false,
  isEdit: false,
  data: null as SyntheticsEnvironment | null,
});
const duplicateDialogOpen = ref(false);
const listRef = ref<InstanceType<typeof SyntheticsVariablesList> | null>(null);

const scope = computed(() => resolveScope(selectedScope.value, environments.value, globals.value));

async function refresh() {
  loading.value = true;
  try {
    const org = store.state.selectedOrganization.identifier;
    // Both scopes in one pass: the environments list already carries each
    // environment's variables inline, so selecting a scope is a local filter.
    const [envRes, globalRes] = await Promise.all([
      syntheticsService.listEnvironments(org),
      syntheticsService.listGlobalVariables(org),
    ]);
    environments.value = envRes.data ?? [];
    globals.value = globalRes.data ?? [];
  } catch (error: any) {
    toast.error(error?.response?.data?.message ?? t("synthetics.variables.loadFailed"));
  } finally {
    loading.value = false;
  }
}

function openCreateEnvironment() {
  environmentDrawer.value = { show: true, isEdit: false, data: null };
}

function openEditEnvironment() {
  environmentDrawer.value = { show: true, isEdit: true, data: scope.value.environment };
}

function addVariable() {
  listRef.value?.openCreate();
}

async function onDuplicated(name: string) {
  await refresh();
  // Land on what was just made, rather than leaving the user to find it.
  selectedScope.value = name;
}

onMounted(refresh);
</script>
