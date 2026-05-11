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
  <q-card class="azure-integration-tile" flat bordered>
    <q-card-section class="tw:pb-2">
      <div class="tw:flex tw:items-start tw:justify-between tw:mb-2">
        <div class="tile-name tw:font-semibold tw:text-base">
          {{ integration.displayName }}
        </div>
        <OButton
          v-if="integration.documentationUrl"
          variant="ghost"
          size="icon-circle-sm"
          @click="handleDocumentation()"
          class="docs-btn"
          :data-test="`azure-${integration.id}-docs-btn`"
        >
          <q-icon name="description" />
          <q-tooltip>View Documentation</q-tooltip>
        </OButton>
      </div>
      <div class="tile-description tw:text-sm tw:text-gray-600 tw:mb-3">
        {{ integration.description }}
      </div>
    </q-card-section>

    <q-card-actions class="tw:px-4 tw:pb-4 tw:flex tw:flex-row tw:gap-2">
      <!-- Deploy Button (ARM template) -->
      <OButton
        v-if="integration.armTemplate"
        variant="primary"
        size="sm"
        @click="handleDeploy()"
        class="tw:flex-1"
        :data-test="`azure-${integration.id}-deploy-btn`"
        >Deploy</OButton
      >
      <!-- Documentation Button (shown when no ARM template) -->
      <OButton
        v-else-if="integration.documentationUrl"
        variant="primary"
        size="sm"
        @click="handleDocumentation()"
        class="tw:flex-1"
        :data-test="`azure-${integration.id}-documentation-btn`"
        >Documentation</OButton
      >
      <!-- Docs icon button (shown alongside Deploy when both exist) -->
      <OButton
        v-if="integration.armTemplate && integration.documentationUrl"
        variant="ghost"
        size="icon-circle-sm"
        @click="handleDocumentation()"
        :data-test="`azure-${integration.id}-docs-icon-btn`"
      >
        <q-icon name="description" />
        <q-tooltip>View Documentation</q-tooltip>
      </OButton>
      <!-- Dashboard Button -->
      <OButton
        variant="outline"
        size="sm"
        @click="handleDashboard"
        :disabled="!integration.hasDashboard"
        class="tw:flex-1"
        :data-test="`azure-${integration.id}-dashboard-btn`"
        icon-left="dashboard"
      >
        Dashboard
      </OButton>
    </q-card-actions>
  </q-card>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { useRouter } from "vue-router";
import type { AzureIntegration } from "@/utils/azureIntegrations";
import {
  generateAzureDashboardURL,
  generateARMTemplateURL,
} from "@/utils/azureIntegrations";
import { getEndPoint, getIngestionURL } from "@/utils/zincutils";
import segment from "@/services/segment_analytics";

export default defineComponent({
  name: "AzureIntegrationTile",
  components: { OButton },
  props: {
    integration: {
      type: Object as PropType<AzureIntegration>,
      required: true,
    },
  },
  setup(props) {
    const store = useStore();
    const q = useQuasar();
    const router = useRouter();

    let endpoint: any = null;
    try {
      endpoint = getEndPoint(getIngestionURL());
    } catch (e) {
      console.error("Error getting endpoint:", e);
    }

    const handleDeploy = () => {
      if (!props.integration.armTemplate) return;

      if (!endpoint?.url) {
        q.notify({
          type: "negative",
          message: "Invalid ingestion endpoint. Please check configuration.",
          timeout: 3000,
        });
        return;
      }

      const organizationId = store.state?.selectedOrganization?.identifier;
      const email = store.state?.userInfo?.email;
      const passcode = store.state?.organizationData?.organizationPasscode;

      if (!organizationId || !email || !passcode) {
        q.notify({
          type: "negative",
          message: "Missing organization credentials. Please refresh the page.",
          timeout: 3000,
        });
        return;
      }

      const accessKey = btoa(`${email}:${passcode}`);
      const endpointUrl = `${endpoint.url}/azure/${organizationId}/default/_event_hub`;

      const url = generateARMTemplateURL(
        props.integration,
        endpointUrl,
        accessKey,
      );

      window.open(url, "_blank", "noopener,noreferrer");

      segment.track("Azure ARM Template Deploy Started", {
        service: props.integration.name,
        integration_id: props.integration.id,
      });

      q.notify({
        type: "info",
        message: `Opening Azure portal to deploy ${props.integration.displayName}`,
        timeout: 3000,
      });
    };

    const handleDashboard = () => {
      if (!props.integration.hasDashboard) {
        return;
      }

      try {
        const organizationId = store.state.selectedOrganization.identifier;

        // Get the base URL from current location
        const baseURL = `${window.location.protocol}//${window.location.host}`;

        // Generate dashboard URL
        const dashboardURL = generateAzureDashboardURL(
          props.integration,
          organizationId,
          baseURL,
        );

        // Track analytics
        segment.track("Azure Dashboard Opened", {
          service: props.integration.name,
          integration_id: props.integration.id,
        });

        // Navigate to dashboard
        router.push(`/dashboards?org_identifier=${organizationId}`);
      } catch (error) {
        console.error("Error navigating to dashboard:", error);
        q.notify({
          type: "negative",
          message: "Error opening dashboard. Please try again.",
          timeout: 3000,
        });
      }
    };

    const handleDocumentation = () => {
      if (!props.integration.documentationUrl) {
        return;
      }

      // Track analytics
      segment.track("Azure Documentation Opened", {
        service: props.integration.name,
        integration_id: props.integration.id,
        documentation_url: props.integration.documentationUrl,
      });

      // Open documentation in new tab
      window.open(
        props.integration.documentationUrl,
        "_blank",
        "noopener,noreferrer",
      );
    };

    return {
      handleDeploy,
      handleDashboard,
      handleDocumentation,
    };
  },
});
</script>

<style scoped lang="scss">
.azure-integration-tile {
  height: 100%;
  display: flex;
  flex-direction: column;
  transition: all 0.2s ease;
  border-radius: 8px;

  &:hover {
    transform: translateY(-2px);
  }

  .body--light & {
    &:hover {
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .tile-name {
      color: #1a1a1a;
    }

    .tile-description {
      color: #666;
    }
  }

  .body--dark & {
    &:hover {
      box-shadow: 0 4px 12px rgba(255, 255, 255, 0.1);
    }

    .tile-name {
      color: #e0e0e0;
    }

    .tile-description {
      color: #b0b0b0;
    }
  }

  .tile-name {
    line-height: 1.4;
  }

  .tile-description {
    line-height: 1.5;
    min-height: 3em;
  }

  .q-card__section,
  .q-card__actions {
    flex-grow: 0;
  }

  .q-card__actions {
    margin-top: auto;
  }

  .docs-btn {
    opacity: 0.7;
    transition: opacity 0.2s ease;

    &:hover {
      opacity: 1;
    }
  }
}
</style>
