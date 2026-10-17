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
  <div class="flex min-h-0 flex-1 max-md:flex-col" data-test="fleet-fleets">
    <div
      class="w-rail max-md:border-border-default h-full shrink-0 max-md:h-auto max-md:w-full max-md:border-b"
    >
      <FolderList ref="folderList" type="fleets" @update:active-folder-id="onRailPick" />
    </div>

    <div class="flex h-full min-w-0 flex-1 flex-col max-md:h-auto max-md:min-h-0">
      <template v-if="!allFleets">
        <div
          v-if="fleetsForbidden || (fleet && !fleet.readable)"
          class="px-page-edge border-border-default shrink-0 border-b py-3"
          data-test="fleet-fleets-no-access"
        >
          <OEmptyState
            size="inline"
            preset="no-access"
            :description="fleetsForbidden ? undefined : t('fleet.fleets.noAccess')"
          />
        </div>
        <div
          v-else-if="!fleet && fleets.error.value"
          class="px-page-edge border-border-default shrink-0 border-b py-3"
          data-test="fleet-fleets-load-error"
        >
          <OEmptyState size="inline" preset="load-error" @action="fleets.refetch()" />
        </div>
        <div
          v-else-if="!fleet && fleets.loading.value"
          class="px-page-edge border-border-default flex shrink-0 justify-center border-b py-3"
          data-test="fleet-fleets-loading"
        >
          <OSpinner />
        </div>
        <div
          v-else-if="!fleet"
          class="px-page-edge border-border-default shrink-0 border-b py-3"
          data-test="fleet-fleets-not-found"
        >
          <OEmptyState size="inline" preset="no-data" :title="t('fleet.fleets.notFound')" />
        </div>
        <div
          v-else
          class="px-page-edge border-border-default flex shrink-0 flex-col gap-3 border-b py-3"
          data-test="fleet-fleets-panel"
        >
          <div class="flex items-center gap-2 max-md:flex-wrap">
            <OText variant="card-title" truncate data-test="fleet-fleets-name">{{
              fleetName
            }}</OText>
            <OTag
              v-if="revisionTag"
              type="fleetRolloutStatus"
              :value="revisionTag"
              data-test="fleet-fleets-revision-status"
            />
            <div class="ms-auto flex flex-wrap items-center gap-2">
              <OButton
                v-if="halted && revision"
                variant="outline"
                size="sm"
                icon-left="refresh"
                data-test="fleet-fleets-retry"
                @click="openDialog(revision)"
              >
                {{ t("fleet.fleets.retry") }}
              </OButton>
              <OButton
                v-if="revertTo"
                variant="outline"
                size="sm"
                icon-left="undo"
                :loading="setDesired.isPending.value"
                data-test="fleet-fleets-revert"
                @click="revert(revertTo)"
              >
                {{ t("fleet.fleets.revert", { version: revertTo.version }) }}
              </OButton>
              <OButton
                v-if="fleet?.readable"
                variant="ghost"
                size="sm"
                icon-left="add"
                data-test="fleet-fleets-add-collector"
                @click="installOpen = true"
              >
                {{ t("fleet.addCollector") }}
              </OButton>
              <OButton
                v-if="fleet?.readable"
                variant="ghost"
                size="sm"
                icon-left="key"
                data-test="fleet-fleets-tokens"
                @click="tokensOpen = true"
              >
                {{ t("fleet.enrollment.tokens") }}
              </OButton>
              <OButton
                variant="ghost"
                size="sm"
                icon-left="history"
                data-test="fleet-fleets-rollouts"
                @click="openRollouts(null)"
              >
                {{ t("fleet.fleets.rollouts") }}
              </OButton>
              <OButton
                variant="outline"
                size="sm"
                icon-left="rocket-launch"
                data-test="fleet-fleets-change-version"
                @click="openDialog(null)"
              >
                {{ t("fleet.fleets.changeVersion") }}
              </OButton>
            </div>
          </div>
          <ODescriptionList>
            <ODescriptionItem :label="t('fleet.fleets.desired')">
              <span data-test="fleet-fleets-desired">{{
                fleet?.desired ? versionText(fleet.desired) : t("fleet.fleets.noVersion")
              }}</span>
            </ODescriptionItem>
            <ODescriptionItem :label="t('fleet.fleets.stable')">
              <span data-test="fleet-fleets-stable">{{
                fleet?.stable
                  ? t("fleet.common.versionShort", { version: fleet.stable.version })
                  : t("fleet.fleets.noVersion")
              }}</span>
            </ODescriptionItem>
            <ODescriptionItem v-if="fleet?.revision" :label="t('fleet.fleets.revision')">
              <span class="inline-flex flex-wrap items-center gap-2">
                <span v-if="revision" class="tabular-nums">{{
                  countsText(revision, revision.total)
                }}</span>
                <OButton
                  variant="ghost-primary"
                  size="sm"
                  data-test="fleet-fleets-open-revision"
                  @click="openRollouts(fleet.revision.id)"
                >
                  {{ t("fleet.flowIssues.openRollout") }}
                </OButton>
              </span>
            </ODescriptionItem>
            <ODescriptionItem :label="t('fleet.fleets.members')">
              <span class="inline-flex flex-wrap gap-x-3" data-test="fleet-fleets-members">
                <span>{{
                  t("fleet.fleets.membersOnline", {
                    online: fleet?.online ?? 0,
                    total: fleet?.collectors ?? 0,
                  })
                }}</span>
                <span>{{
                  t("fleet.fleets.atDesired", {
                    count: fleet?.atDesired ?? 0,
                    total: fleet?.collectors ?? 0,
                  })
                }}</span>
              </span>
            </ODescriptionItem>
          </ODescriptionList>
        </div>
      </template>
      <FleetCollectors
        v-model:all-fleets="allFleets"
        :fleet-id="activeFleetId"
        :forbidden="forbidden"
      />
    </div>

    <FleetInstallDialog v-model:open="installOpen" :fleet-id="activeFleetId" />
    <FleetTokens v-model:open="tokensOpen" :fleet-id="activeFleetId" :fleet-name="fleetName" />

    <FleetRollouts
      :open="rolloutsOpen"
      :fleet-id="activeFleetId"
      :fleet-name="fleetName"
      :rollout-id="openRolloutId"
      @update:open="onRolloutsOpen"
      @update:rollout-id="setRolloutId"
      @revert="(fleetId, to) => revert(to, fleetId)"
      @retry="retryFromRollouts"
      @navigate="onRolloutNavigate"
    />

    <FleetNewRolloutDialog
      v-model:open="changeOpen"
      :fleet-id="activeFleetId"
      :retry-of="retrying"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { useMutation } from "@tanstack/vue-query";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import ODescriptionList from "@/lib/lists/DescriptionList/ODescriptionList.vue";
