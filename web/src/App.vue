<!-- Copyright 2023 Zinc Labs Inc.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http:www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License. 
-->

<template>
  <router-view></router-view>
</template>

<script lang="ts">
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import config from "@/aws-exports";
export default {
  setup() {
    const store = useStore();
    // if (
    //   config.isCloud == "false" &&
    //   window.location.origin != "http://localhost:8081"
    // ) {
    //   const pos = window.location.pathname.indexOf("/web/");
    //   const path =
    //     window.location.origin == "http://localhost:8081"
    //       ? "/"
    //       : pos > -1
    //       ? window.location.pathname.slice(0, pos + 5)
    //       : window.location.pathname;
    //   store.dispatch("endpoint", path);
    // }
    const router = useRouter();
    const creds = localStorage.getItem("creds");
    if (creds) {
      // const credsInfo = JSON.parse(creds);
      // store.dispatch("login", credsInfo);
      router.push("/logs");
    }
  },
};
</script>
