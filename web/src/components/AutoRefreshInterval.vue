<template>
  <div class="q-pl-sm float-left">
      <q-btn-dropdown v-model="btnRefreshInterval" border no-caps class="q-pa-xs">
        <template v-slot:label>
          <div class="row items-center no-wrap" style="min-width: 65px;">
            <q-icon left name="update" />
            <div class="text-center">{{ selectedLabel }}</div>
          </div>
        </template>
        <q-list>
          <q-item v-for="(item, i) in refreshTimes" clickable v-close-popup @click="onItemClick(item)">
            <q-item-section>
              <q-item-label>{{ item.label }}</q-item-label>
            </q-item-section>
          </q-item>
        </q-list>
      </q-btn-dropdown>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, reactive, computed, watch, onActivated, onDeactivated } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import { generateDurationLabel } from "../utils/date"

export default defineComponent({
  name: "AutoRefreshInterval",
  props: {
    modelValue: {
      type: Number,
      default: 0,
    },
  },
  emits: ["update:modelValue","trigger"],
  setup(props: any, { emit }) {
    const router = useRouter();
    const { t } = useI18n();
    const $q = useQuasar();

    const btnRefreshInterval = ref(false);
    let intervalInstance = 0

    const refreshTimes = [
      { label: "Off", value: 0 },
      { label: "5s", value: 5 },
      { label: "10s", value: 10 },
      { label: "15s", value: 15 },
      { label: "30s", value: 30 },
      { label: "1m", value: 60 },
      { label: "5m", value: 300 },
      { label: "15m", value: 900 },
      { label: "30m", value: 1800 },
      { label: "1h", value: 3600 },
      { label: "2h", value: 7200 },
      { label: "1d", value: 86400 }
    ]

    // v-model computed value
    const selectedValue = computed({
      get() {
        return props.modelValue
      },
      set(value) {
        emit('update:modelValue', value)
      }
    })

    // computed label based on the selected value
    const selectedLabel = computed(() => refreshTimes.find((it:any) => it.value == selectedValue.value)?.label || generateDurationLabel(selectedValue.value))

    // update model when the selection has changed
    const onItemClick = (item: any) => {
      selectedValue.value = item.value
    }

    // watch on the selected value and update the timers
    watch(selectedValue, () => {
      resetTimers()
    })

    const resetTimers = () => {
      // first reset the current interval callback
      clearInterval(intervalInstance)

      // return if the interval value is zero
      if(selectedValue.value == 0) {
        return
      }

      // if we have the value, continue and set the interval
      intervalInstance = window?.setInterval(() => {
        emit("trigger")
      }, selectedValue.value * 1000)
    }

    // on component mount and unmount, update the intervals
    onActivated(() => {
      resetTimers()
    })

    onDeactivated(() => {
      clearInterval(intervalInstance)
    })

    return {
      t,
      router,
      btnRefreshInterval,
      selectedLabel,
      refreshTimes,
      onItemClick,
    }
  }

})
</script>


<style lang="scss" scoped>
</style>