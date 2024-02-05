<template>
  <div>
    <component v-if="loadComponent" :is="componentName" />
  </div>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import UsersCloud from "@/enterprise/components/users/User.vue";
import UsersOpenSource from "@/components/iam/users/User.vue";
import UsersEnterprise from "@/components/iam/users/enterprise/User.vue";

import config from "@/aws-exports";
import { watch } from "vue";

export default defineComponent({
  name: "UserPage",
  components: {
    UsersCloud,
    UsersOpenSource,
    UsersEnterprise,
  },
  setup() {
    const store = useStore();
    const { t } = useI18n();

    const componentName = ref("");

    const loadComponent = ref(false);

    watch(
      () => store.state.zoConfig,
      (zoConfig) => {
        if (config.isCloud == "true") {
          componentName.value = "UsersCloud";
        } else if (zoConfig.dex_enabled) {
          componentName.value = "UsersEnterprise";
        } else {
          componentName.value = "UsersOpenSource";
        }

        loadComponent.value = true;
      },
      {
        immediate: true,
      }
    );

    return { store, t, componentName, loadComponent };
  },
});
</script>
