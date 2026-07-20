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
  Windows host agent setup page. Content lives in setupCard/content/windows.ts
  and renders through the shared DataSourceSetupCard.

  Also mounted inside AWSIntegrationTile's EC2 dialog (see awsIntegrations.ts
  componentOptions), so it must stay self-contained.
-->
<template>
  <DataSourceSetupCard slug="windows" />
</template>

<script setup lang="ts">
import DataSourceSetupCard from "@/components/ingestion/setupCard/DataSourceSetupCard.vue";

defineProps<{
  currOrgIdentifier?: string;
  currUserEmail?: string;
}>();
</script>
