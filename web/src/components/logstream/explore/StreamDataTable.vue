<template>
  <q-virtual-scroll
    class="stream-data-table"
    data-test="logs-search-result-logs-table"
    id="searchGridComponent"
    type="table"
    ref="searchTableRef"
    :virtual-scroll-item-size="25"
    :virtual-scroll-sticky-size-start="0"
    :virtual-scroll-sticky-size-end="0"
    :virtual-scroll-slice-size="150"
    :virtual-scroll-slice-ratio-before="10"
    :items="rows"
    @virtual-scroll="onScroll"
  >
    <template v-slot:before>
      <thead class="thead-sticky text-left">
        <tr>
          <th
            v-for="(col, index) in (columns as any[])"
            :key="col.label + index"
            class="table-header"
          >
            <span class="table-head-label">
              {{ col.label }}
            </span>
          </th>
        </tr>
      </thead>
    </template>
    <template v-slot="{ item: row, index }">
      <q-tr
        :data-test="`stream-data-detail-${index}`"
        :key="'expand_' + index"
        style="cursor: pointer"
        class="pointer"
      >
        <q-td
          v-for="column in (columns as any[])"
          :key="row[column.name] || 'null' + index + column.name"
          class="field_list"
          style="cursor: pointer"
          :title="row[column.name] || 'null'"
        >
          <div class="flex row items-center no-wrap">
            {{
              !row[column.name]
                ? "null"
                : row[column.name].toString().length > 50
                ? row[column.name].substring(0, 47) + "..."
                : row[column.name]
            }}
          </div>
        </q-td>
      </q-tr>
    </template>
  </q-virtual-scroll>
</template>

<script lang="ts">
import { defineComponent, onBeforeUpdate, ref } from "vue";

export default defineComponent({
  name: "StreamDataTable",
  props: {
    rows: {
      type: Array,
      default: () => [],
    },
    columns: {
      type: Array,
      default: () => [],
    },
    isLoading: {
      type: Boolean,
      default: false,
    },
    pagination: {
      type: Object,
      default: () => {},
    },
  },
  emits: ["update:scroll"],
  setup(props, { emit }) {
    const searchTableRef: any = ref(null);

    const onScroll = (info: any) => {
      if (info.ref.items.length / info.index <= 1.4 && !props.isLoading) {
        emit("update:scroll");
      }
    };
    return {
      onScroll,
      searchTableRef,
    };
  },
});
</script>

<style lang="scss" scoped>
.stream-data-table {
  width: 100%;

  .my-sticky-header-table {
    .q-table__top,
    .q-table__bottom,
    thead tr:first-child th {
      /* bg color is important for th; just specify one */
      background-color: white;
    }

    thead tr th {
      position: sticky;
      z-index: 1;
    }

    thead tr:first-child th {
      top: 0;
    }

    /* this is when the loading indicator appears */
    &.q-table--loading thead tr:last-child th {
      /* height of all previous header rows */
      top: 48px;
    }
  }

  .q-table__top {
    padding-left: 0;
    padding-top: 0;
  }

  .q-table thead tr,
  .q-table tbody td,
  .q-table th,
  .q-table td {
    height: 15px;
    padding: 0px 5px;
    font-size: 0.75rem;
  }

  .q-table__bottom {
    width: 100%;
  }

  .q-table__bottom {
    min-height: 20px;
    padding-top: 0;
    padding-bottom: 0;
  }

  .q-td {
    overflow: hidden;
    min-width: 100px;
  }
  .table-header {
    // text-transform: capitalize;

    .q-table th.sortable {
      cursor: pointer;
      text-transform: capitalize;
      font-weight: bold;
    }
  }
}
.thead-sticky tr > *,
.tfoot-sticky tr > * {
  position: sticky;
  opacity: 1;
  z-index: 1;
  background: #f5f5f5;
}

.q-table--dark .thead-sticky tr > *,
.q-table--dark .tfoot-sticky tr > * {
  background: #565656;
}

.q-table--dark .table-header {
  // text-transform: capitalize;

  .table-head-chip {
    background-color: #565656;
  }
}
.thead-sticky tr:last-child > * {
  top: 0;
}

.tfoot-sticky tr:first-child > * {
  bottom: 0;
}
</style>
