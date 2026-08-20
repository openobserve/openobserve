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
import { raw, useI18nTyped } from "@/types/i18n";
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
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import SkeletonBox from "@/components/shared/SkeletonBox.vue";
import { formatTimeAgoUs } from "@/utils/synthetics/format";
import { locationLiveStatus as liveStatus } from "@/utils/synthetics/locationLiveStatus";

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

type StatusTier = "ready" | "unknown" | "connecting" | "offline" | "down";

/** Resolve the display tier — "down" is offline with no agent for ≥24h, a
 *  distinction raw `status` can't express. Sorting and display both key off
 *  this so a dead location never outranks a recently-dropped one. */
function statusTier(location: SyntheticsLocation): StatusTier {
  // Checked first: without it this region's missing agent rows read as
  // "connecting", i.e. install an agent you already installed elsewhere.
  if (liveStatus(location) === "unknown") return "unknown";
  if (location.status === "online") return "ready";
  if (location.status === "pending") return "connecting";
  const nowUs = Date.now() * 1000;
  const lastSeen = location.last_seen_at ?? 0;
  const isDown = lastSeen > 0 && (nowUs - lastSeen) / 1_000_000 / 3600 >= 24;
  return isDown ? "down" : "offline";
}

interface StatusInfo {
  tier: StatusTier;
  icon: string;
  label: string;
  iconClass: string;
  message: string;
  /** Color of the always-visible message line under the row. */
  messageClass: string;
  badgeVariant:
    "success-outline" | "info-outline" | "warning-outline" | "error-outline" | "default-outline";
  actionLabel: string;
  actionVariant: "outline";
}

