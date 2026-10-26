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
  <div
    class="bg-surface-panel border-border-default flex h-full flex-col border-e max-md:h-auto max-md:border-e-0"
    data-test="fleet-rail"
  >
    <div class="ps-page-edge flex items-center justify-between gap-2 py-1.5 pe-1.5 max-md:hidden">
      <OText variant="panel-title">{{ t("fleet.tabs.fleets") }}</OText>
      <OButton
        variant="ghost"
        size="icon"
        icon-left="add"
        :aria-label="t('fleet.fleets.newFleet')"
        data-test="fleet-rail-add"
        @click="create"
      >
        <OTooltip :content="t('fleet.fleets.newFleet')" />
      </OButton>
    </div>

    <div class="flex items-center gap-1.5 px-1.5 pb-1.5 max-md:pt-1.5">
      <OSearchInput
        v-model="search"
        class="w-full max-md:hidden"
        clearable
        :placeholder="t('fleet.fleets.search')"
        data-test="fleet-rail-search"
      />
      <OSelect
        class="min-w-0 flex-1 md:hidden"
        size="sm"
        :model-value="activeId"
        :options="mobileOptions"
        data-test="fleet-rail-mobile-select"
        @update:model-value="(v) => v && emit('select', String(v))"
      />
      <OButton
        class="md:hidden"
        variant="outline"
        size="icon-toolbar"
        icon-left="add"
        :aria-label="t('fleet.fleets.newFleet')"
        data-test="fleet-rail-mobile-add"
        @click="create"
      />
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-1.5 max-md:hidden">
      <OEmptyState
        v-if="forbidden"
        size="inline"
        preset="no-access"
        data-test="fleet-rail-forbidden"
      />
      <OEmptyState
        v-else-if="error && !rows.length"
        size="inline"
        preset="load-error"
        data-test="fleet-rail-error"
        @action="emit('retry')"
      />
      <div v-else-if="loading" class="flex justify-center py-4" data-test="fleet-rail-loading">
        <OSpinner />
      </div>
      <OTabs
        v-else
        orientation="vertical"
        dense
        :model-value="activeId"
        data-test="fleet-rail-tabs"
        @update:model-value="(v) => v && emit('select', String(v))"
      >
        <OTab
          v-for="fleet in filtered"
          :key="fleet.id"
          :name="fleet.id"
          class="min-h-6"
          :data-test="`fleet-rail-item-${fleet.id}`"
        >
          <div class="group/row flex min-h-6 w-full items-center gap-1.5">
            <span
              v-if="fleet.rollout && RAIL_DOT[fleet.rollout.status]"
              class="size-2 shrink-0 rounded-full"
              :class="RAIL_DOT[fleet.rollout.status]"
              :data-test="`fleet-rail-rollout-${fleet.id}`"
            />
            <OTruncatedText class="flex-1 text-left">{{ fleet.name }}</OTruncatedText>
            <span class="text-text-secondary shrink-0 text-xs tabular-nums">{{
              fleet.readable ? fleet.collectors : DASH
            }}</span>
            <!-- The slot is always reserved, so the count never moves when the menu appears. -->
            <div class="flex w-5 shrink-0 items-center justify-center">
              <div
                v-if="fleet.id !== DEFAULT_FLEET"
                class="invisible flex group-hover/row:visible has-[[data-state=open]]:visible"
              >
                <ODropdown side="bottom" align="start">
                  <template #trigger>
                    <OButton
                      size="icon"
                      variant="ghost"
                      icon-left="more-vert"
                      class="h-5 w-5"
                      :aria-label="t('fleet.common.actions')"
                      :data-test="`fleet-rail-menu-${fleet.id}`"
                      @click.stop
                    />
                  </template>
                  <ODropdownItem
                    icon-left="edit"
                    :data-test="`fleet-rail-rename-${fleet.id}`"
                    @select="startRename(fleet)"
                  >
                    {{ t("fleet.fleets.rename") }}
                  </ODropdownItem>
                  <ODropdownItem
                    icon-left="delete"
                    variant="destructive"
                    :data-test="`fleet-rail-delete-${fleet.id}`"
                    @select="startDelete(fleet)"
                  >
                    {{ t("common.delete") }}
                  </ODropdownItem>
                </ODropdown>
              </div>
            </div>
          </div>
        </OTab>
      </OTabs>
    </div>

    <FleetNameDialog
      v-model:open="nameOpen"
      :title="renaming ? t('fleet.fleets.renameTitle') : t('fleet.fleets.newFleet')"
      :label="t('fleet.common.name')"
      :confirm-label="renaming ? t('common.save') : t('fleet.common.create')"
      :initial="renaming?.name ?? ''"
      :save="saveName"
      data-test="fleet-rail-name-dialog"
    />

    <ConfirmDialog
      v-model="deleteOpen"
      :title="t('fleet.fleets.deleteTitle', { name: raw(deleting?.name ?? '') })"
      :message="
        deleting?.collectors
          ? t(
              'fleet.fleets.deleteWithCollectors',
              { count: deleting.collectors },
              deleting.collectors,
            )
          : t('fleet.fleets.deleteMessage')
      "
      :confirm-text="deleting?.name"
      :ok-label="t('common.delete')"
      ok-variant="destructive"
      focus-cancel
      data-test="fleet-rail-delete-dialog"
      @update:ok="confirmDelete"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useMutation } from "@tanstack/vue-query";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { useOrgId } from "@/composables/query/useOrgId";
