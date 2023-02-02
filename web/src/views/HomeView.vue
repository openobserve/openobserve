<template>
  <q-page class="q-pa-lg">
    <div class="row">
      <div class="col-4 pointer-description">
        <!-- Haven't started ingesting data yet? -->
      </div>
      <div class="col-8 pointer-to-demo">
        <img
          src="../assets/images/common/pointer-to-demo-2.svg"
          alt="pointer to demo org selector"
        />
      </div>
    </div>

    <div class="row">
      <div class="col-6">
        <q-btn
          label="Find how to ingest logs"
          color="primary"
          @click="() => $router.push('/ingestion/fluentbit')"
        />
      </div>
    </div>
  </q-page>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useI18n } from "vue-i18n";

export default defineComponent({
  name: "PageHome",

  setup() {
    const { t } = useI18n();

    return {
      t,
    };
  },
});
</script>

<style scoped lang="scss">
.pointer-to-demo {
  // width: 100%;
  // height: 100%;
  margin-left: auto;
  margin-right: 0;
}

.pointer-description {
  // vertical-align: middle;
  display: flex;
  align-items: center;
}
</style>