function getStatusInfo(location: SyntheticsLocation): StatusInfo {
  const tier = statusTier(location);

  if (tier === "ready") {
    return {
      tier: "ready",
      icon: "check-circle",
      label: t("synthetics.locations.statusReady"),
      iconClass: "text-status-success-text",
      message: "",
      messageClass: "",
      badgeVariant: "success-outline",
      actionLabel: t("synthetics.locations.addAgent"),
      actionVariant: "outline",
    };
  }

  // Neutral on purpose: nothing is wrong here and nothing is confirmed either,
  // so it must not colour like a fault and must not offer a fix.
  if (tier === "unknown") {
    return {
      tier: "unknown",
      icon: "help-outline",
      label: t("synthetics.locations.statusUnknown"),
      iconClass: "text-text-muted",
      message: t("synthetics.locations.unknownMessage"),
      messageClass: "text-text-secondary",
      badgeVariant: "default-outline",
      actionLabel: t("synthetics.locations.addAgent"),
      actionVariant: "outline",
    };
  }

  if (tier === "connecting") {
    return {
      tier: "connecting",
      icon: "schedule",
      label: t("synthetics.locations.statusConnecting"),
      iconClass: "text-status-info-text",
      message: t("synthetics.locations.connectingMessage"),
      messageClass: "text-text-secondary",
      badgeVariant: "info-outline",
      actionLabel: t("synthetics.locations.installAgent"),
      actionVariant: "outline",
    };
  }

  if (tier === "down") {
    return {
      tier: "down",
      icon: "error-outline",
      label: t("synthetics.locations.statusDown"),
      iconClass: "text-status-error-text",
      message: t("synthetics.locations.downMessage"),
      messageClass: "text-status-error-text",
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
    messageClass: "text-status-warning-text",
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

  // "Waiting for the first agent" is wrong here — this region has no agent
  // list to report, which is not the same as there being none.
  if (liveStatus(location) === "unknown") {
    return {
      firstAgent: "",
      extra: 0,
      allNames: [],
      count: 0,
      statusText: t("synthetics.locations.unknownAgents"),
    };
  }

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

  // pending, offline without a last-seen timestamp, or an unknown status:
  // the location has never had an agent report in.
  return {
    firstAgent: "",
    extra: 0,
    allNames: [],
    count: 0,
    statusText: t("synthetics.locations.pendingAgent"),
  };
}

// ── Location lists ───────────────────────────────────────────────────────────

// "unknown" ranks just below "ready": it is selectable and probably fine, so it
// must not sink beneath the locations that genuinely need attention.
const TIER_SORT: Record<StatusTier, number> = {
  ready: 0,
  unknown: 1,
  connecting: 2,
  offline: 3,
  down: 4,
};

const publicLocations = computed(() => props.locations.filter((l) => l.kind !== "private"));

const filteredPublicLocations = computed(() => publicLocations.value.filter(matchesSearch));

const privateLocations = computed(() => {
  const list = props.locations.filter((l) => l.kind === "private");
  // Sort: ready → connecting → offline → down, alphabetical within groups
  return [...list].sort((a, b) => {
    const aTier = TIER_SORT[statusTier(a)];
    const bTier = TIER_SORT[statusTier(b)];
    if (aTier !== bTier) return aTier - bTier;
    return a.label.localeCompare(b.label);
  });
});

const filteredPrivateLocations = computed(() => privateLocations.value.filter(matchesSearch));

/** Private rows with status/agent info resolved once per list change instead of
 *  on every template access. */
const privateRows = computed(() =>
  filteredPrivateLocations.value.map((location) => ({
    location,
    status: getStatusInfo(location),
    agents: agentDisplay(location),
  })),
);

const hasSearch = computed(() => searchQuery.value.trim().length > 0);

/** A section has locations but the search matched none of them — distinct from
 *  the section being genuinely empty, so headers stay put and the private
 *  creation empty state never masquerades as a "no results" state. */
const publicNoMatches = computed(
  () =>
    hasSearch.value &&
    publicLocations.value.length > 0 &&
    filteredPublicLocations.value.length === 0,
);
const privateNoMatches = computed(
  () =>
    hasSearch.value &&
    privateLocations.value.length > 0 &&
    filteredPrivateLocations.value.length === 0,
);

/** The search matched nothing anywhere — the whole list area collapses to a
 *  single empty state (carrying the private-location CTA when allowed) instead
 *  of two section-level messages. */
const allNoMatches = computed(
  () =>
    hasSearch.value &&
    props.locations.length > 0 &&
    filteredPublicLocations.value.length === 0 &&
    filteredPrivateLocations.value.length === 0,
);

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
      <!-- ── Search + refresh — kept mounted during loading so a refresh doesn't
           flicker the row away and drop the user's query context. -->
      <div class="flex items-center gap-2">
        <OInput
          v-model="searchQuery"
          type="search"
          :placeholder="t('synthetics.locations.searchPlaceholder')"
          :disabled="loadingLocations"
          class="flex-1"
          data-test="synthetics-check-locations-search"
        />
        <OButton
          variant="outline"
          size="sm"
          icon-left="refresh"
          :loading="loadingLocations"
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
        <div v-for="i in 4" :key="'skel-' + i" class="flex items-center gap-2 py-1">
          <SkeletonBox width="1rem" height="1rem" variant="custom" :rounded="true" />
          <SkeletonBox width="60%" height="0.875rem" variant="text" />
        </div>
      </div>

      <!-- ── Loaded content ─────────────────────────────────────────────────── -->
      <template v-else>
        <!-- Rendered whenever private locations are allowed, even with zero
             locations of any kind — the private subsection's empty state carries
             the "new private location" CTA, which is the only way out of a
             no-locations org. Without private support an empty list has nothing
             actionable, so it falls through to the plain empty state below. -->
        <!-- ── Search matched nothing anywhere ──────────────────────────────── -->
        <OEmptyState
          v-if="allNoMatches"
          size="inline"
          icon="search-off"
          :title="t('synthetics.locations.noSearchResults')"
          :action-label="allowPrivate ? t('synthetics.locations.newPrivateLocation') : undefined"
          action-icon="add"
          data-test="synthetics-check-locations-no-results"
          @action="emit('new-location')"
        />

        <OCheckboxGroup
          v-else-if="locations.length || allowPrivate"
          v-model="selectedLocations"
          data-test="synthetics-check-locations-group"
        >
          <!-- ── Public section — header keyed to the unfiltered list so a
               search miss doesn't collapse the section structure. -->
          <template v-if="allowPrivate && publicLocations.length">
            <p class="text-text-secondary flex items-center gap-1 pb-1 text-xs">
              <span class="font-medium capitalize">{{
                t("synthetics.locations.publicTitle")
              }}</span>
              <OTooltip :content="t('synthetics.locations.publicSubtitle')">
                <OIcon name="info" size="xs" class="text-text-secondary cursor-help" />
              </OTooltip>
            </p>
          </template>
          <div class="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
            <OCheckbox
              v-for="location in filteredPublicLocations"
              :key="location.id"
              :value="location.id"
              :data-test="`synthetics-check-locations-option-${location.id}`"
              class="min-w-0 pb-2"
            >
              <template #label>
                <span class="flex items-center gap-1.5">
                  <OIcon :name="locationIcon(location.provider)" size="sm" />
                  {{ locationDisplayName(location) }}
                </span>
              </template>
            </OCheckbox>
          </div>

          <!-- ── Search matched no public locations (private still has hits) ── -->
          <OEmptyState
            v-if="publicNoMatches"
            size="inline"
            icon="search-off"
            :title="t('synthetics.locations.noPublicMatches')"
            data-test="synthetics-check-locations-public-no-results"
          />

          <!-- ── Private section ──────────────────────────────────────────── -->
          <template v-if="allowPrivate">
            <div class="flex items-center justify-between pt-2 pb-1">
              <p class="text-text-secondary flex items-center gap-1 text-xs">
                <span class="font-medium capitalize">{{
                  t("synthetics.locations.privateTitle")
                }}</span>
                <OTooltip :content="t('synthetics.locations.privateSubtitle')">
                  <OIcon name="info" size="xs" class="text-text-secondary cursor-help" />
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
            <div v-if="privateRows.length" class="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
              <div
                v-for="{ location, status, agents } in privateRows"
                :key="location.id"
                class="flex min-w-0 items-start gap-2 pb-2"
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
                          :name="status.icon"
                          size="sm"
                          :class="status.iconClass"
                          :data-test="`synthetics-check-locations-status-icon-${location.id}`"
                        />
                        {{ locationDisplayName(location) }}
                        <OBadge
                          :variant="status.badgeVariant"
                          size="xs"
                          :data-test="`synthetics-check-locations-status-badge-${location.id}`"
                        >
                          {{ status.label }}
                        </OBadge>
                      </span>
                      <span class="text-text-label text-xs">
                        {{ agents.statusText
                        }}<template v-if="agents.firstAgent">
                          ·
                          <span class="text-text-secondary">{{ agents.firstAgent }}</span>
                        </template>
                        <!-- Agent machine names, not prose — deliberately untranslated. -->
                        <OTooltip
                          v-if="agents.extra > 0"
                          :content="raw(agents.allNames.join(', '))"
                        >
                          <OBadge
                            variant="default"
                            size="xs"
                            class="ml-2"
                            :data-test="`synthetics-check-locations-extra-agents-${location.id}`"
                          >
                            +{{ agents.extra }}
                          </OBadge>
                        </OTooltip>
                      </span>
                      <!-- Always-visible guidance for not-ready locations — a
                           tooltip alone hides it from touch and keyboard users. -->
                      <span
                        v-if="status.message"
                        class="text-xs"
                        :class="status.messageClass"
                        :data-test="`synthetics-check-locations-warning-${location.id}`"
                      >
                        {{ status.message }}
                      </span>
                    </span>
                  </template>
                </OCheckbox>
                <OButton
                  :variant="status.actionVariant"
                  size="xs"
                  :data-test="`synthetics-check-locations-add-agent-${location.id}`"
                  @click="emit('add-agent', location.id)"
                >
                  {{ status.actionLabel }}
                </OButton>
              </div>
            </div>

            <!-- ── Search matched no private locations (public still has hits) ── -->
            <OEmptyState
              v-else-if="privateNoMatches"
              size="inline"
              icon="search-off"
              :title="t('synthetics.locations.noPrivateMatches')"
              data-test="synthetics-check-locations-private-no-results"
            />

            <!-- ── No private locations at all — the creation CTA, never shown
                 for a search miss (that case is the no-results block above). -->
            <div
              v-else-if="!privateLocations.length"
              class="rounded-default border-border-default text-text-secondary flex flex-col items-center gap-2 border border-dashed px-3 py-4 text-sm"
              data-test="synthetics-check-locations-private-empty"
            >
              <span>{{ t("synthetics.locations.privateEmptyBody") }}</span>
              <OButton
                variant="outline"
                size="sm"
                icon-left="add"
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
