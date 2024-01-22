<!-- Copyright 2023 Zinc Labs Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <login></login>
</template>

<script lang="ts">
import { defineComponent, onBeforeMount } from "vue";
import Login from "@/components/login/Login.vue";
import config from "@/aws-exports";
import authService from "@/services/auth";
import configService from "@/services/config";
import { useStore } from "vuex";

export default defineComponent({
  name: "LoginPage",
  components: {
    Login,
  },
  setup() {
    const store = useStore();

    onBeforeMount(async () => {
      await configService
        .get_config()
        .then((res) => {
          store.commit("setZoConfig", res.data);
          if (config.isEnterprise == "true" && res.data.dex_enabled) {
            try {
              const dexData = authService.get_dex_login();
              dexData.then((res) => {
                if (res.data.url) {
                  window.location.href = res.data.url;
                }
              });
            } catch (error) {
              console.error("Error during redirection:", error);
            }
          }
        })
        .catch((err) => {
          console.error("Error while fetching config:", err);
        });
    });

    return {
      store,
    };
  },
});
</script>
