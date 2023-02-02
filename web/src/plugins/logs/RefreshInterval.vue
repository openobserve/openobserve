<template>
  <div class="col">
    <q-item
      v-for="(item, index) in data"
      :key="'interval_' + index"
      v-close-popup
      dense
      clickable
      @click="refreshTimeChange(item)"
    >
      <q-item-section>
        <q-item-label>{{ item.label }}</q-item-label>
      </q-item-section>
    </q-item>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
  name: "ComponentRefreshInterval",
  props: {
    data: {
      type: Object,
      default: () => ({}),
    },
  },
  emits: ["on_change"],
  setup(props, { emit }) {
    const refreshTimeChange = (item: any) => {
      emit("on_change", item);
    };

    return {
      refreshTimeChange,
    };
  },
});
</script>

<style lang="scss">
.q-item {
  &:hover {
    background-color: #e3e4fa;
  }
  border-radius: 5px;
  text-align: left;
  margin: 5px;
}
</style>
