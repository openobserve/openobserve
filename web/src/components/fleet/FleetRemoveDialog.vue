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
  <ODialog
    :open="!!request"
    size="md"
    :title="title"
    :primary-button-label="t('fleet.collectors.remove')"
    primary-button-variant="destructive"
    :secondary-button-label="t('common.cancel')"
    initial-focus="secondary"
    persistent
    data-test="fleet-remove-dialog"
    @click:primary="answer(true)"
    @click:secondary="answer(false)"
    @update:open="(open) => !open && answer(false)"
  >
    <div v-if="shown" class="flex flex-col gap-4">
      <OText data-test="fleet-remove-dialog-message">{{ message }}</OText>
      <FleetUninstallCommand v-if="shown.online" v-model:platform="platform" show-platforms />
      <OCollapsible
        v-else
        :label="t('fleet.uninstall.howTo')"
        data-test="fleet-remove-dialog-uninstall"
      >
        <FleetUninstallCommand v-model:platform="platform" show-platforms />
      </OCollapsible>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, shallowRef, watch } from "vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import FleetUninstallCommand from "./FleetUninstallCommand.vue";
import { platformForOs, type InstallPlatform } from "./fleetInstall";
import { useRemoveRequest, type RemoveRequest } from "./useCollectorActions";

const { t } = useI18nTyped();
const { request, answer } = useRemoveRequest();

const platform = ref<InstallPlatform>("linux");
// The answered request stays shown so the closing dialog does not flash an empty title.
const shown = shallowRef<RemoveRequest | null>(null);
watch(request, (req) => {
  if (!req) return;
  shown.value = req;
  platform.value = platformForOs(req.targets.map((c) => c.os));
});

const title = computed(() => {
  const targets = shown.value?.targets ?? [];
  return targets.length === 1
    ? t("fleet.collectors.removeTitle", { name: raw(targets[0].name) })
    : t("fleet.collectors.removeManyTitle", { count: targets.length });
});

const message = computed(() => {
  const online = shown.value?.online ?? 0;
  return online
    ? t("fleet.collectors.removeOnlineMessage", { count: online }, online)
    : t("fleet.collectors.removeMessage");
});
</script>
