// Copyright 2026 OpenObserve Inc.

import type { NavItem } from "@/lib/core/Navbar/ONavbar.types";
import type { TranslateFn } from "@/types/i18n";

/** The fixed Security rail; every icon must exist in the OIcon registry (OIcon.icons.ts). */
export const securityNavLinks = (t: TranslateFn): NavItem[] => [
  {
    title: t("siem.nav.overview"),
    icon: "bar-chart",
    link: "/security/overview",
    name: "securityOverview",
  },
  {
    title: t("siem.nav.events"),
    icon: "manage-search",
    link: "/security/events",
    name: "securityEvents",
  },
  {
    title: t("siem.nav.detections"),
    icon: "shield-alert-outline",
    link: "/security/detections",
    name: "securityDetections",
  },
  {
    title: t("siem.nav.alerts"),
    icon: "notifications-active",
    link: "/security/alerts",
    name: "securityAlerts",
  },
  {
    title: t("siem.nav.cases"),
    icon: "folder-open",
    link: "/security/cases",
    name: "securityCases",
  },
  {
    title: t("siem.nav.entities"),
    icon: "person-pin-circle",
    link: "/security/entities",
    name: "securityEntities",
  },
  {
    title: t("siem.nav.intel"),
    icon: "brain-circuit",
    link: "/security/intel",
    name: "securityIntel",
  },
  { title: t("siem.nav.ueba"), icon: "group-work", link: "/security/ueba", name: "securityUEBA" },
  {
    title: t("siem.nav.mitre"),
    icon: "compare-arrows",
    link: "/security/mitre",
    name: "securityMitre",
  },
  {
    title: t("siem.nav.content"),
    icon: "menu-book",
    link: "/security/content",
    name: "securityContent",
  },
  {
    title: t("siem.nav.sources"),
    icon: "cloud-upload",
    link: "/security/sources",
    name: "securitySources",
  },
];
