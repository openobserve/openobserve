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
    <div class="w-rail h-full shrink-0 max-md:h-auto max-md:w-full">
      <FleetRail
        ref="rail"
        :rows="fleets.rows.value"
        :active-id="activeFleetId"
        :loading="fleets.loading.value"
        :error="fleets.error.value"
        :forbidden="fleetsForbidden"
        @select="onRailPick"
        @retry="fleets.refetch()"
      />
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
              v-if="rolloutTag"
              type="fleetRolloutStatus"
              :value="rolloutTag"
              data-test="fleet-fleets-rollout-status"
            />
            <div class="ms-auto flex flex-wrap items-center gap-2">
              <OButton
                variant="ghost"
                size="sm"
                icon-left="add"
                data-test="fleet-fleets-add-collector"
                @click="installOpen = true"
              >
                {{ t("fleet.addCollector") }}
              </OButton>
              <OButton
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
                variant="ghost"
                size="sm"
                icon-left="settings"
                data-test="fleet-fleets-settings"
                @click="settingsOpen = true"
              >
                {{ t("fleet.fleets.settings") }}
              </OButton>
              <OButton
                variant="outline"
                size="sm"
                icon-left="rocket-launch"
                data-test="fleet-fleets-change-version"
                @click="changeOpen = true"
              >
                {{ t("fleet.fleets.changeVersion") }}
              </OButton>
            </div>
          </div>

          <KpiCardRow min-width="14rem">
            <KpiCard
              :label="t('fleet.fleets.desired')"
              icon="rocket-launch"
              icon-size="md"
              label-class="text-sm font-medium text-text-secondary"
              icon-class="bg-icon-chip-primary-bg text-icon-chip-primary-text"
              data-test="fleet-fleets-desired-card"
            >
              <template #value>
                <span
                  class="text-text-heading text-2xl leading-tight font-semibold"
                  data-test="fleet-fleets-desired"
                  >{{
                    fleet.desired ? versionText(fleet.desired) : t("fleet.fleets.noConfigAssigned")
                  }}</span
                >
              </template>
              <template #footer>
                <span
                  v-if="activeRollout"
                  class="inline-flex flex-wrap items-center gap-2"
                  data-test="fleet-fleets-rollout-progress"
                >
                  <OText variant="meta" class="tabular-nums">{{
                    progressText(activeRollout)
                  }}</OText>
                  <OButton
                    variant="ghost-primary"
                    size="sm"
                    data-test="fleet-fleets-open-rollout"
                    @click="openRollouts(activeRollout.id)"
                  >
                    {{ t("fleet.flowIssues.openRollout") }}
                  </OButton>
                </span>
                <OText v-else-if="!fleet.desired" variant="meta">{{
                  t("fleet.fleets.placeholderHint")
                }}</OText>
                <OText v-else variant="meta">{{ t("fleet.fleets.desiredHint") }}</OText>
              </template>
            </KpiCard>
            <KpiCard
              :label="t('fleet.fleets.stable')"
              icon="verified"
              icon-size="md"
              label-class="text-sm font-medium text-text-secondary"
              icon-class="bg-icon-chip-success-bg text-icon-chip-success-text"
              data-test="fleet-fleets-stable-card"
            >
              <template #value>
                <span
                  class="text-text-heading text-2xl leading-tight font-semibold"
                  data-test="fleet-fleets-stable"
                  >{{
                    fleet.stable ? versionText(fleet.stable) : t("fleet.fleets.noVersion")
                  }}</span
                >
              </template>
              <template #footer>
                <OText variant="meta">{{ t("fleet.fleets.stableHint") }}</OText>
              </template>
            </KpiCard>
            <KpiCard
              :label="t('fleet.fleets.members')"
              icon="dns"
              icon-size="md"
              label-class="text-sm font-medium text-text-secondary"
              icon-class="bg-icon-chip-info-bg text-icon-chip-info-text"
              data-test="fleet-fleets-members-card"
            >
              <template #value>
                <span
                  class="text-text-heading text-2xl leading-tight font-semibold tabular-nums"
                  data-test="fleet-fleets-members"
                  >{{
                    t("fleet.fleets.membersOnline", {
                      online: fleet.online,
                      total: fleet.collectors,
                    })
                  }}</span
                >
              </template>
              <template #footer>
                <OText variant="meta" class="tabular-nums">{{
                  t("fleet.fleets.atDesired", { count: fleet.atDesired, total: fleet.collectors })
                }}</OText>
              </template>
            </KpiCard>
          </KpiCardRow>
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
    <FleetFleetSettingsDrawer
      v-model:open="settingsOpen"
      :fleet-id="activeFleetId"
      :fleet-name="fleetName"
    />

    <FleetRollouts
      :open="rolloutsOpen"
      :fleet-id="activeFleetId"
      :fleet-name="fleetName"
      :rollout-id="openRolloutId"
      @update:open="onRolloutsOpen"
      @update:rollout-id="setRolloutId"
      @fix-forward="fixForward"
      @navigate="onRolloutNavigate"
    />

    <FleetNewRolloutDialog v-model:open="changeOpen" :fleet-id="activeFleetId" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import KpiCard from "@/components/common/KpiCard.vue";
