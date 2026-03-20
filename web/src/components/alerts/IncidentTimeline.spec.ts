// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

vi.mock("@/aws-exports", () => ({
  default: { isEnterprise: "true", isCloud: "false" },
}));

vi.mock("@/services/incidents", () => ({
  default: {
    getEvents: vi.fn(),
    postComment: vi.fn(),
  },
}));

import { describe, expect, it, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import IncidentTimeline from "@/components/alerts/IncidentTimeline.vue";
import incidentsService from "@/services/incidents";

installQuasar({ plugins: [Dialog, Notify] });

const makeEvent = (overrides: Record<string, any> = {}) => ({
  type: "Alert",
  timestamp: 1700000000000000,
  data: { alert_name: "High CPU", count: 1, user_id: undefined },
  ...overrides,
});

async function mountComp(props: Record<string, any> = {}) {
  return mount(IncidentTimeline, {
    props: {
      orgId: "default",
      incidentId: "incident-1",
      visible: true,
      ...props,
    },
    global: { plugins: [i18n, store] },
  });
}

describe("IncidentTimeline - rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (incidentsService.getEvents as any).mockResolvedValue({ data: { events: [] } });
  });

  it("renders without errors", async () => {
    const w = await mountComp();
    await flushPromises();
    expect(w.exists()).toBe(true);
  });

  it("shows empty state when no events", async () => {
    const w = await mountComp();
    await flushPromises();
    expect(w.text()).toContain("No activity yet");
  });

  it("shows comment input area", async () => {
    const w = await mountComp();
    await flushPromises();
    expect(w.find('[data-test="incident-timeline-comment-input"]').exists()).toBe(true);
  });

  it("shows send button", async () => {
    const w = await mountComp();
    await flushPromises();
    expect(w.find('[data-test="incident-timeline-comment-send"]').exists()).toBe(true);
  });
});

describe("IncidentTimeline - fetchEvents", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls getEvents with orgId and incidentId on mount when visible=true", async () => {
    (incidentsService.getEvents as any).mockResolvedValue({ data: { events: [] } });
    await mountComp({ visible: true });
    await flushPromises();
    expect(incidentsService.getEvents).toHaveBeenCalledWith("default", "incident-1");
  });

  it("does not call getEvents when visible=false", async () => {
    (incidentsService.getEvents as any).mockResolvedValue({ data: { events: [] } });
    await mountComp({ visible: false });
    await flushPromises();
    expect(incidentsService.getEvents).not.toHaveBeenCalled();
  });

  it("populates events after fetch", async () => {
    (incidentsService.getEvents as any).mockResolvedValue({
      data: { events: [makeEvent(), makeEvent({ type: "Resolved" })] },
    });
    const w = await mountComp();
    await flushPromises();
    expect(w.vm.events).toHaveLength(2);
  });

  it("sets events to empty array on API error", async () => {
    (incidentsService.getEvents as any).mockRejectedValue(new Error("fail"));
    const w = await mountComp();
    await flushPromises();
    expect(w.vm.events).toEqual([]);
    expect(w.vm.loading).toBe(false);
  });

  it("sets loading to false after success", async () => {
    (incidentsService.getEvents as any).mockResolvedValue({ data: { events: [] } });
    const w = await mountComp();
    await flushPromises();
    expect(w.vm.loading).toBe(false);
  });
});

describe("IncidentTimeline - scroll buttons", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders scroll-top button when events present", async () => {
    (incidentsService.getEvents as any).mockResolvedValue({
      data: { events: [makeEvent()] },
    });
    const w = await mountComp();
    await flushPromises();
    expect(w.find('[data-test="incident-timeline-scroll-top"]').exists()).toBe(true);
  });

  it("renders scroll-bottom button when events present", async () => {
    (incidentsService.getEvents as any).mockResolvedValue({
      data: { events: [makeEvent()] },
    });
    const w = await mountComp();
    await flushPromises();
    expect(w.find('[data-test="incident-timeline-scroll-bottom"]').exists()).toBe(true);
  });
});

