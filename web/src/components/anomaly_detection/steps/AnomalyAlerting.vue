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
  <div class="step-anomaly-alerting" :class="bare ? '' : 'h-full'">
    <div
      class="step-content"
      :class="
        bare
          ? ''
          : 'rounded-default bg-surface-overlay border-border-default h-full overflow-y-auto border'
      "
    >
      <OSettingRow
        :label="t('alerts.priority')"
        :info="t('alerts.priorityTooltip')"
        data-test="anomaly-priority-row"
        fill
      >
        <OSelect
          v-model="configModel.priority"
          :options="priorityOptions"
          labelKey="label"
          valueKey="value"
          :searchable="false"
          clearable
          width="xs"
          :placeholder="t('alerts.priorityUnset')"
          :aria-label="t('alerts.priority')"
          data-test="anomaly-priority-select"
        />
      </OSettingRow>

      <OSettingRow
        :label="t('alerts.tags')"
        :info="t('alerts.tagsTooltip')"
        data-test="anomaly-tags-row"
        fill
      >
        <div class="max-w-105">
          <OTagInput
            v-model="tagsModel"
            :aria-label="t('alerts.tags')"
            :placeholder="t('alerts.placeholders.addTag')"
            data-test="anomaly-tags-input"
          />
        </div>
      </OSettingRow>

      <OSettingRow
        :label="t('alerts.anomaly.notifications')"
        :info="t('alerts.anomaly.notificationsTooltip')"
        data-test="anomaly-notifications-row"
        fill
      >
        <div class="flex min-h-9 items-center">
          <span id="anomaly-alert-enabled-heading" class="sr-only">{{
            t("alerts.anomaly.notifications")
          }}</span>
          <OSwitch
            id="anomaly-alert-enabled-switch"
            v-model="configModel.alert_enabled"
            aria-labelledby="anomaly-alert-enabled-heading anomaly-alert-enabled-switch-label"
            :label="
              config.alert_enabled ? t('alerts.anomaly.enabled') : t('alerts.anomaly.disabled')
            "
            data-test="anomaly-alert-enabled"
          />
        </div>
        <div
          v-if="!config.alert_enabled"
          class="text-text-secondary mt-1 text-xs"
          data-test="anomaly-notifications-disabled-note"
        >
          {{ t("alerts.anomaly.disabledNotificationsInfo") }}
        </div>
      </OSettingRow>

      <OSettingRow
        v-if="config.alert_enabled"
        :label="t('alerts.destination')"
        data-test="anomaly-destination-row"
        fill
      >
        <div class="flex flex-wrap items-center gap-2">
          <OSelect
            v-model="configModel.alert_destination_ids"
            :options="destinations"
            labelKey="name"
            valueKey="name"
            multiple
            searchable
            :placeholder="t('alerts.summary.noDestination')"
            class="h-auto! min-h-auto! max-w-105 min-w-0 flex-1 basis-75"
            :aria-label="t('alerts.destination')"
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
            :title="t('alerts.alertSettings.refreshDestinations')"
            data-test="anomaly-refresh-destinations"
            @click="$emit('refresh:destinations')"
            icon-left="refresh"
          />
          <OButton
            variant="outline"
            size="sm"
            data-test="anomaly-add-destination"
            @click="openAddDestination"
          >
            {{ t("alerts.anomaly.addNewDestination") }}
          </OButton>
        </div>
        <p
          class="text-input-help-text pt-1 text-xs"
          :data-test="
            config.alert_destination_ids.length === 0
              ? 'anomaly-destination-note'
              : 'anomaly-destination-status'
          "
        >
          {{ destinationStatus }}
        </p>
      </OSettingRow>

      <OSettingRow
        v-if="config.alert_enabled"
        :label="t('alerts.templateOverride.label')"
        data-test="anomaly-template-row"
        fill
      >
        <div class="max-w-105">
          <TemplateOverridePicker
            kind="anomaly"
            :model-value="config.template ?? null"
            :destinations="selectedDestinations"
            :server-error="config.template_error ?? null"
            @update:model-value="onTemplateChange"
          />
        </div>
      </OSettingRow>

      <OSettingRow
        :label="t('alerts.anomaly.alertDirection')"
        :info="t('alerts.anomaly.alertDirectionTooltip')"
        data-test="anomaly-alert-direction-row"
        fill
      >
        <OSelect
          v-model="directionModel"
          :options="directionOptions"
          labelKey="label"
          valueKey="value"
          :searchable="false"
          width="sm"
          :aria-label="t('alerts.anomaly.alertDirection')"
          data-test="anomaly-alert-direction"
        />
      </OSettingRow>

      <OSettingRow
        :label="t('alerts.anomaly.windowShare')"
        :info="t('alerts.anomaly.windowShareTooltip')"
        data-test="anomaly-window-share-row"
        fill
      >
        <div class="flex flex-col gap-1">
          <div class="flex flex-wrap items-center gap-2">
            <div class="w-36">
              <OInput
                v-model="configModel.alert_window_buckets"
                type="number"
                :model-modifiers="{ number: true }"
                :prefix="t('alerts.anomaly.windowBucketsPrefix')"
                :suffix="t('alerts.anomaly.windowBucketsSuffix')"
                :aria-label="t('alerts.anomaly.windowBuckets')"
                :placeholder="raw('1')"
                :error="!!windowShareErrors.buckets"
                data-test="anomaly-window-buckets"
              />
            </div>
            <div class="w-33">
              <OInput
                v-model="configModel.alert_window_fire_pct"
                type="number"
                :model-modifiers="{ number: true }"
                :prefix="t('alerts.anomaly.windowFirePrefix')"
                :suffix="percentSuffix"
                :aria-label="t('alerts.anomaly.windowFirePct')"
                :placeholder="raw('100')"
                :error="!!windowShareErrors.fire"
                data-test="anomaly-window-fire-pct"
              />
            </div>
            <div class="min-w-58 flex-1">
              <OInput
                v-model="configModel.alert_window_recover_pct"
                type="number"
                :model-modifiers="{ number: true }"
                :prefix="t('alerts.anomaly.windowRecoverPrefix')"
                :suffix="percentSuffix"
                :aria-label="t('alerts.anomaly.windowRecoverPct')"
                :placeholder="t('alerts.anomaly.windowRecoverSameAsFire')"
                :error="!!windowShareErrors.recover"
                data-test="anomaly-window-recover-pct"
              />
            </div>
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
      </OSettingRow>
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, inject, type PropType } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTagInput from "@/lib/forms/TagInput/OTagInput.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OSettingRow from "@/lib/core/SettingRow/OSettingRow.vue";
import { SETTING_ROW_BARE_KEY } from "@/lib/core/SettingRow/OSettingRow.types";
import TemplateOverridePicker from "@/components/alerts/TemplateOverridePicker.vue";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import {
  ANOMALY_DIRECTION_KEYS,
  anomalyWindowShareEffective,
  anomalyWindowShareErrors,
} from "./AnomalyDetectionConfig.schema";

