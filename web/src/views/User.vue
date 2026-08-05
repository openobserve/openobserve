<template>
  <component v-if="loadComponent" :is="componentName" />
</template>

<script lang="ts">
import { defineComponent, ref, onBeforeMount } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import Users from "@/components/iam/users/User.vue";

import config from "@/aws-exports";

export default defineComponent({
  name: "UserPage",
  components: {
    Users,
  },
  setup() {
    const store = useStore();
    const { t } = useI18nTyped();

    const componentName = ref("");

    const loadComponent = ref(false);

    onBeforeMount(() => {
      componentName.value = "Users";
      loadComponent.value = true;
    });

    return { store, t, componentName, loadComponent };
  },
});
</script>