import ODescriptionItem from "@/lib/lists/DescriptionList/ODescriptionItem.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import FolderList from "@/components/common/sidebar/FolderList.vue";
import { useOrgId } from "@/composables/query/useOrgId";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { setFleetDesiredMutation } from "@/services/fleet.queries";
import { raw, useI18nTyped } from "@/types/i18n";
import FleetCollectors from "./FleetCollectors.vue";
import FleetNewRolloutDialog from "./FleetNewRolloutDialog.vue";
import FleetRollouts from "./FleetRollouts.vue";
import FleetInstallDialog from "./FleetInstallDialog.vue";
import FleetTokens from "./FleetTokens.vue";
import { fleetLocation, type FleetTab } from "./fleetRoute";
import { useRolloutText } from "./rolloutText";
import {
  rolloutTagValue,
  isForbidden,
  serverMessage,
  useFleetRollout,
  useFleetRollouts,
  useFleets,
  type RolloutRow,
} from "./useFleetApi";

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const orgId = useOrgId();
const { countsText } = useRolloutText();
const store = useStore();
const { confirm } = useConfirmDialog();

const folderList = ref<{ addFolder: () => void } | null>(null);
const fleets = useFleets();
const fleetsForbidden = computed(() => isForbidden(fleets.error.value));
const rollouts = useFleetRollouts();
const setDesired = useMutation(() => setFleetDesiredMutation(orgId.value));

const changeOpen = ref(false);
const installOpen = ref(false);
const tokensOpen = ref(false);
const retrying = ref<RolloutRow | null>(null);
const rolloutsOpen = ref(false);

