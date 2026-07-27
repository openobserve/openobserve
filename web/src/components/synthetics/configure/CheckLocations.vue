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

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18nTyped } from "@/types/i18n";
import type { BrowserCheck, SyntheticsLocation } from "@/types/synthetics";
import awsSvgUrl from "@/assets/images/ingestion/aws.svg";
import gcpSvgUrl from "@/assets/images/ingestion/gcp.svg";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OCheckboxGroup from "@/lib/forms/Checkbox/OCheckboxGroup.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import SkeletonBox from "@/components/shared/SkeletonBox.vue";
import { formatTimeAgoUs } from "@/utils/synthetics/format";

const props = defineProps<{
  check: BrowserCheck;
  locations: SyntheticsLocation[];
  /** Shows the private-locations subsection + setup CTA (protocol checks only —
   *  browser tests are Lambda-only and pass the public list without this). */
  allowPrivate?: boolean;
  validationErrors?: Record<string, string>;
  /** When true, shows skeleton placeholder rows instead of the location list. */
  loadingLocations?: boolean;
}>();
const emit = defineEmits<{
  "update:check": [value: BrowserCheck];
  /** Open the form to create a new private location. */
  "new-location": [];
  /** Open agent setup pre-scoped to the given location. */
  "add-agent": [locationId: string];
  /** Request parent to re-fetch locations. */
  "refresh-locations": [];
}>();

const { t } = useI18nTyped();

// ── Search ────────────────────────────────────────────────────────────────────

const searchQuery = ref("");

function matchesSearch(location: SyntheticsLocation): boolean {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return true;
  return (
    location.label.toLowerCase().includes(q) || (location.region ?? "").toLowerCase().includes(q)
  );
}

// ── Icon & display name ──────────────────────────────────────────────────────

function locationIcon(provider: string): string {
  const p = provider.toLowerCase();
  if (p === "aws") return "img:" + awsSvgUrl;
  if (p === "gcp") return "img:" + gcpSvgUrl;
  return "location-on";
}

/** "Label · Region", omitting the region when it's blank or a mechanical
 *  duplicate of the label (private locations without a set region default to
 *  a slug of their own label server-side, which reads as pointless noise). */
function locationDisplayName(location: SyntheticsLocation): string {
  const region = location.region?.trim();
  if (!region || region.toLowerCase() === location.label.trim().toLowerCase()) {
    return location.label;
  }
  return `${location.label} · ${region}`;
}

// ── Status tiers ─────────────────────────────────────────────────────────────

type StatusTier = "ready" | "connecting" | "offline" | "down";

interface StatusInfo {
  tier: StatusTier;
  icon: string;
  label: string;
  iconClass: string;
  message: string;
  badgeVariant: "success-outline" | "info-outline" | "warning-outline" | "error-outline";
  actionLabel: string;
  actionVariant: "outline";
}

function getStatusInfo(location: SyntheticsLocation): StatusInfo {
  const status = location.status;

  if (status === "online") {
    return {
      tier: "ready",
      icon: "check-circle",
      label: t("synthetics.locations.statusReady"),
      iconClass: "text-status-success-text",
      message: "",
      badgeVariant: "success-outline",
      actionLabel: t("synthetics.locations.addAgent"),
      actionVariant: "outline",
    };
  }

  if (status === "pending") {
    return {
      tier: "connecting",
      icon: "schedule",
      label: t("synthetics.locations.statusConnecting"),
      iconClass: "text-status-info-text",
      message: t("synthetics.locations.connectingMessage"),
      badgeVariant: "info-outline",
      actionLabel: t("synthetics.locations.installAgent"),
      actionVariant: "outline",
    };
  }

  // offline — determine if it's "down" based on last_seen_at
  const nowUs = Date.now() * 1000;
  const lastSeen = location.last_seen_at ?? 0;
  const isDown = lastSeen > 0 && (nowUs - lastSeen) / 1_000_000 / 3600 >= 24;

  if (isDown) {
    return {
      tier: "down",
      icon: "error-outline",
      label: t("synthetics.locations.statusDown"),
      iconClass: "text-status-error-text",
      message: t("synthetics.locations.downMessage"),
      badgeVariant: "error-outline",
      actionLabel: t("synthetics.locations.addAgent"),
      actionVariant: "outline",
    };
  }

  return {
    tier: "offline",
    icon: "warning",
    label: t("synthetics.locations.statusOffline"),
    iconClass: "text-status-error-text",
    message: t("synthetics.locations.offlineMessage"),
    badgeVariant: "warning-outline",
    actionLabel: t("synthetics.locations.addAgent"),
    actionVariant: "outline",
  };
}

// ── Agent info ───────────────────────────────────────────────────────────────

interface AgentDisplay {
  /** The first agent name to show inline (or empty string). */
  firstAgent: string;
  /** Count of remaining agents beyond the first. */
  extra: number;
  /** All agent names (for tooltip). */
  allNames: string[];
  /** Live agent count. */
  count: number;
  /** The status line text (e.g. "1 live agent", "Offline · last seen 2h ago"). */
  statusText: string;
}

