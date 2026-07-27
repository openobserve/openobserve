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
  <div data-test="invoice-history-container" class="rounded-default flex h-full flex-col">
    <div class="min-h-0 flex-1">
      <div class="h-full w-full">
        <InvoiceTable></InvoiceTable>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useI18n } from "vue-i18n";
import InvoiceTable from "./invoiceTable.vue";

export default defineComponent({
  name: "Payment Details",
  components: {
    InvoiceTable,
  },
  setup() {
    const { t } = useI18n();
    return {
      t,
    };
  },
});
</script>