describe("IncidentTimeline - isCommentEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (incidentsService.getEvents as any).mockResolvedValue({ data: { events: [] } });
  });

  it("returns true for Comment type", async () => {
    const w = await mountComp();
    await flushPromises();
    expect((w.vm as any).isCommentEvent({ type: "Comment" })).toBe(true);
  });

  it("returns false for Alert type", async () => {
    const w = await mountComp();
    await flushPromises();
    expect((w.vm as any).isCommentEvent({ type: "Alert" })).toBe(false);
  });

  it("returns false for Resolved type", async () => {
    const w = await mountComp();
    await flushPromises();
    expect((w.vm as any).isCommentEvent({ type: "Resolved" })).toBe(false);
  });
});

describe("IncidentTimeline - getUserId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (incidentsService.getEvents as any).mockResolvedValue({ data: { events: [] } });
  });

  it("returns user_id from event data", async () => {
    const w = await mountComp();
    await flushPromises();
    expect((w.vm as any).getUserId({ data: { user_id: "alice" } })).toBe("alice");
  });

  it("returns System when user_id is absent", async () => {
    const w = await mountComp();
    await flushPromises();
    expect((w.vm as any).getUserId({ data: {} })).toBe("System");
  });

  it("returns System when data is absent", async () => {
    const w = await mountComp();
    await flushPromises();
    expect((w.vm as any).getUserId({})).toBe("System");
  });
});

describe("IncidentTimeline - getInitials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (incidentsService.getEvents as any).mockResolvedValue({ data: { events: [] } });
  });

  it("returns S for System", async () => {
    const w = await mountComp();
    await flushPromises();
    expect((w.vm as any).getInitials("System")).toBe("S");
  });

  it("returns first two chars for single word", async () => {
    const w = await mountComp();
    await flushPromises();
    expect((w.vm as any).getInitials("bob")).toBe("BO");
  });

  it("returns first letters of two words", async () => {
    const w = await mountComp();
    await flushPromises();
    expect((w.vm as any).getInitials("john doe")).toBe("JD");
  });

  it("handles email addresses", async () => {
    const w = await mountComp();
    await flushPromises();
    const result = (w.vm as any).getInitials("john.doe@example.com");
    expect(result).toBe("JD");
  });
});

describe("IncidentTimeline - getEventIcon", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (incidentsService.getEvents as any).mockResolvedValue({ data: { events: [] } });
  });

  it("returns add_circle for Created", async () => {
    const w = await mountComp();
    await flushPromises();
    expect((w.vm as any).getEventIcon({ type: "Created" })).toBe("add_circle");
  });

  it("returns notifications for Alert", async () => {
    const w = await mountComp();
    await flushPromises();
    expect((w.vm as any).getEventIcon({ type: "Alert" })).toBe("notifications");
  });

  it("returns psychology for ai_analysis_begin", async () => {
    const w = await mountComp();
    await flushPromises();
    expect((w.vm as any).getEventIcon({ type: "ai_analysis_begin" })).toBe("psychology");
  });

  it("returns circle for unknown type", async () => {
    const w = await mountComp();
    await flushPromises();
    expect((w.vm as any).getEventIcon({ type: "unknown_xyz" })).toBe("circle");
  });
});

describe("IncidentTimeline - getEventBadgeColor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (incidentsService.getEvents as any).mockResolvedValue({ data: { events: [] } });
  });

  it("returns green for Resolved", async () => {
    const w = await mountComp();
    await flushPromises();
    expect((w.vm as any).getEventBadgeColor({ type: "Resolved" })).toBe("#059669");
  });

  it("returns red for SeverityUpgrade", async () => {
    const w = await mountComp();
    await flushPromises();
    expect((w.vm as any).getEventBadgeColor({ type: "SeverityUpgrade" })).toBe("#EF4444");
  });

  it("returns purple for ai_analysis_begin", async () => {
    const w = await mountComp();
    await flushPromises();
    expect((w.vm as any).getEventBadgeColor({ type: "ai_analysis_begin" })).toBe("#8B5CF6");
  });

  it("returns gray for unknown type", async () => {
    const w = await mountComp();
    await flushPromises();
    expect((w.vm as any).getEventBadgeColor({ type: "unknown" })).toBe("#6B7280");
  });
});

