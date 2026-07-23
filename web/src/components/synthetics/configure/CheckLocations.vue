<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { BrowserCheck, SyntheticsLocation } from "@/types/synthetics";
import awsSvgUrl from "@/assets/images/ingestion/aws.svg";
import gcpSvgUrl from "@/assets/images/ingestion/gcp.svg";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCheckboxGroup from "@/lib/forms/Checkbox/OCheckboxGroup.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import { formatTimeAgoUs } from "@/utils/synthetics/format";

const props = defineProps<{
  check: BrowserCheck;
  locations: SyntheticsLocation[];
  /** Shows the private-locations subsection + setup CTA (protocol checks only —
   *  browser tests are Lambda-only and pass the public list without this). */
  allowPrivate?: boolean;
  validationErrors?: Record<string, string>;
}>();
const emit = defineEmits<{
  "update:check": [value: BrowserCheck];
  /** Open the agent setup drawer (org-level composer). */
  "setup-agent": [];
}>();

const { t } = useI18n();

function locationIcon(provider: string): string {
  const p = provider.toLowerCase();
  if (p === "aws") return "img:" + awsSvgUrl;
  if (p === "gcp") return "img:" + gcpSvgUrl;
  return "location-on";
}

/** "Name · Region", omitting the region when it's blank or a mechanical
 *  duplicate of the name (private locations without a set region default to
 *  a slug of their own name server-side, which reads as pointless noise). */
function locationDisplayName(location: SyntheticsLocation): string {
  const region = location.region?.trim();
  if (!region || region.toLowerCase() === location.name.trim().toLowerCase()) {
    return location.name;
  }
  return `${location.name} · ${region}`;
}

const publicLocations = computed(() => props.locations.filter((l) => l.kind !== "private"));
const privateLocations = computed(() => props.locations.filter((l) => l.kind === "private"));

const selectedLocations = computed({
  get: () => props.check.locations,
  set: (v: (string | number)[]) =>
    emit("update:check", { ...props.check, locations: v.map(String) }),
});

function agentSubtext(location: SyntheticsLocation): string {
  if (location.status === "online") {
    const names = (location.agent_names ?? []).join(", ");
    const count = location.live_agents ?? location.agent_names?.length ?? 0;
    return names
      ? t("synthetics.locations.liveAgentsNamed", { count, names })
      : t("synthetics.locations.liveAgents", { count });
  }
  if (location.status === "offline" && location.last_seen_at) {
    return t("synthetics.locations.offlineSince", {
      ago: formatTimeAgoUs(location.last_seen_at),
    });
  }
  return t("synthetics.locations.pendingAgent");
}
</script>

<template>
  <div class="rounded-default border-border-default mb-4 border">
    <div class="border-border-default flex items-center border-b px-3 py-2.5">
      <div class="rounded-default bg-primary-600 mr-2 h-4 w-[0.1875rem] shrink-0" />
      <h3 class="text-text-heading text-base font-semibold">
        {{ t("synthetics.locations.title") }}
      </h3>
    </div>
    <div class="flex flex-col gap-3 px-3 py-2">
      <OCheckboxGroup
        v-if="locations.length"
        v-model="selectedLocations"
        data-test="synthetics-check-locations-group"
      >
        <template v-if="allowPrivate && publicLocations.length">
          <div class="text-text-muted pb-1 text-xs font-medium uppercase">
            {{ t("synthetics.locations.publicTitle") }}
          </div>
        </template>
        <OCheckbox
          v-for="location in publicLocations"
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

        <template v-if="allowPrivate">
          <div class="flex items-center justify-between pt-2 pb-1">
            <div class="text-text-muted text-xs font-medium uppercase">
              {{ t("synthetics.locations.privateTitle") }}
            </div>
            <OButton
              variant="ghost"
              size="xs"
              icon-left="add"
              data-test="synthetics-check-locations-setup-agent-btn"
              @click="emit('setup-agent')"
            >
              {{ t("synthetics.locations.setupAgent") }}
            </OButton>
          </div>

          <template v-if="privateLocations.length">
            <OCheckbox
              v-for="location in privateLocations"
              :key="location.id"
              :value="location.id"
              :data-test="`synthetics-check-locations-option-${location.id}`"
              class="pb-2"
            >
              <template #label>
                <span class="flex flex-col gap-0.5">
                  <span class="flex items-center gap-1.5">
                    <span
                      class="inline-block h-2 w-2 shrink-0 rounded-full"
                      :class="
                        location.status === 'online'
                          ? 'bg-status-success-text'
                          : location.status === 'offline'
                            ? 'bg-status-error-text'
                            : 'bg-text-disabled'
                      "
                      :data-test="`synthetics-check-locations-status-${location.id}`"
                    />
                    {{ locationDisplayName(location) }}
                    <OTag size="xs" shape="rounded" variant="purple-soft">
                      {{ t("synthetics.locations.privateBadge") }}
                    </OTag>
                  </span>
                  <span class="text-text-muted text-xs">{{ agentSubtext(location) }}</span>
                  <span
                    v-if="location.status !== 'online'"
                    class="text-status-warning-text text-xs"
                    :data-test="`synthetics-check-locations-warning-${location.id}`"
                  >
                    {{ t("synthetics.locations.offlineWarning") }}
                  </span>
                </span>
              </template>
            </OCheckbox>
          </template>

          <div
            v-else
            class="rounded-default border-border-default text-text-muted flex flex-col items-center gap-2 border border-dashed px-3 py-4 text-sm"
            data-test="synthetics-check-locations-private-empty"
          >
            <span>{{ t("synthetics.locations.privateEmptyBody") }}</span>
            <OButton
              variant="outline"
              size="sm"
              icon-left="add"
              data-test="synthetics-check-locations-private-empty-cta"
              @click="emit('setup-agent')"
            >
              {{ t("synthetics.locations.setupAgent") }}
            </OButton>
          </div>
        </template>
      </OCheckboxGroup>

      <div
        v-else
        class="rounded-default border-border-default text-text-muted flex items-center justify-center border border-dashed px-3 py-3 text-sm"
        data-test="synthetics-check-locations-empty"
      >
        {{ t("synthetics.locations.empty") }}
      </div>
      <p
        v-if="props.validationErrors?.locations"
        class="text-status-error-text mt-2 text-xs"
        data-test="synthetics-check-locations-error"
      >
        {{ props.validationErrors.locations }}
      </p>
    </div>
  </div>
</template>
