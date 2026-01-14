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
  <q-dialog v-model="showDialog" @hide="onDialogHide">
    <q-card style="min-width: 700px; max-width: 800px">
      <q-card-section class="row items-center q-pb-sm q-pt-md q-px-md">
        <div class="text-h6 text-bold">Upgrade to Enterprise for Free</div>
        <q-space />
        <q-btn icon="close" flat round dense v-close-popup />
      </q-card-section>

      <q-card-section class="q-pt-none q-pb-sm q-px-md">
        <div class="text-subtitle2 text-bold q-mb-xs" style="color: #059669">
          Up to 200GB/day FREE for self-hosted deployments
        </div>
        <div class="text-body2 text-grey-7" style="font-size: 13px">
          Get enterprise features completely free when you self-host OpenObserve
        </div>
      </q-card-section>

      <q-separator />

      <q-card-section class="q-py-sm q-px-md">
        <div class="text-subtitle2 text-bold q-mb-sm">Enterprise Features</div>

        <!-- Feature Grid -->
        <div class="feature-grid">
          <div
            v-for="feature in enterpriseFeatures"
            :key="feature.name"
            class="feature-item"
          >
            <div class="row items-start no-wrap">
              <q-icon
                name="check_circle"
                color="positive"
                size="18px"
                class="q-mr-xs"
                style="margin-top: 1px"
              />
              <div>
                <div class="text-body2 text-bold" style="font-size: 13px; line-height: 1.4">{{ feature.name }}</div>
                <div
                  v-if="feature.note"
                  class="text-caption text-grey-7"
                  style="font-size: 11px; line-height: 1.3"
                >
                  {{ feature.note }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </q-card-section>

      <q-separator />

      <q-card-section class="q-py-sm q-px-md">
        <div class="text-body2 text-grey-7" style="font-size: 12px; line-height: 1.5">
          All OpenObserve open source features are included, plus these
          enterprise-exclusive capabilities for enhanced security, compliance,
          and scalability.
        </div>
      </q-card-section>

      <q-card-actions align="right" class="q-pa-md q-pt-sm">
        <q-btn
          flat
          label="Learn More"\

          @click="openDocsLink"
          class="q-mr-sm o2-secondary-button"
          no-caps
        />
        <q-btn
          unelevated
          label="Download OpenObserve"
          class="o2-primary-button"
          @click="openDownloadPage"
          icon-right="launch"
          no-caps
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";

export default defineComponent({
  name: "EnterpriseUpgradeDialog",
  props: {
    modelValue: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    const showDialog = ref(props.modelValue);

    // Enterprise features list based on the comparison table
    const enterpriseFeatures = [
      {
        name: "Single Sign On (SSO)",
        note: "Requires HA mode",
      },
      {
        name: "Role Based Access Control (RBAC)",
        note: "Requires HA mode",
      },
      {
        name: "Federated Search / Super Cluster",
        note: "Distribute queries across multiple clusters",
      },
      {
        name: "Query Management",
        note: "Advanced query monitoring and optimization",
      },
      {
        name: "Workload Management (QoS)",
        note: "Priority-based resource allocation",
      },
      {
        name: "Audit Trail",
        note: "Complete activity logging for compliance",
      },
      {
        name: "Action Scripts",
        note: "Automate responses to events",
      },
      {
        name: "Sensitive Data Redaction",
        note: "Protect PII and sensitive information",
      },
    ];

    const onDialogHide = () => {
      emit("update:modelValue", false);
    };

    const openDownloadPage = () => {
      window.open("https://openobserve.ai/downloads/", "_blank");
    };

    const openDocsLink = () => {
      window.open("https://openobserve.ai/docs/", "_blank");
    };

    return {
      showDialog,
      enterpriseFeatures,
      onDialogHide,
      openDownloadPage,
      openDocsLink,
    };
  },
  watch: {
    modelValue(newVal) {
      this.showDialog = newVal;
    },
    showDialog(newVal) {
      if (!newVal) {
        this.$emit("update:modelValue", false);
      }
    },
  },
});
</script>

<style scoped lang="scss">
.feature-grid {
  display: grid;
  grid-template-columns: repeat(1, 1fr);
  gap: 10px;
}

.feature-item {
  padding: 4px 0;
}

@media (min-width: 700px) {
  .feature-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
  }
}
</style>
