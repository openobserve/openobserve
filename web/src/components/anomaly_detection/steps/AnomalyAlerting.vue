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
  <div
    class="step-anomaly-alerting"
    :class="store.state.theme === 'dark' ? 'dark-mode' : 'light-mode'"
  >
    <div class="step-content tw:px-3 tw:py-4">
      <!-- Enable Notifications toggle -->
      <div class="flex items-start alert-settings-row">
        <div
          class="tw:font-semibold flex items-center"
          style="width: 190px; height: 36px"
        >
          {{ t('alerts.anomaly.notifications') }}
          <q-icon
            name="info"
            size="17px"
            class="q-ml-xs cursor-pointer"
            :class="
              store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'
            "
          >
            <OTooltip :content="t('alerts.anomaly.notificationsTooltip')" side="right" />
          </q-icon>
        </div>
        <div>
          <OSwitch
            v-model="config.alert_enabled"
            :label="config.alert_enabled ? t('alerts.anomaly.enabled') : t('alerts.anomaly.disabled')"
            data-test="anomaly-alert-enabled"
          />
        </div>
      </div>

      <!-- Destination picker (shown when alert_enabled) -->
      <div
        v-if="config.alert_enabled"
        class="flex items-start alert-settings-row"
      >
        <div
          class="tw:font-semibold flex items-center"
          style="width: 190px; height: 36px"
        >
          {{ t("alerts.destination") }}
          <span class="text-negative tw:ml-1">*</span>
        </div>
        <div class="tw:flex tw:flex-col">
          <div class="tw:flex tw:items-center">
            <OSelect
              v-model="config.alert_destination_ids"
              :options="props.destinations"
              labelKey="name"
              valueKey="name"
              multiple
              searchable
              class="destination-select"
              style="min-width: 300px; max-width: 420px"
              data-test="anomaly-destination"
            >
              <template #empty>
                <span>{{ t('alerts.anomaly.noDestinationsFound') }}</span>
              </template>
            </OSelect>
            <OButton
              variant="ghost"
              size="icon-sm"
              class="q-ml-xs"
              :title="t('alerts.alertSettings.refreshDestinations')"
              @click="$emit('refresh:destinations')"
            >
              <RefreshCw class="tw:size-4" />
            </OButton>
            <OButton
              variant="outline"
              size="sm-action"
              class="q-ml-sm"
              @click="openAddDestination"
            >
              {{ t('alerts.anomaly.addNewDestination') }}
            </OButton>
          </div>
          <div
            v-if="
              config.alert_enabled && config.alert_destination_ids.length === 0
            "
            class="text-red-8 q-pt-xs"
            style="font-size: 11px; line-height: 12px"
            data-test="anomaly-destination-error"
          >
            {{ t('alerts.anomaly.destinationRequired') }}
          </div>
        </div>
      </div>

      <!-- Info note when notifications disabled -->
      <div
        v-if="!config.alert_enabled"
        class="tw:flex tw:items-start tw:gap-2 text-caption tw:mt-2"
        :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
      >
        <q-icon name="info" size="16px"
class="tw:mt-px tw:flex-shrink-0" />
        <span>{{ t('alerts.anomaly.disabledNotificationsInfo') }}</span>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import OButton from '@/lib/core/Button/OButton.vue';
import OSwitch from '@/lib/forms/Switch/OSwitch.vue';
import OSelect from '@/lib/forms/Select/OSelect.vue';
import OTooltip from '@/lib/overlay/Tooltip/OTooltip.vue';
import { RefreshCw } from 'lucide-vue-next';

export default defineComponent({
  name: "AnomalyAlerting",
  components: { OButton, OSwitch, OSelect, OTooltip, RefreshCw },

  props: {
    config: {
      type: Object as PropType<any>,
      required: true,
    },
    destinations: {
      type: Array as PropType<any[]>,
      default: () => [],
    },
  },

  emits: ["refresh:destinations"],

  setup(props) {
    const { t } = useI18n();
    const router = useRouter();
    const store = useStore();

    const openAddDestination = () => {
      const route = router.resolve({
        name: "alertDestinations",
        query: { org_identifier: store.state.selectedOrganization.identifier },
      });
      window.open(route.href, "_blank");
    };

    return {
      t,
      store,
      openAddDestination,
    };
  },
});
</script>

<style lang="scss" scoped>
.step-anomaly-alerting {
  height: 100%;

  .step-content {
    border-radius: 8px;
    height: 100%;
    overflow-y: auto;
  }

  &.dark-mode {
    .step-content {
      background-color: #212121;
      border: 1px solid #343434;
    }
  }

  &.light-mode {
    .step-content {
      background-color: #ffffff;
      border: 1px solid #e6e6e6;
    }
  }
}

.alert-settings-row {
  margin-bottom: 24px !important;
  padding-bottom: 0 !important;
}

.destination-select {
  // override the compact 28px from alert-v3-select — chips need flexible height
  min-height: auto !important;
  height: auto !important;
  :deep(.q-field__inner) {
    min-height: auto !important;
    max-height: none !important;
    height: auto !important;
  }
  :deep(.q-field__control) {
    min-height: 1.75rem !important;
    max-height: none !important;
    height: auto !important;
    flex-wrap: nowrap;
  }
  :deep(.q-field__control-container) {
    flex-wrap: nowrap;
    overflow: hidden;
  }
  :deep(.q-field__marginal) {
    height: auto !important;
  }
  :deep(.q-field__append) {
    height: auto !important;
  }
}
</style>
