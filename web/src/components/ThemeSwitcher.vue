<template>
    <q-toggle v-model="darkMode" label="Dark Mode"></q-toggle>
</template>

<script lang="ts">
import { ref, watch, onMounted } from 'vue';
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

        return {
            store,
            darkMode,
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
</style>
