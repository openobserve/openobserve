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

<!--
  LogsErrorState — thin wrapper around the shared QueryErrorState component,
  scoped to the logs search page context.

  Passes through all props and events. The "configure-resource" event is
  handled here to build the correct stream-settings route; all other actions
  bubble up to Index.vue.
-->
<template>
  <QueryErrorState
    :error-code="errorCode"
    :error-msg="errorMsg"
    :error-detail="errorDetail"
    :ai-enabled="aiEnabled"
    :resource-name="streamName"
    size="hero"
    illustration="broken-panel"
    @ask-ai="emit('ask-ai')"
    @fix-query="emit('fix-query')"
    @configure-resource="emit('configure-stream')"
    @widen-range="emit('widen-range')"
  />
</template>

<script setup lang="ts">
import QueryErrorState from "@/components/common/QueryErrorState.vue";

defineProps<{
  errorCode: number;
  errorMsg: string;
  errorDetail?: string;
  aiEnabled: boolean;
  streamName?: string;
}>();

const emit = defineEmits<{
  "ask-ai": [];
  "fix-query": [];
  "configure-stream": [];
  "widen-range": [];
}>();
</script>
