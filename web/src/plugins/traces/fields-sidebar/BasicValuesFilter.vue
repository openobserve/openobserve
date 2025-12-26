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
        <div
          class="field_label ellipsis"
          style="width: calc(100% - 28px); font-size: 14px"
          :title="row.label || row.name"
        >
          {{ row.label || row.name }}
        </div>
        <div class="field_overlay">
          <q-btn
            :data-test="`log-search-index-list-filter-${row.name}-field-btn`"
            :icon="outlinedAdd"
            style="margin-right: 0.375rem"
            size="6px"
            class="q-mr-sm"
            @click.stop="addSearchTerm(`${row.name}=''`)"
            round
          />
        </div>
      </div>
    </template>
    <q-card>
      <q-card-section class="q-pl-md q-pr-xs q-py-xs">
        <div class="filter-values-container">
          <div
            v-show="fieldValues[row.name]?.isLoading"
            class="q-pl-md q-py-xs"
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
            class="q-pl-md q-py-xs text-subtitle2"
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
                  class="flex row wrap justify-between"
                  style="width: calc(100% - 46px)"
                >
                  <div
                    :title="value.key"
                    class="ellipsis q-pr-xs"
                    style="width: calc(100% - 50px)"
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
                <div
                  class="flex row"
                  :class="
                    store.state.theme === 'dark' ? 'text-white' : 'text-black'
                  "
                >
                  <q-btn
                    class="o2-custom-button-hover tw:ml-[0.25rem] tw:mr-[0.25rem] tw:border! tw:border-solid! tw:border-[var(--o2-border-color)]!"
                    size="6px"
                    title="Include Term"
                    round
                    @click="addSearchTerm(`${row.name}='${value.key}'`)"
                  >
                    <q-icon class="tw:h-[0.5rem] tw:w-[0.5rem]">
                      <EqualIcon></EqualIcon>
                    </q-icon>
                  </q-btn>
                  <q-btn
                    class="o2-custom-button-hover tw:border! tw:border-solid! tw:border-[var(--o2-border-color)]!"
                    size="6px"
                    title="Exclude Term"
                    round
                    @click="addSearchTerm(`${row.name}!='${value.key}'`)"
                  >
                    <q-icon class="tw:h-[0.5rem] tw:w-[0.5rem]">
                      <NotEqualIcon></NotEqualIcon>
                    </q-icon>
                  </q-btn>
                </div>
              </q-item>
            </q-list>
          </div>
        </div>
      </q-card-section>
    </q-card>
  </q-expansion-item>
</template>

<script lang="ts" setup>
import { ref } from "vue";
import useTraces from "@/composables/useTraces";
import { b64EncodeUnicode, formatLargeNumber } from "@/utils/zincutils";
import streamService from "@/services/stream";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import EqualIcon from "@/components/icons/EqualIcon.vue";
import NotEqualIcon from "@/components/icons/NotEqualIcon.vue";
import { outlinedAdd } from "@quasar/extras/material-icons-outlined";

const props = defineProps({
  row: {
    type: Object,
    default: () => null,
  },
});

const fieldValues = ref<any>({});

const store = useStore();

const $q = useQuasar();

const { searchObj } = useTraces();

const addSearchTerm = (term: string) => {
  searchObj.data.stream.addToFilter = term;
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

      // query_context = query_context.replace(
      //   "[WHERE_CLAUSE]",
      //   " WHERE " + whereClause,
      // );
      query_context = query_context.split("[WHERE_CLAUSE]").join(" WHERE " + whereClause);
    } else {
      query_context = query_context.replace("[WHERE_CLAUSE]", "");
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
        size: store.state.zoConfig?.query_values_default_num || 10,
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

<style lang="scss">
.q-expansion-item {
  .field_overlay {
    visibility: hidden;

    .q-icon {
      opacity: 0;
    }
  }

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
