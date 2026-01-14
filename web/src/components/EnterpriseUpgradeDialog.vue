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
    <q-card class="enterprise-dialog-v3" style="min-width: 850px; max-width: 950px">
      <div class="dialog-split-layout">
        <!-- Left Panel - Hero Section -->
        <div class="hero-panel">
          <q-btn
            icon="close"
            flat
            round
            dense
            v-close-popup
            class="close-btn"
            color="white"
          />

          <div class="hero-content">
            <div class="hero-icon">
              <q-icon name="workspace_premium" size="48px" />
            </div>

            <h2 class="hero-title">Enterprise Features</h2>
            <h3 class="hero-subtitle">100% Free</h3>

            <div class="hero-offer">
              <div class="offer-badge">
                <q-icon name="bolt" size="20px" class="q-mr-xs" />
                <span>Up to 200GB/day</span>
              </div>
              <p class="offer-text">
                Get all enterprise features completely free when you self-host OpenObserve
              </p>
            </div>

            <div class="hero-actions">
              <q-btn
                unelevated
                label="Download Now"
                @click="openDownloadPage"
                icon-right="download"
                no-caps
                size="lg"
                class="download-btn"
              />
              <q-btn
                flat
                label="Learn More"
                @click="openDocsLink"
                no-caps
                class="learn-more-btn"
                color="white"
              />
            </div>
          </div>
        </div>

        <!-- Right Panel - Features List -->
        <div class="features-panel">
          <div class="features-header">
            <h4>What's Included</h4>
            <p>8 powerful enterprise features</p>
          </div>

          <div class="features-list">
            <div
              v-for="feature in enterpriseFeatures"
              :key="feature.name"
              class="feature-list-item"
            >
              <div class="feature-icon-badge">
                <q-icon :name="feature.icon" size="18px" />
              </div>
              <div class="feature-content">
                <div class="feature-name">{{ feature.name }}</div>
                <div class="feature-desc">{{ feature.note }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
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
.enterprise-dialog-v3 {
  overflow: hidden;
}

.dialog-split-layout {
  display: flex;
  min-height: 600px;
}

// Left Panel - Hero Section
.hero-panel {
  flex: 0 0 45%;
  background: linear-gradient(135deg, var(--q-primary) 0%, color-mix(in srgb, var(--q-primary) 85%, black 15%) 100%);
  padding: 40px;
  display: flex;
  flex-direction: column;
  position: relative;
  color: white;

  .close-btn {
    position: absolute;
    top: 16px;
    right: 16px;
    z-index: 10;
  }

  .hero-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    max-width: 400px;
  }

  .hero-icon {
    width: 80px;
    height: 80px;
    background: rgba(255, 255, 255, 0.15);
    border-radius: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 24px;
    backdrop-filter: blur(10px);

    .q-icon {
      color: white;
    }
  }

  .hero-title {
    font-size: 32px;
    font-weight: 700;
    margin: 0 0 8px 0;
    line-height: 1.2;
  }

  .hero-subtitle {
    font-size: 48px;
    font-weight: 800;
    margin: 0 0 32px 0;
    line-height: 1;
    background: linear-gradient(90deg, #ffffff 0%, rgba(255, 255, 255, 0.8) 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .hero-offer {
    margin-bottom: 32px;

    .offer-badge {
      display: inline-flex;
      align-items: center;
      background: rgba(255, 255, 255, 0.2);
      padding: 8px 16px;
      border-radius: 20px;
      font-weight: 600;
      margin-bottom: 16px;
      backdrop-filter: blur(10px);

      .q-icon {
        color: #ffd700;
      }
    }

    .offer-text {
      margin: 0;
      font-size: 14px;
      line-height: 1.6;
      opacity: 0.95;
    }
  }

  .hero-actions {
    display: flex;
    flex-direction: column;
    gap: 12px;

    .download-btn {
      background: white !important;
      color: var(--q-primary) !important;
      font-weight: 700;
      padding: 14px 36px;
      font-size: 16px;
      border-radius: 8px !important;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      letter-spacing: 0.3px;

      &:hover {
        transform: translateY(-3px) scale(1.02);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
      }

      &:active {
        transform: translateY(-1px) scale(0.98);
      }
    }

    .learn-more-btn {
      font-weight: 600;
      padding: 10px 24px;
      font-size: 15px;
      border-radius: 8px !important;
      border: 2px solid rgba(255, 255, 255, 0.3);
      transition: all 0.3s ease;
      letter-spacing: 0.2px;
      background: transparent;

      &:hover {
        background: rgba(255, 255, 255, 0.15);
        border-color: rgba(255, 255, 255, 0.5);
        transform: translateX(4px);
      }

      &:active {
        transform: scale(0.96);
      }
    }
  }
}

// Right Panel - Features List
.features-panel {
  flex: 1;
  padding: 40px;
  background: white;
  overflow-y: auto;

  .features-header {
    margin-bottom: 24px;

    h4 {
      font-size: 20px;
      font-weight: 700;
      margin: 0 0 4px 0;
      color: rgba(0, 0, 0, 0.87);
    }

    p {
      margin: 0;
      font-size: 13px;
      color: rgba(0, 0, 0, 0.5);
    }
  }

  .features-list {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .feature-list-item {
    display: flex;
    gap: 12px;
    padding: 12px;
    border-radius: 8px;
    transition: all 0.2s ease;

    &:hover {
      background: rgba(0, 0, 0, 0.03);
    }

    .feature-icon-badge {
      flex-shrink: 0;
      width: 36px;
      height: 36px;
      border-radius: 8px;
      background: rgba(var(--q-primary-rgb), 0.1);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--q-primary);
    }

    .feature-content {
      flex: 1;
      min-width: 0;
    }

    .feature-name {
      font-size: 14px;
      font-weight: 600;
      color: rgba(0, 0, 0, 0.87);
      margin-bottom: 2px;
      line-height: 1.3;
    }

    .feature-desc {
      font-size: 12px;
      color: rgba(0, 0, 0, 0.55);
      line-height: 1.4;
    }
  }
}

// Dark mode
body.body--dark {
  .features-panel {
    background: #1e1e1e;

    .features-header {
      h4 {
        color: rgba(255, 255, 255, 0.95);
      }

      p {
        color: rgba(255, 255, 255, 0.5);
      }
    }

    .feature-list-item {
      &:hover {
        background: rgba(255, 255, 255, 0.05);
      }

      .feature-icon-badge {
        background: rgba(var(--q-primary-rgb), 0.15);
      }

      .feature-name {
        color: rgba(255, 255, 255, 0.95);
      }

      .feature-desc {
        color: rgba(255, 255, 255, 0.55);
      }
    }
  }
}

@media (max-width: 900px) {
  .dialog-split-layout {
    flex-direction: column;
  }

  .hero-panel {
    flex: 0 0 auto;
    min-height: 400px;
  }
}
</style>
