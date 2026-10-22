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
          v-if="collector.outdated"
          variant="warning-soft"
          :label="t('fleet.collectors.outdated')"
        />
        <div class="ms-auto flex flex-wrap items-center gap-2">
          <OButton
            variant="outline"
            size="sm"
            icon-left="drive-file-move"
            data-test="fleet-collector-drawer-move"
            @click="moveOpen = true"
          >
            {{ t("fleet.collectors.moveToFleet") }}
          </OButton>
          <span class="inline-flex">
            <OButton
              variant="outline"
              size="sm"
              icon-left="restart-alt"
              :disabled="!canRestart"
              :loading="actions.restarting.value"
              data-test="fleet-collector-drawer-restart"
              @click="actions.restart([collector])"
            >
              {{ t("fleet.collectors.restart") }}
            </OButton>
            <!-- A disabled button gets no pointer events, so the reason hangs on its wrapper. -->
            <OTooltip v-if="!canRestart" :content="t('fleet.collectors.restartUnsupported')" />
          </span>
          <OButton
            v-if="collector.config"
            variant="outline"
            size="sm"
            icon-left="sync"
            :loading="actions.redelivering.value"
            data-test="fleet-collector-drawer-redeliver"
            @click="actions.redeliver(collector)"
          >
            {{ t("fleet.collectors.redeliver") }}
          </OButton>
          <OButton
            variant="outline-destructive"
            size="sm"
            icon-left="delete"
            :loading="actions.removing.value"
            data-test="fleet-collector-drawer-remove"
            @click="removeNow"
          >
            {{ t("fleet.collectors.remove") }}
          </OButton>
        </div>
      </div>

      <OTabs v-model="tab" class="border-border-default mt-2 shrink-0 border-b" dense>
        <OTab name="overview" :label="t('fleet.collectors.overview')" />
        <OTab name="metrics" :label="t('fleet.collectorMetrics.tab')" />
        <OTab name="health" :label="t('fleet.collectors.health')" />
        <OTab name="config" :label="t('fleet.collectors.effectiveConfig')" />
        <OTab name="history" :label="t('fleet.collectors.history')" />
      </OTabs>

      <div class="min-h-0 flex-1 overflow-auto p-4">
        <div v-if="tab === 'overview'" class="flex flex-col gap-5">
          <OBanner
            v-if="collector.delivery === 'rejected' && collector.deliveryError"
            variant="error"
            dense
            preserve-whitespace
            :content="raw(collector.deliveryError)"
            data-test="fleet-collector-drawer-delivery-error"
          />
          <ODescriptionList>
            <ODescriptionItem :label="t('fleet.collectors.nickname')">
              <OInlineEdit
                :model-value="collector.name"
                size="sm"
                :maxlength="128"
                :aria-label="t('fleet.collectors.nickname')"
                :edit-hint="t('fleet.collectors.nicknameHelp')"
                data-test="fleet-collector-drawer-nickname"
                @commit="saveNickname"
              />
            </ODescriptionItem>
            <ODescriptionItem :label="t('fleet.collectors.collectorId')">
              <OText variant="mono" data-test="fleet-collector-drawer-id">{{ collector.id }}</OText>
            </ODescriptionItem>
            <ODescriptionItem :label="t('fleet.collectors.lastConnectedFrom')">
              <OText
                v-if="collector.lastConnectedFrom"
                variant="mono"
                data-test="fleet-collector-drawer-peer"
                >{{ collector.lastConnectedFrom }}</OText
              >
              <span v-else class="text-text-muted">{{ DASH }}</span>
            </ODescriptionItem>
            <ODescriptionItem :label="t('fleet.collectors.token')">
              <span v-if="tokenName" data-test="fleet-collector-drawer-token">{{ tokenName }}</span>
              <span v-else class="text-text-muted">{{ DASH }}</span>
            </ODescriptionItem>
            <ODescriptionItem :label="t('fleet.collectors.lastHeartbeat')">
              <OTimeCell
                :value="collector.evidence?.last_heartbeat_at ?? collector.lastSeen"
                unit="ms"
                mode="relative"
              />
            </ODescriptionItem>
            <ODescriptionItem :label="t('fleet.collectors.os')">
              <span v-if="osLine" data-test="fleet-collector-drawer-os">{{ osLine }}</span>
              <span v-else class="text-text-muted">{{ DASH }}</span>
            </ODescriptionItem>
            <ODescriptionItem :label="t('fleet.collectors.version')">
              <OText v-if="collector.version" variant="mono">{{ collector.version }}</OText>
              <span v-else class="text-text-muted">{{ DASH }}</span>
            </ODescriptionItem>
            <ODescriptionItem :label="t('fleet.collectors.fleet')">
              <span data-test="fleet-collector-drawer-fleet">{{ collector.fleetName }}</span>
            </ODescriptionItem>
            <ODescriptionItem :label="t('fleet.collectors.enrolled')">
              <OTimeCell :value="collector.enrolledAt" unit="ms" mode="date" />
            </ODescriptionItem>
            <ODescriptionItem :label="t('fleet.common.configuration')">
              <span v-if="collector.assignment" data-test="fleet-collector-drawer-assignment">{{
                t("fleet.collectors.assignmentValue", {
                  config: raw(collector.assignment.config),
                  version: collector.assignment.version,
                  revision: collector.assignment.revision,
                })
              }}</span>
              <span v-else class="text-text-muted" data-test="fleet-collector-drawer-assignment">{{
                t("fleet.collectors.placeholderAssigned")
              }}</span>
            </ODescriptionItem>
            <ODescriptionItem :label="t('fleet.collectors.delivery')">
              <span
                v-if="collector.delivery"
                class="inline-flex flex-wrap items-center gap-2"
                data-test="fleet-collector-drawer-delivery"
              >
                <OTag
                  type="fleetDelivery"
                  :value="collector.delivery"
                  :variant="collector.status === 'offline' ? 'default-outline' : undefined"
                />
                <OText
                  v-if="collector.status === 'offline'"
                  as="span"
                  variant="meta"
                  class="inline-flex items-center gap-1"
                  data-test="fleet-collector-drawer-delivery-offline"
                >
                  {{ t("fleet.collectors.deliveryOffline") }}
                  <OTimeCell
                    :value="collector.evidence?.last_heartbeat_at ?? collector.lastSeen"
                    unit="ms"
                    mode="relative"
                  />
                </OText>
              </span>
              <span v-else class="text-text-muted" data-test="fleet-collector-drawer-delivery">{{
                DASH
              }}</span>
            </ODescriptionItem>
            <ODescriptionItem :label="t('fleet.collectors.remoteStatus')">
              <span
                v-if="collector.evidence?.remote_status"
                class="inline-flex flex-wrap items-center gap-2"
                data-test="fleet-collector-drawer-remote"
              >
                <span>{{ collector.evidence.remote_status }}</span>
                <OTimeCell
                  v-if="collector.evidence.remote_at"
                  :value="collector.evidence.remote_at"
                  unit="ms"
                  mode="relative"
                />
              </span>
              <span v-else class="text-text-muted">{{ DASH }}</span>
            </ODescriptionItem>
            <ODescriptionItem :label="t('fleet.collectors.remoteHash')">
              <OText
                v-if="collector.evidence?.remote_hash"
                variant="mono"
                data-test="fleet-collector-drawer-remote-hash"
                >{{ collector.evidence.remote_hash }}</OText
              >
              <span v-else class="text-text-muted">{{ DASH }}</span>
            </ODescriptionItem>
            <ODescriptionItem :label="t('fleet.collectors.marker')">
              <span v-if="collector.evidence?.marker" data-test="fleet-collector-drawer-marker">{{
                t("fleet.rollouts.publishSubtitle", {
                  config: raw(collector.evidence.marker.config),
                  version: collector.evidence.marker.version,
                })
              }}</span>
              <span v-else class="text-text-muted" data-test="fleet-collector-drawer-marker">{{
                t("fleet.collectors.noMarker")
              }}</span>
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

        <FleetCollectorMetrics
          v-else-if="tab === 'metrics'"
          :collector-id="collector.id"
          :collector-name="collector.name"
        />

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
          <OBanner
            v-if="collector.healthError"
            variant="error"
            dense
            preserve-whitespace
            :content="raw(collector.healthError)"
            data-test="fleet-collector-drawer-errors"
          />
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
          <OText variant="meta">{{ t("fleet.collectors.healthMeaning") }}</OText>

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
          <template v-if="collector.effectiveConfig && split">
            <OText v-if="collector.effectiveConfig.reportedAt" variant="meta">
              {{ t("fleet.collectors.lastEffectiveReport") }}
              <OTimeCell :value="collector.effectiveConfig.reportedAt" unit="ms" mode="relative" />
            </OText>
            <FleetCodeEditor
              class="h-96"
              :code="split.user"
              language="yaml"
              :filename="raw('effective.yaml')"
              data-test="fleet-collector-drawer-yaml"
            />
            <OCollapsible
              v-if="split.system"
              :label="t('fleet.collectors.systemSections')"
              :caption="t('fleet.collectors.systemSectionsCaption')"
              data-test="fleet-collector-drawer-system-yaml"
            >
              <FleetCodeEditor
                class="h-60"
                :code="split.system"
                language="yaml"
                data-test="fleet-collector-drawer-system-yaml-code"
              />
            </OCollapsible>
          </template>
          <div v-else data-test="fleet-collector-drawer-no-yaml">
            <OEmptyState size="inline" :title="t('fleet.collectors.noEffectiveConfig')" />
          </div>
        </div>

        <div v-else data-test="fleet-collector-drawer-history">
          <OTimeline v-if="collector.history.length">
            <OTimelineItem
              v-for="(event, i) in collector.history"
              :key="i"
              :title="historyTitle(event.event)"
              :variant="HISTORY_VARIANT[event.event] ?? 'muted'"
            >
              <template #subtitle>
                <OTimeCell :value="event.at" unit="ms" mode="relative" />
              </template>
              <OText v-if="event.detail" variant="meta">{{ event.detail }}</OText>
            </OTimelineItem>
          </OTimeline>
          <OEmptyState v-else size="inline" :title="t('fleet.collectors.noHistory')" />
        </div>
      </div>
    </div>
    <FleetMoveDialog
      v-if="collector"
      v-model:open="moveOpen"
      :collector-ids="[collector.id]"
      :source-fleet-id="collector.fleetId"
    />
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OInlineEdit from "@/lib/forms/InlineEdit/OInlineEdit.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTimeline from "@/lib/data/Timeline/OTimeline.vue";
import OTimelineItem from "@/lib/data/Timeline/OTimelineItem.vue";
import type { TimelineItemVariant } from "@/lib/data/Timeline/OTimelineItem.types";
import ODescriptionList from "@/lib/lists/DescriptionList/ODescriptionList.vue";
import ODescriptionItem from "@/lib/lists/DescriptionList/ODescriptionItem.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import { useOrgId } from "@/composables/query/useOrgId";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import FleetCodeEditor from "./FleetCodeEditor.vue";
import FleetMoveDialog from "./FleetMoveDialog.vue";
import FleetCollectorMetrics from "./FleetCollectorMetrics.vue";
import { splitSystemSections } from "./effectiveConfig";
import { useCollectorActions } from "./useCollectorActions";
import { isForbidden, osLabel, useFleetCollector, useFleetTokens } from "./useFleetApi";

