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
  <div class="step-anomaly-alerting h-full">
    <div
      class="step-content rounded-default bg-surface-overlay border-border-default h-full overflow-y-auto border px-3 py-4"
    >
      <!-- Priority & tags (Feature 2). Anomaly configs appear in the same
           alert list, so they carry the same triage metadata. -->
      <div class="mb-6! flex flex-wrap items-start gap-x-2 pb-0!">
        <div class="flex h-9 w-47.5 shrink-0 items-center font-semibold">
          {{ t("alerts.priority") }}
          <OIcon name="info" size="sm" class="text-icon-color ms-1 cursor-pointer">
            <OTooltip :content="t('alerts.priorityTooltip')" side="right" />
          </OIcon>
        </div>
        <div class="flex h-11 items-center">
          <OSelect
            v-model="configModel.priority"
            :options="priorityOptions"
            labelKey="label"
            valueKey="value"
            :searchable="false"
            clearable
            width="xs"
            :placeholder="t('alerts.priorityUnset')"
            data-test="anomaly-priority-select"
          />
        </div>
      </div>

      <div class="mb-6! flex flex-wrap items-start gap-x-2 pb-0!">
        <div class="flex h-9 w-47.5 shrink-0 items-center font-semibold">
          {{ t("alerts.tags") }}
          <OIcon name="info" size="sm" class="text-icon-color ms-1 cursor-pointer">
            <OTooltip :content="t('alerts.tagsTooltip')" side="right" />
          </OIcon>
        </div>
        <div class="min-w-60 flex-1">
          <OTagInput
            v-model="tagsModel"
            :placeholder="t('alerts.placeholders.addTag')"
            data-test="anomaly-tags-input"
          />
        </div>
      </div>

      <!-- Enable Notifications toggle -->
      <div class="mb-6! flex flex-wrap items-start gap-x-2 pb-0!">
        <div class="flex h-9 w-47.5 shrink-0 items-center font-semibold">
          {{ t("alerts.anomaly.notifications") }}
          <OIcon name="info" size="sm" class="text-icon-color ms-1 cursor-pointer">
            <OTooltip :content="t('alerts.anomaly.notificationsTooltip')" side="right" />
          </OIcon>
        </div>
        <div class="flex h-11 items-center">
          <OSwitch
            v-model="configModel.alert_enabled"
            :label="
              config.alert_enabled ? t('alerts.anomaly.enabled') : t('alerts.anomaly.disabled')
            "
            data-test="anomaly-alert-enabled"
          />
        </div>
      </div>

      <!-- Destination picker (shown when alert_enabled) -->
      <div v-if="config.alert_enabled" class="mb-6! flex flex-wrap items-start gap-x-2 pb-0!">
        <div class="flex h-9 w-47.5 shrink-0 items-center font-semibold">
          {{ t("alerts.destination") }}
          <span class="text-status-error-text ms-1">*</span>
        </div>
        <div class="flex min-w-0 flex-1 basis-60 flex-col">
          <div class="flex flex-wrap items-center gap-y-1">
            <OSelect
              v-model="configModel.alert_destination_ids"
              :options="destinations"
              labelKey="name"
              valueKey="name"
              multiple
              searchable
              class="h-auto! min-h-auto! max-w-105 min-w-0 flex-1 basis-75"
              data-test="anomaly-destination"
            >
              <template #selected-item="{ index, opt, removeAtIndex }">
                <OTag v-if="index < visibleChipCount" type="selectionChip">
                  {{ typeof opt === "object" ? opt.name : opt }}
                  <template #trailing>
                    <button
                      type="button"
                      :aria-label="t('common.remove')"
                      class="inline-flex cursor-pointer items-center justify-center hover:opacity-70"
                      @click="removeAtIndex(index)"
                    >
                      <OIcon name="close" size="xs" />
                    </button>
                  </template>
                </OTag>
                <span
                  v-if="
                    index === visibleChipCount &&
                    config.alert_destination_ids.length > visibleChipCount
                  "
                  class="text-compact text-text-secondary ms-1 whitespace-nowrap"
                >
                  +{{ config.alert_destination_ids.length - visibleChipCount }}
                </span>
              </template>
              <template #empty>
                <span>{{ t("alerts.anomaly.noDestinationsFound") }}</span>
              </template>
            </OSelect>
            <OButton
              variant="ghost"
              size="sm"
              class="ms-1"
              :title="t('alerts.alertSettings.refreshDestinations')"
              data-test="anomaly-refresh-destinations"
              @click="$emit('refresh:destinations')"
              icon-left="refresh"
            />
            <OButton variant="outline" size="sm" class="ms-2" @click="openAddDestination">
              {{ t("alerts.anomaly.addNewDestination") }}
            </OButton>
          </div>
          <div
            v-if="config.alert_enabled && config.alert_destination_ids.length === 0"
            class="text-input-error-text pt-1 text-xs"
            data-test="anomaly-destination-error"
          >
            {{ t("alerts.anomaly.destinationRequired") }}
          </div>
        </div>
      </div>

      <div class="mb-6! flex flex-wrap items-start gap-x-2 pb-0!">
        <div class="flex h-9 w-47.5 shrink-0 items-center font-semibold">
          {{ t("alerts.anomaly.alertDirection") }}
          <OIcon name="info" size="sm" class="text-icon-color ms-1 cursor-pointer">
            <OTooltip :content="t('alerts.anomaly.alertDirectionTooltip')" side="right" />
          </OIcon>
        </div>
        <div class="flex h-11 items-center">
          <OSelect
            v-model="directionModel"
            :options="directionOptions"
            labelKey="label"
            valueKey="value"
            :searchable="false"
            width="sm"
            data-test="anomaly-alert-direction"
          />
        </div>
      </div>

      <div class="mb-6! flex flex-wrap items-start gap-x-2 pb-0!">
        <div class="flex h-9 w-47.5 shrink-0 items-center font-semibold">
          {{ t("alerts.anomaly.windowShare") }}
          <OIcon name="info" size="sm" class="text-icon-color ms-1 cursor-pointer">
            <OTooltip :content="t('alerts.anomaly.windowShareTooltip')" side="right" />
          </OIcon>
        </div>
        <div class="flex min-w-0 flex-1 basis-60 flex-col gap-1">
          <div class="flex flex-wrap items-start gap-3">
            <OInput
              v-model="configModel.alert_window_buckets"
              type="number"
              :model-modifiers="{ number: true }"
              :label="t('alerts.anomaly.windowBuckets')"
              :placeholder="raw('1')"
              :error="!!windowShareErrors.buckets"
              width="xs"
              data-test="anomaly-window-buckets"
            />
            <OInput
              v-model="configModel.alert_window_fire_pct"
              type="number"
              :model-modifiers="{ number: true }"
              :label="t('alerts.anomaly.windowFirePct')"
              :placeholder="raw('100')"
              :error="!!windowShareErrors.fire"
              width="xs"
              data-test="anomaly-window-fire-pct"
            />
            <OInput
              v-model="configModel.alert_window_recover_pct"
              type="number"
              :model-modifiers="{ number: true }"
              :label="t('alerts.anomaly.windowRecoverPct')"
              :placeholder="t('alerts.anomaly.windowRecoverSameAsFire')"
              :error="!!windowShareErrors.recover"
              width="xs"
              data-test="anomaly-window-recover-pct"
            />
          </div>
          <div
            v-for="message in windowShareMessages"
            :key="message"
            class="text-input-error-text text-xs"
            data-test="anomaly-window-share-error"
            role="alert"
          >
            {{ message }}
          </div>
          <span
            v-if="!windowShareMessages.length"
            class="text-text-secondary text-xs"
            data-test="anomaly-window-share-hint"
          >
            {{ windowShareHint }}
          </span>
        </div>
      </div>

      <!-- Info note when notifications disabled -->
      <div
        v-if="!config.alert_enabled"
        class="mt-2 flex items-start gap-2 text-xs"
        :class="'text-text-secondary'"
      >
        <OIcon name="info" size="sm" class="mt-px flex-shrink-0" />
        <span>{{ t("alerts.anomaly.disabledNotificationsInfo") }}</span>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, type PropType } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTagInput from "@/lib/forms/TagInput/OTagInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import {
  ANOMALY_DIRECTION_KEYS,
  anomalyWindowShareEffective,
  anomalyWindowShareErrors,
} from "./AnomalyDetectionConfig.schema";

