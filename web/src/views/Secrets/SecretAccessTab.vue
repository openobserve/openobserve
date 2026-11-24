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
  <div class="flex flex-col gap-3" data-test="secret-access-tab">
    <template v-if="fgaDisabled">
      <OBanner
        variant="info"
        icon="info"
        :content="t('secrets.fgaOffBanner')"
        data-test="secret-access-fga-off"
      />
      <span class="text-text-secondary text-xs">{{ t("secrets.access.fgaOffHint") }}</span>
    </template>
    <OEmptyState
      v-else-if="forbidden"
      size="inline"
      icon="lock"
      :title="t('secrets.access.forbiddenTitle')"
      :description="t('secrets.access.forbiddenDesc')"
      data-test="secret-access-forbidden"
    />
    <div v-else-if="grantsQuery.isPending.value" class="text-text-secondary text-sm">
      {{ t("common.loading") }}
    </div>
    <OEmptyState
      v-else-if="grantsQuery.isError.value"
      preset="load-error"
      size="inline"
      data-test="secret-access-error"
      @action="grantsQuery.refetch()"
    />
    <template v-else>
      <OBanner
        v-if="hasGrants(grantsQuery.data.value?.unapplied)"
        variant="warning"
        icon="warning"
        :content="t('secrets.access.unapplied')"
        data-test="secret-access-unapplied"
      />
      <OTable
        :data="tableRows"
        :columns="columns"
        row-key="role"
        pagination="none"
        :default-columns="false"
        :show-global-filter="false"
        data-test="secret-access-table"
      >
        <template #cell-role="{ row }">
          <div class="flex min-w-0 flex-col py-1">
            <span class="text-text-heading text-sm font-medium">{{ row.role }}</span>
            <span v-if="row.fixed" class="text-text-secondary text-xs">
              {{ t("secrets.access.adminsAlways") }}
            </span>
          </div>
        </template>
        <template v-for="right in GRANT_RIGHTS" :key="right" #[`cell-${right}`]="{ row }">
          <OCheckbox
            :model-value="row.fixed ? true : row[right]"
            :disabled="row.fixed || !canEdit"
            :aria-label="rightLabel(right)"
            :data-test="`secret-access-${row.role}-${right}`"
            @update:model-value="(v) => setRight(row.role, right, v === true)"
          />
        </template>
        <template #cell-remove="{ row }">
          <OButton
            v-if="!row.fixed && canEdit"
            variant="ghost"
            size="icon-sm"
            icon-left="delete"
            :aria-label="t('secrets.access.removeRole')"
            :data-test="`secret-access-${row.role}-remove`"
            @click="removeRole(row.role)"
          />
        </template>
      </OTable>

      <div v-if="canEdit" class="flex flex-wrap items-center gap-2">
        <OSelect
          v-model="roleToAdd"
          class="w-60"
          size="sm"
          searchable
          :options="roleOptions"
          :placeholder="t('secrets.access.pickRole')"
          data-test="secret-access-role-select"
        />
        <OButton
          variant="outline"
          size="sm"
          icon-left="add"
          :disabled="!roleToAdd"
          data-test="secret-access-add-role"
          @click="addRole"
        >
          {{ t("secrets.access.addRole") }}
        </OButton>
      </div>
      <span class="text-text-secondary text-xs">{{ t("secrets.access.hint") }}</span>

      <OBanner
        v-if="tooLarge"
        variant="error"
        icon="error"
        :content="t('secrets.access.tooLarge', { limit: GRANT_EDIT_LIMIT })"
        data-test="secret-access-too-large"
      />

      <div v-if="canEdit" class="flex items-center justify-end gap-2">
        <span class="text-text-secondary me-auto text-xs">{{ t("secrets.access.audited") }}</span>
        <OButton
          variant="outline"
          size="sm-action"
          :disabled="!dirty"
          data-test="secret-access-cancel"
          @click="resetRows"
        >
          {{ t("common.cancel") }}
        </OButton>
        <OButton
          variant="primary"
          size="sm-action"
          :disabled="!dirty"
          :loading="put.isPending.value"
          data-test="secret-access-save"
          @click="save"
        >
          {{ t("common.save") }}
        </OButton>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useOrgId } from "@/composables/query/useOrgId";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { rolesQuery } from "@/services/iam.queries";
import {
  GRANT_RIGHTS,
  secretErrorCode,
  type GrantRight,
  type SecretDetail,
} from "@/services/secrets";
import { putSecretGrantsMutation, secretGrantsQuery } from "@/services/secrets.queries";
import {
  GRANT_EDIT_LIMIT,
  emptyGrants,
  grantChangeCount,
  grantsFromRows,
  hasGrants,
  rowsFromGrants,
  type GrantRow,
} from "./secretGrants";
import { secretErrorText } from "./secretErrors";

