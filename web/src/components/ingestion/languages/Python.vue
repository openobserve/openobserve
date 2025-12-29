<!-- Copyright 2025 OpenObserve Inc.

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
import useIngestion from "@/composables/useIngestion";
const name = "python";
const store = useStore();
const { endpoint, languagesContent, languagesDocURLs } = useIngestion();
const content = languagesContent.replace("[STREAM_NAME]", name.replace(" ", "_").toLowerCase());

const docURL = languagesDocURLs[name];
const docURLFastAPI = languagesDocURLs["fastapi"];
</script>

<template>
  <div class="q-pa-sm">
    <div class="tw:text-[16px]">
      <CopyContent :content="content" />
      <div class="tw:font-bold tw:pt-6 tw:pb-2">Check further documentation at:</div>
      <ol class="tw:list-decimal q-pl-md">
        <li class="tw:py-1">
          <a :href="docURL" target="_blank" class="text-blue-500 tw:underline">Python</a>
        </li>
        <li class="tw:py-1">
          <a :href="docURLFastAPI" target="_blank" class="text-blue-500 tw:underline">FastAPI</a>
        </li>
      </ol>
    </div>
  </div>
</template>