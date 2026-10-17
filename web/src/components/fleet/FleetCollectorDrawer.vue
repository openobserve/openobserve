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
    size="lg"
    :title="collector ? raw(collector.name) : undefined"
    :sub-title="collector?.hostname ? raw(collector.hostname) : undefined"
    bleed
    data-test="fleet-collector-drawer"
    @update:open="emit('update:open', $event)"
  >
    <div
      v-if="error && !collector"
      class="flex h-full items-center justify-center"
      data-test="fleet-collector-drawer-error"
    >
      <OEmptyState
        v-if="forbidden"
        preset="no-access"
        data-test="fleet-collector-drawer-forbidden"
      />
      <OEmptyState v-else preset="load-error" @action="refetch" />
    </div>
    <div
      v-else-if="!collector"
      class="flex h-full items-center justify-center"
      data-test="fleet-collector-drawer-loading"
    >
      <OSpinner />
    </div>
    <div v-else class="flex h-full min-h-0 flex-col">
      <div class="flex shrink-0 flex-wrap items-center gap-2 px-4 pt-3">
        <OTag type="serviceStatus" :value="collector.status" />
        <OTag
          v-if="collector.drifted === true"
          variant="warning-soft"
          :label="t('fleet.collectors.drifted')"
        />
        <OTag
          v-if="collector.outdated"
          variant="warning-soft"
          :label="t('fleet.collectors.outdated')"
        />
        <div class="ms-auto flex items-center gap-2">
          <OButton
            variant="outline"
            size="sm"
            icon-left="drive-file-move"
            data-test="fleet-collector-drawer-move"
            @click="moveOpen = true"
          >
            {{ t("fleet.collectors.moveToFleet") }}
          </OButton>
          <OButton
            variant="outline-destructive"
            size="sm"
            icon-left="link-off"
            :loading="unenroll.isPending.value"
            data-test="fleet-collector-drawer-unenroll"
            @click="unenrollNow"
          >
            {{ t("fleet.collectors.unenroll") }}
          </OButton>
        </div>
      </div>

      <OTabs v-model="tab" class="border-border-default mt-2 shrink-0 border-b" dense>
        <OTab name="overview" :label="t('fleet.tabs.overview')" />
        <OTab name="health" :label="t('fleet.collectors.health')" />
        <OTab name="config" :label="t('fleet.collectors.effectiveConfig')" />
        <OTab name="history" :label="t('fleet.collectors.history')" />
      </OTabs>

      <div class="min-h-0 flex-1 overflow-auto p-4">
        <div v-if="tab === 'overview'" class="flex flex-col gap-5">
          <ODescriptionList>
            <ODescriptionItem :label="t('fleet.collectors.collectorId')">
              <OText variant="mono" data-test="fleet-collector-drawer-id">{{ collector.id }}</OText>
            </ODescriptionItem>
            <ODescriptionItem :label="t('fleet.collectors.ip')">
              <span v-if="collector.ip">{{ collector.ip }}</span>
              <span v-else class="text-text-muted">{{ DASH }}</span>
            </ODescriptionItem>
            <ODescriptionItem :label="t('fleet.collectors.os')">
              <span v-if="osLine" data-test="fleet-collector-drawer-os">{{ osLine }}</span>
              <span v-else class="text-text-muted">{{ DASH }}</span>
            </ODescriptionItem>
            <ODescriptionItem :label="t('fleet.collectors.version')">
              <OText v-if="collector.version" variant="mono">{{ collector.version }}</OText>
              <span v-else class="text-text-muted">{{ DASH }}</span>
            </ODescriptionItem>
            <ODescriptionItem :label="t('fleet.common.configuration')">
              <span
                v-if="collector.config"
                class="inline-flex items-center gap-1.5"
                data-test="fleet-collector-drawer-config"
              >
                {{ collector.config }}
                <template v-if="collector.configVersion !== null">
                  {{ t("fleet.common.versionShort", { version: collector.configVersion }) }}
                </template>
                <OTag
                  v-if="collector.delivery"
                  type="fleetDelivery"
                  :value="collector.delivery"
                  size="xs"
                />
              </span>
              <span
                v-else
                class="inline-flex items-center gap-1.5"
                data-test="fleet-collector-drawer-config"
              >
                <span class="text-text-muted">{{ t("fleet.collectors.notAssigned") }}</span>
                <OTag
                  v-if="collector.delivery"
                  type="fleetDelivery"
                  :value="collector.delivery"
                  size="xs"
                />
              </span>
            </ODescriptionItem>
            <ODescriptionItem :label="t('fleet.collectors.fleet')">
              <span data-test="fleet-collector-drawer-fleet">{{ collector.fleetName }}</span>
            </ODescriptionItem>
            <ODescriptionItem :label="t('fleet.collectors.lastSeen')">
              <OTimeCell :value="collector.lastSeen" unit="ms" mode="relative" />
            </ODescriptionItem>
            <ODescriptionItem :label="t('fleet.collectors.enrolled')">
              <OTimeCell :value="collector.enrolledAt" unit="ms" mode="date" />
            </ODescriptionItem>
            <ODescriptionItem :label="t('fleet.collectors.capabilities')" stacked>
              <div
                v-if="collector.capabilities.length"
                class="flex flex-wrap gap-1"
                data-test="fleet-collector-drawer-capabilities"
              >
                <OTag
                  v-for="cap in collector.capabilities"
                  :key="cap"
                  variant="default-soft"
                  :label="raw(cap)"
                />
              </div>
              <span v-else class="text-text-muted">{{ t("fleet.collectors.noCapabilities") }}</span>
            </ODescriptionItem>
          </ODescriptionList>
        </div>

        <div v-else-if="tab === 'health'" class="flex flex-col gap-5">
          <div class="flex items-center gap-2">
            <OText variant="panel-title">{{ t("fleet.collectors.diagnostics") }}</OText>
            <OText
              v-if="collector.status === 'offline' && collector.healthReported"
              variant="meta"
              data-test="fleet-collector-drawer-last-reported"
              >{{ t("fleet.collectors.lastReported") }}</OText
            >
          </div>
          <div
            v-if="collector.errors.length"
            class="flex flex-col gap-2"
            data-test="fleet-collector-drawer-errors"
          >
            <OBanner
              v-for="(err, i) in collector.errors"
              :key="i"
              variant="error"
              dense
              preserve-whitespace
              :content="raw(err)"
            />
          </div>
          <OBanner
            v-else-if="!collector.healthReported"
            dense
            :content="t('fleet.collectors.noHealth')"
            data-test="fleet-collector-drawer-no-health"
          />
          <OBanner
            v-else
            :variant="collector.status === 'offline' ? 'default' : 'success'"
            dense
            :content="t('fleet.collectors.noErrors')"
            data-test="fleet-collector-drawer-no-errors"
          />

          <ODescriptionList dense>
            <ODescriptionItem :label="t('fleet.collectors.componentHealth')" stacked>
              <div
                v-if="collector.components.length"
                class="flex flex-col gap-1.5"
                data-test="fleet-collector-drawer-components"
              >
                <div
                  v-for="comp in collector.components"
                  :key="comp.id"
                  class="flex items-center gap-2"
                >
                  <OTag type="serviceStatus" :value="comp.status" />
                  <OText variant="mono">{{ comp.id }}</OText>
                  <OText v-if="comp.lastError" variant="meta">{{ comp.lastError }}</OText>
                </div>
              </div>
              <span v-else class="text-text-muted" data-test="fleet-collector-drawer-components">{{
                t("fleet.collectors.noComponentHealth")
              }}</span>
            </ODescriptionItem>
          </ODescriptionList>
        </div>

        <div v-else-if="tab === 'config'" class="flex flex-col gap-3">
          <ODescriptionList dense>
            <ODescriptionItem :label="t('fleet.collectors.assignedVia')">
              <span v-if="assignment" data-test="fleet-collector-drawer-assignment">{{
                assignment
              }}</span>
              <span v-else class="text-text-muted">{{ t("fleet.collectors.notAssigned") }}</span>
            </ODescriptionItem>
            <ODescriptionItem :label="t('fleet.collectors.lastEffectiveReport')">
              <OTimeCell
                v-if="collector.effectiveConfig"
                :value="collector.effectiveConfig.reportedAt"
                unit="ms"
                mode="relative"
              />
              <span v-else class="text-text-muted">{{ DASH }}</span>
            </ODescriptionItem>
            <ODescriptionItem :label="t('fleet.collectors.delivery')">
              <OTag
                v-if="collector.delivery"
                type="fleetDelivery"
                :value="collector.delivery"
                data-test="fleet-collector-drawer-delivery"
              />
              <span v-else class="text-text-muted" data-test="fleet-collector-drawer-delivery">{{
                DASH
              }}</span>
            </ODescriptionItem>
          </ODescriptionList>
          <OBanner
            v-if="collector.drifted === true"
            variant="warning"
            dense
            :content="t('fleet.collectors.driftBody')"
          />
          <FleetConfigDiff
            v-if="
              collector.drifted === true && collector.baselineConfig && collector.effectiveConfig
            "
            :before="collector.baselineConfig"
            :after="collector.effectiveConfig.yaml"
          />
          <FleetCodeEditor
            v-if="collector.effectiveConfig"
            class="h-96"
            :code="collector.effectiveConfig.yaml"
            language="yaml"
            :filename="raw('effective.yaml')"
            data-test="fleet-collector-drawer-yaml"
          />
          <div v-else data-test="fleet-collector-drawer-no-yaml">
            <OEmptyState size="inline" :title="t('fleet.collectors.noEffectiveConfig')" />
          </div>
        </div>

        <OTimeline v-else>
          <OTimelineItem
            v-for="event in history"
            :key="event.id"
            :title="event.title"
            :variant="event.variant"
          >
            <template #subtitle>
              <OTimeCell :value="event.at" unit="ms" mode="relative" />
            </template>
          </OTimelineItem>
        </OTimeline>
      </div>
    </div>
    <MoveAcrossFolders
      v-if="collector"
      v-model:open="moveOpen"
      :active-folder-id="collector.fleetId"
      :module-id="[collector.id]"
      type="fleets"
      @updated="onMoved"
    />
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useMutation } from "@tanstack/vue-query";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTimeline from "@/lib/data/Timeline/OTimeline.vue";
import OTimelineItem from "@/lib/data/Timeline/OTimelineItem.vue";
import type { TimelineItemVariant } from "@/lib/data/Timeline/OTimelineItem.types";
import ODescriptionList from "@/lib/lists/DescriptionList/ODescriptionList.vue";
import ODescriptionItem from "@/lib/lists/DescriptionList/ODescriptionItem.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { useOrgId } from "@/composables/query/useOrgId";
import { queryClient } from "@/composables/query/queryClient";
import MoveAcrossFolders from "@/components/common/sidebar/MoveAcrossFolders.vue";
import { unenrollCollectorsMutation } from "@/services/fleet.queries";
import { fleetKeys } from "@/services/fleet.querykeys";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import FleetCodeEditor from "./FleetCodeEditor.vue";
import FleetConfigDiff from "./FleetConfigDiff.vue";
import { isForbidden, osLabel, serverMessage, useFleetCollector } from "./useFleetApi";

