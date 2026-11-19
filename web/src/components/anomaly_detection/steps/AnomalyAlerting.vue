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
        v-if="config.alert_enabled"
        :label="t('alerts.destination')"
        data-test="anomaly-destination-row"
        fill
      >
        <div class="flex items-center">
          <OSelect
            v-model="configModel.alert_destination_ids"
            :options="destinations"
            labelKey="name"
            valueKey="name"
            multiple
            searchable
            :placeholder="t('alerts.summary.noDestination')"
            class="h-auto! min-h-auto! max-w-75 min-w-0 flex-1 max-md:max-w-none max-md:basis-full"
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
        </div>
        <template #note>
          <span class="flex flex-wrap items-start gap-x-3 gap-y-0.5">
            <span
              class="basis-full"
              :data-test="
                config.alert_destination_ids.length === 0
                  ? 'anomaly-destination-note'
                  : 'anomaly-destination-status'
              "
              >{{ destinationStatus }}</span
            >
            <OButton
              variant="link"
              class="shrink-0"
              data-test="anomaly-add-destination"
              @click="openAddDestination"
            >
              {{ t("alerts.alertSettings.addNewDestination") }}
            </OButton>
          </span>
        </template>
        <template #actions>
          <OButton
            variant="ghost"
            size="icon-circle-sm"
            :title="t('alerts.alertSettings.refreshDestinations')"
            data-test="anomaly-refresh-destinations"
            @click="$emit('refresh:destinations')"
          >
            <OIcon name="refresh" size="sm" />
          </OButton>
        </template>
      </OSettingRow>

      <AlertTierPlace id="anomalyTemplate">
        <OSettingRow
          v-if="config.alert_enabled && tierShows('anomalyTemplate')"
          :label="t('alerts.plain.messageTemplate')"
          data-test="anomaly-template-row"
          fill
        >
          <div class="w-75 max-w-full">
            <TemplateOverridePicker
              ref="templatePickerRef"
              kind="anomaly"
              :model-value="config.template ?? null"
              :destinations="selectedDestinations"
              :server-error="config.template_error ?? null"
              :help-text="t('alerts.form.anomaly.templateNote')"
              help-outside
              @update:model-value="onTemplateChange"
            />
          </div>
          <template #actions>
            <OButton
              variant="ghost-primary"
              size="icon-circle-sm"
              :title="t('alerts.alertSettings.learnAboutTemplates')"
              :aria-label="t('alerts.alertSettings.learnAboutTemplates')"
              data-test="template-override-help-btn"
              @click="templatePickerRef?.openHelp()"
            >
              <OIcon name="help" size="sm" />
            </OButton>
          </template>
        </OSettingRow>
      </AlertTierPlace>

      <AlertTierPlace id="anomalyRecordOnly">
        <AlertSentenceRow
          v-if="!config.alert_enabled"
          :label="t('alerts.anomaly.notifications')"
          :info="t('alerts.anomaly.disabledNotificationsInfo')"
          data-test="anomaly-record-only-row"
          removable
          @remove="stopRecordOnly"
        >
          {{ t("alerts.tiers.names.anomalyRecordOnly") }}
        </AlertSentenceRow>
        <OSettingRow
          v-else-if="tierShows('anomalyRecordOnly')"
          :label="t('alerts.tiers.names.anomalyRecordOnly')"
          :description="t('alerts.anomaly.recordOnlyHelp')"
          data-test="anomaly-notifications-row"
          fill
        >
          <div class="flex min-h-8.5 items-center">
            <OSwitch
              :model-value="!config.alert_enabled"
              off-tone="neutral"
              state-text
              :aria-label="t('alerts.tiers.names.anomalyRecordOnly')"
              data-test="anomaly-alert-enabled"
              @update:model-value="setRecordOnly(Boolean($event))"
            />
          </div>
        </OSettingRow>
      </AlertTierPlace>

      <Teleport
        :to="sectionTargets?.anomalyConditionMore"
        :disabled="!sectionTargets?.anomalyConditionMore"
      >
        <AlertTierPlace id="anomalyDirection">
          <OSettingRow
            v-if="tierShows('anomalyDirection')"
            :label="t('alerts.tiers.names.anomalyDirection')"
            :description="t('alerts.form.anomaly.directionHelp')"
            :info="t('alerts.anomaly.alertDirectionTooltip')"
            data-test="anomaly-alert-direction-row"
          >
            <OSelect
              v-model="directionModel"
              :options="directionOptions"
              labelKey="label"
              valueKey="value"
              :searchable="false"
              class="w-50!"
              :aria-label="t('alerts.anomaly.alertDirection')"
              data-test="anomaly-alert-direction"
            />
          </OSettingRow>
        </AlertTierPlace>

        <AlertTierPlace id="anomalyWindow">
          <OSettingRow
            v-if="tierShows('anomalyWindow')"
            :label="t('alerts.tiers.names.anomalyWindow')"
            :info="t('alerts.form.anomaly.windowTooltip', { noun: bucketNoun(1) })"
            data-test="anomaly-window-share-row"
            fill
          >
            <div class="flex flex-col gap-2">
              <i18n-t
                keypath="alerts.form.anomaly.windowCountWords"
                :plural="windowBucketCount"
                tag="div"
                class="text-text-body flex flex-wrap items-center gap-x-1.5 gap-y-2 text-sm"
                data-test="anomaly-window-sentence"
              >
                <template #fire>
                  <OInput
                    v-model="fireCountModel"
                    type="number"
                    :model-modifiers="{ number: true }"
                    fit-content
                    :aria-label="t('alerts.anomaly.windowFireCount')"
                    :placeholder="raw(String(windowBucketCount))"
                    :error="!!windowShareErrors.fire"
                    data-test="anomaly-window-fire-count"
                  />
                </template>
                <template #buckets>
                  <OInput
                    v-model="bucketsModel"
                    type="number"
                    :model-modifiers="{ number: true }"
                    fit-content
                    :aria-label="t('alerts.anomaly.windowRecent')"
                    :placeholder="raw('1')"
                    :error="!!windowShareErrors.buckets"
                    data-test="anomaly-window-buckets"
                  />
                </template>
                <template #noun>{{ bucketNoun(windowBucketCount, false) }}</template>
              </i18n-t>
              <i18n-t
                keypath="alerts.form.anomaly.windowRecoverCountWords"
                tag="div"
                class="text-text-body flex flex-wrap items-center gap-x-1.5 gap-y-2 text-sm"
              >
                <template #recover>
                  <OInput
                    v-model="recoverCountModel"
                    type="number"
                    :model-modifiers="{ number: true }"
                    fit-content
                    :aria-label="t('alerts.anomaly.windowRecoverCount')"
                    :placeholder="raw(String(windowCounts.fire))"
                    :error="!!windowShareErrors.recover"
                    data-test="anomaly-window-recover-count"
                  />
                </template>
              </i18n-t>
              <div
                v-for="message in windowShareMessages"
                :key="message"
                class="text-input-error-text text-xs"
                data-test="anomaly-window-share-error"
                role="alert"
              >
                {{ message }}
              </div>
            </div>
            <template #note>
              <span data-test="anomaly-window-note">{{ windowNote }}</span>
            </template>
          </OSettingRow>
        </AlertTierPlace>
      </Teleport>

      <Teleport :to="sectionTargets?.anomalyDetails" :disabled="!sectionTargets?.anomalyDetails">
        <AlertTierPlace id="anomalyPriority">
          <OSettingRow
            v-if="tierShows('anomalyPriority')"
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
              width="sm"
              :placeholder="
                store.state.zoConfig?.oncall_enabled === true
                  ? t('alerts.priorityUnsetPagesAs')
                  : t('alerts.priorityUnset')
              "
              :aria-label="t('alerts.priority')"
              data-test="anomaly-priority-select"
            />
          </OSettingRow>
        </AlertTierPlace>

        <AlertTierPlace id="anomalyTags">
          <OSettingRow
            v-if="tierShows('anomalyTags')"
            :label="t('alerts.tags')"
            :info="t('alerts.tagsTooltip')"
            data-test="anomaly-tags-row"
            fill
          >
            <div>
              <OTagInput
                v-model="tagsModel"
                :aria-label="t('alerts.tags')"
                :placeholder="t('alerts.placeholders.addTag')"
                data-test="anomaly-tags-input"
              />
            </div>
          </OSettingRow>
        </AlertTierPlace>
      </Teleport>
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, inject, ref, watch, type PropType } from "vue";
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
import AlertSentenceRow from "@/components/alerts/AlertSentenceRow.vue";
import AlertTierPlace from "@/components/alerts/AlertTierPlace.vue";
import {
  ALERT_SETTING_TIERS_KEY,
  useTierVisibility,
} from "@/composables/alerts/useAlertSettingTiers";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import type { AlertSectionTargets } from "@/components/alerts/alertFormSections";
import { durationText } from "@/utils/alerts/alertCopy";
import type { I18nKey, I18nText } from "@/types/i18n";
import {
  ANOMALY_DIRECTION_KEYS,
  anomalyIntervalSeconds,
  anomalyWindowCounts,
  anomalyWindowPct,
  anomalyWindowShareErrors,
} from "./AnomalyDetectionConfig.schema";

