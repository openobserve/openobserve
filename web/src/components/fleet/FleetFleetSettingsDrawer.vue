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
  <ODrawer
    :open="open"
    size="xl"
    :title="t('fleet.fleets.settingsTitle')"
    :sub-title="fleetName"
    :form-id="ready ? FORM_ID : undefined"
    :primary-button-label="ready ? t('fleet.settings.save') : undefined"
    :primary-button-loading="update.isPending.value"
    :secondary-button-label="t('common.cancel')"
    data-test="fleet-fleet-settings-drawer"
    @update:open="emit('update:open', $event)"
    @click:secondary="emit('update:open', false)"
  >
    <OEmptyState
      v-if="forbidden"
      size="block"
      preset="no-access"
      data-test="fleet-fleet-settings-forbidden"
    />
    <OEmptyState
      v-else-if="failed"
      size="block"
      preset="load-error"
      data-test="fleet-fleet-settings-error"
      @action="retry"
    />
    <div
      v-else-if="!ready"
      class="flex justify-center py-6"
      data-test="fleet-fleet-settings-loading"
    >
      <OSpinner />
    </div>
    <div v-else class="flex flex-col gap-4">
      <OText variant="meta">{{ t("fleet.fleets.settingsHint") }}</OText>
      <FleetSettingsForm
        :key="`${fleetId}:${loadedAt}`"
        :form-id="FORM_ID"
        :initial="settings.settings.value"
        :defaults="org.settings.value?.fleet_defaults ?? null"
        data-test="fleet-fleet-settings-form"
        @save="save"
      />
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useMutation } from "@tanstack/vue-query";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useOrgId } from "@/composables/query/useOrgId";
import { updateFleetSettingsOfMutation } from "@/services/fleet.queries";
import type { FleetSettings } from "@/services/fleet";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import FleetSettingsForm from "./FleetSettingsForm.vue";
import { serverMessage, useFleetSettings, useFleetSettingsOf } from "./useFleetApi";

const props = defineProps<{ open: boolean; fleetId: string; fleetName: I18nText }>();
const emit = defineEmits<{ "update:open": [open: boolean] }>();

const FORM_ID = "fleet-fleet-settings-form";

const { t } = useI18nTyped();
const orgId = useOrgId();
const settings = useFleetSettingsOf(
  () => props.fleetId,
  () => props.open,
);
// The org defaults are only placeholders, so a failed read leaves the form usable.
const org = useFleetSettings();
const update = useMutation(() => updateFleetSettingsOfMutation(orgId.value));

const forbidden = settings.forbidden;
const failed = computed(() => !!settings.error.value && !settings.settings.value);
const ready = computed(() => !!settings.settings.value && !forbidden.value);
const loadedAt = computed(() =>
  settings.settings.value ? JSON.stringify(settings.settings.value) : "",
);
const retry = () => settings.refetch();

async function save(body: FleetSettings) {
  try {
    await update.mutateAsync({ id: props.fleetId, body });
    toast({ variant: "success", message: t("fleet.settings.saved") });
    emit("update:open", false);
  } catch (err) {
    toast({
      variant: "error",
      message: raw(serverMessage(err)) || t("fleet.common.requestFailed"),
    });
  }
}
</script>
