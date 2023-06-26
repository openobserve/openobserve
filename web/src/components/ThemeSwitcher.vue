<template>
    <q-btn class="round-button" flat @click="toggleDarkMode">
      <q-icon :name="DarkModeIcon"></q-icon>
    </q-btn>
</template>

<script lang="ts">
import { ref, watch, onMounted, computed } from 'vue';
import { useQuasar } from 'quasar';
import { useStore } from "vuex";
import * as monaco from "monaco-editor";

export default {
    setup() {
        const store = useStore();
        const $q = useQuasar();
        const darkMode = ref(false);

        onMounted(() => {
            const savedTheme = localStorage.getItem('theme');
            if (savedTheme !== null) {
                darkMode.value = savedTheme == 'dark';
            } else {
                // Default to light theme if no saved theme is found
                darkMode.value = false;
            }
            console.log(`Mounted with saved theme: ${savedTheme} and darkMode: ${darkMode.value}`);
            setTheme(darkMode.value ? 'dark' : 'light');
        });

        const DarkModeIcon = computed(() => {
            return darkMode.value ? 'dark_mode' : 'light_mode'
        });

        watch(darkMode, () => {
            setTheme(darkMode.value ? 'dark' : 'light')
        });
         watch(() => store.state.theme, () => {
            console.log('theme updated', store.state.theme);
            monaco.editor.setTheme(store.state.theme == 'dark' ? 'vs-dark' : 'myCustomTheme');
        })

        const setTheme = (theme: any) => {
            localStorage.setItem('theme', theme);
            console.log(`Saved new theme to local storage: ${theme}`);
            $q.dark.set(theme == 'dark');
            console.log(theme, "newMode");
            store.dispatch("appTheme", theme);
        }

        const toggleDarkMode = () => {
            darkMode.value = !darkMode.value;
        };

        return {
            store,
            darkMode,
            DarkModeIcon,
            toggleDarkMode
        };
    },
};
</script>


<style>
.light-mode {
    background-color: #ffffff;
    color: #000000;
}

.dark-mode {
    background-color: #36383A;
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
