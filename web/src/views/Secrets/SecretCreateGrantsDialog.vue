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

<!-- The only org-wide secret grant (R13-33); every other right is per secret. -->
<template>
  <ODialog
    :open="open"
    size="sm"
    :title="t('secrets.createGrants.title')"
    :secondary-button-label="t('common.cancel')"
    :primary-button-label="t('common.save')"
    :primary-button-disabled="!dirty || forbidden"
    :primary-button-loading="put.isPending.value"
    primary-button-data-test="secret-create-grants-save"
    data-test="secret-create-grants-dialog"
    @update:open="emit('update:open', $event)"
    @click:secondary="emit('update:open', false)"
    @click:primary="save"
  >
    <div class="flex flex-col gap-3">
      <OEmptyState
        v-if="forbidden"
        size="inline"
        icon="lock"
        :title="t('secrets.createGrants.forbidden')"
        data-test="secret-create-grants-forbidden"
      />
      <template v-else>
        <ul
          class="border-border-default divide-border-default rounded-surface flex flex-col divide-y border"
        >
          <li class="flex items-center gap-2 px-3 py-2">
            <span class="text-text-heading text-sm font-medium">{{ adminRole }}</span>
            <span class="text-text-secondary text-xs">{{ t("secrets.access.adminsAlways") }}</span>
          </li>
          <li
            v-for="role in draft"
            :key="role"
            class="flex items-center gap-2 px-3 py-2"
            :data-test="`secret-create-grants-${role}`"
          >
            <span class="text-text-heading min-w-0 flex-1 text-sm font-medium">{{ role }}</span>
            <OButton
              variant="ghost"
              size="icon-sm"
              icon-left="delete"
              :aria-label="t('secrets.access.removeRole')"
              :data-test="`secret-create-grants-${role}-remove`"
              @click="draft = draft.filter((r) => r !== role)"
            />
          </li>
        </ul>
        <div class="flex items-center gap-2">
          <OSelect
            v-model="roleToAdd"
            class="min-w-0 flex-1"
            size="sm"
            searchable
            :options="roleOptions"
            :placeholder="t('secrets.access.pickRole')"
            data-test="secret-create-grants-role-select"
          />
          <OButton
            variant="outline"
            size="sm"
            icon-left="add"
            :disabled="!roleToAdd"
            data-test="secret-create-grants-add"
            @click="addRole"
          >
            {{ t("secrets.access.addRole") }}
          </OButton>
        </div>
        <span class="text-text-secondary text-xs">{{ t("secrets.createGrants.hint") }}</span>
      </template>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { raw, useI18nTyped } from "@/types/i18n";
import { useOrgId } from "@/composables/query/useOrgId";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { rolesQuery } from "@/services/iam.queries";
import { putCreateGrantsMutation, secretCreateGrantsQuery } from "@/services/secrets.queries";
import { secretErrorText } from "./secretErrors";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();

const { t } = useI18nTyped();
const orgId = useOrgId();
const adminRole = raw("admin");

const grants = useQuery(() =>
  Object.assign(secretCreateGrantsQuery(orgId.value), { enabled: props.open && !!orgId.value }),
);
const roles = useQuery(() =>
  Object.assign(rolesQuery(orgId.value), { enabled: props.open && !!orgId.value }),
);
const put = useMutation(() => putCreateGrantsMutation(orgId.value));

const forbidden = computed(() => {
  const e: any = grants.error.value;
  return (e?.response?.status ?? e?.status) === 403;
});
const draft = ref<string[]>([]);
watch(
  [() => grants.data.value, () => props.open],
  () => (draft.value = [...(grants.data.value ?? [])]),
  {
    immediate: true,
  },
);
const dirty = computed(() => {
  const saved = [...(grants.data.value ?? [])].sort().join("\n");
  return saved !== [...draft.value].sort().join("\n");
});

const roleToAdd = ref<string | null>(null);
const roleOptions = computed(() =>
  (roles.data.value ?? [])
    .map((r: any) => (typeof r === "string" ? r : String(r?.name ?? r?.role ?? "")))
    .filter((n: string) => n && n !== "admin" && !draft.value.includes(n))
    .map((n: string) => ({ label: raw(n), value: n })),
);
const addRole = () => {
  if (roleToAdd.value) draft.value = [...draft.value, roleToAdd.value];
  roleToAdd.value = null;
};

const save = async () => {
  try {
    await put.mutateAsync([...draft.value]);
    toast({ variant: "success", message: t("secrets.createGrants.saved") });
    emit("update:open", false);
  } catch (e) {
    toast({ variant: "error", message: secretErrorText(t, e, t("secrets.access.saveFailed")) });
  }
};
</script>