const props = defineProps<{
  open: boolean;
  collectorId: string | null;
  initialTab?: string;
}>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();

const DASH = raw("—");

const { t } = useI18nTyped();

const { confirm } = useConfirmDialog();
const orgId = useOrgId();
const unenroll = useMutation(() => unenrollCollectorsMutation(orgId.value));

const tab = ref(props.initialTab ?? "overview");
const moveOpen = ref(false);
watch(
  () => [props.collectorId, props.open, props.initialTab],
  () => {
    tab.value = props.initialTab ?? "overview";
  },
);
// The open collector belongs to the previous org, and any move or unenroll would hit the new one.
watch(orgId, () => {
  moveOpen.value = false;
  if (props.open) emit("update:open", false);
});

const query = useFleetCollector(
  () => props.collectorId,
  () => props.open,
);
const collector = query.detail;
const error = query.error;
const forbidden = computed(() => isForbidden(error.value));
const refetch = () => query.refetch();

const osLine = computed<I18nText | null>(() => {
  const c = collector.value;
  if (!c) return null;
  const os = c.distribution ?? osLabel(c.os);
  if (os && c.arch) return t("fleet.collectors.osLine", { os: raw(os), arch: raw(c.arch) });
  return raw(os ?? c.arch) || null;
});

const assignment = computed<I18nText | null>(() => {
  const c = collector.value;
  if (!c?.config) return null;
  return t("fleet.collectors.assignedThroughFleet", {
    fleet: raw(c.fleetName),
    config: raw(c.config),
    version: c.configVersion ?? DASH,
  });
});

