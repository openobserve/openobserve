<template>
  <div v-if="props.errors.errors.length">
    <q-separator />
    <div>
      <q-bar class="row q-pa-sm expand-bar">
        <div style="flex: 1;" @click="onDropDownClick">
          <q-icon flat :name="!showErrors ? 'arrow_right' : 'arrow_drop_down'" text-color="black" class="q-mr-sm" />
          <span class="text-subtitle2 text-weight-bold" style="color: red;">Errors ({{ props.errors.errors.length }})</span>
          <q-space />
        </div>
      </q-bar>
    </div>
    <div class="row" :style="!showErrors ? 'height: 0px;' : 'height: auto;'" style="overflow: hidden;">
      <div class="col">
        <div>
          <ul>
            <li v-for="(item, index) in props.errors.errors" :key="index" style="color:red;">{{ item }}</li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, watch } from 'vue'
import { useI18n } from "vue-i18n";

export default defineComponent({
  name: "DashboardErrorsComponent",
  props: ["errors"],

  setup(props, { emit }) {
    const showErrors = ref(false)
    const { t } = useI18n();

    const onDropDownClick = () => {
      showErrors.value = !showErrors.value
    }

    watch([showErrors, props.errors], () => {
      resizeChartEvent()
    })

    watch(props.errors, () => {
      if(props.errors.errors.length > 0) {
        showErrors.value = true
      }
    })

    const resizeChartEvent = () => {
      window.dispatchEvent(new Event("resize"))
    }

    return {
      props,
      t,
      onDropDownClick,
      showErrors
    }
  }
})
</script>

<style lang="scss" scoped>
.expand-bar {
  overflow: hidden;
  cursor: pointer;

  &:hover {
    background-color: #eaeaeaa5;
  }
}
</style>