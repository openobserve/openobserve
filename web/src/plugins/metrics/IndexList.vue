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
          searchObj.data.stream.selectedMetrics.includes(metric.label)
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
import { defineComponent, ref, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { useRouter } from "vue-router";
import useMetrics from "../../composables/useMetrics";
import { getImageURL } from "../../utils/zincutils";
import streamService from "../../services/stream";
import { getConsumableDateTime } from "@/utils/commons";

export default defineComponent({
  name: "ComponentSearchIndexSelect",
  setup() {
    const store = useStore();
    const router = useRouter();
    const { t } = useI18n();
    const $q = useQuasar();
    const { searchObj } = useMetrics();
    const streamOptions: any = ref(searchObj.data.stream.streamLists);
    const fieldValues: Ref<{
      [key: string | number]: {
        isLoading: boolean;
        values: { key: string; count: string }[];
      };
    }> = ref({});

    const searchMetricValue: Ref<string> = ref("");

    const filterMetrics = () => {
      if (!searchMetricValue.value) {
        streamOptions.value = [...searchObj.data.stream.streamLists];
        return;
      }
      const value = searchMetricValue.value.toLowerCase();
      streamOptions.value = searchObj.data.stream.streamLists.filter(
        (column: any) => column.label.toLowerCase().indexOf(value) > -1
      );
    };

    const filterFieldFn = (rows: any, terms: any) => {
      var filtered = [];
      if (terms != "") {
        terms = terms.toLowerCase();
        for (var i = 0; i < rows.length; i++) {
          if (rows[i]["name"].toLowerCase().includes(terms)) {
            filtered.push(rows[i]);
          }
        }
      }
      return filtered;
    };

    const addToFilter = (field: any) => {
      searchObj.data.stream.addToFilter = field;
    };

    const openFilterCreator = (event: any, { name, ftsKey }: any) => {
      if (ftsKey) {
        event.stopPropagation();
        event.preventDefault();
        return;
      }
      const timestamps = getConsumableDateTime(searchObj.data.datetime);
      const startISOTimestamp: any =
        new Date(timestamps.start_time.toISOString()).getTime() * 1000;
      const endISOTimestamp: any =
        new Date(timestamps.end_time.toISOString()).getTime() * 1000;

      fieldValues.value[name] = {
        isLoading: true,
        values: [],
      };
      try {
        streamService
          .fieldValues({
            org_identifier: store.state.selectedOrganization.identifier,
            stream_name: searchObj.data.stream.selectedStream.value,
            start_time: startISOTimestamp,
            end_time: endISOTimestamp,
            fields: [name],
            size: 10,
          })
          .then((res: any) => {
            if (res.data.hits.length) {
              fieldValues.value[name]["values"] = res.data.hits
                .find((field: any) => field.field === name)
                .values.map((value: any) => {
                  return {
                    key: value.key ? value.key : "null",
                    count: formatNumberWithPrefix(value.num),
                  };
                });
            }
          })
          .finally(() => {
            fieldValues.value[name]["isLoading"] = false;
          });
      } catch (err) {
        $q.notify({
          type: "negative",
          message: "Error while fetching field values",
        });
      }
    };

    function formatNumberWithPrefix(number: number) {
      if (number >= 1000000000) {
        return (number / 1000000000).toFixed(1) + "B";
      } else if (number >= 1000000) {
        return (number / 1000000).toFixed(1) + "M";
      } else if (number >= 1000) {
        return (number / 1000).toFixed(1) + "K";
      } else {
        return number.toString();
      }
    }

    const addSearchTerm = (term: string) => {
      // searchObj.meta.showDetailTab = false;
      searchObj.data.stream.addToFilter = term;
    };

    const updateSelectedMetrics = (metric: any) => {
      searchObj.data.stream.selectedMetrics = [];
      searchObj.data.stream.selectedMetrics.push(metric);
    };

    return {
      t,
      store,
      router,
      searchObj,
      streamOptions,
      addToFilter,
      getImageURL,
      filterMetrics,
      openFilterCreator,
      addSearchTerm,
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