const history = computed<
  { id: string; title: I18nText; at: number; variant: TimelineItemVariant }[]
>(() => {
  const c = collector.value;
  if (!c) return [];
  // Offline is derived when read, so its onset is unknown; only stored timestamps are shown.
  const events: { id: string; title: I18nText; at: number | null; variant: TimelineItemVariant }[] =
    [
      {
        id: "seen",
        title: t("fleet.collectors.lastSeen"),
        at: c.lastSeen,
        variant: c.status === "offline" ? "destructive" : "success",
      },
      {
        id: "drift",
        title: t("fleet.collectors.eventDrift"),
        at: c.driftSince,
        variant: "destructive",
      },
      {
        id: "applied",
        title: t("fleet.collectors.eventApplied"),
        at: c.appliedAt,
        variant: "success",
      },
      {
        id: "assigned",
        title: t("fleet.collectors.eventAssigned"),
        at: c.assignedAt,
        variant: "primary",
      },
      { id: "enr", title: t("fleet.collectors.eventEnrolled"), at: c.enrolledAt, variant: "muted" },
    ];
  return events
    .filter((e): e is typeof e & { at: number } => e.at !== null)
    .sort((a, b) => b.at - a.at);
});

async function unenrollNow() {
  const c = collector.value;
  if (!c) return;
  const org = orgId.value;
  const ok = await confirm({
    title: t("fleet.collectors.unenrollTitle", { name: raw(c.name) }),
    message: t("fleet.collectors.unenrollMessage"),
    confirmLabel: t("fleet.collectors.unenroll"),
    confirmVariant: "destructive",
    focusCancel: true,
  });
  if (!ok || orgId.value !== org) return;
  try {
    await unenroll.mutateAsync([c.id]);
    emit("update:open", false);
    toast({
      variant: "success",
      message: t("fleet.collectors.unenrolledToast", { name: raw(c.name) }),
    });
  } catch (err) {
    toastFailure(err);
  }
}

function onMoved() {
  moveOpen.value = false;
  queryClient.invalidateQueries({ queryKey: fleetKeys.all(orgId.value) });
}

function toastFailure(err: unknown) {
  toast({ variant: "error", message: raw(serverMessage(err)) || t("fleet.common.requestFailed") });
}
</script>
