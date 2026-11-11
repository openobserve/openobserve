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
  <div class="flex flex-col py-3.5" data-test="svcver-env-versions">
    <div class="text-text-body mb-3 flex flex-wrap items-center gap-2 text-[0.8125rem]">
      <OIcon name="info" size="sm" class="text-text-secondary" />
      <span>{{ t("serviceVersions.settings.intro") }}</span>
      <OButton
        variant="ghost-primary"
        size="xs"
        data-test="svcver-overrides-how-detection"
        @click="showDetection = !showDetection"
        >{{ t("serviceVersions.settings.howDetection") }}</OButton
      >
    </div>
    <p
      v-if="showDetection && rows.length"
      class="text-text-secondary mb-3 max-w-[48rem] text-[0.8125rem]"
      data-test="svcver-overrides-detection-text"
    >
      <i18n-t keypath="serviceVersions.settings.emptyBody" tag="span"
        ><template #attribute
          ><span class="font-mono">{{ raw("deployment.environment") }}</span></template
        ><template #changeEnv
          ><b class="text-text-heading">{{ t("serviceVersions.envEdit.title") }}</b></template
        ></i18n-t
      >
    </p>
    <div
      v-if="overrides.isPending.value"
      class="flex flex-col gap-2"
      data-test="svcver-overrides-loading"
    >
      <OSkeleton class="h-6 w-48" />
      <OSkeleton class="h-40 w-full" />
    </div>
    <OEmptyState
      v-else-if="denied"
      size="hero"
      preset="no-access"
      :description="t('serviceVersions.settings.denied')"
      data-test="svcver-overrides-denied"
    />
    <div
      v-else-if="overrides.isError.value"
      class="rounded-default border-border-default text-text-secondary flex items-center gap-2 border px-4 py-3 text-sm"
      data-test="svcver-overrides-error"
    >
      <OIcon name="error-outline" size="sm" class="text-status-error-text" />
      <span>{{ loadError }}</span>
      <OButton variant="ghost-primary" size="xs" @click="overrides.refetch()">{{
        t("serviceVersions.actions.retry")
      }}</OButton>
    </div>
    <div
      v-else-if="!rows.length && page === 1"
      class="rounded-default border-border-default flex flex-col items-center gap-2.5 border px-6 py-10 text-center"
      data-test="svcver-overrides-empty"
    >
      <span
        class="bg-tabs-active-bg text-tabs-active-text rounded-surface flex h-12 w-12 items-center justify-center"
        ><OIcon name="check" size="md"
      /></span>
      <div class="text-text-heading text-base font-semibold">
        {{ t("serviceVersions.settings.emptyTitle") }}
      </div>
      <div class="text-text-secondary max-w-[34rem] text-[0.8125rem]">
        <i18n-t keypath="serviceVersions.settings.emptyBody" tag="span"
          ><template #attribute
            ><span class="font-mono">{{ raw("deployment.environment") }}</span></template
          ><template #changeEnv
            ><b class="text-text-heading">{{ t("serviceVersions.envEdit.title") }}</b></template
          ></i18n-t
        >
      </div>
    </div>
    <template v-else>
      <div class="mb-2 flex items-center gap-2">
        <span class="text-text-heading text-sm font-semibold">{{
          t("serviceVersions.settings.title")
        }}</span>
        <span class="text-text-secondary text-xs">{{
          t("serviceVersions.settings.subtitle", { n: total })
        }}</span>
      </div>
      <OTable
        v-model:current-page="page"
        :data="rows"
        :columns="columns"
        row-key="rule_key"
        pagination="server"
        :page-size="PAGE_SIZE"
        :page-size-options="[PAGE_SIZE]"
        :total-count="total"
        :default-columns="false"
        dense
        bordered
        data-test="svcver-overrides-table"
      >
        <template #cell-matches="{ row }">
          <div class="flex flex-col py-1.5">
            <span
              >{{ match(row).text
              }}<span v-if="row.scope === 'cluster'" class="text-text-secondary"
                >{{ raw(" ") }}{{ t("serviceVersions.settings.match.allNamespaces") }}</span
              ></span
            >
            <span v-if="row.affected" class="text-text-secondary text-[0.6875rem]">{{
              reach(row.affected)
            }}</span>
          </div>
        </template>
        <template #cell-change="{ row }">
          <span class="flex items-center gap-2">
            <span class="flex flex-col items-start py-1.5">
              <ODimensionChip
                dim-key="env"
                :key-label="t('serviceVersions.compare.envChip')"
                :value="row.inferred_value"
                variant="success-soft"
                :value-tooltip="false"
              />
              <span class="text-text-secondary text-[0.6875rem]">{{
                t("serviceVersions.settings.from", { kind: envKind(row.inferred_source, t) })
              }}</span>
            </span>
            <OIcon name="arrow-forward" size="xs" class="text-text-muted" />
            <ODimensionChip
              dim-key="env"
              :key-label="t('serviceVersions.compare.envChip')"
              :value="row.value"
              variant="success-soft"
              :value-tooltip="false"
            />
          </span>
        </template>
        <template #cell-who="{ row }">
          <span class="flex items-center gap-2" :title="row.updated_by || row.created_by">
            <span
              class="bg-surface-panel text-text-secondary flex h-5 w-5 items-center justify-center rounded-full text-[0.5625rem] font-semibold"
              >{{ initials(row.updated_by || row.created_by) }}</span
            >{{ person(row.updated_by || row.created_by) }}
          </span>
        </template>
        <template #cell-when="{ row }">
          <span class="text-text-secondary">{{ when(row.updated_at) }}</span>
        </template>
        <template #cell-remove="{ row }">
          <OButton
            variant="ghost-destructive"
            size="xs"
            :loading="removing === row.rule_key"
            :disabled="Boolean(removing)"
            :data-test="`svcver-override-remove-${row.rule_key}`"
            @click="removeRow(row)"
            >{{ t("serviceVersions.settings.remove") }}</OButton
          >
        </template>
        <template #footer-note>{{ t("serviceVersions.settings.footer") }}</template>
      </OTable>
      <div
        v-if="actionError"
        class="text-status-error-text mt-2 text-xs"
        role="alert"
        data-test="svcver-overrides-action-error"
      >
        {{ actionError }}
      </div>
    </template>
    <div
      class="rounded-default bg-surface-panel border-border-default mt-4 flex items-center gap-2 border px-3 py-2.5 text-[0.8125rem]"
      data-test="svcver-overrides-versions-note"
    >
      <OIcon name="check" size="sm" class="text-text-secondary" />
      <span class="text-text-heading font-semibold">{{
        t("serviceVersions.settings.versionsTitle")
      }}</span>
      <i18n-t keypath="serviceVersions.settings.versionsNote" tag="span" class="text-text-secondary"
        ><template #raw
          ><span class="font-mono">{{ raw("v1.1.0-rc2-0778d32-cbf4ffe") }}</span></template
        ><template #clean
          ><span class="font-mono">{{ raw("v1.1.0-rc2") }}</span></template
        ></i18n-t
      >
    </div>
    <Teleport to="body">
      <div
        v-if="undo"
        class="rounded-default shadow-toast bg-toast-default-bg border-toast-default-border text-toast-fg pointer-events-auto fixed bottom-6 left-1/2 z-10001 flex -translate-x-1/2 items-center gap-3 border px-4 py-2.5 text-sm whitespace-nowrap"
        role="status"
        data-test="svcver-overrides-undo-bar"
      >
        <span>{{ undo.error || t("serviceVersions.settings.removed") }}</span>
        <OButton
          v-if="!undo.error"
          variant="ghost-primary"
          size="xs"
          :loading="undo.busy"
          data-test="svcver-overrides-undo"
          @click="runUndo"
          >{{ t("serviceVersions.settings.undo") }}</OButton
        >
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { useStore } from "vuex";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { isAxiosError } from "axios";
import { raw, useI18nTyped } from "@/types/i18n";
import type { IdentityOverride, OverrideAffected } from "@/services/service_versions";
import {
  deleteOverrideMutation,
  identityQuery,
  putOverrideMutation,
} from "@/services/service_versions.queries";
import { formatTimestampInTimezone } from "@/utils/date";
import { isOutsideK8s } from "@/utils/serviceVersionsCopy";
import { envKind, flatWhere, overrideWrite } from "@/components/shared/ChangeEnvPopover.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OTable from "@/lib/core/Table/OTable.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODimensionChip from "@/lib/core/Badge/ODimensionChip.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";

