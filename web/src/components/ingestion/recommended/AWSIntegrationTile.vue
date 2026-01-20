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
  <q-card
    class="aws-integration-tile"
    flat
    bordered
  >
    <q-card-section class="tw:pb-2">
      <div class="tw:flex tw:items-start tw:justify-between tw:mb-2">
        <div class="tile-name tw:font-semibold tw:text-base">
          {{ integration.displayName }}
        </div>
      </div>
      <div class="tile-description tw:text-sm tw:text-gray-600 tw:mb-3">
        {{ integration.description }}
      </div>
    </q-card-section>

    <q-card-actions class="tw:px-4 tw:pb-4 tw:flex tw:flex-row tw:gap-2">
      <!-- Show "Add Source" for active integrations, "Documentation" for others -->
      <q-btn
        color="primary"
        :label="integration.cloudFormationTemplate ? 'Add Source' : 'Documentation'"
        @click="integration.cloudFormationTemplate ? handleAddSource() : handleDocumentation()"
        unelevated
        class="tw:flex-1"
        :data-test="`aws-${integration.id}-add-source-btn`"
      />
      <q-btn
        outline
        color="primary"
        icon="dashboard"
        label="Dashboard"
        @click="handleDashboard"
        :disable="!integration.hasDashboard"
        class="tw:flex-1"
        :data-test="`aws-${integration.id}-dashboard-btn`"
      />
    </q-card-actions>
  </q-card>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { useRouter } from "vue-router";
import type { AWSIntegration } from "@/utils/awsIntegrations";
import { generateCloudFormationURL, generateDashboardURL } from "@/utils/awsIntegrations";
import { getEndPoint, getIngestionURL } from "@/utils/zincutils";
import segment from "@/services/segment_analytics";

export default defineComponent({
  name: "AWSIntegrationTile",
  props: {
    integration: {
      type: Object as PropType<AWSIntegration>,
      required: true,
    },
  },
  setup(props) {
    const store = useStore();
    const q = useQuasar();
    const router = useRouter();

    // Get endpoint information during setup (not inside click handler)
    let endpoint: any = null;
    try {
      const ingestionURL = getIngestionURL();
      endpoint = getEndPoint(ingestionURL);
    } catch (e) {
      console.error("Error getting endpoint during setup:", e);
    }

    const handleAddSource = () => {
      try {
        // Validate endpoint
        if (!endpoint?.url) {
          console.error("Invalid endpoint:", endpoint);
          q.notify({
            type: "negative",
            message: "Invalid ingestion endpoint. Please check configuration.",
            timeout: 3000,
          });
          return;
        }

        // Get organization details
        const organizationId = store.state?.selectedOrganization?.identifier;
        const email = store.state?.userInfo?.email;
        const passcode = store.state?.organizationData?.organizationPasscode;

        // Validate required data
        if (!organizationId || !email || !passcode) {
          console.error("Missing required data:", { organizationId, email, hasPasscode: !!passcode });
          q.notify({
            type: "negative",
            message: "Missing organization credentials. Please refresh the page.",
            timeout: 3000,
          });
          return;
        }

        // Generate base64 encoded access key
        const accessKey = btoa(`${email}:${passcode}`);

        // Generate CloudFormation URL
        const cloudFormationURL = generateCloudFormationURL(
          props.integration,
          organizationId,
          `${endpoint.url}/aws/${organizationId}/default/_kinesis_firehose`,
          accessKey
        );

        if (!cloudFormationURL) {
          q.notify({
            type: "warning",
            message: "CloudFormation template not available yet",
            timeout: 3000,
          });
          return;
        }

        // Open AWS Console in new tab
        window.open(cloudFormationURL, '_blank', 'noopener,noreferrer');

        // Track analytics
        segment.track("AWS Integration Started", {
          service: props.integration.name,
          category: props.integration.category,
          integration_id: props.integration.id,
        });

        q.notify({
          type: "info",
          message: `Opening AWS Console to set up ${props.integration.displayName}`,
          timeout: 3000,
        });
      } catch (error) {
        console.error("Error generating CloudFormation URL:", error);
        q.notify({
          type: "negative",
          message: `Error opening AWS Console: ${error instanceof Error ? error.message : 'Unknown error'}`,
          timeout: 5000,
        });
      }
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
        const dashboardURL = generateDashboardURL(
          props.integration,
          organizationId,
          baseURL
        );

        // Track analytics
        segment.track("AWS Dashboard Opened", {
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
      segment.track("AWS Documentation Opened", {
        service: props.integration.name,
        integration_id: props.integration.id,
        documentation_url: props.integration.documentationUrl,
      });

      // Open documentation in new tab
      window.open(props.integration.documentationUrl, '_blank', 'noopener,noreferrer');
    };

    return {
      handleAddSource,
      handleDashboard,
      handleDocumentation,
    };
  },
});
</script>

<style scoped lang="scss">
.aws-integration-tile {
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

  .info-btn {
    opacity: 0.7;
    transition: opacity 0.2s ease;

    &:hover {
      opacity: 1;
    }
  }
}
</style>