describe("IncidentTimeline - getEventBadgeText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (incidentsService.getEvents as any).mockResolvedValue({ data: { events: [] } });
  });

  it("returns 'Acknowledged' for Acknowledged", async () => {
    const w = await mountComp();
    await flushPromises();
    expect((w.vm as any).getEventBadgeText({ type: "Acknowledged" })).toBe("Acknowledged");
  });

  it("returns 'Resolved' for Resolved", async () => {
    const w = await mountComp();
    await flushPromises();
    expect((w.vm as any).getEventBadgeText({ type: "Resolved" })).toBe("Resolved");
  });

  it("returns event type as-is for unknown type", async () => {
    const w = await mountComp();
    await flushPromises();
    expect((w.vm as any).getEventBadgeText({ type: "CustomEvent" })).toBe("CustomEvent");
  });
});

describe("IncidentTimeline - getSeverityColor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (incidentsService.getEvents as any).mockResolvedValue({ data: { events: [] } });
  });

  it("returns red for P1", async () => {
    const w = await mountComp();
    await flushPromises();
    expect((w.vm as any).getSeverityColor("P1")).toBe("#EF4444");
  });

  it("returns orange for P2", async () => {
    const w = await mountComp();
    await flushPromises();
    expect((w.vm as any).getSeverityColor("P2")).toBe("#F97316");
  });

  it("returns blue for P4", async () => {
    const w = await mountComp();
    await flushPromises();
    expect((w.vm as any).getSeverityColor("P4")).toBe("#3B82F6");
  });

  it("returns gray for unknown severity", async () => {
    const w = await mountComp();
    await flushPromises();
    expect((w.vm as any).getSeverityColor("P99")).toBe("#6B7280");
  });
});

describe("IncidentTimeline - getInlineEventText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (incidentsService.getEvents as any).mockResolvedValue({ data: { events: [] } });
  });

  it("returns alert name for Alert event with count=1", async () => {
    const w = await mountComp();
    await flushPromises();
    const text = (w.vm as any).getInlineEventText({
      type: "Alert",
      data: { alert_name: "CPU Alert", count: 1 },
    });
    expect(text).toContain("CPU Alert");
    expect(text).toContain("triggered");
  });

  it("includes count for Alert event with count > 1", async () => {
    const w = await mountComp();
    await flushPromises();
    const text = (w.vm as any).getInlineEventText({
      type: "Alert",
      data: { alert_name: "CPU Alert", count: 5 },
    });
    expect(text).toContain("5 times");
  });

  it("returns text for ai_analysis_begin", async () => {
    const w = await mountComp();
    await flushPromises();
    const text = (w.vm as any).getInlineEventText({ type: "ai_analysis_begin", data: {} });
    expect(text).toContain("analyzing");
  });

  it("returns text for ai_analysis_complete", async () => {
    const w = await mountComp();
    await flushPromises();
    const text = (w.vm as any).getInlineEventText({ type: "ai_analysis_complete", data: {} });
    expect(text).toContain("analysis");
  });

  it("returns empty string for unknown type", async () => {
    const w = await mountComp();
    await flushPromises();
    const text = (w.vm as any).getInlineEventText({ type: "UnknownXYZ", data: {} });
    expect(text).toBe("");
  });
});

describe("IncidentTimeline - formatRelativeTime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (incidentsService.getEvents as any).mockResolvedValue({ data: { events: [] } });
  });

  it("returns 'just now' for recent timestamp", async () => {
    const w = await mountComp();
    await flushPromises();
    const nowUs = Date.now() * 1000;
    expect((w.vm as any).formatRelativeTime(nowUs)).toBe("just now");
  });

  it("returns minutes ago for timestamps 1-59 minutes old", async () => {
    const w = await mountComp();
    await flushPromises();
    const fiveMinsAgoUs = (Date.now() - 5 * 60 * 1000) * 1000;
    const result = (w.vm as any).formatRelativeTime(fiveMinsAgoUs);
    expect(result).toContain("minute");
  });

  it("returns hours ago for timestamps 1-23 hours old", async () => {
    const w = await mountComp();
    await flushPromises();
    const twoHoursAgoUs = (Date.now() - 2 * 3600 * 1000) * 1000;
    const result = (w.vm as any).formatRelativeTime(twoHoursAgoUs);
    expect(result).toContain("hour");
  });

  it("returns days ago for timestamps 1-6 days old", async () => {
    const w = await mountComp();
    await flushPromises();
    const threeDaysAgoUs = (Date.now() - 3 * 86400 * 1000) * 1000;
    const result = (w.vm as any).formatRelativeTime(threeDaysAgoUs);
    expect(result).toContain("day");
  });
});

