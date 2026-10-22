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
    :title="mode === 'list' ? t('fleet.enrollment.tokens') : t('fleet.enrollment.newToken')"
    :sub-title="fleetName"
    data-test="fleet-tokens-drawer"
    @update:open="onOpen"
  >
    <div class="flex flex-col gap-4">
      <OText variant="meta" data-test="fleet-tokens-security-note">{{
        t("fleet.enrollment.securityNote")
      }}</OText>
      <div v-if="mode !== 'list'" class="flex flex-col gap-5">
        <div>
          <OButton
            variant="ghost"
            size="sm"
            icon-left="arrow-back"
            data-test="fleet-tokens-back"
            @click="toList"
          >
            {{ t("fleet.enrollment.allTokens") }}
          </OButton>
        </div>
        <FleetTokenForm v-if="mode === 'create'" :fleet-id="fleetId" @created="onCreated" />
        <div v-else-if="created" class="flex flex-col gap-3">
          <OBanner variant="info" dense :content="t('fleet.enrollment.copyOnce')" />
          <OCodeBlock
            :code="created.token"
            lang="plaintext"
            chrome="editor"
            :filename="t('fleet.enrollment.tokenLabel')"
            data-test="fleet-tokens-new-token"
          />
          <div>
            <OButton
              variant="primary"
              size="sm-action"
              data-test="fleet-tokens-done"
              @click="toList"
            >
              {{ t("fleet.common.done") }}
            </OButton>
          </div>
        </div>
      </div>

      <OTable
        v-else
        :data="tokens"
        :columns="columns"
        row-key="id"
        :frame="false"
        pagination="client"
        :page-size="20"
        :show-global-filter="false"
        :loading="loading"
        :error="loadError"
        :forbidden="forbidden"
        :row-tone="(row: TokenRow) => (stateOf(row) === 'active' ? null : 'muted')"
        data-test="fleet-tokens-table"
      >
        <template #toolbar>
          <div class="min-w-0 flex-1 max-md:min-w-40">
            <OSearchInput
              v-model="search"
              class="w-full"
              size="sm"
              clearable
              :placeholder="t('fleet.enrollment.search')"
              data-test="fleet-tokens-search"
            />
          </div>
        </template>

        <template #toolbar-trailing>
          <ORefreshButton
            layout="inline"
            variant="outline"
            :last-run-at="lastUpdatedAt"
            :loading="fetching"
            data-test="fleet-tokens-refresh"
            @click="refresh"
          />
          <OButton
            variant="outline"
            size="sm"
            icon-left="add"
            data-test="fleet-tokens-create"
            @click="mode = 'create'"
          >
            {{ t("fleet.enrollment.newToken") }}
          </OButton>
        </template>

        <template #cell-prefix="{ row }">
          <span class="flex items-center gap-1">
            <span
              class="text-text-secondary font-mono text-xs"
              :data-test="`fleet-tokens-prefix-${row.id}`"
              >{{ masked(row.prefix) }}</span
            >
            <OButton
              v-if="row.token"
              variant="ghost-muted"
              size="icon-xs"
              icon-left="content-copy"
              :aria-label="t('fleet.enrollment.copyToken')"
              :title="t('fleet.enrollment.copyToken')"
              :data-test="`fleet-tokens-copy-${row.id}`"
              @click="copyToken(row.token)"
            />
          </span>
        </template>

        <template #cell-inUse="{ row }">
          <span class="tabular-nums" :data-test="`fleet-tokens-in-use-${row.id}`">
            <template v-if="usage(row.id).total">{{
              t("fleet.enrollment.inUse", usage(row.id))
            }}</template>
            <span v-else class="text-text-muted">{{ DASH }}</span>
          </span>
        </template>

        <template #cell-state="{ row }">
          <span :data-test="`fleet-tokens-state-${row.id}`">
            <OTag
              v-if="expiresSoon(row)"
              variant="warning-soft"
              dot
              :label="t('fleet.enrollment.expiresSoon')"
            />
            <OTag v-else :variant="STATE_VARIANT[stateOf(row)]" dot :label="stateLabel(row)" />
          </span>
        </template>

        <template #cell-uses="{ row }">
          <span class="tabular-nums" :data-test="`fleet-tokens-uses-${row.id}`">{{
            row.maxUses !== null
              ? t("fleet.enrollment.usesOf", { uses: row.uses, max: row.maxUses })
              : t("fleet.enrollment.usesUnlimited", { uses: row.uses })
          }}</span>
        </template>

        <template #cell-expiresAt="{ row }">
          <span
            v-if="row.expiresAt"
            :class="expiresSoon(row) ? 'text-status-warning-text font-medium' : ''"
            :data-test="`fleet-tokens-expires-${row.id}`"
          >
            <OTimeCell :value="row.expiresAt" unit="ms" mode="date" />
          </span>
          <span v-else class="text-text-secondary">{{ t("fleet.enrollment.never") }}</span>
        </template>

        <template #cell-createdAt="{ row }">
          <OTimeCell :value="row.createdAt" unit="ms" mode="relative" />
        </template>

        <template #cell-actions="{ row }">
          <OButton
            v-if="!row.revoked"
            variant="ghost-destructive"
            size="icon-sm"
            icon-left="block"
            :aria-label="t('fleet.enrollment.revoke')"
            :disabled="revokeToken.isPending.value"
            :data-test="`fleet-tokens-revoke-${row.id}`"
            @click="revoking = row"
          >
            <OTooltip :content="t('fleet.enrollment.revoke')" />
          </OButton>
        </template>

        <template #empty>
          <div data-test="fleet-tokens-empty">
            <OEmptyState size="block" preset="no-data" :filtered="!!search" @action="search = ''" />
          </div>
        </template>

        <template #error>
          <div data-test="fleet-tokens-error">
            <OEmptyState size="block" preset="load-error" @action="refresh" />
          </div>
        </template>
      </OTable>
    </div>
    <FleetRevokeTokenDialog
      :open="!!revoking"
      :token="revoking"
      :affected="affected"
      :loading="revokeToken.isPending.value"
      @update:open="(v) => !v && (revoking = null)"
      @confirm="revoke"
    />
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useMutation } from "@tanstack/vue-query";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import { copyToClipboard } from "@/utils/clipboard";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useOrgId } from "@/composables/query/useOrgId";
import { revokeFleetTokenMutation } from "@/services/fleet.queries";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import FleetRevokeTokenDialog from "./FleetRevokeTokenDialog.vue";
import FleetTokenForm from "./FleetTokenForm.vue";
import {
  isForbidden,
  serverMessage,
  tokenExpiresSoon,
  tokenState,
  useFleetCollectors,
  useFleetTokens,
  type TokenRow,
  type TokenState,
} from "./useFleetApi";

