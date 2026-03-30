<!-- Copyright 2023 OpenObserve Inc.

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
    <div class="step-content card-container tw:px-3 tw:py-4">
      <!-- Enable Notifications toggle -->
      <div class="flex items-start alert-settings-row">
        <div
          class="tw:font-semibold flex items-center"
          style="width: 190px; height: 36px"
        >
          Notifications
          <q-icon
            name="info"
            size="17px"
            class="q-ml-xs cursor-pointer"
            :class="
              store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'
            "
          >
            <q-tooltip
              anchor="center right"
              self="center left"
              max-width="300px"
            >
              <span style="font-size: 14px">
                When enabled, a notification will be sent to the selected
                destination whenever an anomaly is detected.
              </span>
            </q-tooltip>
          </q-icon>
        </div>
        <div>
          <q-toggle
            v-model="config.alert_enabled"
            :label="config.alert_enabled ? 'Enabled' : 'Disabled'"
            color="primary"
            size="xs"
            class="o2-toggle-button-xs"
            :class="
              store.state.theme === 'dark'
                ? 'o2-toggle-button-xs-dark'
                : 'o2-toggle-button-xs-light'
            "
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
            <q-select
              v-model="config.alert_destination_ids"
              :options="filteredDestinations"
              option-label="name"
              option-value="name"
              emit-value
              map-options
              multiple
              use-chips
              dense
              borderless
              use-input
              input-debounce="300"
              :max-values="undefined"
              class="destination-select"
              style="min-width: 300px; max-width: 420px; background: none"
              data-test="anomaly-destination"
              @filter="filterDestinations"
            >
              <template #selected-item="{ index, opt, removeAtIndex }">
                <q-chip
                  v-if="index < visibleChipCount"
                  dense
                  removable
                  class="tw:text-[13px]"
                  @remove="removeAtIndex(index)"
                >
                  {{ typeof opt === "object" ? opt.name : opt }}
                </q-chip>
                <span
                  v-if="
                    index === visibleChipCount &&
                    config.alert_destination_ids.length > visibleChipCount
                  "
                  class="tw:text-[13px] tw:text-gray-500 tw:ml-1 tw:whitespace-nowrap"
                >
                  +{{ config.alert_destination_ids.length - visibleChipCount }}
                </span>
              </template>
              <template #option="{ itemProps, opt, selected, toggleOption }">
                <q-item v-bind="itemProps">
                  <q-item-section side>
                    <q-checkbox
                      :model-value="selected"
                      dense
                      @update:model-value="toggleOption(opt)"
                    />
                  </q-item-section>
                  <q-item-section>
                    <q-item-label>{{ opt.name }}</q-item-label>
                  </q-item-section>
                </q-item>
              </template>
              <template #no-option>
                <q-item>
                  <q-item-section class="text-grey"
                    >No destinations found</q-item-section
                  >
                </q-item>
              </template>
            </q-select>
            <q-btn
              icon="refresh"
              class="iconHoverBtn q-ml-xs"
              :class="store.state?.theme === 'dark' ? 'icon-dark' : ''"
              padding="xs"
              unelevated
              size="sm"
              round
              flat
              title="Refresh destinations"
              style="min-width: auto"
              @click="$emit('refresh:destinations')"
            />
            <q-btn
              label="Add New Destination"
              class="o2-secondary-button q-ml-sm"
              no-caps
              size="sm"
              @click="openAddDestination"
            />
          </div>
          <div
            v-if="
              config.alert_enabled && config.alert_destination_ids.length === 0
            "
            class="text-red-8 q-pt-xs"
            style="font-size: 11px; line-height: 12px"
            data-test="anomaly-destination-error"
          >
            At least one destination is required!
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
        <span>
          Anomaly detection will still run and write results to the
          <code>_anomalies</code> stream. Enable notifications to receive alerts
          when anomalies are detected.
        </span>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch, type PropType } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useStore } from "vuex";

export default defineComponent({
  name: "AnomalyAlerting",

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

    const filteredDestinations = ref<any[]>(props.destinations);

    // Sync when parent loads destinations asynchronously after component mount.
    watch(
      () => props.destinations,
      (val) => {
        filteredDestinations.value = val;
      },
    );

    const filterDestinations = (val: string, update: any) => {
      update(() => {
        const needle = val.toLowerCase();
        filteredDestinations.value = needle
          ? props.destinations.filter((d: any) =>
              d.name.toLowerCase().includes(needle),
            )
          : props.destinations;
      });
    };

    // Dynamically decide how many chips to show based on text length.
    // The select has ~420px max-width; each char is roughly 7px + chip padding ~50px.
    const MAX_CHARS = 42;
    const visibleChipCount = computed(() => {
      const ids = props.config.alert_destination_ids;
      if (!ids || ids.length === 0) return 0;
      if (ids.length === 1) return 1;
      // Resolve names from destinations list
      const getName = (id: string) => {
        const dest = props.destinations.find((d: any) => d.name === id);
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
      store,
      filteredDestinations,
      filterDestinations,
      openAddDestination,
      visibleChipCount,
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
  :deep(.q-field__control) {
    height: 36px;
    min-height: 36px;
    flex-wrap: nowrap;
  }
  :deep(.q-field__control-container) {
    flex-wrap: nowrap;
    overflow: hidden;
  }
}
</style>
