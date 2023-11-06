<!-- Copyright 2023 Zinc Labs Inc.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http:www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License. 
-->

<template>
  <div class="q-pl-sm float-left">
    <q-btn-dropdown
      v-model="btnRefreshInterval"
      border
      no-caps
      class="q-pa-xs refresh-interval-dropdown"
    >
      <template v-slot:label>
        <div class="row items-center no-wrap">
          <q-icon left name="update" />
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
      <div v-for="(items, i) in refreshTimes"
:key="'row_' + i" class="row">
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
            :class="
              'no-border ' +
              (Number(modelValue) === item.value ? 'selected' : '')
            "
            @click="onItemClick(item)"
            v-close-popup="true"
          >
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
  reactive,
  computed,
  watch,
  onActivated,
  onDeactivated,
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
        { label: "5 sec", value: 5 },
        { label: "1 min", value: 60 },
        { label: "1 hr", value: 3600 },
      ],
      [
        { label: "10 sec", value: 10 },
        { label: "5 min", value: 300 },
        { label: "2 hr", value: 7200 },
      ],
      [
        { label: "15 sec", value: 15 },
        { label: "15 min", value: 900 },
        { label: "1 day", value: 86400 },
      ],
      [
        { label: "30 sec", value: 30 },
        { label: "30 min", value: 1800 },
      ],
    ];

    // v-model computed value
    const selectedValue = computed({
      get() {
        return props.modelValue;
      },
      set(value) {
        emit("update:modelValue", Number(value));
      },
    });

    // computed label based on the selected value
    const selectedLabel = computed(
      () =>
        refreshTimes.flat().find((it: any) => it.value == selectedValue.value)
          ?.label || generateDurationLabel(selectedValue.value)
    );

    // update model when the selection has changed
    const onItemClick = (item: any) => {
      selectedValue.value = item.value;
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
    };
  },
});
</script>

<style lang="scss" scoped>
.refresh-interval-dropdown {
  min-width: 36px;
  height: 30px;
  min-height: 30px;
  line-height: 30px;
  padding: 0px 5px;
}
</style>
