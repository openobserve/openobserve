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
      <!-- Close Button -->
      <q-btn
        icon="close"
        flat
        round
        dense
        v-close-popup
        class="close-btn-top-right"
      />

      <div class="dialog-split-layout">
        <!-- Left Panel - Hero Section -->
        <div class="hero-panel">

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
            <div v-if="false" class="header-icon-wrapper">
              <q-icon name="stars" size="24px" class="header-icon" />
            </div>
            <h4>Unlock All Enterprise Features</h4>
            <p class="header-subtitle">Everything you need for production-ready observability</p>
          </div>

          <div class="features-list">
            <div
              v-for="feature in enterpriseFeatures"
              :key="feature.name"
              class="feature-list-item"
            >
              <div class="feature-icon-badge">
                <q-icon :name="feature.icon" size="15px" />
              </div>
              <div class="feature-content">
                <div class="feature-name">
                  {{ feature.name }}
                  <span v-if="feature.requiresHA" class="ha-badge">HA</span>
                </div>
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

    // Enterprise features list - all 21 features
    const enterpriseFeatures = [
      {
        name: "Single Sign On",
        note: "Seamless authentication with SSO providers",
        icon: "key",
        requiresHA: true,
      },
      {
        name: "Role Based Access Control",
        note: "Granular permissions and user management",
        icon: "admin_panel_settings",
        requiresHA: true,
      },
      {
        name: "Federated Search / Supercluster",
        note: "Distribute queries across multiple clusters",
        icon: "hub",
        requiresHA: true,
      },
      {
        name: "Query Management",
        note: "Advanced query monitoring and optimization",
        icon: "insights",
        requiresHA: false,
      },
      {
        name: "Workload Management",
        note: "Priority-based resource allocation and QoS",
        icon: "speed",
        requiresHA: false,
      },
      {
        name: "Audit Trail",
        note: "Complete activity logging for compliance",
        icon: "fact_check",
        requiresHA: false,
      },
      {
        name: "Action Scripts",
        note: "Automate responses to events and alerts",
        icon: "code",
        requiresHA: true,
      },
      {
        name: "Sensitive Data Redaction",
        note: "Protect PII and sensitive information",
        icon: "shield",
        requiresHA: false,
      },
      {
        name: "Pipeline Remote Destinations",
        note: "Send data to remote destinations",
        icon: "alt_route",
        requiresHA: false,
      },
      {
        name: "Query Optimizer / Aggregation Cache",
        note: "TopK aggregation and query optimization",
        icon: "memory",
        requiresHA: false,
      },
      {
        name: "Incident Management",
        note: "Track and manage incidents efficiently",
        icon: "emergency",
        requiresHA: true,
      },
      {
        name: "SRE Agent",
        note: "Automated SRE operations and insights",
        icon: "smart_toy",
        requiresHA: true,
      },
      {
        name: "AI Assistant",
        note: "Intelligent query and analysis assistance",
        icon: "psychology",
        requiresHA: true,
      },
      {
        name: "Anomaly Detection",
        note: "Automatically detect anomalies in data",
        icon: "query_stats",
        requiresHA: false,
      },
      {
        name: "Metrics Auto Downsampling",
        note: "Automatic metrics aggregation over time",
        icon: "compress",
        requiresHA: false,
      },
      {
        name: "Log Patterns",
        note: "Discover patterns in log data",
        icon: "pattern",
        requiresHA: false,
      },
      {
        name: "MCP Server",
        note: "Model Context Protocol server integration",
        icon: "dns",
        requiresHA: true,
      },
      {
        name: "Rate Limiting",
        note: "Control query and ingestion rates",
        icon: "speed",
        requiresHA: false,
      },
      {
        name: "Broadcast Join",
        note: "Optimized distributed join operations",
        icon: "join",
        requiresHA: true,
      },
      {
        name: "Logs, Metrics & Traces Correlation",
        note: "Automated detection and correlation",
        icon: "auto_graph",
        requiresHA: false,
      },
      {
        name: "Service Maps",
        note: "Visualize service dependencies",
        icon: "account_tree",
        requiresHA: false,
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
  position: relative;
}

.close-btn-top-right {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 100;
  color: rgba(0, 0, 0, 0.6);

  &:hover {
    color: rgba(0, 0, 0, 0.87);
  }
}

.dialog-split-layout {
  display: flex;
  height: 600px;
  max-height: 80vh;
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
  overflow: hidden;

  .hero-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: flex-start;
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
  background: white;
  display: flex;
  flex-direction: column;
  overflow: hidden;

  .features-header {
    padding: 32px 32px 24px 32px;
    background: white;
    position: sticky;
    top: 0;
    z-index: 10;
    border-bottom: 1px solid rgba(0, 0, 0, 0.08);
    text-align: center;

    .header-icon-wrapper {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 48px;
      height: 48px;
      background: linear-gradient(135deg, var(--q-primary), color-mix(in srgb, var(--q-primary) 85%, purple 15%));
      border-radius: 12px;
      margin-bottom: 16px;

      .header-icon {
        color: white;
      }
    }

    h4 {
      font-size: 22px;
      font-weight: 800;
      margin: 0 0 8px 0;
      color: rgba(0, 0, 0, 0.9);
      letter-spacing: -0.3px;
    }

    .header-subtitle {
      font-size: 14px;
      color: rgba(0, 0, 0, 0.6);
      margin: 0;
      font-weight: 500;
    }
  }

  .features-list {
    flex: 1;
    overflow-y: auto;
    padding: 18px 32px 30px 32px;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .feature-list-item {
    display: flex;
    gap: 10px;
    padding: 6px 10px;
    border-radius: 6px;
    transition: all 0.2s ease;

    &:hover {
      background: rgba(0, 0, 0, 0.03);
    }

    .feature-icon-badge {
      flex-shrink: 0;
      width: 28px;
      height: 28px;
      border-radius: 6px;
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
      font-size: 13px;
      font-weight: 600;
      color: rgba(0, 0, 0, 0.87);
      margin-bottom: 2px;
      line-height: 1.3;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .ha-badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 6px;
      background: rgba(var(--q-primary-rgb), 0.15);
      color: var(--q-primary);
      border-radius: 4px;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.5px;
      line-height: 1;
    }

    .feature-desc {
      font-size: 11px;
      color: rgba(0, 0, 0, 0.55);
      line-height: 1.3;
    }
  }
}

// Dark mode
body.body--dark {
  .close-btn-top-right {
    color: rgba(255, 255, 255, 0.7);

    &:hover {
      color: rgba(255, 255, 255, 0.95);
    }
  }

  .features-panel {
    background: #1e1e1e;

    .features-header {
      background: #1e1e1e;
      border-bottom-color: rgba(255, 255, 255, 0.1);

      h4 {
        color: rgba(255, 255, 255, 0.95);
      }

      .header-subtitle {
        color: rgba(255, 255, 255, 0.6);
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

      .ha-badge {
        background: rgba(var(--q-primary-rgb), 0.2);
        color: var(--q-primary);
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
