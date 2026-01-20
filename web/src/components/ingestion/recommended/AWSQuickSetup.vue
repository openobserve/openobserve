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
  <div class="aws-quick-setup">
    <div class="setup-card">
      <div class="tw:pb-4">
        <div class="tw:flex tw:items-start tw:gap-4">
          <div class="tw:flex-shrink-0">
            <q-icon name="rocket_launch" size="2.5rem" color="primary" />
          </div>
          <div class="tw:flex-1">
            <h5 class="tw:text-lg tw:font-bold tw:m-0 tw:mb-2 title">
              Complete AWS Integration
            </h5>
            <p class="tw:text-sm tw:m-0 tw:mb-4 description">
              Deploy all AWS services in one click. This CloudFormation stack sets up comprehensive monitoring across your entire AWS infrastructure.
            </p>

            <q-banner v-if="comingSoonNotice" class="tw:mb-4 notice-banner" rounded dense>
              <template v-slot:avatar>
                <q-icon name="info" color="info" size="sm" />
              </template>
              <span class="tw:text-xs">
                Currently includes CloudTrail, WAF, and ALB. Additional services will be added soon.
              </span>
            </q-banner>

            <div class="tw:flex tw:gap-2 tw:mt-4">
              <q-btn
                color="primary"
                unelevated
                @click="handleDeployStack"
                data-test="aws-quick-setup-deploy-btn"
              >
                <q-icon name="cloud_upload" left size="sm" />
                Deploy Complete Stack
              </q-btn>
              <q-btn
                flat
                color="primary"
                @click="showDetails = !showDetails"
                data-test="aws-quick-setup-details-btn"
              >
                <q-icon :name="showDetails ? 'expand_less' : 'expand_more'" left size="sm" />
                {{ showDetails ? 'Hide' : 'View' }} Details
              </q-btn>
            </div>
          </div>
        </div>
      </div>

      <q-slide-transition>
        <div v-show="showDetails">
          <q-separator />
          <q-card-section class="tw:pt-4">
            <div class="tw:text-sm details-section">
              <h6 class="tw:text-base tw:font-semibold tw:m-0 tw:mb-3 details-title">What You'll Get</h6>

              <div class="tw:mb-4">
                <div class="tw:space-y-1">
                  <div class="tw:flex tw:items-start tw:gap-2">
                    <q-icon name="dashboard" size="xs" class="tw:mt-0.5" />
                    <span class="tw:text-sm benefit-text">Pre-built dashboards for all services</span>
                  </div>
                  <div class="tw:flex tw:items-start tw:gap-2">
                    <q-icon name="security" size="xs" class="tw:mt-0.5" />
                    <span class="tw:text-sm benefit-text">Security monitoring (CloudTrail, WAF)</span>
                  </div>
                  <div class="tw:flex tw:items-start tw:gap-2">
                    <q-icon name="speed" size="xs" class="tw:mt-0.5" />
                    <span class="tw:text-sm benefit-text">Performance insights (ALB, CloudWatch)</span>
                  </div>
                  <div class="tw:flex tw:items-start tw:gap-2">
                    <q-icon name="network_check" size="xs" class="tw:mt-0.5" />
                    <span class="tw:text-sm benefit-text">Network analysis (VPC Flow Logs)</span>
                  </div>
                </div>
              </div>

              <h6 class="tw:text-base tw:font-semibold tw:m-0 tw:mb-3 details-title">Deployment Details</h6>

              <div class="tw:mb-3">
                <div class="tw:font-semibold tw:mb-1 detail-label">Estimated Setup Time:</div>
                <div class="detail-value">5-10 minutes for stack creation</div>
              </div>

              <div class="tw:mb-3">
                <div class="tw:font-semibold tw:mb-1 detail-label">AWS Permissions Required:</div>
                <div class="detail-value">CloudFormation, IAM, Kinesis Firehose, S3</div>
              </div>

              <div class="tw:mb-3">
                <div class="tw:font-semibold tw:mb-1 detail-label">What Gets Created:</div>
                <ul class="tw:list-disc tw:ml-5 tw:space-y-1 detail-value">
                  <li>Kinesis Firehose delivery streams for each service</li>
                  <li>IAM roles with appropriate permissions</li>
                  <li>S3 bucket for backup (optional)</li>
                  <li>CloudWatch log subscriptions</li>
                </ul>
              </div>

              <div>
                <div class="tw:font-semibold tw:mb-1 detail-label">Cost Considerations:</div>
                <div class="detail-value">
                  Charges apply for Kinesis Firehose data transfer, CloudWatch Logs ingestion, and OpenObserve storage.
                  Refer to AWS and OpenObserve pricing for details.
                </div>
              </div>
            </div>
          </q-card-section>
        </div>
      </q-slide-transition>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { getEndPoint, getIngestionURL } from "@/utils/zincutils";
