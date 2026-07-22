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
import CopyContent from "@/components/CopyContent.vue";
import IngestionContent from "@/components/ingestion/IngestionContent.vue";
import useIngestion from "@/composables/useIngestion";
const name = "python";
const { languagesContent, languagesDocURLs } = useIngestion();
const content = languagesContent.replace("[STREAM_NAME]", name.replace(" ", "_").toLowerCase());

const docURL = languagesDocURLs[name];
const docURLFastAPI = languagesDocURLs["fastapi"];
</script>

<template>
  <IngestionContent>
    <CopyContent :content="content" />
    <div>
      <div class="font-medium">Check further documentation at:</div>
      <ol class="list-decimal pl-5 mt-1">
        <li class="py-0.5">
          <a
            :href="docURL"
            target="_blank"
            rel="noopener noreferrer"
            class="text-text-link hover:text-text-link-hover underline"
            >Python</a
          >
        </li>
        <li class="py-0.5">
          <a
            :href="docURLFastAPI"
            target="_blank"
            rel="noopener noreferrer"
            class="text-text-link hover:text-text-link-hover underline"
            >FastAPI</a
          >
        </li>
      </ol>
    </div>
  </IngestionContent>
</template>
