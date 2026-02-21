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
  <div :class="isCompact ? '' : 'q-pl-sm float-left'">
    <!-- Compact mode: Simple toggle button with dropdown menu -->
    <q-btn
      v-if="isCompact"
      data-test="logs-search-bar-refresh-interval-btn"
      flat
      dense
      no-caps
      :class="[
        'compact-refresh-btn',
        isAnimating ? 'active-refresh-btn' : ''
      ]"
    >
      <q-icon
        name="update"
        :class="[
          isAnimating ? 'rotating-icon' : '',
          isAnimating ? 'text-white' : ''
        ]"
        size="18px"
      />
      <q-tooltip class="tw-text-[12px]" :offset="[0, 2]">
        {{ t('search.autoRefresh') }}: {{ selectedLabel }}
      </q-tooltip>

      <!-- Dropdown menu for interval selection -->
      <q-menu content-style="z-index: 10001">
        <div class="row">
          <div class="col col-12 q-pa-sm" style="text-align: center; width: 300px">
            <q-btn
              data-test="logs-search-off-refresh-interval"
              no-caps
              :flat="modelValue.toString() !== '0'"
              size="md"
              :class="
                'no-border full-width ' +
                (modelValue.toString() === '0' ? 'selected' : '')
              "
              v-close-popup="true"
              @click="onItemClick({ label: t('common.off'), value: 0 })"
            >
              {{ t("common.off") }}
            </q-btn>
          </div>
        </div>
        <q-separator />
        <div v-for="(items, i) in refreshTimes" :key="'row_' + i" class="row">
          <div
            v-for="(item, j) in items"
            :key="'col_' + i + '_' + j"
            class="col col-4 q-pa-sm"
            style="text-align: center"
          >
            <q-btn
              :data-test="`logs-search-bar-refresh-time-${item.value}`"
              no-caps
              :flat="Number(modelValue) !== item.value"
              size="md"
              :class="[
                'no-border ' +
                  (Number(modelValue) === item.value ? 'selected' : ''),
              ]"
              @click="onItemClick(item)"
              v-close-popup="true"
              :disable="item.disabled"
            >
              <q-tooltip
                v-if="item.disabled"
                style="z-index: 10001; font-size: 14px"
                anchor="center right"
                self="center left"
                max-width="300px"
              >
                {{ minRangeRestrictionMessageVal }}
              </q-tooltip>
              {{ item.label }}
            </q-btn>
          </div>
        </div>
      </q-menu>
    </q-btn>

    <!-- Full mode: Dropdown with label -->
    <q-btn-dropdown
      v-else
      data-test="logs-search-bar-refresh-interval-btn-dropdown"
      v-model="btnRefreshInterval"
      no-caps
      class="q-pa-xs element-box-shadow el-border"
      content-style="z-index: 10001"
    >
      <template v-slot:label>
        <div class="row items-center no-wrap">
          <q-icon
            left
            name="update"
            :class="[
              isAnimating ? 'rotating-icon' : '',
              isAnimating ? 'text-primary' : ''
            ]"
          />
          <div class="text-center">{{ selectedLabel }}</div>
        </div>
      </template>
      <div class="row">
        <div class="col col-12 q-pa-sm" style="text-align: center">
          <q-btn
            data-test="logs-search-off-refresh-interval"
            no-caps
            :flat="modelValue.toString() !== '0'"
            size="md"
            :class="
              'no-border full-width ' +
              (modelValue.toString() === '0' ? 'selected' : '')
            "
            v-close-popup="true"
            @click="onItemClick({ label: 'Off', value: 0 })"
          >
            Off
          </q-btn>
        </div>
      </div>
      <q-separator />
      <div v-for="(items, i) in refreshTimes" :key="'row_' + i" class="row">
        <div
          v-for="(item, j) in items"
          :key="'col_' + i + '_' + j"
          class="col col-4 q-pa-sm"
          style="text-align: center"
        >
          <q-btn
            :data-test="`logs-search-bar-refresh-time-${item.value}`"
            no-caps
            :flat="Number(modelValue) !== item.value"
            size="md"
            :class="[
              'no-border ' +
                (Number(modelValue) === item.value ? 'selected' : ''),
            ]"
            @click="onItemClick(item)"
            v-close-popup="true"
            :disable="item.disabled"
          >
            <q-tooltip
              v-if="item.disabled"
              style="z-index: 10001; font-size: 14px"
              anchor="center right"
              self="center left"
              max-width="300px"
            >
              {{ minRangeRestrictionMessageVal }}
            </q-tooltip>
            {{ item.label }}
          </q-btn>
        </div>
      </div>
    </q-btn-dropdown>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  computed,
  watch,
  onActivated,
  onDeactivated,
  onMounted,
} from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import { generateDurationLabel } from "../utils/date";