import { generateCloudFormationURL } from "@/utils/awsIntegrations";
import segment from "@/services/segment_analytics";

export default defineComponent({
  name: "AWSQuickSetup",
  setup() {
    const store = useStore();
    const q = useQuasar();
    const showDetails = ref(false);
    const comingSoonNotice = ref(true);

    // Get endpoint information during setup
    let endpoint: any = null;
    try {
      const ingestionURL = getIngestionURL();
      endpoint = getEndPoint(ingestionURL);
    } catch (e) {
      console.error("Error getting endpoint during setup:", e);
    }

    const includedServices = [
      { name: "CloudTrail", category: "Security" },
      { name: "WAF", category: "Security" },
      { name: "Application Load Balancer", category: "Networking" },
      { name: "VPC Flow Logs", category: "Networking" },
      { name: "CloudWatch Logs", category: "Logs" },
      { name: "CloudWatch Metrics", category: "Metrics" },
      { name: "Lambda", category: "Compute" },
      { name: "API Gateway", category: "API" },
      { name: "RDS", category: "Database" },
      { name: "DynamoDB", category: "Database" },
      { name: "S3 Access Logs", category: "Storage" },
      { name: "CloudFront", category: "CDN" },
    ];

    const handleDeployStack = () => {
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

        // Create a unified integration object
        const unifiedIntegration = {
          id: 'aws-complete',
          name: 'AWS-Complete',
          displayName: 'AWS Complete Integration',
          cloudFormationTemplate: 'https://openobserve-datasources-bucket.s3.us-east-2.amazonaws.com/datasource/cloud/aws/aws_complete.yaml',
          comingSoon: false,
        };

        // Generate CloudFormation URL
        const cloudFormationURL = generateCloudFormationURL(
          unifiedIntegration as any,
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
        segment.track("AWS Complete Integration Started", {
          integration_type: "complete",
          services_count: includedServices.length,
        });

        q.notify({
          type: "info",
          message: "Opening AWS Console to deploy complete integration stack",
          timeout: 3000,
        });
      } catch (error) {
        console.error("Error deploying stack:", error);
        q.notify({
          type: "negative",
          message: `Error opening AWS Console: ${error instanceof Error ? error.message : 'Unknown error'}`,
          timeout: 5000,
        });
      }
    };

    return {
      showDetails,
      comingSoonNotice,
      includedServices,
      handleDeployStack,
    };
  },
});
</script>

<style scoped lang="scss">
.aws-quick-setup {
  .setup-card {
    max-width: 900px;
    margin: 0 auto;
  }

  .body--light & {
    .title {
      color: #1a1a1a;
    }

    .description,
    .service-name,
    .benefit-text,
    .detail-value {
      color: #666;
    }

    .service-category {
      color: #999;
    }

    .section-header,
    .detail-label,
    .details-title {
      color: #333;
    }

    .notice-banner {
      background-color: #e3f2fd;
    }
  }

  .body--dark & {
    .title {
      color: #e0e0e0;
    }

    .description,
    .service-name,
    .benefit-text,
    .detail-value {
      color: #b0b0b0;
    }

    .service-category {
      color: #808080;
    }

    .section-header,
    .detail-label,
    .details-title {
      color: #d0d0d0;
    }

    .notice-banner {
      background-color: rgba(33, 150, 243, 0.1);
    }
  }
}
</style>