const props = defineProps<{
  open: boolean;
  collectorId: string | null;
  initialTab?: string;
}>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();

const DASH = raw("—");

const HISTORY_VARIANT: Record<string, TimelineItemVariant> = {
  enrolled: "muted",
  assigned: "primary",
  sent: "info",
  accepted: "info",
  running: "success",
  rejected: "destructive",
  moved: "primary",
  moved_by_token: "primary",
  restarted: "info",
  redelivered: "primary",
};

const { t } = useI18nTyped();
const orgId = useOrgId();
const actions = useCollectorActions();

const tab = ref(props.initialTab ?? "overview");
const moveOpen = ref(false);
watch(
  () => [props.collectorId, props.open, props.initialTab],
  () => {
    tab.value = props.initialTab ?? "overview";
  },
);
// The open collector belongs to the previous org, and any write would hit the new one.
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
const tokens = useFleetTokens(() => props.open);

const canRestart = computed(
  () =>
    !collector.value?.capabilities.length ||
    collector.value.capabilities.includes("AcceptsRestartCommand"),
);

const tokenName = computed<I18nText | null>(() => {
  const id = collector.value?.tokenId;
  if (!id) return null;
  const tok = tokens.rows.value.find((x) => x.id === id);
  return raw(tok ? `${tok.name} (${tok.prefix})` : id);
});