const PAGE_SIZE = 50;
const UNDO_MS = 10_000;
const { t } = useI18nTyped();
const store = useStore();
const org = computed(() => String(store.state.selectedOrganization?.identifier || ""));
const user = computed(() => String(store.state.userInfo?.email || ""));
const timezone = computed(() => String(store.state.timezone || "UTC"));
const page = ref(1);
const showDetection = ref(false);
const removing = ref("");
const actionError = ref("");
const undo = ref<{ removed: IdentityOverride; busy: boolean; error: string } | null>(null);
let undoTimer: ReturnType<typeof setTimeout> | undefined;

const overrides = useQuery(
  computed(() => ({
    ...identityQuery(org.value, user.value, "identityOverrides", {
      limit: PAGE_SIZE,
      offset: (page.value - 1) * PAGE_SIZE,
    }),
    enabled: Boolean(org.value),
  })),
);
const remove = useMutation(() => deleteOverrideMutation(org.value));
const put = useMutation(() => putOverrideMutation(org.value));
const rows = computed(() => overrides.data.value?.overrides || []);
const total = computed(() => overrides.data.value?.total || 0);
const denied = computed(() => {
  const error = overrides.error.value;
  return isAxiosError(error) && error.response?.status === 403;
});
const loadError = computed(() => {
  const error = overrides.error.value;
  return isAxiosError(error) && error.response?.status === 503
    ? t("serviceVersions.settings.unavailable")
    : t("serviceVersions.settings.loadError");
});
const columns = computed<OTableColumnDef<IdentityOverride>[]>(() => [
  { id: "matches", header: t("serviceVersions.settings.cols.matches"), size: 420 },
  { id: "change", header: t("serviceVersions.settings.cols.inferredSetTo"), size: 300 },
  { id: "who", header: t("serviceVersions.settings.cols.who"), size: 140 },
  { id: "when", header: t("serviceVersions.settings.cols.when"), size: 130 },
  { id: "remove", header: raw(""), size: 100 },
]);

