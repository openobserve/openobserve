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
  <q-page class="q-pa-md">
    <div class="row text-body1 text-weight-medium">
      {{ t("billing.invoiceHistory") }}
    </div>
    <div>
      <invoice-table></invoice-table>
    </div>
  </q-page>
</template>

<script lang="ts">
import { defineComponent } from "@vue/runtime-core";
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
<style lang="scss" scoped></style>