const SPAN_UNITS: ReadonlyArray<readonly [I18nKey, number]> = [
  ["alerts.form.anomaly.span.days", 86400],
  ["alerts.form.anomaly.span.hours", 3600],
  ["alerts.form.anomaly.span.minutes", 60],
];
const isBlank = (v: unknown): boolean => v === "" || v === null || v === undefined;
const wholeCount = (v: unknown): number | null =>
  Number.isInteger(Number(v)) && Number(v) >= 1 && !isBlank(v) ? Number(v) : null;

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
    AlertSentenceRow,
    AlertTierPlace,
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
    sectionTargets: {
      type: Object as PropType<AlertSectionTargets>,
      default: undefined,
    },
  },

  emits: ["refresh:destinations"],

  setup(props) {
    const { t } = useI18nTyped();
    const router = useRouter();
    const store = useStore();
    // The sectioned alert editor provides this; its rows sit flat on the page instead of in a card.
    const bare = inject(SETTING_ROW_BARE_KEY, false);
    const tierShows = useTierVisibility();
    const tiers = inject(ALERT_SETTING_TIERS_KEY, null);

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
    // Counts convert at the last whole N typed, so clearing N to retype it keeps "2 of" as 2.
    const lastBuckets = ref(wholeCount(props.config.alert_window_buckets) ?? 1);
    watch(
      () => wholeCount(props.config.alert_window_buckets),
      (n) => {
        if (n !== null) lastBuckets.value = n;
      },
    );
    const windowBucketCount = computed(
      () => wholeCount(props.config.alert_window_buckets) ?? lastBuckets.value,
    );
    const windowCounts = computed(() =>
      anomalyWindowCounts({ ...props.config, alert_window_buckets: windowBucketCount.value }),
    );
    // The counts the user last set, so typing "10" over N passes through "1" without losing "3 of".
    const held = ref({ fire: windowCounts.value.fire, recover: windowCounts.value.recover });
    watch(
      () => props.config,
      () => {
        held.value = { fire: windowCounts.value.fire, recover: windowCounts.value.recover };
      },
    );
    const countModel = (field: "fire" | "recover") =>
      computed({
        get: () =>
          isBlank(props.config[`alert_window_${field}_pct`]) ? "" : windowCounts.value[field],
        set: (v: unknown) => {
          if (!isBlank(v)) held.value[field] = Number(v);
          configModel.value[`alert_window_${field}_pct`] = isBlank(v)
            ? null
            : anomalyWindowPct(Number(v), windowBucketCount.value);
        },
      });
    const fireCountModel = countModel("fire");
    const recoverCountModel = countModel("recover");
    // A new N keeps the counts the sentence shows, so "1 of the last 1" becomes "1 of the last 5".
    const bucketsModel = computed({
      get: () => props.config.alert_window_buckets ?? "",
      set: (v: unknown) => {
        const cfg = configModel.value;
        cfg.alert_window_buckets = v;
        const n = wholeCount(v);
        if (n === null) return;
        for (const field of ["fire", "recover"] as const) {
          if (!isBlank(cfg[`alert_window_${field}_pct`]))
            cfg[`alert_window_${field}_pct`] = anomalyWindowPct(Math.min(held.value[field], n), n);
        }
      },
    });
    const bucketSeconds = computed(() =>
      anomalyIntervalSeconds(
        Number(props.config.histogram_interval_value),
        String(props.config.histogram_interval_unit),
      ),
    );
    // "5-minute count": what one bucket holds, so the rule never says bucket or measure.
    const bucketNoun = (count: number, withSpan = true): I18nText => {
      const secs = withSpan ? bucketSeconds.value : null;
      const unit = secs ? SPAN_UNITS.find(([, size]) => secs % size === 0) : undefined;
      const span = !secs
        ? raw("")
        : unit
          ? t(unit[0], { count: secs / unit[1] })
          : t("alerts.form.anomaly.span.seconds", { count: secs });
      const counts =
        props.config.query_mode !== "custom_sql" && props.config.detection_function === "count";
      return raw(
        t(
          counts ? "alerts.form.anomaly.bucketCount" : "alerts.form.anomaly.bucketValue",
          { span },
          count,
        ).trim(),
      );
    };
    const windowNote = computed(() => {
      const { buckets, fire } = windowCounts.value;
      if (fire <= 1) return t("alerts.form.anomaly.windowAtOnce", { noun: bucketNoun(1) });
      const secs = bucketSeconds.value;
      const span = secs ? durationText(secs * buckets, t) : raw("");
      return fire >= buckets
        ? t("alerts.form.anomaly.windowInARow", { noun: bucketNoun(1), span })
        : t("alerts.form.anomaly.windowShareOf", { fire, noun: bucketNoun(2), span });
    });
    const templatePickerRef = ref<{ openHelp: () => void } | null>(null);
    const windowShareMessages = computed(() => {
      const e = windowShareErrors.value;
      return [
        e.buckets && t(e.buckets as any),
        e.fire && t(e.fire as any, { max: windowBucketCount.value }),
        e.recover && t(e.recover as any, { max: windowCounts.value.fire }),
      ].filter((m): m is I18nText => !!m);
    });

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

    const setRecordOnly = (on: boolean) => {
      configModel.value.alert_enabled = !on;
    };

    // Turning notifications back on returns the setting to its More options line.
    const stopRecordOnly = () => {
      setRecordOnly(false);
      tiers?.conceal("anomalyRecordOnly");
    };

    const openAddDestination = () => {
      const route = router.resolve({
        name: "alertDestinations",
        query: { org_identifier: store.state.selectedOrganization.identifier },
      });
      window.open(route.href, "_blank");
    };

    return {
      windowBucketCount,
      windowCounts,
      fireCountModel,
      recoverCountModel,
      bucketsModel,
      bucketNoun,
      windowNote,
      templatePickerRef,
      t,
      raw,
      store,
      bare,
      tierShows,
      setRecordOnly,
      stopRecordOnly,
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
    };
  },
});
</script>
