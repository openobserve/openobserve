<template>
  <div>
    <component v-if="loadComponent" :is="componentName" />
  </div>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import OrganizationsCloud from "@/enterprise/components/organizations/Organization.vue";
import OrganizationsEnterprise from "@/components/iam/organizations/ListOrganizations.vue";

import config from "@/aws-exports";
import { watch } from "vue";

export default defineComponent({
  name: "AppOrganizations",
  components: {
    OrganizationsCloud,
    OrganizationsEnterprise,
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
          componentName.value = "OrganizationsCloud";
        }

        if (zoConfig.dex_enabled || config.isEnterprise == "true") {
          componentName.value = "OrganizationsEnterprise";
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
