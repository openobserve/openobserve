<!-- Copyright 2026 OpenObserve Inc.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License. -->

<template>
  <div data-test="prebuilt-destination-selector" class="@container/dest-picker">
    <div class="mb-4">
      <div
        class="selector-grid grid auto-cols-fr grid-flow-col gap-2 @max-[54rem]/dest-picker:auto-cols-auto @max-[54rem]/dest-picker:grid-flow-row @max-[54rem]/dest-picker:grid-cols-5 @max-[27rem]/dest-picker:grid-cols-2"
      >
        <OTooltip v-for="tile in tiles" :key="tile.id" :delay="300">
          <template #content>
            <div v-for="(part, index) in tile.tips" :key="index" :class="index > 0 && 'mt-1'">
              {{ part }}
            </div>
          </template>
          <div
            data-test="destination-type-card"
            :data-type="tile.id"
            class="destination-card group/dest-card border-card-glass-border rounded-default hover:border-accent relative flex min-h-24 min-w-0 flex-col items-center border-2 px-2 py-3 text-center"
            :class="[
              tile.id === 'custom' && 'custom-card border-dashed',
              tile.disabled ? 'cursor-not-allowed' : 'cursor-pointer',
              !tile.disabled && selectedType === tile.id
                ? 'selected border-accent shadow-status-info-text/20 bg-card-glass-tint shadow-lg'
                : 'bg-card-glass-bg',
            ]"
            role="button"
            tabindex="0"
            :aria-disabled="tile.disabled ? 'true' : undefined"
            :aria-describedby="`${uid}-${tile.id}`"
            @click="selectType(tile.id)"
            @keydown.enter.prevent="selectType(tile.id)"
            @keydown.space.prevent="selectType(tile.id)"
          >
            <span :id="`${uid}-${tile.id}`" data-test="destination-type-description" class="sr-only"
              ><span v-for="(part, index) in tile.tips" :key="index" class="block">{{
                part
              }}</span></span
            >
            <div
              class="card-content flex min-w-0 flex-1 flex-col items-center"
              :class="{ 'opacity-40': tile.disabled }"
            >
              <div
                data-test="destination-type-icon"
                class="text-icon-color group-[.selected]/dest-card:text-accent mb-1"
              >
                <img
                  v-if="tile.image"
                  :src="tile.image"
                  :alt="tile.name"
                  class="destination-logo h-6 w-6 [object-fit:contain]"
                  :class="{ 'dark:invert': tile.id === 'opsgenie' }"
                />
                <OIcon v-else :name="getIconName(tile.icon)" size="md" />
              </div>
              <div
                data-test="destination-type-name"
                class="card-title text-compact text-text-heading mb-0 text-center [line-height:1.3] font-medium"
              >
                {{ tile.name }}
              </div>
              <div
                data-test="destination-type-short"
                class="text-2xs text-text-secondary mt-auto pt-1 text-center [line-height:1.2]"
              >
                {{ tile.short }}
              </div>
            </div>

            <OTag
              v-if="tile.disabled"
              data-test="destination-type-off"
              variant="default-soft"
              size="sm"
              class="absolute top-1 right-1"
              :label="t('slackApp.destination.off')"
            />
            <div
              v-if="!tile.disabled && selectedType === tile.id"
              class="check-icon bg-status-positive absolute top-1.5 right-1.5 z-1 flex h-5 w-5 items-center justify-center overflow-hidden rounded-full text-white"
            >
              <OIcon name="check" size="xs" />
            </div>
          </div>
        </OTooltip>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, useId } from "vue";
import config from "@/aws-exports";
import { raw, useI18nTyped } from "@/types/i18n";
import type { SlackDisabledReason } from "@/types/slack";
import { destinationTypeTiles } from "@/utils/prebuilt-templates";
import type { DestinationTileId } from "@/utils/prebuilt-templates/types";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

interface Props {
  modelValue?: DestinationTileId | "custom" | "" | null | string;
  /** Whether the deployment and org allow Slack app destinations. */
  slackApp?: boolean;
  /** Why they are off; the edition and a super cluster share one reason. */
  unavailableReason?: SlackDisabledReason;
  /** Org admin or root: only they can get an operator to turn Slack on. */
  canManageSlack?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: null,
  slackApp: false,
  canManageSlack: false,
});

interface Emits {
  (e: "update:modelValue", value: DestinationTileId | "custom"): void;
  (e: "select", value: DestinationTileId | "custom"): void;
}

const emit = defineEmits<Emits>();

const { t } = useI18nTyped();
const uid = useId();
const isCloud = computed(() => config.isCloud === "true");
const serverReason = computed(() =>
  props.unavailableReason === "flag" || props.unavailableReason === "master_key"
    ? props.unavailableReason
    : null,
);
const operatorSetting = computed(() => {
  // Cloud users have no operator to ask, so no reason names a server variable.
  if (isCloud.value || !props.canManageSlack || !serverReason.value) return null;
  return serverReason.value === "flag" ? "O2_SLACK_ENABLED" : "O2_MASTER_ENCRYPTION_KEY";
});
const unavailableKey = computed(() => {
  if (isCloud.value) return "slackApp.destination.unavailableCloud" as const;
  if (!serverReason.value) return "slackApp.destination.unavailableReason" as const;
  if (!props.canManageSlack) return "slackApp.destination.unavailableNoAccess" as const;
  return serverReason.value === "flag"
    ? ("slackApp.destination.unavailableFlag" as const)
    : ("slackApp.destination.unavailableMasterKey" as const);
});

const selectedType = computed({
  get: () => props.modelValue,
  // Only user selections flow through the setter, so null/'' never get emitted.
  set: (value: DestinationTileId | "custom") => emit("update:modelValue", value),
});

const filteredDestinationTypes = computed(() => destinationTypeTiles(props.slackApp));
const unavailableText = computed(() =>
  operatorSetting.value
    ? t(unavailableKey.value, { variable: raw(operatorSetting.value) })
    : t(unavailableKey.value),
);

// Separate lines, not one joined sentence, so every locale keeps its own punctuation.
function tileTips(tile: (typeof filteredDestinationTypes.value)[number]): string[] {
  const hasSlackWebhook = filteredDestinationTypes.value.some((type) => type.id === "slack");
  const isSlack = tile.id === "slack" || tile.id === "slack_app";
  return [
    ...(tile.disabled ? [unavailableText.value] : []),
    ...(tile.disabled && !isSlack ? [] : [t(tile.descriptionKey)]),
    ...(isSlack && hasSlackWebhook ? [t("slackApp.destination.choiceHint")] : []),
  ];
}

const tiles = computed(() => [
  ...filteredDestinationTypes.value.map((tile) => ({
    ...tile,
    short: t(tile.shortKey),
    tips: tileTips(tile),
  })),
  {
    id: "custom" as const,
    name: t("alerts.customDestination"),
    short: t("alert_destinations.prebuilt.customShort"),
    tips: [t("alerts.customDestinationDescription")],
    icon: "settings",
    image: undefined,
    disabled: false,
  },
]);

function selectType(typeId: DestinationTileId | "custom") {
  if (filteredDestinationTypes.value.find((type) => type.id === typeId)?.disabled) return;
  selectedType.value = typeId;
  emit("select", typeId);
}

function getIconName(icon: string): string {
  const iconMap: Record<string, string> = {
    slack: "chat",
    discord: "forum",
    msteams: "groups",
    email: "email",
    pagerduty: "warning",
    opsgenie: "notifications_active",
    servicenow: "support_agent",
    jira: "assignment",
    custom: "settings",
  };

  return iconMap[icon] || icon;
}
</script>
