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
  <OContent y class="min-h-0 flex-1 overflow-auto" data-test="fleet-settings">
    <div class="flex flex-col gap-4">
      <OFormSection :title="t('fleet.settings.governance')" data-test="fleet-settings-governance">
        <div v-if="forbidden" class="py-3" data-test="fleet-settings-no-access">
          <OEmptyState size="inline" preset="no-access" :title="t('fleet.settings.noAccess')" />
        </div>
        <div v-else-if="loadFailed" class="py-3" data-test="fleet-settings-load-failed">
          <OEmptyState
            size="inline"
            preset="load-error"
            :title="t('fleet.settings.loadFailed')"
            :action-label="t('emptyState.loadError.action')"
            action-icon="refresh"
            @action="current.refetch"
          />
        </div>
        <div
          v-else-if="!loaded"
          class="flex justify-center py-4"
          data-test="fleet-settings-loading"
        >
          <OSpinner />
        </div>
        <template v-else>
          <OSettingRow
            :label="t('fleet.settings.restricted')"
            :description="t('fleet.settings.restrictedDesc')"
          >
            <OSelect
              v-model="restricted"
              width="md"
              class="max-md:w-full"
              size="sm"
              :placeholder="t('fleet.settings.restrictedPlaceholder')"
              multiple
              creatable
              :options="restrictedOptions"
              :disabled="!editable"
              data-test="fleet-settings-restricted"
              @create="addRestricted"
            />
          </OSettingRow>
          <OSettingRow
            :label="t('fleet.settings.targetVersion')"
            :description="t('fleet.settings.targetVersionDesc')"
          >
            <OInput
              v-model="target"
              width="md"
              class="max-md:w-full"
              size="sm"
              :placeholder="t('fleet.settings.targetVersionPlaceholder')"
              :disabled="!editable"
              data-test="fleet-settings-target-version"
            />
          </OSettingRow>
          <div v-if="editable" class="pt-1">
            <OButton
              variant="primary"
              size="sm-action"
              :disabled="!dirty"
              :loading="update.isPending.value"
              data-test="fleet-settings-save"
              @click="save"
            >
              {{ t("fleet.settings.save") }}
            </OButton>
          </div>
        </template>
      </OFormSection>

      <OFormSection
        :title="t('fleet.settings.fleetDefaults')"
        :info="t('fleet.settings.fleetDefaultsDesc')"
        data-test="fleet-settings-defaults"
      >
        <FleetSettingsForm
          v-if="loaded && !forbidden && !loadFailed"
          :key="defaultsKey"
          :initial="loaded.fleet_defaults"
          :defaults="loaded.fleet_defaults"
          required
          inline-submit
          :disabled="!editable"
          data-test="fleet-settings-defaults-form"
          @save="saveDefaults"
        />
        <div v-else-if="!forbidden && !loadFailed" class="flex justify-center py-4">
          <OSpinner />
        </div>
      </OFormSection>

      <OFormSection
        :title="t('fleet.settings.alerts')"
        :info="t('fleet.settings.alertsDesc')"
        data-test="fleet-settings-alerts"
      >
        <div class="flex flex-col gap-3">
          <ul class="text-text-secondary flex list-disc flex-col gap-1 ps-5 text-sm">
            <li>{{ t("fleet.settings.alertRolloutHalted") }}</li>
            <li>{{ t("fleet.settings.alertAutoRolledBack") }}</li>
            <li>{{ t("fleet.settings.alertOfflineRatio") }}</li>
          </ul>
          <div>
            <OButton
              variant="outline"
              size="sm"
              icon-right="open-in-new"
              data-test="fleet-settings-alert-library"
              @click="openAlertLibrary"
            >
              {{ t("fleet.settings.openAlertLibrary") }}
            </OButton>
          </div>
        </div>
      </OFormSection>

      <FleetCollectorVersions class="shrink-0" />
    </div>
  </OContent>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useMutation } from "@tanstack/vue-query";