const props = defineProps<{ open: boolean; fleetId: string; fleetName: I18nText }>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();

const STATE_VARIANT: Record<
  TokenState,
  "success-soft" | "default-soft" | "warning-soft" | "error-soft"
> = {
  active: "success-soft",
  expired: "default-soft",
  exhausted: "warning-soft",
  revoked: "error-soft",
};

const { t } = useI18nTyped();
const orgId = useOrgId();

const list = useFleetTokens(() => props.open);
const loading = list.loading;
const fetching = list.fetching;
const lastUpdatedAt = list.lastUpdatedAt;
const forbidden = computed(() => isForbidden(list.error.value));
const refresh = () => list.refetch();
const revokeToken = useMutation(() => revokeFleetTokenMutation(orgId.value));
const collectors = useFleetCollectors(() => props.open);
const revoking = ref<TokenRow | null>(null);

const DASH = raw("—");

// A collector uses the token it presented last, which is what revoking cuts off.
const usageByToken = computed(() => {
  const out = new Map<string, { online: number; offline: number; total: number }>();
  for (const c of collectors.rows.value) {
    if (!c.tokenId) continue;
    const u = out.get(c.tokenId) ?? { online: 0, offline: 0, total: 0 };
    if (c.status === "offline" || c.status === "unknown") u.offline += 1;
    else u.online += 1;
    u.total += 1;
    out.set(c.tokenId, u);
  }
  return out;
});
const usage = (id: string) => usageByToken.value.get(id) ?? { online: 0, offline: 0, total: 0 };
const affected = computed(() =>
  revoking.value ? collectors.rows.value.filter((c) => c.tokenId === revoking.value?.id) : [],
);

