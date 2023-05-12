<template>
  <div>
    <component v-if="loadComponent" :is="componentName" />
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import UsersCloud from "@/enterprise/components/users/User.vue";
import UsersOpenSource from "@/components/users/User.vue";
import config from "@/aws-exports";

export default defineComponent({
  name: "UserPage",
  data() {
    return {
      componentName: "",
      loadComponent: false,
    };
  },
  created() {
    // check condition here and set the componentName accordingly
    if (config.isZincObserveCloud == "true") {
      this.componentName = "UsersCloud";
    } else {
      this.componentName = "UsersOpenSource";
    }
    this.loadComponent = true;
  },
  components: {
    UsersCloud,
    UsersOpenSource,
  },
  setup() {
    const store = useStore();
    const { t } = useI18n();

    return {store, t,};
  },
});
</script>
