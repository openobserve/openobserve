<!-- Copyright 2023 OpenObserve Inc.

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
  <div class="q-ma-md">
    <div class="tw:text-[16px]">
      <div class="tw:font-bold">
        Azure Function for sending logs to OpenObserve
      </div>
      <div class="tw:py-2">
        <a
          href="https://github.com/openobserve/azure-function-openobserve"
          class="hover:tw:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          https://github.com/openobserve/azure-function-openobserve
        </a>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
  name: "AzureConfig",
});
</script>