function agentDisplay(location: SyntheticsLocation): AgentDisplay {
  const names = location.agent_names ?? [];
  const count = location.live_agents ?? names.length;

  if (location.status === "online") {
    return {
      firstAgent: names[0] ?? "",
      extra: Math.max(0, names.length - 1),
      allNames: names,
      count,
      statusText: t("synthetics.locations.liveAgents", { count }),
    };
  }

  if (location.status === "offline" && location.last_seen_at) {
    return {
      firstAgent: "",
      extra: 0,
      allNames: [],
      count: 0,
      statusText: t("synthetics.locations.offlineSince", {
        ago: formatTimeAgoUs(location.last_seen_at),
      }),
    };
  }

  if (location.status === "pending") {
    return {
      firstAgent: "",
      extra: 0,
      allNames: [],
      count: 0,
      statusText: t("synthetics.locations.pendingAgent"),
    };
  }

  return { firstAgent: "", extra: 0, allNames: [], count: 0, statusText: "" };
}

// ── Location lists ───────────────────────────────────────────────────────────

const STATUS_SORT: Record<string, number> = { online: 0, pending: 1, offline: 2 };

const publicLocations = computed(() => props.locations.filter((l) => l.kind !== "private"));

const filteredPublicLocations = computed(() => publicLocations.value.filter(matchesSearch));

const privateLocations = computed(() => {
  const list = props.locations.filter((l) => l.kind === "private");
  // Sort: online → pending → offline, alphabetical within groups
  return [...list].sort((a, b) => {
    const aStatus = STATUS_SORT[a.status ?? "offline"] ?? 99;
    const bStatus = STATUS_SORT[b.status ?? "offline"] ?? 99;
    if (aStatus !== bStatus) return aStatus - bStatus;
    return a.label.localeCompare(b.label);
  });
});

const filteredPrivateLocations = computed(() => privateLocations.value.filter(matchesSearch));

const selectedLocations = computed({
  get: () => props.check.locations,
  set: (v: (string | number)[]) =>
    emit("update:check", { ...props.check, locations: v.map(String) }),
});
</script>

