// Copyright 2026 OpenObserve Inc.

import type { NavItem } from "@/lib/core/Navbar/ONavbar.types";

/** The fixed Security rail; every icon must exist in the OIcon registry (OIcon.icons.ts). */
export const SECURITY_NAV_LINKS: NavItem[] = [
  {
    title: "Overview",
    icon: "bar-chart",
    link: "/security/overview",
    name: "securityOverview",
  },
  { title: "Events", icon: "manage-search", link: "/security/events", name: "securityEvents" },
  {
    title: "Detections",
    icon: "shield-alert-outline",
    link: "/security/detections",
    name: "securityDetections",
  },
  {
    title: "Alerts",
    icon: "notifications-active",
    link: "/security/alerts",
    name: "securityAlerts",
  },
  { title: "Cases", icon: "folder-open", link: "/security/cases", name: "securityCases" },
  {
    title: "Entities",
    icon: "person-pin-circle",
    link: "/security/entities",
    name: "securityEntities",
  },
  {
    title: "Threat Intel",
    icon: "brain-circuit",
    link: "/security/intel",
    name: "securityIntel",
  },
  { title: "UEBA", icon: "group-work", link: "/security/ueba", name: "securityUEBA" },
  {
    title: "MITRE ATT&CK",
    icon: "compare-arrows",
    link: "/security/mitre",
    name: "securityMitre",
  },
  {
    title: "Compliance",
    icon: "verified-user",
    link: "/security/compliance",
    name: "securityCompliance",
  },
  { title: "Content", icon: "menu-book", link: "/security/content", name: "securityContent" },
];
