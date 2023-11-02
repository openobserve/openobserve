<template>
  <div>
    display name
    <q-input
      v-model="override.value"
      label="Display Name *"
      color="input-border"
      bg-color="input-bg"
      class="q-py-md showLabelOnTop"
      stack-label
      outlined
      filled
      dense
    />
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, watch } from 'vue';

export default defineComponent({
  name: "DisplayName",
  props: {
    override:{
      type: Object,
      required: true
    }
  },
  setup(props) {
    

    return {};
  }
})
</script>
