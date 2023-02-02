<template>
  <router-view></router-view>
</template>

<script lang="ts">
//import { useStore } from "vuex";
import { useRouter } from "vue-router";
export default {
  setup() {
    const router = useRouter();
    const creds = localStorage.getItem("creds");
    if (creds) {
      const credsInfo = JSON.parse(creds);
      // store.dispatch("login", credsInfo);
      router.push("/logs");
    }
  },
};
</script>