<!-- Copyright 2022 Zinc Labs Inc. and Contributors

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
  <div class="column index-menu">
    <q-input
      data-test="log-search-index-list-field-search-input"
      v-model="searchMetricValue"
      data-cy="index-field-search-input"
      filled
      borderless
      dense
      clearable
      debounce="1"
      :placeholder="t('metrics.searchMetric')"
      @update:model-value="filterMetrics"
    >
      <template #prepend>
        <q-icon name="search" />
      </template>
    </q-input>
    <div class="metric-list">
      <div
        v-for="metric in streamOptions"
        :key="metric.label"
        class="metric-container flex content-center ellipsis q-py-sm q-px-sm cursor-pointer q-my-xs"
        :class="
          searchObj.data.metrics.selectedMetrics.includes(metric.label)
            ? 'selected'
            : ''
        "
        :title="metric.label"
        @click="updateSelectedMetrics(metric.label)"
      >
        <div class="field_label ellipsis pointer-cursor">
          {{ metric.label }}
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, type Ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { useRouter } from "vue-router";
import useMetrics from "../../composables/useMetrics";
import { getImageURL } from "../../utils/zincutils";

export default defineComponent({
  name: "MetricsList",
  setup() {
    const store = useStore();
    const router = useRouter();
    const { t } = useI18n();
    const $q = useQuasar();
    const { searchObj } = useMetrics();
    const streamOptions: any = ref(searchObj.data.metrics.metricList);
    const fieldValues: Ref<{
      [key: string | number]: {
        isLoading: boolean;
        values: { key: string; count: string }[];
      };
    }> = ref({});

    watch(
      () => searchObj.data.metrics.metricList.length,
      () => {
        streamOptions.value = searchObj.data.metrics.metricList;
      }
    );

    const searchMetricValue: Ref<string> = ref("");

    const filterMetrics = () => {
      if (!searchMetricValue.value) {
        streamOptions.value = [...searchObj.data.metrics.metricList];
        return;
      }
      const value = searchMetricValue.value.toLowerCase();
      streamOptions.value = searchObj.data.metrics.metricList.filter(
        (column: any) => column.label.toLowerCase().indexOf(value) > -1
      );
    };

    const updateSelectedMetrics = (metric: any) => {
      searchObj.data.metrics.selectedMetrics = [];
      searchObj.data.metrics.selectedMetrics.push(metric);
    };

    return {
      t,
      store,
      router,
      searchObj,
      streamOptions,
      getImageURL,
      filterMetrics,
      fieldValues,
      updateSelectedMetrics,
      searchMetricValue,
    };
  },
});
</script>

<style lang="scss" scoped>
.q-menu {
  box-shadow: 0px 3px 15px rgba(0, 0, 0, 0.1);
  transform: translateY(0.5rem);
  border-radius: 0px;

  .q-virtual-scroll__content {
    padding: 0.5rem;
  }
}
.index-menu {
  width: 100%;

  .metric-list {
    height: calc(100vh - 98px);
    width: 100%;
    overflow-x: hidden;
    overflow-y: auto;
    .metric-container {
      width: 100%;

      &:hover {
        background-color: #e6e6e6;
      }

      &.selected {
        background-color: rgba(89, 96, 178, 0.3);
      }
    }
  }
}

.q-item {
  color: $dark-page;
  min-height: 1.3rem;
  padding: 5px 10px;

  &__label {
    font-size: 0.75rem;
  }

  &.q-manual-focusable--focused > .q-focus-helper {
    background: none !important;
    opacity: 0.3 !important;
  }

  &.q-manual-focusable--focused > .q-focus-helper,
  &--active {
    background-color: $selected-list-bg !important;
  }

  &.q-manual-focusable--focused > .q-focus-helper,
  &:hover,
  &--active {
    color: $primary;
  }
}
.q-field--dense .q-field__before,
.q-field--dense .q-field__prepend {
  padding: 0px 0px 0px 0px;
  height: auto;
  line-height: auto;
}
.q-field__native,
.q-field__input {
  padding: 0px 0px 0px 0px;
}

.q-field--dense .q-field__label {
  top: 5px;
}
.q-field--dense .q-field__control,
.q-field--dense .q-field__marginal {
  height: 34px;
}
</style>
