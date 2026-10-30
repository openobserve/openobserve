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
  <div data-test="prebuilt-destination-selector">
    <div
      class="selector-grid mb-4 grid [grid-template-columns:repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-3"
    >
      <!-- A disabled tile's actions sit beside its role="button", never inside it. -->
      <div
        v-for="type in filteredDestinationTypes"
        :key="type.id"
        :class="
          type.disabled
            ? 'border-card-glass-border rounded-default bg-card-glass-bg flex [min-height:7.5rem] min-w-0 flex-col border-2 px-3 py-5'
            : 'contents'
        "
      >
        <div
          data-test="destination-type-card"
          :data-type="type.id"
          class="destination-card group/dest-card relative flex min-w-0 flex-col"
          :class="[
            type.disabled
              ? 'grow cursor-not-allowed'
              : 'border-card-glass-border rounded-default hover:border-accent hover:shadow-status-info-text/15 [min-height:7.5rem] cursor-pointer border-2 px-3 py-5 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md',
            !type.disabled && selectedType === type.id
              ? 'selected border-accent shadow-status-info-text/20 bg-card-glass-tint shadow-lg'
              : !type.disabled && 'bg-card-glass-bg',
          ]"
          role="button"
          :tabindex="type.disabled ? -1 : 0"
          :aria-disabled="type.disabled || undefined"
          :aria-describedby="type.disabled ? unavailableReasonId : undefined"
          @click="selectType(type.id)"
          @keydown.enter.prevent="selectType(type.id)"
          @keydown.space.prevent="selectType(type.id)"
        >
          <div
            class="card-content relative flex h-full min-w-0 flex-col items-center text-center"
            :class="{ 'opacity-40': type.disabled }"
          >
            <div
              data-test="destination-type-icon"
              class="text-icon-color group-[.selected]/dest-card:text-accent mb-2"
            >
              <img
                v-if="type.image"
                :src="type.image"
                :alt="type.name"
                class="destination-logo h-6 w-6 [object-fit:contain]"
              />
              <OIcon v-else :name="getIconName(type.icon)" size="md" />
            </div>

            <div
              data-test="destination-type-name"
              class="card-title text-compact text-text-heading mt-1 mb-0 text-center [line-height:1.3] font-medium"
            >
              {{ type.name }}
            </div>

            <OTag
              v-if="type.tag"
              data-test="destination-type-tag"
              :variant="type.tag.variant"
              size="sm"
              class="mt-1 max-w-full max-[35rem]:[overflow-wrap:anywhere] max-[35rem]:whitespace-normal"
              :label="type.tag.label"
            />

            <div
              data-test="destination-type-description"
              class="text-2xs text-text-secondary mt-1 mb-0 grow text-center [line-height:1.2]"
              :class="{
                'hidden min-[75rem]:block': type.id !== 'slack' && type.id !== 'slack_app',
              }"
            >
              {{ t(type.descriptionKey) }}
            </div>
          </div>

          <div
            v-if="!type.disabled && selectedType === type.id"
            class="check-icon bg-status-positive absolute top-1.5 right-1.5 z-1 flex h-5 w-5 items-center justify-center overflow-hidden rounded-full text-white"
          >
            <OIcon name="check" size="xs" />
          </div>
        </div>
        <div v-if="type.disabled" class="mt-3 flex flex-col items-center gap-2 text-center">
          <p class="text-text-secondary mb-0 text-center text-xs [line-height:1.3]">
            <!-- The copy button sits outside the described span so it is not read as part of the reason. -->
            <span :id="unavailableReasonId"
              ><i18n-t v-if="operatorSetting" :keypath="unavailableKey" tag="span">
                <template #variable>
                  <span class="inline-flex items-center align-middle">
                    <OCode data-test="slack-app-unavailable-variable">{{ operatorSetting }}</OCode>
                  </span>
                </template>
              </i18n-t>
              <template v-else>{{ t(unavailableKey) }}</template></span
            ><template v-if="operatorSetting"
              >{{ WORD_JOINER
              }}<OTooltip :content="t('common.copyToClipboard')">
                <OButton
                  variant="ghost-muted"
                  size="icon"
                  class="-my-1 ms-0.5 align-middle"
                  :aria-label="t('common.copyToClipboard')"
                  data-test="slack-app-unavailable-copy"
                  @click="copyOperatorSetting"
                >
                  <template #icon-left><OIcon name="content-copy" size="xs" /></template>
                </OButton> </OTooltip
            ></template>
          </p>
          <OButton
            v-if="isCloud"
            variant="outline"
            size="xs"
            data-test="slack-app-contact-support"
            @click="contactSupport"
            >{{ t("billing.trialStrip.contactSupport") }}</OButton
          >
        </div>
      </div>

      <div
        data-test="destination-type-card"
        data-type="custom"
        class="destination-card custom-card group/dest-card border-card-glass-border rounded-default hover:border-accent hover:shadow-status-info-text/15 relative flex [min-height:7.5rem] cursor-pointer flex-col border-2 border-dashed px-3 py-5 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
        :class="
          selectedType === 'custom'
            ? 'selected border-accent shadow-status-info-text/20 bg-card-glass-tint shadow-lg'
            : 'bg-card-glass-bg'
        "
        @click="selectType('custom')"
      >
        <div class="card-content relative flex h-full flex-col items-center text-center">
          <div
            data-test="destination-type-icon"
            class="text-icon-color group-[.selected]/dest-card:text-accent mb-2"
          >
            <OIcon name="settings" size="md" />
          </div>
          <div
            data-test="destination-type-name"
            class="card-title text-compact text-text-heading mt-1 mb-0 text-center [line-height:1.3] font-medium"
          >
            {{ t("alerts.customDestination") }}
          </div>
          <div
            data-test="destination-type-description"
            class="text-2xs text-text-secondary mt-1 mb-0 hidden grow text-center [line-height:1.2] min-[75rem]:block"
          >
            {{ t("alerts.customDestinationDescription") }}
          </div>
        </div>

        <div
          v-if="selectedType === 'custom'"
          class="check-icon bg-status-positive absolute top-1.5 right-1.5 z-1 flex h-5 w-5 items-center justify-center overflow-hidden rounded-full text-white"
        >
          <OIcon name="check" size="xs" />
        </div>
      </div>
    </div>
    <p
      v-if="filteredDestinationTypes.some((type) => type.id === 'slack')"
      data-test="slack-choice-hint"
      class="text-text-secondary mt-4 mb-0 text-xs leading-none"
    >
      {{ t("slackApp.destination.choiceHint") }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, useId } from "vue";
import config from "@/aws-exports";
import { siteURL } from "@/constants/config";
import { useI18nTyped } from "@/types/i18n";
import type { SlackDisabledReason } from "@/types/slack";
import { copyToClipboard } from "@/utils/clipboard";
import { destinationTypeTiles } from "@/utils/prebuilt-templates";
import type { DestinationTileId } from "@/utils/prebuilt-templates/types";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCode from "@/lib/core/Code/OCode.vue";
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
// Keeps the copy button on the chip's line without adding any announced text.
const WORD_JOINER = "\u2060";
const unavailableReasonId = useId();
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

function contactSupport() {
  window.open(siteURL.contactSupport, "_blank");
}

// The util falls back to execCommand, so the copy works on plain-HTTP self-hosted servers.
function copyOperatorSetting() {
  if (operatorSetting.value) copyToClipboard(operatorSetting.value, t);
}

const selectedType = computed({
  get: () => props.modelValue,
  // Only user selections flow through the setter, so null/'' never get emitted.
  set: (value: DestinationTileId | "custom") => emit("update:modelValue", value),
});

const filteredDestinationTypes = computed(() => destinationTypeTiles(props.slackApp));

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
    custom: "settings",
  };

  return iconMap[icon] || icon;
}
</script>