export default defineComponent({
  name: "AnomalyAlerting",
  components: { OButton, OSwitch, OSelect, OInput, OTagInput, OTooltip, OIcon, OTag },

  props: {
    config: {
      type: Object as PropType<any>,
      required: true,
    },
    destinations: {
      type: Array as PropType<(SelectOption & { name: string })[]>,
      default: () => [],
    },
  },

  emits: ["refresh:destinations"],

  setup(props) {
    const { t } = useI18nTyped();
    const router = useRouter();
    const store = useStore();

    // Alias for the config prop; same reference, mutation stays identical.
    const configModel = computed(() => props.config);

    // Value is the INTEGER storage id so the form holds exactly what the API
    // serializes; "P3" is display only.
    const priorityOptions = [1, 2, 3, 4, 5].map((value) => ({
      label: raw(`P${value}`),
      value,
    }));

    // `config` is an untyped bag supplied by the parent, and not every caller
    // pre-populates `tags` — OTagInput reads `.length`, so binding straight to
    // a possibly-undefined field throws on mount. Default on read, write back
    // to the config so edits still propagate.
    const tagsModel = computed({
      get: () => configModel.value.tags ?? [],
      set: (v: string[]) => {
        configModel.value.tags = v;
      },
    });

    const directionOptions = computed(() =>
      Object.entries(ANOMALY_DIRECTION_KEYS).map(([value, key]) => ({
        label: t(key as any),
        value,
      })),
    );

    // NULL on the wire means both, so an unset row still shows a selected option.
    const directionModel = computed({
      get: () => configModel.value.alert_direction ?? "both",
      set: (v: string) => {
        configModel.value.alert_direction = v;
      },
    });

    const windowShareErrors = computed(() => anomalyWindowShareErrors(props.config));
    const windowShareMessages = computed(() =>
      [
        windowShareErrors.value.buckets,
        windowShareErrors.value.fire,
        windowShareErrors.value.recover,
      ]
        .filter((key): key is string => key !== null)
        .map((key) => t(key as any)),
    );

    const windowShareHint = computed(() =>
      t("alerts.anomaly.windowShareHint", anomalyWindowShareEffective(props.config)),
    );

    // Dynamically decide how many chips to show based on text length.
    // Restored from pre-refactor version; the template still depends on it.
    const MAX_CHARS = 42;
    const visibleChipCount = computed(() => {
      const ids = props.config.alert_destination_ids;
      if (!ids || ids.length === 0) return 0;
      if (ids.length === 1) return 1;
      // Resolve names from destinations list
      const getName = (id: string) => {
        const dest = props.destinations.find((d) => d.name === id);
        return dest ? dest.name : id;
      };
      const firstLen = getName(ids[0]).length;
      if (firstLen > MAX_CHARS) return 1;
      const secondLen = getName(ids[1]).length;
      // Show 2 chips if both fit within budget
      if (firstLen + secondLen <= MAX_CHARS) return 2;
      return 1;
    });

    const openAddDestination = () => {
      const route = router.resolve({
        name: "alertDestinations",
        query: { org_identifier: store.state.selectedOrganization.identifier },
      });
      window.open(route.href, "_blank");
    };

    return {
      t,
      raw,
      store,
      configModel,
      priorityOptions,
      tagsModel,
      openAddDestination,
      visibleChipCount,
      directionOptions,
      directionModel,
      windowShareErrors,
      windowShareMessages,
      windowShareHint,
    };
  },
});
</script>