onBeforeUnmount(() => clearTimeout(undoTimer));

function k8sParts(whereKey: string) {
  const [cluster, namespace = ""] = whereKey.slice(4).split("/", 2);
  return { cluster, namespace };
}

function whereText(row: IdentityOverride) {
  if (isOutsideK8s(row.where_key)) return t("serviceVersions.where.outside");
  if (!row.where_key.startsWith("k8s:"))
    return t("serviceVersions.settings.match.whereFlat", { where: flatWhere(row.where_key) });
  const { cluster, namespace } = k8sParts(row.where_key);
  return cluster
    ? t("serviceVersions.settings.match.where", { namespace, cluster })
    : t("serviceVersions.settings.match.whereNoCluster", { namespace });
}

function match(row: IdentityOverride) {
  if (row.scope === "cluster")
    return { text: t("serviceVersions.settings.match.cluster", { cluster: row.k8s_cluster }) };
  if (row.scope === "service" && isOutsideK8s(row.where_key))
    return {
      text: t("serviceVersions.settings.match.serviceOutside", { service: row.service_name }),
    };
  if (row.scope === "service")
    return {
      text: t("serviceVersions.settings.match.service", {
        service: row.service_name,
        where: whereText(row),
      }),
    };
  return { text: whereText(row) };
}

function reach({ services, versions }: OverrideAffected) {
  return `${t("serviceVersions.envEdit.impactServices", { n: services }, services)} · ${t(
    "serviceVersions.envEdit.impactVersions",
    { n: versions },
    versions,
  )}`;
}
function person(value: string) {
  return value.split("@")[0] || value;
}

function initials(value: string) {
  const parts = person(value)
    .split(/[._\-\s]+/)
    .filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : person(value).slice(0, 2);
  return letters.toUpperCase();
}

function when(us: number) {
  const sameDay =
    formatTimestampInTimezone(us, "yyyy-MM-dd", timezone.value) ===
    formatTimestampInTimezone(Date.now() * 1000, "yyyy-MM-dd", timezone.value);
  return sameDay
    ? t("serviceVersions.settings.today", {
        time: formatTimestampInTimezone(us, "HH:mm", timezone.value),
      })
    : formatTimestampInTimezone(us, "d MMM yyyy", timezone.value);
}

async function removeRow(row: IdentityOverride) {
  if (removing.value) return;
  removing.value = row.rule_key;
  actionError.value = "";
  try {
    const result = await remove.mutateAsync(row.rule_key);
    clearTimeout(undoTimer);
    undo.value = { removed: result.removed || row, busy: false, error: "" };
    undoTimer = setTimeout(() => {
      undo.value = null;
    }, UNDO_MS);
  } catch (failure) {
    actionError.value =
      isAxiosError(failure) && failure.response?.status === 403
        ? t("serviceVersions.settings.denied")
        : t("serviceVersions.settings.removeFailed");
  } finally {
    removing.value = "";
  }
}

async function runUndo() {
  const state = undo.value;
  if (!state || state.busy) return;
  state.busy = true;
  try {
    await put.mutateAsync(overrideWrite(state.removed));
    clearTimeout(undoTimer);
    undo.value = null;
  } catch {
    state.error = t("serviceVersions.settings.undoFailed");
  } finally {
    state.busy = false;
  }
}
</script>
