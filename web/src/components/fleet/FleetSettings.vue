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
    <div class="mx-auto flex max-w-6xl flex-col gap-4">
      <OFormSection :title="t('fleet.settings.governance')" data-test="fleet-settings-governance">
        <template v-if="loaded && !forbidden && !loadFailed" #actions>
          <OButton
            variant="primary"
            size="sm"
            :disabled="!dirty"
            :loading="update.isPending.value"
            data-test="fleet-settings-save"
            @click="save"
          >
            {{ t("fleet.settings.save") }}
          </OButton>
        </template>
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
        </template>
      </OFormSection>

      <OFormSection :title="t('fleet.settings.auditTrail')" data-test="fleet-settings-audit">
        <OTable
          :data="auditRows"
          :columns="auditColumns"
          row-key="id"
          pagination="none"
          :frame="false"
          :loading="auditLoading"
          :forbidden="auditForbidden"
          :error="auditError"
          :empty-message="audit.disabled.value ? t('fleet.settings.auditDisabled') : undefined"
          data-test="fleet-settings-audit-table"
        >
          <template #cell-at="{ row }">
            <OTimeCell :value="row.at" unit="ms" mode="relative" />
          </template>
          <template #cell-action="{ row }">
            {{ te(row.action) ? t(row.action) : raw(row.action) }}
          </template>
          <template #cell-target="{ row }">
            <OText variant="mono">{{ row.target }}</OText>
          </template>
          <template #error>
            <div data-test="fleet-settings-audit-error">
              <OEmptyState size="block" preset="load-error" @action="audit.refetch()" />
            </div>
          </template>
        </OTable>
      </OFormSection>
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
import OText from "@/lib/core/Typography/OText.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useOrgId } from "@/composables/query/useOrgId";
import { updateFleetSettingsMutation } from "@/services/fleet.queries";
import { raw, useI18nTyped } from "@/types/i18n";
import type { FleetAuditEvent, FleetSettings } from "@/services/fleet";
import { isForbidden, serverMessage, useFleetAudit, useFleetSettings } from "./useFleetApi";

const { t, te } = useI18nTyped();
const orgId = useOrgId();

const audit = useFleetAudit();
const auditRows = audit.rows;
const auditLoading = audit.loading;
const auditForbidden = computed(() => isForbidden(audit.error.value));
const auditError = computed(() =>
  audit.error.value && !auditForbidden.value && !auditRows.value.length
    ? String(audit.error.value)
    : null,
);

const current = useFleetSettings();
const forbidden = current.forbidden;
// A failed refetch keeps the loaded values on screen.
const loadFailed = computed(() => !!current.error.value && !current.settings.value);
const update = useMutation(() => updateFleetSettingsMutation(orgId.value));

const loaded = ref<FleetSettings | null>(null);
const skipped = ref<FleetSettings | null>(null);
const restricted = ref<string[]>([]);
const target = ref("");
// Edits made while a save is in flight would be replaced by its response.
const editable = computed(() => !update.isPending.value);

function seed(settings: FleetSettings | null) {
  loaded.value = settings;
  skipped.value = null;
  restricted.value = [...(settings?.restricted_components ?? [])];
  target.value = settings?.target_version ?? "";
}

const restrictedOptions = computed(() =>
  restricted.value.map((c) => ({ label: raw(c), value: c })),
);

const body = computed<FleetSettings>(() => ({
  restricted_components: [...restricted.value],
  target_version: target.value.trim() || null,
}));

const dirty = computed(
  () =>
    !!loaded.value &&
    (body.value.target_version !== loaded.value.target_version ||
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
  const org = orgId.value;
  try {
    const saved = await update.mutateAsync(body.value);
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

const auditColumns = computed<OTableColumnDef<FleetAuditEvent>[]>(() => [
  { id: "at", header: t("fleet.settings.when"), accessorKey: "at", size: 120 },
  { id: "actor", header: t("fleet.settings.actor"), accessorKey: "actor", size: 180 },
  { id: "action", header: t("fleet.settings.action"), accessorKey: "action", size: 220 },
  { id: "target", header: t("fleet.settings.target"), accessorKey: "target", size: 240 },
]);
</script>
