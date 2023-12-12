<template>
  <q-expansion-item
    class="field-expansion-item"
    dense
    switch-toggle-side
    :label="row.name"
    expand-icon-class="field-expansion-icon"
    expand-icon="expand_more"
    @before-show="(event: any) => openFilterCreator(event, row)"
  >
    <template v-slot:header>
      <div class="flex content-center ellipsis full-width" :title="row.name">
        <div class="field_label ellipsis" style="width: calc(100% - 28px)">
          {{ row.name }}
        </div>
        <div
          class="field_overlay"
          :style="{
            background: store.state.theme === 'dark' ? '#414345' : '#d9d9d9',
          }"
        >
          <q-btn
            :data-test="`log-search-index-list-filter-${row.name}-field-btn`"
            :icon="outlinedAdd"
            style="margin-right: 0.375rem"
            size="4px"
            class="q-mr-sm"
            @click.stop="addToFilter(`${row.name}=''`)"
            round
          />
        </div>
      </div>
    </template>
    <q-card>
      <q-card-section class="q-pl-md q-pr-xs q-py-xs">
        <div class="q-mr-sm q-ml-sm">
          <input
            v-model="searchValue"
            class="full-width"
            :disabled="
              !fieldValues[row.name]?.values?.length &&
              !fieldValues[row.name]?.isLoading
            "
            @input="onSearchValue()"
          />
        </div>
        <div class="filter-values-container q-mt-sm">
          <div
            v-show="fieldValues[row.name]?.isLoading"
            class="q-pl-md q-mb-xs q-mt-md"
            style="height: 60px"
          >
            <q-inner-loading
              size="xs"
              :showing="fieldValues[row.name]?.isLoading"
              label="Fetching values..."
              label-style="font-size: 1.1em"
            />
          </div>
          <div
            v-show="
              !fieldValues[row.name]?.values?.length &&
              !fieldValues[row.name]?.isLoading
            "
            class="q-py-xs text-grey-9 text-center"
          >
            No values found
          </div>
          <div
            v-for="value in fieldValues[row.name]?.values || []"
            :key="value.key"
          >
            <q-list dense>
              <q-item tag="label" class="q-pr-none">
                <div
                  class="flex row wrap justify-between items-center"
                  style="width: calc(100%)"
                >
                  <q-checkbox
                    size="xs"
                    v-model="selectedValues"
                    :val="value.key"
                    class="filter-check-box cursor-pointer"
                    @update:model-value="processValues(value.key)"
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
            v-show="fieldValues[row.name]?.values.length === valuesSize"
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
import { ref, defineEmits } from "vue";
import useTraces from "@/composables/useTraces";
import { b64EncodeUnicode, formatLargeNumber } from "@/utils/zincutils";
import streamService from "@/services/stream";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { outlinedAdd } from "@quasar/extras/material-icons-outlined";
import { debounce } from "quasar";

const props = defineProps({
  row: {
    type: Object,
    default: () => null,
  },
});

const fieldValues = ref<any>({});

const store = useStore();

const $q = useQuasar();

const { searchObj, addToFilter } = useTraces();

const searchValue = ref("");

const showShowMore = ref(true);

const selectedValues = ref([]);

const valuesSize = ref(4);

const emits = defineEmits(["update:values"]);

const onSearchValue = () => {
  debouncedOpenFilterCreator();
};

const debouncedOpenFilterCreator = debounce(() => {
  openFilterCreator(null, props.row);
}, 400);

const fetchMoreValues = () => {
  valuesSize.value = valuesSize.value * 2;
  openFilterCreator(null, props.row);
};

const processValues = () => {
  emits("update:values", props.row.name, selectedValues.value);
};

const openFilterCreator = (event: any, { name, ftsKey }: any) => {
  if (ftsKey) {
    event.stopPropagation();
    event.preventDefault();
    return;
  }

  fieldValues.value[name] = {
    isLoading: true,
    values: [],
  };

  try {
    let query_context = "";
    let query = searchObj.data.editorValue;
    let parseQuery = query.split("|");
    let whereClause = "";
    if (parseQuery.length > 1) {
      whereClause = parseQuery[1].trim();
    } else {
      whereClause = parseQuery[0].trim();
    }

    query_context =
      `SELECT * FROM "` +
      searchObj.data.stream.selectedStream.value +
      `" [WHERE_CLAUSE]`;

    if (whereClause.trim() != "") {
      whereClause = whereClause
        .replace(/=(?=(?:[^"']*"[^"']*"')*[^"']*$)/g, " =")
        .replace(/>(?=(?:[^"']*"[^"']*"')*[^"']*$)/g, " >")
        .replace(/<(?=(?:[^"']*"[^"']*"')*[^"']*$)/g, " <");

      whereClause = whereClause
        .replace(/!=(?=(?:[^"']*"[^"']*"')*[^"']*$)/g, " !=")
        .replace(/! =(?=(?:[^"']*"[^"']*"')*[^"']*$)/g, " !=")
        .replace(/< =(?=(?:[^"']*"[^"']*"')*[^"']*$)/g, " <=")
        .replace(/> =(?=(?:[^"']*"[^"']*"')*[^"']*$)/g, " >=");

      const parsedSQL = whereClause.split(" ");
      searchObj.data.stream.selectedStreamFields.forEach((field: any) => {
        parsedSQL.forEach((node: any, index: any) => {
          if (node == field.name) {
            node = node.replaceAll('"', "");
            parsedSQL[index] = '"' + node + '"';
          }
        });
      });

      whereClause = parsedSQL.join(" ");

      query_context = query_context.replace(
        "[WHERE_CLAUSE]",
        " WHERE " + whereClause
      );
    } else {
      query_context = query_context.replace("[WHERE_CLAUSE]", "");
    }

    if (searchValue.value) {
      if (whereClause) {
        query_context =
          query_context + ` AND ${name} ILIKE '${searchValue.value}%'`;
      } else {
        query_context =
          query_context + `WHERE ${name} ILIKE '${searchValue.value}%'`;
      }
    }

    query_context = b64EncodeUnicode(query_context) || "";

    fieldValues.value[name] = {
      isLoading: true,
      values: [],
    };

    streamService
      .fieldValues({
        org_identifier: store.state.selectedOrganization.identifier,
        stream_name: searchObj.data.stream.selectedStream.value,
        start_time: searchObj.data.datetime.startTime,
        end_time: searchObj.data.datetime.endTime,
        fields: [name],
        size: valuesSize.value,
        type: "traces",
        query_context,
      })
      .then((res: any) => {
        if (res.data.hits.length) {
          fieldValues.value[name]["values"] = res.data.hits
            .find((field: any) => field.field === name)
            .values.map((value: any) => {
              return {
                key: value.zo_sql_key ? value.zo_sql_key : "null",
                count: formatLargeNumber(value.zo_sql_num),
              };
            });
        }
      })
      .catch(() => {
        $q.notify({
          type: "negative",
          message: `Error while fetching values for ${name}`,
        });
      })
      .finally(() => {
        fieldValues.value[name]["isLoading"] = false;
      });
  } catch (e) {
    fieldValues.value[name]["isLoading"] = false;
    console.log("Error while fetching field values");
  }
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
    height: 25px !important;
    min-height: 25px !important;
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
    img {
      width: 12px;
      height: 12px;
    }
  }
}
</style>
