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
        @edit="openEditEnvironment"
        @duplicate="openDuplicateEnvironment"
        @delete="removeEnvironment"
      />
    </div>

    <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
      <div class="bg-card-glass-bg min-h-0 flex-1 overflow-hidden">
        <SyntheticsVariablesList
          ref="listRef"
          :variables="scope.variables"
          :loading="loading"
          :environment="scope.isGlobal ? null : (scope.environment?.name ?? null)"
          :environments="environments"
          :scope-label="scopeLabel"
          :scope-summary="scopeSummary"
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
      :source="duplicateSource"
      @done="onDuplicated"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import syntheticsService from "@/services/synthetics";
import type { SyntheticsEnvironment, SyntheticsVariable } from "@/types/synthetics";
import SyntheticsScopeRail from "./SyntheticsScopeRail.vue";
import SyntheticsVariablesList from "./SyntheticsVariablesList.vue";
import SyntheticsEnvironmentForm from "./SyntheticsEnvironmentForm.vue";
import SyntheticsDuplicateEnvironmentDialog from "./SyntheticsDuplicateEnvironmentDialog.vue";
import { GLOBAL_SCOPE, resolveScope } from "./scope";
import { environmentDeleteBlock } from "./usage";

const { t } = useI18nTyped();
const store = useStore();
const { confirm } = useConfirmDialog();

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
// Held separately from the selection: the row menu acts on its own row, which
// is not necessarily the scope the pane is showing.
const duplicateSource = ref<SyntheticsEnvironment | null>(null);
const listRef = ref<InstanceType<typeof SyntheticsVariablesList> | null>(null);

const scope = computed(() => resolveScope(selectedScope.value, environments.value, globals.value));

// Global has no record behind it, so the line that explains the tier stands in
// for the usage count an environment carries.
const scopeLabel = computed(() =>
  scope.value.isGlobal ? t("synthetics.variables.global") : (scope.value.environment?.name ?? ""),
);
const scopeSummary = computed(() => {
  if (scope.value.isGlobal) return t("synthetics.variables.globalSubtitle");
  const count = scope.value.environment?.checks_count ?? 0;
  return t("synthetics.environments.checksCount", { count }, count);
});

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
    toast({
      variant: "error",
      message: error?.response?.data?.message || t("synthetics.variables.loadFailed"),
    });
  } finally {
    loading.value = false;
  }
}

function openCreateEnvironment() {
  environmentDrawer.value = { show: true, isEdit: false, data: null };
}

// The page header owns the primary action for every tab; adding an environment
// is the rail's own affordance, the way adding a folder is.
defineExpose({ addVariable });

function openEditEnvironment(environment: SyntheticsEnvironment) {
  environmentDrawer.value = { show: true, isEdit: true, data: environment };
}

function openDuplicateEnvironment(environment: SyntheticsEnvironment) {
  duplicateSource.value = environment;
  duplicateDialogOpen.value = true;
}

function addVariable() {
  listRef.value?.openCreate();
}

async function removeEnvironment(environment: SyntheticsEnvironment) {
  if (environmentDeleteBlock(environment.variables, environment.checks_count)) return;

  const count = environment.variables.length;
  const ok = await confirm({
    title: t("synthetics.environments.deleteTitle"),
    // Name what goes with it before asking, not after.
    message: count
      ? t("synthetics.environments.deleteWithVariables", { name: environment.name, n: count })
      : t("synthetics.environments.deleteConfirm", { name: environment.name }),
  });
  if (!ok) return;

  try {
    const org = store.state.selectedOrganization.identifier;
    // The dialog above IS the confirmation the server's guard asks for, so
    // force is set once the user has seen the variables going with it.
    await syntheticsService.deleteEnvironment(org, environment.name, count > 0);
    // Only the selection needs moving, and only when it was the one deleted.
    if (selectedScope.value === environment.name) selectedScope.value = GLOBAL_SCOPE;
    await refresh();
    toast({ variant: "success", message: t("synthetics.environments.deleted") });
  } catch (error: any) {
    toast({
      variant: "error",
      message: error?.response?.data?.message || t("synthetics.environments.deleteFailed"),
    });
  }
}

async function onDuplicated(name: string) {
  await refresh();
  // Land on what was just made, rather than leaving the user to find it.
  selectedScope.value = name;
}

onMounted(refresh);
</script>