describe("IncidentTimeline - submitComment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (incidentsService.getEvents as any).mockResolvedValue({ data: { events: [] } });
    (incidentsService.postComment as any).mockResolvedValue({ data: {} });
  });

  it("calls postComment with correct args", async () => {
    const w = await mountComp();
    await flushPromises();
    w.vm.commentText = "test comment";
    await (w.vm as any).submitComment();
    await flushPromises();
    expect(incidentsService.postComment).toHaveBeenCalledWith("default", "incident-1", "test comment");
  });

  it("clears commentText after successful submit", async () => {
    const w = await mountComp();
    await flushPromises();
    w.vm.commentText = "hello";
    await (w.vm as any).submitComment();
    await flushPromises();
    expect(w.vm.commentText).toBe("");
  });

  it("does nothing when commentText is blank", async () => {
    const w = await mountComp();
    await flushPromises();
    w.vm.commentText = "   ";
    await (w.vm as any).submitComment();
    expect(incidentsService.postComment).not.toHaveBeenCalled();
  });

  it("does not clear text on API error", async () => {
    (incidentsService.postComment as any).mockRejectedValue(new Error("fail"));
    const w = await mountComp();
    await flushPromises();
    w.vm.commentText = "hello error";
    await (w.vm as any).submitComment();
    await flushPromises();
    expect(w.vm.commentText).toBe("hello error");
  });

  it("sets submitting to false after completion", async () => {
    const w = await mountComp();
    await flushPromises();
    w.vm.commentText = "test";
    await (w.vm as any).submitComment();
    await flushPromises();
    expect(w.vm.submitting).toBe(false);
  });

  it("re-fetches events after successful comment", async () => {
    vi.clearAllMocks();
    (incidentsService.getEvents as any).mockResolvedValue({ data: { events: [] } });
    (incidentsService.postComment as any).mockResolvedValue({ data: {} });
    const w = await mountComp();
    await flushPromises();
    const beforeCount = (incidentsService.getEvents as any).mock.calls.length;
    w.vm.commentText = "another comment";
    await (w.vm as any).submitComment();
    await flushPromises();
    expect((incidentsService.getEvents as any).mock.calls.length).toBeGreaterThan(beforeCount);
  });
});

describe("IncidentTimeline - getAvatarColor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (incidentsService.getEvents as any).mockResolvedValue({ data: { events: [] } });
  });

  it("returns a hex color string", async () => {
    const w = await mountComp();
    await flushPromises();
    const color = (w.vm as any).getAvatarColor("alice");
    expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("returns consistent color for same username", async () => {
    const w = await mountComp();
    await flushPromises();
    const c1 = (w.vm as any).getAvatarColor("alice");
    const c2 = (w.vm as any).getAvatarColor("alice");
    expect(c1).toBe(c2);
  });
});

describe("IncidentTimeline - watcher: visible", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches events when visible changes from false to true", async () => {
    (incidentsService.getEvents as any).mockResolvedValue({ data: { events: [] } });
    const w = await mountComp({ visible: false });
    await flushPromises();
    vi.clearAllMocks();
    (incidentsService.getEvents as any).mockResolvedValue({ data: { events: [] } });
    await w.setProps({ visible: true });
    await flushPromises();
    expect(incidentsService.getEvents).toHaveBeenCalledWith("default", "incident-1");
  });
});

describe("IncidentTimeline - watcher: refreshTrigger", () => {
  beforeEach(() => vi.clearAllMocks());

  it("re-fetches events when refreshTrigger changes", async () => {
    (incidentsService.getEvents as any).mockResolvedValue({ data: { events: [] } });
    const w = await mountComp({ visible: true, refreshTrigger: 0 });
    await flushPromises();
    vi.clearAllMocks();
    (incidentsService.getEvents as any).mockResolvedValue({ data: { events: [] } });
    await w.setProps({ refreshTrigger: 1 });
    await flushPromises();
    expect(incidentsService.getEvents).toHaveBeenCalled();
  });
});