const props = defineProps<{ detail: SecretDetail; fgaOff: boolean }>();

const { t } = useI18nTyped();
const orgId = useOrgId();

const grantsQuery = useQuery(() =>
  Object.assign(secretGrantsQuery(orgId.value, props.detail.id), {
    enabled: !!orgId.value && !props.fgaOff,
  }),
);
const roles = useQuery(() =>
  Object.assign(rolesQuery(orgId.value), { enabled: !!orgId.value && !props.fgaOff }),
);
const put = useMutation(() => putSecretGrantsMutation(orgId.value, props.detail.id));

const errorStatus = computed(() => {
  const e: any = grantsQuery.error.value;
  return e?.response?.status ?? e?.status;
});
const fgaDisabled = computed(
  () => props.fgaOff || secretErrorCode(grantsQuery.error.value) === "fga_disabled",
);
const forbidden = computed(() => errorStatus.value === 403);

const canEdit = computed(() => props.detail.rights?.manage_access !== false);
const rows = ref<GrantRow[]>([]);
const grantsRev = ref<string>();
const serverError = ref<string | undefined>();
const saved = computed(() => grantsQuery.data.value ?? emptyGrants());
const edited = computed(() => grantsFromRows(rows.value));
const changes = computed(() => grantChangeCount(saved.value, edited.value));
const dirty = computed(() => changes.value > 0);
const tooLarge = computed(
  () => changes.value > GRANT_EDIT_LIMIT || serverError.value === "grant_edit_too_large",
);

const resetRows = () => {
  rows.value = rowsFromGrants(saved.value);
  serverError.value = undefined;
};
watch(saved, resetRows, { immediate: true });
watch(
  () => grantsQuery.data.value,
  (grants) => (grantsRev.value = grants?.grants_rev),
  { immediate: true },
);

const tableRows = computed(() => [
  { role: "admin", fixed: true, see: true, use: true, manage: true, manage_access: true },
  ...rows.value.map((r) => ({ ...r, fixed: false })),
]);

const RIGHT_KEYS = {
  see: "secrets.access.see",
  use: "secrets.access.use",
  manage: "secrets.access.manage",
  manage_access: "secrets.access.manageAccess",
} as const;
const rightLabel = (right: GrantRight): I18nText => t(RIGHT_KEYS[right]);

const columns: OTableColumnDef[] = [
  { id: "role", header: t("secrets.access.role"), size: 220, meta: { align: "left", flex: true } },
  ...GRANT_RIGHTS.map((right) => ({
    id: right,
    header: rightLabel(right),
    size: 110,
    meta: { align: "center" as const },
  })),
  { id: "remove", header: raw(""), size: 56 },
];

const roleToAdd = ref<string | null>(null);
const roleOptions = computed(() => {
  const listed = new Set(rows.value.map((r) => r.role));
  const names: string[] = (roles.data.value ?? []).map((r: any) =>
    typeof r === "string" ? r : String(r?.name ?? r?.role ?? ""),
  );
  return names
    .filter((n) => n && n !== "admin" && !listed.has(n))
    .map((n) => ({ label: raw(n), value: n }));
});

const setRight = (role: string, right: GrantRight, value: boolean) => {
  const row = rows.value.find((r) => r.role === role);
  if (row) row[right] = value;
  serverError.value = undefined;
};

const addRole = () => {
  if (!roleToAdd.value) return;
  rows.value.push({
    role: roleToAdd.value,
    see: true,
    use: false,
    manage: false,
    manage_access: false,
  });
  roleToAdd.value = null;
};

const removeRole = (role: string) => {
  rows.value = rows.value.filter((r) => r.role !== role);
};

const save = async () => {
  if (tooLarge.value) return;
  try {
    const { see, use, manage, manage_access } = edited.value;
    const res = await put.mutateAsync({
      see,
      use,
      manage,
      manage_access,
      expected_grants_rev: grantsRev.value,
    });
    grantsRev.value = res.data.grants_rev;
    toast({
      variant: hasGrants(res.data?.unapplied) ? "warning" : "success",
      message: hasGrants(res.data?.unapplied)
        ? t("secrets.access.unapplied")
        : t("secrets.access.saved"),
    });
  } catch (e) {
    serverError.value = secretErrorCode(e);
    if (serverError.value !== "grant_edit_too_large") {
      toast({ variant: "error", message: secretErrorText(t, e, t("secrets.access.saveFailed")) });
    }
  }
};
</script>