import KpiCardRow from "@/components/common/KpiCardRow.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import FleetCollectors from "./FleetCollectors.vue";
import FleetFleetSettingsDrawer from "./FleetFleetSettingsDrawer.vue";
import FleetInstallDialog from "./FleetInstallDialog.vue";
import FleetNewRolloutDialog from "./FleetNewRolloutDialog.vue";
import FleetRail from "./FleetRail.vue";
import FleetRollouts from "./FleetRollouts.vue";
import FleetTokens from "./FleetTokens.vue";
import { fleetLocation, type FleetTab } from "./fleetRoute";
import { useRolloutText } from "./rolloutText";
import {
  isForbidden,
  rolloutTagValue,
  useFleetRollout,
  useFleetRollouts,
  useFleets,
  type RolloutRow,
} from "./useFleetApi";

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const { progressText } = useRolloutText();

const rail = ref<{ create: () => void } | null>(null);
const fleets = useFleets();
const fleetsForbidden = computed(() => isForbidden(fleets.error.value));
const rollouts = useFleetRollouts();

const changeOpen = ref(false);
const installOpen = ref(false);
const tokensOpen = ref(false);
const settingsOpen = ref(false);
const rolloutsOpen = ref(false);

const activeFleetId = computed(() =>
  typeof route.query.fleet === "string" && route.query.fleet ? route.query.fleet : "default",
);
// The Overview's expiring-token banner lands here with the tokens drawer open.
watch(
  () => route.query.tokens,
  (tokens) => {
    if (tokens !== "1") return;
    tokensOpen.value = true;
    router.replace({ query: { ...route.query, tokens: undefined } });
  },
  { immediate: true },
);
const allFleets = computed({
  get: () => route.query.scope === "all",
  set: (v: boolean) => router.replace({ query: { ...route.query, scope: v ? "all" : undefined } }),
});
const fleet = computed(() => fleets.rows.value.find((f) => f.id === activeFleetId.value));
const fleetName = computed(() => raw(fleet.value?.name ?? activeFleetId.value));
const activeRollout = computed(() => {
  const id = fleet.value?.rollout?.id;
  const status = fleet.value?.rollout?.status;
  if (!id || status === "completed" || status === "superseded" || status === "rolled_back")
    return null;
  return rollouts.rows.value.find((r) => r.id === id) ?? null;
});
const forbidden = computed(() => !allFleets.value && !!fleet.value && !fleet.value.readable);
// Only the rollout row knows whether a completed rollout targeted any collectors.
const rolloutTag = computed(() => {
  const status = fleet.value?.rollout?.status;
  if (!status) return null;
  const row = rollouts.rows.value.find((r) => r.id === fleet.value?.rollout?.id);
  if (row) return rolloutTagValue(row);
  return status !== "completed" ? status : null;
});
const openRolloutId = computed(() =>
  typeof route.query.rollout === "string" && route.query.rollout ? route.query.rollout : null,
);
const openRollout = useFleetRollout(
  () => openRolloutId.value,
  () => !!openRolloutId.value,
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
      router.replace({ query: { ...route.query, fleet: owner, scope: undefined } });
    }
  },
  { immediate: true },
);

// Without `?fleet=` the page lands on `default`, which a restricted reader may not list.
watch(
  () => [activeFleetId.value, fleets.rows.value] as const,
  ([id, rows]) => {
    if (id === "default" && rows.length && !rows.some((f) => f.id === "default")) {
      onRailPick(rows[0].id);
    }
  },
  { immediate: true },
);

function versionText(v: { config: string; version: number }) {
  return t("fleet.rollouts.publishSubtitle", { config: raw(v.config), version: v.version });
}

function onRailPick(id: string) {
  if (!id || (id === activeFleetId.value && route.query.fleet)) return;
  router.replace({ query: { ...route.query, fleet: id, scope: undefined, rollout: undefined } });
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

// Fix forward is a new desired version, so it opens the editor of the rollout's configuration.
function fixForward(r: RolloutRow) {
  onRolloutNavigate({ tab: "editor", query: { id: r.config } });
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

defineExpose({ create: () => rail.value?.create() });
</script>