const activeFleetId = computed(() =>
  typeof route.query.folder === "string" && route.query.folder ? route.query.folder : "default",
);
const allFleets = computed({
  get: () => route.query.scope === "all",
  set: (v: boolean) => router.replace({ query: { ...route.query, scope: v ? "all" : undefined } }),
});
const fleet = computed(() => fleets.rows.value.find((f) => f.id === activeFleetId.value));
const fleetName = computed(() => raw(fleet.value?.name ?? activeFleetId.value));
const halted = computed(() => fleet.value?.revision?.status === "halted");
const revertTo = computed(() => {
  const f = fleet.value;
  if (!f?.stable || !f.desired) return null;
  const same = f.stable.config === f.desired.config && f.stable.version === f.desired.version;
  return same ? null : f.stable;
});
const revision = computed(() =>
  rollouts.rows.value.find((r) => r.id === fleet.value?.revision?.id),
);
const forbidden = computed(() => !allFleets.value && !!fleet.value && !fleet.value.readable);
// Only the rollout row knows whether a completed revision targeted any collectors.
const revisionTag = computed(() => {
  if (revision.value) return rolloutTagValue(revision.value);
  const status = fleet.value?.revision?.status;
  return status && status !== "completed" ? status : null;
});
const openRolloutId = computed(() =>
  typeof route.query.rollout === "string" && route.query.rollout ? route.query.rollout : null,
);
const openRollout = useFleetRollout(
  () => openRolloutId.value,
  () => !!openRolloutId.value,
);

// The rail refreshes the shared list after a create, rename or delete, but emits nothing on delete.
watch(
  () => store.state.organizationData.foldersByType?.fleets,
  (_now, before) => before && fleets.refetch(),
);

watch(openRolloutId, (id) => id && (rolloutsOpen.value = true), { immediate: true });

// A `?rollout=` link may lack its fleet, so the rollout's own fleet is selected once either read knows it.
watch(
  () =>
    [
      openRolloutId.value,
      openRollout.detail.value,
      rollouts.rows.value,
      activeFleetId.value,
    ] as const,
  ([id, detail, rows, fleetId]) => {
    const owner = detail?.fleetId ?? rows.find((r) => r.id === id)?.fleetId;
    if (owner && owner !== fleetId) {
      router.replace({ query: { ...route.query, folder: owner, scope: undefined } });
    }
  },
  { immediate: true },
);

// The rail lands on `default` without a `?folder=`, which a restricted reader may not list.
watch(
  () => [activeFleetId.value, fleets.rows.value] as const,
  ([id, rows]) => {
    if (id === "default" && rows.length && !rows.some((f) => f.id === "default")) {
      selectFleet(rows[0].id);
    }
  },
  { immediate: true },
);

function versionText(v: { config: string; version: number }) {
  return t("fleet.rollouts.publishSubtitle", { config: raw(v.config), version: v.version });
}

function selectFleet(id: string) {
  if (!id || id === route.query.folder) return;
  router.replace({ query: { ...route.query, folder: id } });
}

// FolderList emits its initial selection on mount, so re-picking the active fleet must keep `?scope=all`.
function onRailPick(id: string) {
  if (!id || id === activeFleetId.value) return;
  router.replace({ query: { ...route.query, folder: id, scope: undefined, rollout: undefined } });
}

function setRolloutId(id: string | null) {
  router.replace({ query: { ...route.query, rollout: id ?? undefined } });
}

function openRollouts(id: string | null) {
  rolloutsOpen.value = true;
  setRolloutId(id);
}

function onRolloutsOpen(open: boolean) {
  rolloutsOpen.value = open;
  if (!open && openRolloutId.value) setRolloutId(null);
}

function retryFromRollouts(r: RolloutRow) {
  onRolloutsOpen(false);
  openDialog(r);
}

function onRolloutNavigate(target: { tab: string; query: Record<string, string> }) {
  rolloutsOpen.value = false;
  if (target.tab === "editor") {
    const org = route.query.org_identifier;
    router.push({
      name: "fleetConfigEditor",
      params: { id: target.query.id },
      query: org ? { org_identifier: org } : {},
    });
    return;
  }
  router.replace(fleetLocation(target.tab as FleetTab, target.query, route.query));
}

function openDialog(retryOf: RolloutRow | null) {
  retrying.value = retryOf;
  changeOpen.value = true;
}

async function revert(target: { config: string; version: number }, fleetId = activeFleetId.value) {
  const name = fleets.rows.value.find((f) => f.id === fleetId)?.name ?? fleetId;
  const ok = await confirm({
    title: t("fleet.fleets.revertTitle", { fleet: raw(name), version: target.version }),
    message: t("fleet.fleets.revertMessage", { version: target.version }),
    confirmLabel: t("fleet.fleets.revertConfirm"),
  });
  if (!ok) return;
  try {
    await setDesired.mutateAsync({
      fleet: fleetId,
      body: { config: target.config, version: target.version, strategy: "immediate" },
    });
    toast({
      variant: "success",
      message: t("fleet.fleets.reverting", { version: target.version }),
    });
  } catch (err) {
    toast({
      variant: "error",
      message: raw(serverMessage(err)) || t("fleet.common.requestFailed"),
    });
  }
}

defineExpose({ create: () => folderList.value?.addFolder() });
</script>
