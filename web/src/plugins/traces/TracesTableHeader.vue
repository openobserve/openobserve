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
    data-test="traces-table-header"
    class="traces-table-header row items-center q-px-sm"
  >
    <div
      data-test="traces-table-header-timestamp"
      class="header-cell col-timestamp text-caption text-weight-bold"
    >
      TIMESTAMP
    </div>

    <div
      data-test="traces-table-header-service"
      class="header-cell col-service text-caption text-weight-bold"
    >
      SERVICE &amp; OPERATION
    </div>

    <div
      data-test="traces-table-header-duration"
      class="header-cell col-duration text-caption text-weight-bold text-left"
    >
      DURATION
    </div>

    <div
      data-test="traces-table-header-spans"
      class="header-cell col-spans text-caption text-weight-bold text-center"
    >
      SPANS
    </div>

    <div
      data-test="traces-table-header-status"
      class="header-cell col-status text-caption text-weight-bold text-center"
    >
      STATUS
    </div>

    <template v-if="showLlmColumns">
      <div
        data-test="traces-table-header-input-tokens"
        class="header-cell col-llm text-caption text-weight-bold text-right"
      >
        INPUT TOKENS
      </div>

      <div
        data-test="traces-table-header-output-tokens"
        class="header-cell col-llm text-caption text-weight-bold text-right"
      >
        OUTPUT TOKENS
      </div>

      <div
        data-test="traces-table-header-cost"
        class="header-cell col-cost text-caption text-weight-bold text-right"
      >
        COST
      </div>
    </template>

    <div
      data-test="traces-table-header-latency"
      class="header-cell col-latency text-caption text-weight-bold"
    >
      SERVICE LATENCY
    </div>
  </div>
</template>

<script setup lang="ts">
export interface TracesTableHeaderProps {
  showLlmColumns?: boolean;
}

withDefaults(defineProps<TracesTableHeaderProps>(), {
  showLlmColumns: false,
});
</script>

<style lang="scss" scoped>
.traces-table-header {
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  min-height: 36px;
  position: sticky;
  top: 0;
  z-index: 2;
  letter-spacing: 0.04em;
  color: var(--o2-text-3);
  letter-spacing: 2px !important;
}

.header-cell {
  padding: 0 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Column widths — must match TraceRow.vue */
.col-timestamp {
  width: 160px;
  flex: 0 0 160px;
}
.col-service {
  flex: 1 1 0;
  min-width: 180px;
}
.col-duration {
  width: 120px;
  flex: 0 0 120px;
}
.col-spans {
  width: 100px;
  flex: 0 0 100px;
}
.col-status {
  width: 160px;
  flex: 0 0 160px;
}
.col-llm {
  width: 110px;
  flex: 0 0 110px;
}
.col-cost {
  width: 80px;
  flex: 0 0 80px;
}
.col-latency {
  width: 160px;
  flex: 0 0 160px;
}
</style>