const search = ref("");
const mode = ref<"list" | "create" | "created">("list");
const created = ref<{ id: string; token: string } | null>(null);

const fleetTokens = computed(() => list.rows.value.filter((tok) => tok.fleetId === props.fleetId));
const tokens = computed(() => {
  const q = search.value.trim().toLowerCase();
  return q
    ? fleetTokens.value.filter((tok) => tok.name.toLowerCase().includes(q))
    : fleetTokens.value;
});
// Judged on this fleet's rows: other fleets' cached tokens must not hide a failed read.
const loadError = computed(() =>
  list.error.value && !forbidden.value && !fleetTokens.value.length
    ? String(list.error.value)
    : null,
);

// A plaintext shown for one org or fleet must not stay on screen after a switch.
watch([orgId, () => props.fleetId], () => {
  revoking.value = null;
  toList();
  search.value = "";
});

const stateOf = (row: TokenRow) => tokenState(row, Date.now());
const expiresSoon = (row: TokenRow) =>
  stateOf(row) === "active" && tokenExpiresSoon(row, Date.now());
const masked = (prefix: string) => raw(`${prefix}••••••••••••`);
const copyToken = (token: string) =>
  copyToClipboard(token, t, { successMessage: t("fleet.enrollment.tokenCopied") });

function stateLabel(row: TokenRow): I18nText {
  const labels: Record<TokenState, I18nText> = {
    active: t("fleet.enrollment.active"),
    expired: t("fleet.enrollment.expired"),
    exhausted: t("fleet.enrollment.exhausted"),
    revoked: t("fleet.enrollment.revoked"),
  };
  return labels[stateOf(row)];
}

const columns = computed<OTableColumnDef<TokenRow>[]>(() => [
  { id: "name", header: t("fleet.common.name"), accessorKey: "name", size: 180, sortable: true },
  {
    id: "prefix",
    header: t("fleet.enrollment.prefix"),
    accessorKey: "prefix",
    size: 150,
    meta: { cellOverflowTooltip: false },
  },
  { id: "state", header: t("fleet.common.status"), accessorKey: "revoked", size: 110 },
  { id: "expiresAt", header: t("fleet.enrollment.expires"), accessorKey: "expiresAt", size: 110 },
  { id: "uses", header: t("fleet.enrollment.enrollments"), accessorKey: "uses", size: 110 },
  {
    id: "inUse",
    header: t("fleet.enrollment.inUseHeader"),
    accessorFn: (r) => usage(r.id).total,
    size: 140,
  },
  { id: "createdAt", header: t("fleet.enrollment.created"), accessorKey: "createdAt", size: 110 },
  { id: "actions", header: raw(""), isAction: true, size: 56 },
]);

function toList() {
  mode.value = "list";
  created.value = null;
}

function onOpen(open: boolean) {
  if (!open) toList();
  emit("update:open", open);
}

function onCreated(token: { id: string; token: string }) {
  // A create that resolves after the drawer closed or left the form must not reopen its plaintext.
  if (!props.open || mode.value !== "create") return;
  created.value = token;
  mode.value = "created";
}

async function revoke(row: TokenRow) {
  const org = orgId.value;
  const fleet = props.fleetId;
  try {
    await revokeToken.mutateAsync(row.id);
    // The row belongs to the org and fleet the dialog was opened in.
    if (orgId.value === org && props.fleetId === fleet) revoking.value = null;
    toast({
      variant: "success",
      message: t("fleet.enrollment.revokedToast", { name: raw(row.name) }),
    });
  } catch (err) {
    toast({
      variant: "error",
      message: raw(serverMessage(err)) || t("fleet.common.requestFailed"),
    });
  }
}
</script>
