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
-->

<template>
  <div class="flex min-h-0 flex-1 overflow-hidden">
    <div class="w-rail shrink-0 overflow-y-auto">
      <SyntheticsScopeRail
        :model-value="scope.environment?.name ?? ''"
        :environments="environments"
        :global-count="globals.length"
        @new-environment="openCreateEnvironment"
        @edit="openEditEnvironment"
        @duplicate="openDuplicateEnvironment"
        @delete="removeEnvironment"
        @update:model-value="selectedScope = $event"
      />
    </div>

    <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
      <div class="bg-card-glass-bg min-h-0 flex-1 overflow-hidden">
        <SyntheticsVariablesList
          ref="listRef"
          :variables="scope.variables"
          :loading="loading"
          :environment="scope.isGlobal ? null : (scope.environment?.name ?? null)"
          :environments="overridingEnvironments"
          :globals="globals"
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
      @created="landOn"
    />

    <SyntheticsDuplicateEnvironmentDialog
      v-model:open="duplicateDialogOpen"
      :source="duplicateSource"
      @done="landOn"
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
import { namedEnvironments, resolveScope } from "./scope";
import { environmentDeleteBlock } from "./usage";
import { serverMessage } from "./serverMessage";

const { t } = useI18nTyped();
const store = useStore();
const { confirm } = useConfirmDialog();

const environments = ref<SyntheticsEnvironment[]>([]);
const globals = ref<SyntheticsVariable[]>([]);
const loading = ref(false);
const selectedScope = ref<string>("");
const environmentDrawer = ref({
  show: false,
  isEdit: false,
  data: null as SyntheticsEnvironment | null,
});
const duplicateDialogOpen = ref(false);
const duplicateSource = ref<SyntheticsEnvironment | null>(null);
const listRef = ref<InstanceType<typeof SyntheticsVariablesList> | null>(null);

const scope = computed(() => resolveScope(selectedScope.value, environments.value, globals.value));
const overridingEnvironments = computed(() => namedEnvironments(environments.value));

// The line that explains the tier stands in for the check count other environments show.
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
    const [envRes, globalRes] = await Promise.all([
      syntheticsService.listEnvironments(org),
      syntheticsService.listGlobalVariables(org),
    ]);
    environments.value = envRes.data ?? [];
    globals.value = globalRes.data ?? [];
  } catch (error) {
    toast({
      variant: "error",
      message: serverMessage(error) ?? t("synthetics.variables.loadFailed"),
    });
  } finally {
    loading.value = false;
  }
}

function openCreateEnvironment() {
  environmentDrawer.value = { show: true, isEdit: false, data: null };
}

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
    await syntheticsService.deleteEnvironment(org, environment.name, count > 0);
    // Only the selection needs moving, and only when it was the one deleted.
    if (selectedScope.value === environment.name) selectedScope.value = "";
    await refresh();
    toast({ variant: "success", message: t("synthetics.environments.deleted") });
  } catch (error) {
    toast({
      variant: "error",
      message: serverMessage(error) ?? t("synthetics.environments.deleteFailed"),
    });
  }
}

// Land on what was just made, rather than leaving the user to find it.
async function landOn(name: string) {
  await refresh();
  selectedScope.value = name;
}

onMounted(refresh);
</script>