<template>
  <div class="rounded-default border-border-default mb-4 border">
    <div class="border-border-default flex items-center border-b px-3 py-2.5">
      <div class="rounded-default bg-accent mr-2 h-4 w-[0.1875rem] shrink-0" />
      <h3 class="text-text-heading text-base font-semibold">
        {{ t("synthetics.locations.title") }}
      </h3>
    </div>
    <div class="flex flex-col gap-3 px-3 py-2">
      <!-- ── Search ────────────────────────────────────────────────────────── -->
      <!-- ── Search + refresh ────────────────────────────────────────────────── -->
      <div v-if="!loadingLocations" class="flex items-center gap-2">
        <OInput
          v-model="searchQuery"
          type="search"
          :placeholder="t('synthetics.locations.searchPlaceholder')"
          class="flex-1"
          data-test="synthetics-check-locations-search"
        />
        <OButton
          variant="outline"
          size="sm"
          icon-left="refresh"
          data-test="synthetics-check-locations-refresh-btn"
          @click="emit('refresh-locations')"
        />
      </div>

      <!-- ── Loading skeleton ──────────────────────────────────────────────── -->
      <div
        v-if="loadingLocations"
        class="flex flex-col gap-2"
        data-test="synthetics-check-locations-loading"
      >
        <p class="text-text-secondary text-xs">
          {{ t("synthetics.locations.loadingLocations") }}
        </p>
        <div v-for="i in 4" :key="'skel-' + i" class="flex items-center gap-2 py-1">
          <SkeletonBox width="1rem" height="1rem" variant="custom" :rounded="true" />
          <SkeletonBox width="60%" height="0.875rem" variant="text" />
        </div>
      </div>

      <!-- ── Loaded content ─────────────────────────────────────────────────── -->
      <template v-else>
        <OCheckboxGroup
          v-if="locations.length"
          v-model="selectedLocations"
          data-test="synthetics-check-locations-group"
        >
          <!-- ── Public section ───────────────────────────────────────────── -->
          <template v-if="allowPrivate && filteredPublicLocations.length">
            <p class="text-text-secondary flex items-center gap-1 pb-1 text-xs">
              <span class="font-medium capitalize">{{
                t("synthetics.locations.publicTitle")
              }}</span>
              <OTooltip :content="t('synthetics.locations.publicSubtitle')">
                <OIcon name="info" size="2xs" class="text-text-secondary cursor-help" />
              </OTooltip>
            </p>
          </template>
          <OCheckbox
            v-for="location in filteredPublicLocations"
            :key="location.id"
            :value="location.id"
            :data-test="`synthetics-check-locations-option-${location.id}`"
            class="pb-2"
          >
            <template #label>
              <span class="flex items-center gap-1.5">
                <OIcon :name="locationIcon(location.provider)" size="sm" />
                {{ locationDisplayName(location) }}
              </span>
            </template>
          </OCheckbox>

          <!-- ── Private section ──────────────────────────────────────────── -->
          <template v-if="allowPrivate">
            <div class="flex items-center justify-between pt-2 pb-1">
              <p class="text-text-secondary flex items-center gap-1 text-xs">
                <span class="font-medium capitalize">{{
                  t("synthetics.locations.privateTitle")
                }}</span>
                <OTooltip :content="t('synthetics.locations.privateSubtitle')">
                  <OIcon name="info" size="2xs" class="text-text-secondary cursor-help" />
                </OTooltip>
              </p>
              <OButton
                variant="primary"
                size="xs"
                data-test="synthetics-check-locations-new-location-btn"
                @click="emit('new-location')"
              >
                {{ t("synthetics.locations.newLocation") }}
              </OButton>
            </div>

            <!-- ── Private location rows ─────────────────────────────────── -->
            <template v-if="filteredPrivateLocations.length">
              <div
                v-for="location in filteredPrivateLocations"
                :key="location.id"
                class="flex items-start gap-2 pb-2"
              >
                <OCheckbox
                  :value="location.id"
                  :data-test="`synthetics-check-locations-option-${location.id}`"
                  class="min-w-0 flex-1"
                >
                  <template #label>
                    <span class="flex flex-col gap-0.5">
                      <span class="flex items-center gap-1.5">
                        <OIcon
                          :name="getStatusInfo(location).icon"
                          size="sm"
                          :class="getStatusInfo(location).iconClass"
                          :data-test="`synthetics-check-locations-status-icon-${location.id}`"
                        />
                        {{ locationDisplayName(location) }}
                        <OTooltip
                          v-if="getStatusInfo(location).message"
                          :content="getStatusInfo(location).message"
                        >
                          <OBadge
                            :variant="getStatusInfo(location).badgeVariant"
                            size="xs"
                            :data-test="`synthetics-check-locations-status-badge-${location.id}`"
                          >
                            {{ getStatusInfo(location).label }}
                          </OBadge>
                        </OTooltip>
                        <OBadge
                          v-else
                          :variant="getStatusInfo(location).badgeVariant"
                          size="xs"
                          :data-test="`synthetics-check-locations-status-badge-${location.id}`"
                        >
                          {{ getStatusInfo(location).label }}
                        </OBadge>
                      </span>
                      <span class="text-text-label text-xs">
                        {{ agentDisplay(location).statusText
                        }}<template v-if="agentDisplay(location).firstAgent">
                          ·
                          <span class="text-text-secondary">{{
                            agentDisplay(location).firstAgent
                          }}</span>
                        </template>
                        <OTooltip
                          v-if="agentDisplay(location).extra > 0"
                          :content="agentDisplay(location).allNames.join(', ')"
                        >
                          <OBadge
                            variant="default"
                            size="xs"
                            class="ml-2"
                            :data-test="`synthetics-check-locations-extra-agents-${location.id}`"
                          >
                            +{{ agentDisplay(location).extra }}
                          </OBadge>
                        </OTooltip>
                      </span>
                    </span>
                  </template>
                </OCheckbox>
                <OButton
                  :variant="getStatusInfo(location).actionVariant"
                  size="xs"
                  :data-test="`synthetics-check-locations-add-agent-${location.id}`"
                  @click="emit('add-agent', location.id)"
                >
                  {{ getStatusInfo(location).actionLabel }}
                </OButton>
              </div>
            </template>

            <!-- ── No private locations ──────────────────────────────────── -->
            <div
              v-else
              class="rounded-default border-border-default text-text-secondary flex flex-col items-center gap-2 border border-dashed px-3 py-4 text-sm"
              data-test="synthetics-check-locations-private-empty"
            >
              <span>{{ t("synthetics.locations.privateEmptyBody") }}</span>
              <OButton
                variant="outline"
                size="sm"
                icon-left="add_location_alt"
                data-test="synthetics-check-locations-private-empty-cta"
                @click="emit('new-location')"
              >
                {{ t("synthetics.locations.newLocation") }}
              </OButton>
            </div>
          </template>
        </OCheckboxGroup>

        <!-- ── No locations at all ──────────────────────────────────────────── -->
        <div
          v-else
          class="rounded-default border-border-default text-text-secondary flex items-center justify-center border border-dashed px-3 py-3 text-sm"
          data-test="synthetics-check-locations-empty"
        >
          {{ t("synthetics.locations.empty") }}
        </div>

        <!-- ── Validation error ──────────────────────────────────────────────── -->
        <p
          v-if="props.validationErrors?.locations"
          class="text-status-error-text mt-2 text-xs"
          data-test="synthetics-check-locations-error"
        >
          {{ props.validationErrors.locations }}
        </p>
      </template>
    </div>
  </div>
</template>
