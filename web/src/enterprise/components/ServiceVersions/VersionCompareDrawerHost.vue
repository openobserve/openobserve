<template><VersionCompareDrawer v-if="drawer.isOpen.value" /></template>
<script setup lang="ts">
import VersionCompareDrawer from "./VersionCompareDrawer.vue";
import { useVersionCompareDrawer } from "@/enterprise/composables/useVersionCompareDrawer";
const drawer = useVersionCompareDrawer();
</script>
