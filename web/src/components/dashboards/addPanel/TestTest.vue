<template>Coucou test</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useStore } from "vuex";

export default defineComponent({
  name: "TestTest",
  setup() {
    const store = useStore();

    return {
      store,
    };
  },
});
</script>
