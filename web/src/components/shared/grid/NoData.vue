<template>
  <div
    class="full-width column flex-center text-dark q-gutter-sm"
    style="font-size: 1.5rem"
  >
    <q-img
      src="../../../assets/images/common/clipboard_icon.svg"
      style="width: 230px; margin: 20vh auto 2rem"
    />
    <div class="q-ma-none">{{ t("ticket.noDataErrorMsg") }}</div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useI18n } from "vue-i18n";

export default defineComponent({
  name: "QTableNoData",
  setup() {
    const { t } = useI18n();

    return { t };
  },
});
</script>
