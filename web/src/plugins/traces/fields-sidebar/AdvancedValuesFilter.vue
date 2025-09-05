
<template>
  <q-expansion-item
    class="field-expansion-item"
    dense
    switch-toggle-side
    :label="row.name"
    v-model:model-value="_isOpen"
    expand-icon-class="field-expansion-icon"
    expand-icon="expand_more"
    @before-show="(event: any) => openFilterCreator()"
    @before-hide="(event: any) => closeFilterCreator()"
  >
    <template v-slot:header>
      <div class="flex content-center ellipsis full-width" :title="row.name">
        <div
          class="field_label ellipsis"
          style="width: calc(100% - 28px); font-size: 14px"
        >
          {{ row.name }}
        </div>
      </div>
    </template>
    <q-card>
      <q-card-section class="q-pl-md q-pr-xs q-py-xs">
        <div class="q-mr-sm q-ml-sm">
          <input
            v-model="searchValue"
            class="full-width"
            :disabled="filter.isLoading"
            placeholder="Search"
            @input="onSearchValue()"
          />
        </div>
        <div class="filter-values-container q-mt-sm">
          <div
            v-show="!values?.length && !filter.isLoading"
            class="q-py-xs text-grey-9 text-center"
          >
            No values found
          </div>
          <div v-for="value in (values as any[])" :key="value.key">
            <q-list dense>
              <q-item tag="label" class="q-pr-none">
                <div
                  class="flex row wrap justify-between items-center"
                  style="width: calc(100%)"
                >
                  <q-checkbox
                    size="xs"
                    v-model="_selectedValues"
                    :val="value.key.toString()"
                    class="filter-check-box cursor-pointer"
                    @update:model-value="processValues()"
                  />
                  <div
                    :title="value.key"
                    class="ellipsis q-pr-xs"
                    style="width: calc(100% - 74px)"
                  >
                    {{ value.key }}
                  </div>
                  <div
                    :title="value.count"
                    class="ellipsis text-right q-pr-sm"
                    style="width: 50px"
                  >
                    {{ value.count }}
                  </div>
                </div>
              </q-item>
            </q-list>
          </div>
          <div
            v-show="filter.isLoading"
            class="q-pl-md q-mb-xs q-mt-md"
            style="height: 60px; position: relative"
          >
            <q-inner-loading
              size="xs"
              :showing="filter.isLoading"
              label="Fetching values..."
              label-style="font-size: 1.1em"
            />
          </div>
          <div
            v-show="values.length === filter.size"
            class="text-right flex items-center justify-end q-pt-xs"
          >
            <div
              style="width: fit-content"
              class="flex items-center cursor-pointer"
              @click="fetchMoreValues()"
            >
              <div style="width: fit-content" class="show-more-btn">
                Show more
              </div>
            </div>
          </div>
        </div>
      </q-card-section>
    </q-card>
  </q-expansion-item>
</template>

<script lang="ts" setup>
import { ref } from "vue";
import { debounce } from "quasar";
import { watch } from "vue";
import { cloneDeep } from "lodash-es";

const props = defineProps({
  row: {
    type: Object,
    default: () => null,
  },
  filter: {
    type: Object,
    default: () => {},
  },
  values: {
    type: Array,
    default: () => [],
  },
  selectedValues: {
    type: Array,
    default: () => [],
  },
  searchKeyword: {
    type: String,
    default: "",
  },
});

watch(
  () => props.selectedValues,
  () => {
    if (
      JSON.stringify(props.selectedValues) !==
      JSON.stringify(_selectedValues.value)
    ) {
      _selectedValues.value = props.selectedValues;
    }
  },
  {
    deep: true,
  }
);

const searchValue = ref("");

const _selectedValues = ref(props.selectedValues);

const _isOpen = ref(props.filter.isOpen);

const valuesSize = ref(4);

const emits = defineEmits([
  "update:selectedValues",
  "update:isOpen",
  "update:searchKeyword",
]);

const onSearchValue = () => {
  debouncedOpenFilterCreator();
};

const debouncedOpenFilterCreator = debounce(() => {
  emits("update:searchKeyword", searchValue);
}, 400);

const fetchMoreValues = () => {
  valuesSize.value = valuesSize.value * 2;
  openFilterCreator();
};

const processValues = () => {
  emits(
    "update:selectedValues",
    _selectedValues.value,
    cloneDeep(props.selectedValues)
  );
};

const closeFilterCreator = () => {
  emits("update:isOpen", false);
};

const openFilterCreator = () => {
  emits("update:isOpen", true, props.row.name);
};
</script>

<style lang="scss" scoped>
.show-more-btn {
  &:hover {
    color: $primary;
  }
}
</style>
<style lang="scss">
.filter-check-box {
  .q-checkbox__inner {
    font-size: 24px !important;
  }
}
.q-expansion-item {
  .q-item {
    display: flex;
    align-items: center;
    padding: 0;
    height: 32px !important;
    min-height: 32px !important;
  }
  .q-item__section--avatar {
    min-width: 12px;
    max-width: 12px;
    margin-right: 8px;
  }

  .filter-values-container {
    .q-item {
      padding-left: 4px;

      .q-focus-helper {
        background: none !important;
      }
    }
  }
  .q-item-type {
    &:hover {
      .field_overlay {
        visibility: visible;

        .q-icon {
          opacity: 1;
        }
      }
    }
  }
  .field-expansion-icon {
    margin-right: 4px !important;
    .q-icon {
      font-size: 18px;
      color: #808080;
    }
  }
}
</style>