const osLine = computed<I18nText | null>(() => {
  const c = collector.value;
  if (!c) return null;
  const os = c.distribution ?? osLabel(c.os);
  if (os && c.arch) return t("fleet.collectors.osLine", { os: raw(os), arch: raw(c.arch) });
  return raw(os ?? c.arch) || null;
});

const split = computed(() =>
  collector.value?.effectiveConfig
    ? splitSystemSections(collector.value.effectiveConfig.yaml)
    : null,
);

function historyTitle(event: string): I18nText {
  const known: Record<string, I18nText> = {
    enrolled: t("fleet.collectors.eventEnrolled"),
    assigned: t("fleet.collectors.eventAssigned"),
    sent: t("fleet.delivery.sent"),
    accepted: t("fleet.delivery.accepted"),
    running: t("fleet.delivery.running"),
    rejected: t("fleet.delivery.rejected"),
    moved: t("fleet.collectors.eventMoved"),
    moved_by_token: t("fleet.collectors.eventMovedByToken"),
    restarted: t("fleet.collectors.eventRestarted"),
    redelivered: t("fleet.collectors.eventRedelivered"),
  };
  return known[event] ?? raw(event);
}

async function saveNickname(name: string) {
  const c = collector.value;
  const next = name.trim();
  if (!c || !next || next === c.name) return;
  await actions.rename(c.id, next);
}

async function removeNow() {
  const c = collector.value;
  if (!c) return;
  const gone = await actions.remove([c]);
  if (gone.includes(c.id)) emit("update:open", false);
}
</script>
