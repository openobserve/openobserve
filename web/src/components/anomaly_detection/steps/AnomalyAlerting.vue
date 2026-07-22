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
    class="step-anomaly-alerting h-full"
  >
    <div
      class="step-content px-3 py-4 rounded-default h-full overflow-y-auto border bg-surface-overlay border-border-default"
    >
      <!-- Enable Notifications toggle -->
      <div class="flex items-start mb-6!  pb-0!">
        <div
          class="font-semibold flex items-center"
          style="width: 190px; height: 36px"
        >
          {{ t('alerts.anomaly.notifications') }}
          <OIcon
            name="info"
            size="sm"
            class="ml-1 cursor-pointer text-icon-color"
          >
            <OTooltip :content="t('alerts.anomaly.notificationsTooltip')" side="right" />
          </OIcon>
        </div>
        <div class="flex items-center h-11">
          <OSwitch
            v-model="configModel.alert_enabled"
            :label="config.alert_enabled ? t('alerts.anomaly.enabled') : t('alerts.anomaly.disabled')"
            data-test="anomaly-alert-enabled"
          />
        </div>
      </div>

      <!-- Destination picker (shown when alert_enabled) -->
      <div
        v-if="config.alert_enabled"
        class="flex items-start mb-6! pb-0!"
      >
        <div
          class="font-semibold flex items-center"
          style="width: 190px; height: 36px"
        >
          {{ t("alerts.destination") }}
          <span class="text-status-error-text ml-1">*</span>
        </div>
        <div class="flex flex-col">
          <div class="flex items-center">
            <OSelect
              v-model="configModel.alert_destination_ids"
              :options="destinations"
              labelKey="name"
              valueKey="name"
              multiple
              searchable
              class="min-h-auto! h-auto!"
              style="min-width: 300px; max-width: 420px"
              data-test="anomaly-destination"
            >
              <template #selected-item="{ index, opt, removeAtIndex }">
                <OTag
                  v-if="index < visibleChipCount"
                  type="selectionChip"
                >
                  {{ typeof opt === "object" ? opt.name : opt }}
                  <template #trailing>
                    <button
                      type="button"
                      :aria-label="t('common.remove')"
                      class="inline-flex items-center justify-center cursor-pointer hover:opacity-70"
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
                  class="text-compact text-text-secondary ml-1 whitespace-nowrap"
                >
                  +{{ config.alert_destination_ids.length - visibleChipCount }}
                </span>
              </template>
              <template #empty>
                <span>{{ t('alerts.anomaly.noDestinationsFound') }}</span>
              </template>
            </OSelect>
            <OButton
              variant="ghost"
              size="sm"
              class="ml-1"
              :title="t('alerts.alertSettings.refreshDestinations')"
              @click="$emit('refresh:destinations')"
              icon-left="refresh"
            />
            <OButton
              variant="outline"
              size="sm"
              class="ml-2"
              @click="openAddDestination"
            >
              {{ t('alerts.anomaly.addNewDestination') }}
            </OButton>
          </div>
          <div
            v-if="
              config.alert_enabled && config.alert_destination_ids.length === 0
            "
            class="text-xs text-input-error-text pt-1"
            data-test="anomaly-destination-error"
          >
            {{ t('alerts.anomaly.destinationRequired') }}
          </div>
        </div>
      </div>

      <!-- Info note when notifications disabled -->
      <div
        v-if="!config.alert_enabled"
        class="flex items-start gap-2 text-xs mt-2"
        :class="'text-text-secondary'"
      >
        <OIcon name="info" size="sm"
class="mt-px flex-shrink-0" />
        <span>{{ t('alerts.anomaly.disabledNotificationsInfo') }}</span>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, type PropType } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import OButton from '@/lib/core/Button/OButton.vue';
import OSwitch from '@/lib/forms/Switch/OSwitch.vue';
import OSelect from '@/lib/forms/Select/OSelect.vue';
import OTooltip from '@/lib/overlay/Tooltip/OTooltip.vue';
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";

export default defineComponent({
  name: "AnomalyAlerting",
  components: { OButton, OSwitch, OSelect, OTooltip,
    OIcon,
    OTag,
},

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
    const { t } = useI18n();
    const router = useRouter();
    const store = useStore();

    // Alias for the config prop; same reference, mutation stays identical.
    const configModel = computed(() => props.config);

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
      store,
      configModel,
      openAddDestination,
      visibleChipCount,
    };
  },
});
</script>