export default defineComponent({
  name: "AutoRefreshInterval",
  props: {
    modelValue: {
      type: Number,
      default: 0,
    },
    trigger: {
      type: Boolean,
      default: false,
    },
    minRangeRestrictionMessage: {
      type: String,
      default: "",
    },
    minRefreshInterval: {
      type: Number,
      default: 0,
    },
    isCompact: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["update:modelValue", "trigger"],
  setup(props: any, { emit }) {
    const router = useRouter();
    const { t } = useI18n();
    const $q = useQuasar();

    const btnRefreshInterval = ref(false);
    let intervalInstance = 0;

    const refreshTimes = [
      [
        { label: "5 sec", value: 5, disabled: false },
        { label: "1 min", value: 60, disabled: false },
        { label: "1 hr", value: 3600, disabled: false },
      ],
      [
        { label: "10 sec", value: 10, disabled: false },
        { label: "5 min", value: 300, disabled: false },
        { label: "2 hr", value: 7200, disabled: false },
      ],
      [
        { label: "15 sec", value: 15, disabled: false },
        { label: "15 min", value: 900, disabled: false },
        { label: "1 day", value: 86400, disabled: false },
      ],
      [
        { label: "30 sec", value: 30, disabled: false },
        { label: "30 min", value: 1800, disabled: false },
      ],
    ];

    // v-model computed value
    const selectedValue = computed({
      get() {
        return props.modelValue;
      },
      set(value) {
        if (isDisabled(value)) {
          emit("update:modelValue", 0);
        }

        emit("update:modelValue", Number(value));
      },
    });

    // computed label based on the selected value
    const selectedLabel = computed(
      () =>
        refreshTimes.flat().find((it: any) => it.value == selectedValue.value)
          ?.label || generateDurationLabel(selectedValue.value),
    );

    // Check if animation should be active
    const isAnimating = computed(() => {
      return props.isCompact && selectedValue.value > 0;
    });

    // Default refresh interval (5 seconds)
    const defaultRefreshInterval = 5;
    let lastSelectedInterval = 5;

    // Toggle refresh on/off
    const toggleRefresh = () => {
      if (selectedValue.value > 0) {
        // Currently ON, turn it OFF
        lastSelectedInterval = selectedValue.value;
        selectedValue.value = 0;
      } else {
        // Currently OFF, turn it ON with last interval or default
        selectedValue.value = lastSelectedInterval || defaultRefreshInterval;
      }
    };

    // Open dropdown for selecting specific interval (for right-click or future use)
    const openDropdown = () => {
      btnRefreshInterval.value = true;
    };

    // update model when the selection has changed
    const onItemClick = (item: any) => {
      selectedValue.value = item.value;
      if (item.value > 0) {
        lastSelectedInterval = item.value;
      }
    };

    // watch on the selected value and update the timers
    watch(selectedValue, () => {
      resetTimers();
    });

    const resetTimers = () => {
      // first reset the current interval callback
      clearInterval(intervalInstance);

      // return if the interval value is zero
      if (selectedValue.value == 0 || !props.trigger) {
        return;
      }

      // if we have the value, continue and set the interval
      intervalInstance = window?.setInterval(() => {
        emit("trigger");
      }, selectedValue.value * 1000);
    };

    const minRangeRestrictionMessageVal = ref("");

    watch(
      () => props.minRefreshInterval,
      () => {
        updateDisabledFlags();
      },
    );

    const isDisabled = (value: number) => {
      return value < props.minRefreshInterval;
    };

    const updateDisabledFlags = () => {
      refreshTimes.forEach((row) => {
        row.forEach((item) => {
          item.disabled = isDisabled(item.value);
        });
      });
      minRangeRestrictionMessageVal.value = `The minimum refresh interval is ${props.minRefreshInterval} seconds. Please adjust the minimum refresh interval accordingly.`;
    };

    onMounted(() => {
      // Initialize the disabled flags on component mount
      updateDisabledFlags();
    });

    // on component mount and unmount, update the intervals
    onActivated(() => {
      resetTimers();
    });

    onDeactivated(() => {
      clearInterval(intervalInstance);
    });

    return {
      t,
      router,
      btnRefreshInterval,
      selectedLabel,
      refreshTimes,
      onItemClick,
      minRangeRestrictionMessageVal,
      isAnimating,
      selectedValue,
      toggleRefresh,
      openDropdown,
    };
  },
});
</script>

<style lang="scss" scoped>
.refresh-interval-dropdown {
  min-width: 36px;
  height: 100%;
  min-height: 30px;
  line-height: 30px;
  padding: 0px 5px;
}

.compact-refresh-btn {
  min-width: 24px !important;
  height: 28px !important;
  padding: 2px 4px !important;
  border: 1px solid var(--o2-border-color) !important;
  border-radius: 4px !important;
  transition: background-color 0.3s ease, border-color 0.3s ease;
}

.active-refresh-btn {
  background-color: var(--q-primary) !important;
  border-color: var(--q-primary) !important;
}

.active-refresh-btn:hover {
  background-color: var(--q-primary) !important;
  opacity: 0.9;
}

@keyframes rotate {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

:deep(.rotating-icon) {
  animation: rotate 2s linear infinite !important;
  transform-origin: center center !important;
  display: inline-block !important;
}

.rotating-icon {
  animation: rotate 2s linear infinite !important;
  transform-origin: center center !important;
  display: inline-block !important;
}
</style>
