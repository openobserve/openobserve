<!-- Copyright 2026 OpenObserve Inc. -->
<!-- Placeholder for Security (SIEM) sections not yet built, so the whole IA is
     navigable while the mode is scaffolded. -->
<template>
  <div class="sec-placeholder" :class="{ dark: isDark }">
    <div class="box">
      <q-icon :name="icon" size="34px" class="ico" />
      <h2>{{ title }}</h2>
      <p>{{ blurb }}</p>
      <span class="tag">Security · SIEM — coming soon</span>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed } from "vue";
import { useRoute } from "vue-router";
import { useStore } from "vuex";

const COPY: Record<string, { icon: string; blurb: string }> = {
  securityEvents: { icon: "search", blurb: "Search normalized (OCSF) security events with the same fast engine as Logs, on a security field schema." },
  securityDetections: { icon: "shield", blurb: "Sigma-based and custom SQL detection rules, mapped to MITRE ATT&CK, with backtesting against historical events." },
  securityAlerts: { icon: "notifications_active", blurb: "Findings produced by detections. Triage queue with severity, entity grouping, assignment and status." },
  securityCases: { icon: "folder_shared", blurb: "Investigation workspace aggregating alerts, events, entities, notes and a timeline." },
  securityIntel: { icon: "public", blurb: "IOC management and threat-intel feeds (STIX/TAXII, MISP, OTX) with enrichment on ingest and retro-hunt." },
  securityEntities: { icon: "hub", blurb: "Hosts, users and assets with rolling risk scores, related detections and per-entity timelines." },
  securityMitre: { icon: "grid_view", blurb: "Full ATT&CK coverage matrix: which techniques your enabled detections cover, and where the gaps are." },
  securityCompliance: { icon: "verified_user", blurb: "Prebuilt compliance packs (PCI-DSS, HIPAA, GDPR, NIST, CIS) mapping controls to detections and posture." },
  securitySources: { icon: "cloud_sync", blurb: "Collectors and integrations: agents, syslog, cloud audit, EDR and IdP — onboarding and health." },
  securityContent: { icon: "inventory_2", blurb: "Curated, versioned detection and parser content packs — install and keep them up to date." },
};

export default defineComponent({
  name: "SecurityPlaceholder",
  setup() {
    const route = useRoute();
    const store = useStore();
    const isDark = computed(() => store.state.theme === "dark");
    const title = computed(() => (route.meta?.title as string) || "Security");
    const meta = computed(
      () =>
        COPY[route.name as string] || {
          icon: "security",
          blurb: "This Security section is part of the SIEM design and is being built.",
        },
    );
    return {
      isDark,
      title,
      icon: computed(() => meta.value.icon),
      blurb: computed(() => meta.value.blurb),
    };
  },
});
</script>

<style scoped lang="scss">
.sec-placeholder {
  display: grid;
  place-items: center;
  min-height: 70vh;
  padding: 24px;
  --surface: #fff;
  --border: #e6e8ef;
  --text: #1c2030;
  --text-2: #565d75;
  --accent: #6d5ce0;
  &.dark { --surface: #151a23; --border: #232a37; --text: #e7eaf3; --text-2: #a2aabf; --accent: #8b90e6; }
}
.box {
  text-align: center;
  max-width: 460px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 34px 30px;
  color: var(--text);
}
.ico { color: var(--accent); }
h2 { margin: 12px 0 8px; font-size: 20px; }
p { color: var(--text-2); font-size: 13.5px; line-height: 1.5; margin: 0 0 16px; }
.tag {
  display: inline-block;
  font-size: 11px;
  font-weight: 650;
  color: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 20px;
  padding: 3px 11px;
}
</style>