export default defineComponent({
  name: "AnomalyAlerting",
  components: {
    OButton,
    OSwitch,
    OSelect,
    OInput,
    OTagInput,
    OIcon,
    OTag,
    OSettingRow,
    TemplateOverridePicker,
  },

  props: {
    config: {
      type: Object as PropType<any>,
      required: true,
    },
    destinations: {
      type: Array as PropType<(SelectOption & { name: string; destination_type_name?: string })[]>,
      default: () => [],
    },
  },

  emits: ["refresh:destinations"],

  setup(props) {
    const { t } = useI18nTyped();
    const router = useRouter();
    const store = useStore();
    // The sectioned alert editor provides this; its rows sit flat on the page instead of in a card.
    const bare = inject(SETTING_ROW_BARE_KEY, false);
    const percentSuffix = raw("%");

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

    // One name reads better than "1 destination"; more than one is a count.
    const destinationStatus = computed(() => {
      const ids = props.config.alert_destination_ids;
      if (ids.length === 0) return t("alerts.anomaly.noDestinationNote");
      const targets =
        ids.length === 1
          ? ids[0]
          : t("alert_dependencies.countDestinations", { count: ids.length }, ids.length);
      return t("alerts.anomaly.sendsToStatus", { targets });
    });

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

    // The chosen destinations with their transport, for the picker's Custom fit warning.
    const selectedDestinations = computed(() =>
      (props.config.alert_destination_ids ?? []).map((name: string) => {
        const dest = props.destinations.find((d) => d.name === name) as
          { name: string; type?: string } | undefined;
        return { name, type: dest?.type };
      }),
    );

    const onTemplateChange = (value: string | null) => {
      configModel.value.template = value;
      configModel.value.template_error = null;
    };

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
      bare,
      percentSuffix,
      configModel,
      priorityOptions,
      tagsModel,
      openAddDestination,
      selectedDestinations,
      onTemplateChange,
      visibleChipCount,
      destinationStatus,
      directionOptions,
      directionModel,
      windowShareErrors,
      windowShareMessages,
      windowShareHint,
    };
  },
});
</script>
