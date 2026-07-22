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

<script setup lang="ts">
import { useStore } from "vuex";
import CopyContent from "@/components/CopyContent.vue";
import IngestionContent from "@/components/ingestion/IngestionContent.vue";
import IngestionDocLink from "@/components/ingestion/IngestionDocLink.vue";
import useIngestion from "@/composables/useIngestion";
const name = "fastapi";
useStore();
const { languagesContent, languagesDocURLs } = useIngestion();
const content = languagesContent.replace("[STREAM_NAME]", name.replace(" ", "_").toLowerCase());
const docURL = languagesDocURLs[name];
</script>

<template>
  <IngestionContent>
    <CopyContent :content="content" />
    <IngestionDocLink :href="docURL" />
  </IngestionContent>
</template>