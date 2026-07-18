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
  Discoverability pointer for the MCP server. The canonical setup + credentials
  live in IAM (route "mcpServer"); this callout is surfaced from the AI
  Integrations gallery and the Recommended tab so the "connect my AI client"
  audience can find it, then routes them to the one home.
-->
<script setup lang="ts">
// Used as a router-view target in Recommended.vue, which passes unrelated props
// (title / currOrgIdentifier / currUserEmail) — don't let them leak onto the root.
defineOptions({ inheritAttrs: false });
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

const { t } = useI18n();
const store = useStore();
const router = useRouter();

const goToMcp = () => {
  router.push({
    name: "mcpServer",
    query: { org_identifier: store.state.selectedOrganization?.identifier },
  });
};
</script>

<template>
  <div class="p-2" data-test="mcp-cross-link">
    <div
      class="flex flex-col items-start gap-3 rounded-lg border border-border-default bg-surface-panel p-6 max-w-3xl"
    >
      <div class="flex items-center gap-2">
        <OIcon name="mcp" size="md" />
        <h2 class="text-lg font-semibold">
          {{ t("ingestion.mcp.crossLinkTitle") }}
        </h2>
      </div>
      <p class="text-text-secondary text-sm">
        {{ t("ingestion.mcp.crossLinkBody") }}
      </p>
      <OButton
        variant="primary"
        size="sm-action"
        data-test="mcp-cross-link-btn"
        @click="goToMcp"
      >
        {{ t("ingestion.mcp.crossLinkCta") }}
        <OIcon name="arrow-forward" size="sm" />
      </OButton>
    </div>
  </div>
</template>
