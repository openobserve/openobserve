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
  <q-btn class="round-button" round flat @click="toggleDarkMode">
    <q-icon :name="DarkModeIcon"></q-icon>
  </q-btn>
</template>

<script lang="ts">
import { ref, watch, onMounted, computed, defineComponent } from "vue";
import { useQuasar } from "quasar";
import { useStore } from "vuex";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import {
  outlinedDarkMode,
  outlinedLightMode,
} from "@quasar/extras/material-icons-outlined";

export default defineComponent({
  setup() {
    const store = useStore();
    const $q = useQuasar();
    const darkMode = ref(false);

    const DarkModeIcons = {
      light: outlinedLightMode,
      dark: outlinedDarkMode,
    };

    onMounted(() => {
      const savedTheme = localStorage.getItem("theme");
      if (savedTheme !== null) {
        darkMode.value = savedTheme == "dark";
      } else {
        // Default to light theme if no saved theme is found
        darkMode.value = false;
      }
      setTheme(darkMode.value ? "dark" : "light");
    });

    const DarkModeIcon = computed(() => {
      return darkMode.value ? DarkModeIcons.dark : DarkModeIcons.light;
    });

    watch(darkMode, () => {
      setTheme(darkMode.value ? "dark" : "light");
    });
    watch(
      () => store.state.theme,
      () => {
        monaco.editor.setTheme(
          store.state.theme == "dark" ? "vs-dark" : "myCustomTheme"
        );
      }
    );

    const setTheme = (theme: any) => {
      localStorage.setItem("theme", theme);
      $q.dark.set(theme == "dark");
      store.dispatch("appTheme", theme);
    };

    const toggleDarkMode = () => {
      darkMode.value = !darkMode.value;
    };

    return {
      store,
      darkMode,
      DarkModeIcon,
      toggleDarkMode,
      outlinedDarkMode,
      outlinedLightMode,
    };
  },
});
</script>

<style>
.light-mode {
  background-color: #ffffff;
  color: #000000;
}

.dark-mode {
  background-color: #36383a;
  color: #ffffff;
}

.round-button {
  border: none;
  border-radius: 50%;
  box-shadow: none;
  transition: box-shadow 0.3s ease;
}

.round-button:hover {
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}
</style>
