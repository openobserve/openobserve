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
    <q-card class="enterprise-dialog" style="min-width: 750px; max-width: 900px">
      <!-- Header -->
      <q-card-section class="dialog-header q-pa-lg">
        <div class="row items-center">
          <div class="col">
            <div class="text-h5 text-bold q-mb-xs">Upgrade to Enterprise for Free</div>
            <div class="text-subtitle2 text-grey-8">
              <q-icon name="workspace_premium" size="18px" class="q-mr-xs" style="vertical-align: middle" />
              Up to 200GB/day FREE for self-hosted deployments
            </div>
          </div>
          <q-btn icon="close" flat round dense v-close-popup />
        </div>
      </q-card-section>

      <!-- Feature Cards Grid -->
      <q-card-section class="q-pa-lg q-pt-md">
        <div class="feature-cards-grid">
          <div
            v-for="feature in enterpriseFeatures"
            :key="feature.name"
            class="feature-card"
          >
            <div class="feature-card-icon">
              <q-icon :name="feature.icon" size="24px" />
            </div>
            <div class="feature-card-content">
              <div class="feature-card-title">{{ feature.name }}</div>
              <div class="feature-card-description">{{ feature.note }}</div>
            </div>
          </div>
        </div>
      </q-card-section>

      <!-- Footer -->
      <q-card-section class="dialog-footer q-pa-lg q-pt-none">
        <div class="text-center q-mb-md">
          <div class="text-body2 text-grey-7">
            All OpenObserve open source features included, plus enterprise capabilities
          </div>
        </div>
        <div class="row justify-center q-gutter-sm">
          <q-btn
            label="Learn More"
            class="o2-secondary-button"
            @click="openDocsLink"
            no-caps
          />
          <q-btn
            unelevated
            label="Download OpenObserve"
            @click="openDownloadPage"
            icon-right="launch"
            no-caps
            class="o2-primary-button"
          />
        </div>
      </q-card-section>
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
        name: "Single Sign On",
        note: "Seamless authentication with SSO providers (requires HA mode)",
        icon: "key",
      },
      {
        name: "Role Based Access Control",
        note: "Granular permissions and user management (requires HA mode)",
        icon: "admin_panel_settings",
      },
      {
        name: "Federated Search",
        note: "Distribute queries across multiple clusters",
        icon: "hub",
      },
      {
        name: "Query Management",
        note: "Advanced query monitoring and optimization",
        icon: "insights",
      },
      {
        name: "Workload Management",
        note: "Priority-based resource allocation and QoS",
        icon: "speed",
      },
      {
        name: "Audit Trail",
        note: "Complete activity logging for compliance",
        icon: "fact_check",
      },
      {
        name: "Action Scripts",
        note: "Automate responses to events and alerts",
        icon: "code",
      },
      {
        name: "Data Redaction",
        note: "Protect PII and sensitive information",
        icon: "shield",
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
.enterprise-dialog {
  .dialog-header {
    background: linear-gradient(135deg, rgba(var(--q-primary-rgb), 0.05) 0%, rgba(var(--q-primary-rgb), 0.02) 100%);
    border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  }
}

.feature-cards-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

.feature-card {
  background: rgba(0, 0, 0, 0.02);
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
  padding: 16px;
  display: flex;
  gap: 12px;
  transition: all 0.2s ease;
  cursor: default;

  &:hover {
    background: rgba(0, 0, 0, 0.03);
    border-color: rgba(var(--q-primary-rgb), 0.2);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  }

  .feature-card-icon {
    flex-shrink: 0;
    width: 40px;
    height: 40px;
    border-radius: 8px;
    background: rgba(var(--q-primary-rgb), 0.1);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--q-primary);
  }

  .feature-card-content {
    flex: 1;
    min-width: 0;
  }

  .feature-card-title {
    font-size: 14px;
    font-weight: 600;
    color: rgba(0, 0, 0, 0.87);
    margin-bottom: 4px;
    line-height: 1.3;
  }

  .feature-card-description {
    font-size: 12px;
    color: rgba(0, 0, 0, 0.6);
    line-height: 1.4;
  }
}

// Dark mode
body.body--dark {
  .enterprise-dialog {
    .dialog-header {
      background: linear-gradient(135deg, rgba(var(--q-primary-rgb), 0.08) 0%, rgba(var(--q-primary-rgb), 0.03) 100%);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }
  }

  .feature-card {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.1);

    &:hover {
      background: rgba(255, 255, 255, 0.05);
      border-color: rgba(var(--q-primary-rgb), 0.3);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    }

    .feature-card-icon {
      background: rgba(var(--q-primary-rgb), 0.15);
    }

    .feature-card-title {
      color: rgba(255, 255, 255, 0.95);
    }

    .feature-card-description {
      color: rgba(255, 255, 255, 0.6);
    }
  }
}

@media (max-width: 800px) {
  .feature-cards-grid {
    grid-template-columns: repeat(1, 1fr);
  }
}
</style>
