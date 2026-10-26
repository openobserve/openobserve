// Copyright 2026 OpenObserve Inc.

import { beforeEach, describe, expect, it } from "vitest";
import { toastRecords } from "@/lib/feedback/Toast/useToast";
import { notifyTrialBlocked } from "./trialPaywallNotice";

const openToasts = () => toastRecords.filter((r) => r.open);

describe("notifyTrialBlocked", () => {
  beforeEach(() => {
    toastRecords.splice(0, toastRecords.length);
  });

  it("shows one info toast naming the blocked page", () => {
    notifyTrialBlocked({ name: "logs", meta: { titleKey: "menu.search" } });

    expect(openToasts()).toHaveLength(1);
    const [record] = openToasts();
    expect(record.variant).toBe("info");
    expect(record.title).toBe("Your trial has ended");
    expect(record.message).toBe("Logs needs a plan. Choose one on this page to keep using it.");
  });

  it("collapses three blocked clicks on the same page into one toast with count 3", () => {
    const route = { name: "logs", meta: { titleKey: "menu.search" } };
    notifyTrialBlocked(route);
    notifyTrialBlocked(route);
    notifyTrialBlocked(route);

    expect(openToasts()).toHaveLength(1);
    expect(openToasts()[0].count).toBe(3);
  });

  it("replaces the visible toast when a different page is blocked", () => {
    notifyTrialBlocked({ name: "logs", meta: { titleKey: "menu.search" } });
    notifyTrialBlocked({ name: "dashboards", meta: { titleKey: "menu.dashboard" } });

    expect(openToasts()).toHaveLength(1);
    expect(openToasts()[0].message).toContain("Dashboards needs a plan");
  });

  // the boot check redirects from any route, so a route with no title gets the generic copy.
  it("falls back to the generic plan message when the route has no title", () => {
    notifyTrialBlocked({});

    expect(openToasts()).toHaveLength(1);
    expect(openToasts()[0].message).toBe("Choose a plan on this page to keep using OpenObserve.");
  });

  it("falls back when the title key is not translated", () => {
    notifyTrialBlocked({ name: "x", meta: { titleKey: "menu.doesNotExist" } });

    expect(openToasts()[0].message).toBe("Choose a plan on this page to keep using OpenObserve.");
  });
});