import OContent from "@/lib/core/Content/OContent.vue";
import OFormSection from "@/lib/core/FormSection/OFormSection.vue";
import OSettingRow from "@/lib/core/SettingRow/OSettingRow.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useOrgId } from "@/composables/query/useOrgId";
import { updateFleetSettingsMutation } from "@/services/fleet.queries";
import { useRoute, useRouter } from "vue-router";
import { raw, useI18nTyped } from "@/types/i18n";
import type { FleetOrgSettings, FleetSettings } from "@/services/fleet";
import FleetCollectorVersions from "./FleetCollectorVersions.vue";
import FleetSettingsForm from "./FleetSettingsForm.vue";
import { serverMessage, useFleetSettings } from "./useFleetApi";

const { t } = useI18nTyped();
const orgId = useOrgId();

const current = useFleetSettings();
const forbidden = current.forbidden;
// A failed refetch keeps the loaded values on screen.
const loadFailed = computed(() => !!current.error.value && !current.settings.value);
const update = useMutation(() => updateFleetSettingsMutation(orgId.value));

const route = useRoute();
const router = useRouter();
const loaded = ref<FleetOrgSettings | null>(null);
const skipped = ref<FleetOrgSettings | null>(null);
const defaultsKey = computed(() => JSON.stringify(loaded.value?.fleet_defaults ?? null));
const restricted = ref<string[]>([]);
const target = ref("");
// Edits made while a save is in flight would be replaced by its response.
const editable = computed(() => !update.isPending.value);

function seed(settings: FleetOrgSettings | null) {
  loaded.value = settings;
  skipped.value = null;
  restricted.value = [...(settings?.restricted_components ?? [])];
  target.value = settings?.target_collector_version ?? "";
}

const restrictedOptions = computed(() =>
  restricted.value.map((c) => ({ label: raw(c), value: c })),
);

const body = computed<FleetOrgSettings | null>(() =>
  loaded.value
    ? {
        ...loaded.value,
        restricted_components: [...restricted.value],
        target_collector_version: target.value.trim() || null,
      }
    : null,
);

const dirty = computed(
  () =>
    !!loaded.value &&
    !!body.value &&
    (body.value.target_collector_version !== loaded.value.target_collector_version ||
      body.value.restricted_components.join("\n") !==
        loaded.value.restricted_components.join("\n")),
);

// A refetch, from focus or another fleet write, must never overwrite unsaved edits.
watch(
  current.settings,
  (settings) => {
    if (dirty.value) skipped.value = settings;
    else seed(settings);
  },
  { immediate: true },
);
watch(dirty, (isDirty) => {
  if (!isDirty && skipped.value) seed(skipped.value);
});
// Edits belong to the org they were made in.
watch(orgId, () => seed(current.settings.value));

function addRestricted(name: string) {
  if (!restricted.value.includes(name)) restricted.value = [...restricted.value, name];
}

async function save() {
  if (body.value) await put(body.value);
}

// The defaults form only offers complete values, so every field is set.
async function saveDefaults(defaults: FleetSettings) {
  if (!loaded.value) return;
  await put({
    ...loaded.value,
    fleet_defaults: defaults as FleetOrgSettings["fleet_defaults"],
  });
}

function openAlertLibrary() {
  const org = route.query.org_identifier;
  router.push({ name: "alertLibrary", query: org ? { org_identifier: org } : {} });
}

async function put(next: FleetOrgSettings) {
  const org = orgId.value;
  try {
    const saved = await update.mutateAsync(next);
    // A response for the org the user has since left must not fill the new org's form.
    if (orgId.value === org) seed(saved);
    toast({ variant: "success", message: t("fleet.settings.saved") });
  } catch (err) {
    toast({
      variant: "error",
      message: raw(serverMessage(err)) || t("fleet.common.requestFailed"),
    });
  }
}
</script>