import {
  createFleetMutation,
  deleteFleetMutation,
  renameFleetMutation,
} from "@/services/fleet.queries";
import type { FleetRolloutStatus } from "@/services/fleet";
import { raw, useI18nTyped } from "@/types/i18n";
import FleetNameDialog from "./FleetNameDialog.vue";
import { serverMessage, type FleetRow } from "./useFleetApi";

const props = defineProps<{
  rows: FleetRow[];
  activeId: string;
  loading?: boolean;
  error?: unknown;
  forbidden?: boolean;
}>();
const emit = defineEmits<{ select: [id: string]; retry: [] }>();

const DEFAULT_FLEET = "default";
const DASH = raw("—");

// Only the states that need attention get a dot; a settled fleet stays quiet.
const RAIL_DOT: Partial<Record<FleetRolloutStatus, string>> = {
  halted: "bg-status-error-text",
  in_progress: "bg-accent",
  scheduled: "bg-text-secondary",
};

const { t } = useI18nTyped();
const orgId = useOrgId();
const createM = useMutation(() => createFleetMutation(orgId.value));
const renameM = useMutation(() => renameFleetMutation(orgId.value));
const deleteM = useMutation(() => deleteFleetMutation(orgId.value));

const search = ref("");
const nameOpen = ref(false);
const renaming = ref<FleetRow | null>(null);
const deleteOpen = ref(false);
const deleting = ref<FleetRow | null>(null);

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return q ? props.rows.filter((f) => f.name.toLowerCase().includes(q)) : props.rows;
});
const mobileOptions = computed(() => props.rows.map((f) => ({ label: raw(f.name), value: f.id })));

function failure(err: unknown) {
  toast({ variant: "error", message: raw(serverMessage(err)) || t("fleet.common.requestFailed") });
}

function create() {
  renaming.value = null;
  nameOpen.value = true;
}

function startRename(fleet: FleetRow) {
  renaming.value = fleet;
  nameOpen.value = true;
}

function startDelete(fleet: FleetRow) {
  deleting.value = fleet;
  deleteOpen.value = true;
}

async function saveName(name: string): Promise<boolean> {
  try {
    if (renaming.value) {
      await renameM.mutateAsync({ id: renaming.value.id, name });
      toast({ variant: "success", message: t("fleet.fleets.updated") });
    } else {
      const fleet = await createM.mutateAsync(name);
      toast({ variant: "success", message: t("fleet.fleets.added") });
      if (fleet?.id) emit("select", fleet.id);
    }
    return true;
  } catch (err) {
    failure(err);
    return false;
  }
}

async function confirmDelete() {
  const fleet = deleting.value;
  if (!fleet) return;
  try {
    await deleteM.mutateAsync(fleet.id);
    toast({ variant: "success", message: t("fleet.fleets.deleted") });
    if (fleet.id === props.activeId) emit("select", DEFAULT_FLEET);
  } catch (err) {
    failure(err);
  }
}

defineExpose({ create });
</script>
