<!-- Copyright 2026 OpenObserve Inc.

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
  <div class="h-full" data-test="autoobserve-home">
    <AutoObserve v-if="view === 'nerd'" />
    <AutoObserve2 v-else />
  </div>
</template>

<script setup lang="ts">
import AutoObserve from "@/views/AutoObserve.vue";
import AutoObserve2 from "@/views/AutoObserve2.vue";
import { watch } from "vue";
import { useAutoObserveView } from "@/components/autoobserve/v2/useAutoObserveView";
import { resetDecisions } from "@/components/autoobserve/v2/useDecisions";
import { useScenario } from "@/components/autoobserve/data/useScenario";

const { view } = useAutoObserveView();
const { scenario } = useScenario();
// Answers belong to one scenario's story, so switching scenario in either view starts fresh.
watch(scenario, resetDecisions);
</script>
