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
    :open="!!secretId"
    size="xl"
    bleed
    :title="raw(detail?.name ?? '')"
    :sub-title="subtitle"
    data-test="secret-drawer"
    @update:open="(v: boolean) => !v && emit('close')"
  >
    <div v-if="detailQuery.isPending.value" class="text-text-secondary px-5 py-4 text-sm">
      {{ t("common.loading") }}
    </div>
    <OEmptyState
      v-else-if="detailQuery.isError.value || !detail"
      preset="load-error"
      size="inline"
      data-test="secret-drawer-error"
      @action="detailQuery.refetch()"
    />
    <div v-else class="flex h-full min-h-0 flex-col">
      <OBanner
        v-if="detail.state === 'deleted'"
        class="mx-5 mt-3"
        variant="error"
        icon="delete"
        inline-actions
        :content="
          t('secrets.lifecycle.deletedBanner', { count: detail.usage_count }, detail.usage_count)
        "
        data-test="secret-drawer-deleted-banner"
      >
        <template #actions>
          <OButton
            v-if="detail.rights?.manage !== false"
            variant="outline"
            size="sm"
            icon-left="history"
            :loading="restore.isPending.value"
            data-test="secret-drawer-restore"
            @click="onRestore"
          >
            {{ t("secrets.lifecycle.restore") }}
          </OButton>
          <OButton
            v-if="detail.rights?.manage_access !== false"
            variant="outline-destructive"
            size="sm"
            data-test="secret-drawer-purge"
            @click="purgeOpen = true"
          >
            {{ t("secrets.lifecycle.purgeNow") }}
          </OButton>
        </template>
      </OBanner>
      <OBanner
        v-else-if="detail.state === 'conflict'"
        class="mx-5 mt-3"
        variant="warning"
        icon="warning"
        :content="t('secrets.lifecycle.conflictBanner')"
        data-test="secret-drawer-conflict-banner"
      />

      <div class="border-b-dialog-header-border flex shrink-0 items-center border-b pe-3">
        <OTabs v-model="tab" class="min-w-0 flex-1" data-test="secret-drawer-tabs">
          <OTab
            name="values"
            data-test="secret-drawer-tab-values"
            :label="t('secrets.drawer.values')"
          />
          <OTab
            name="policy"
            data-test="secret-drawer-tab-policy"
            :label="t('secrets.drawer.policy')"
          />
          <OTab
            name="access"
            data-test="secret-drawer-tab-access"
            :label="t('secrets.drawer.access')"
          />
          <OTab
            name="usage"
            data-test="secret-drawer-tab-usage"
            :label="t('secrets.drawer.usage')"
          />
          <OTab
            name="audit"
            data-test="secret-drawer-tab-audit"
            :label="t('secrets.drawer.audit')"
          />
        </OTabs>
        <ODropdown v-if="detail.state === 'active' && detail.rights?.manage !== false" align="end">
          <template #trigger>
            <OButton
              variant="ghost"
              size="icon-sm"
              icon-left="more-vert"
              :aria-label="t('secrets.drawer.more')"
              data-test="secret-drawer-more"
            />
          </template>
          <ODropdownItem
            icon-left="edit"
            data-test="secret-drawer-rename"
            @select="renameOpen = true"
          >
            {{ t("secrets.lifecycle.rename") }}
          </ODropdownItem>
          <ODropdownItem
            variant="destructive"
            icon-left="delete"
            data-test="secret-drawer-delete"
            @select="deleteOpen = true"
          >
            {{ t("secrets.lifecycle.delete") }}
          </ODropdownItem>
        </ODropdown>
      </div>

      <div class="min-h-0 flex-1 overflow-auto px-5 py-4">
        <SecretValuesTab v-if="tab === 'values'" :detail="detail" />
        <SecretPolicyTab v-else-if="tab === 'policy'" :key="detail.id" :detail="detail" />
        <SecretAccessTab v-else-if="tab === 'access'" :detail="detail" :fga-off="fgaOff" />
        <SecretUsageTab v-else-if="tab === 'usage'" :detail="detail" />
        <SecretAuditTab v-else :detail="detail" />
      </div>

      <SecretRenameDialog v-model:open="renameOpen" :detail="detail" />
      <SecretDeleteDialog v-model:open="deleteOpen" :detail="detail" />
      <SecretPurgeDialog v-model:open="purgeOpen" :detail="detail" @purged="emit('close')" />
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useOrgId } from "@/composables/query/useOrgId";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { restoreSecretMutation, secretDetailQuery } from "@/services/secrets.queries";
import SecretValuesTab from "./SecretValuesTab.vue";
import SecretPolicyTab from "./SecretPolicyTab.vue";
import SecretUsageTab from "./SecretUsageTab.vue";
import SecretAccessTab from "./SecretAccessTab.vue";
import SecretAuditTab from "./SecretAuditTab.vue";
import SecretRenameDialog from "./SecretRenameDialog.vue";
import SecretDeleteDialog from "./SecretDeleteDialog.vue";
import SecretPurgeDialog from "./SecretPurgeDialog.vue";
import { secretErrorText } from "./secretErrors";

export type SecretDrawerTab = "values" | "policy" | "access" | "usage" | "audit";

const props = defineProps<{
  secretId: string | null;
  initialTab?: SecretDrawerTab;
  fgaOff?: boolean;
}>();
const emit = defineEmits<{ close: [] }>();

const { t } = useI18nTyped();
const orgId = useOrgId();
const tab = ref<SecretDrawerTab>(props.initialTab ?? "values");
const renameOpen = ref(false);
const deleteOpen = ref(false);
const purgeOpen = ref(false);

const detailQuery = useQuery(() =>
  Object.assign(secretDetailQuery(orgId.value, props.secretId ?? ""), {
    enabled: !!orgId.value && !!props.secretId,
  }),
);
const detail = computed(() => detailQuery.data.value);

const subtitle = computed((): I18nText | undefined =>
  detail.value
    ? t(
        detail.value.kind === "secret"
          ? "secrets.drawer.subtitleSecret"
          : "secrets.drawer.subtitleVariable",
        {
          id: detail.value.id,
        },
      )
    : undefined,
);

watch(
  () => props.secretId,
  () => (tab.value = props.initialTab ?? "values"),
);

const restore = useMutation(() => restoreSecretMutation(orgId.value));
const onRestore = async () => {
  if (!detail.value) return;
  try {
    await restore.mutateAsync(detail.value.id);
    toast({
      variant: "success",
      message: t("secrets.lifecycle.restored", { name: detail.value.name }),
    });
  } catch (e) {
    toast({
      variant: "error",
      message: secretErrorText(t, e, t("secrets.lifecycle.restoreFailed")),
    });
  }
};
</script>
