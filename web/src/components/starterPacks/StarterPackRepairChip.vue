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
import { computed, onMounted, ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { STARTER_PACKS_ENABLED } from "@/constants/starterPacks";
import { useStore } from "vuex";
import { canManageInstall } from "@/composables/starterPacks/useStarterPackFlow";
import { useRepairLater, type RepairScope } from "@/composables/starterPacks/useRepairLater";
import { raw, useI18nTyped } from "@/types/i18n";
import StarterPackRepairPanel from "./StarterPackRepairPanel.vue";

const props = defineProps<{ org: string; scope: RepairScope }>();
const emit = defineEmits<{ repaired: []; opened: [] }>();

const { t } = useI18nTyped();
const store = useStore();
const repair = useRepairLater(props.org);
const open = ref(false);

const timeOf = (us: number) => new Date(us / 1000).toLocaleTimeString();
// Someone who cannot edit the pack's items would only meet a failed save.
const issue = computed(() => {
  const found = repair.issue.value;
  return found && canManageInstall(store.state, found.record) ? found : null;
});
const undoRecord = computed(() => {
  const record = repair.undoable.value?.record ?? null;
  return record && canManageInstall(store.state, record) ? record : null;
});
const chipText = computed(() => {
  const found = issue.value;
  if (!found) return "";
  const since = raw(timeOf(found.lastUs));
  return found.panels
    ? t("starterPacks.repairLater.chip", { count: found.panels, since }, found.panels)
    : t("starterPacks.repairLater.chipAlerts", { count: found.alerts, since }, found.alerts);
});

onMounted(() => repair.check(props.scope));

const openDrawer = () => {
  open.value = true;
  emit("opened");
};

const undo = async () => {
  if (await repair.undo(props.scope)) emit("repaired");
};
</script>

<template>
  <template v-if="STARTER_PACKS_ENABLED">
    <OButton
      v-if="issue"
      variant="ghost-warning"
      size="sm-action"
      icon-left="sensors-off"
      :loading="repair.busy.value"
      data-test="starter-pack-repair-chip"
      @click="openDrawer"
    >
      {{ repair.busy.value ? t("starterPacks.repairLater.repointing") : chipText }}
    </OButton>
    <OButton
      v-if="undoRecord"
      variant="ghost-primary"
      size="sm-action"
      icon-left="check"
      :loading="repair.busy.value"
      data-test="starter-pack-repair-undo-btn"
      @click="undo"
    >
      {{
        t("starterPacks.repairLater.readsFromUndo", {
          to: raw(undoRecord.laterRepair?.to ?? ""),
        })
      }}
    </OButton>
    <StarterPackRepairPanel
      v-model:open="open"
      :repair="repair"
      :issue="issue"
      :scope="scope"
      @repaired="emit('repaired')"
    />
  </template>
</template>
