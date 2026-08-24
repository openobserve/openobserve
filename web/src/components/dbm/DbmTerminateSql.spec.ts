import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import DbmTerminateSql from "./DbmTerminateSql.vue";

const copyToClipboard = vi.fn().mockResolvedValue(true);
vi.mock("@/utils/clipboard", () => ({
  copyToClipboard: (...args: unknown[]) => copyToClipboard(...args),
}));

/**
 * The component exists because we deliberately did NOT build the mockup's
 * inline `End session <pid>` button: a destructive, irreversible action one
 * click away in a live-refreshing table is a footgun, and executing it would
 * need a privileged write path this feature does not have. So the contract
 * under test is "hands over the right text, runs nothing".
 */
const mountWith = (props: Record<string, unknown>) =>
  mount(DbmTerminateSql, {
    props: { dbSystem: "postgres", pid: 1069, ...props },
    global: { plugins: [i18n] },
  });

describe("DbmTerminateSql", () => {
  beforeEach(() => copyToClipboard.mockClear());

  it("shows the Postgres statement", () => {
    expect(mountWith({}).text()).toContain("SELECT pg_terminate_backend(1069);");
  });

  it("shows the MySQL statement for a MySQL session", () => {
    expect(mountWith({ dbSystem: "mysql", pid: 88 }).text()).toContain("KILL 88;");
  });

  it("copies rather than executes", async () => {
    const wrapper = mountWith({});
    await wrapper.find("[data-test='dbm-terminate-sql-copy']").trigger("click");
    expect(copyToClipboard).toHaveBeenCalledOnce();
    expect(copyToClipboard.mock.calls[0][0]).toBe("SELECT pg_terminate_backend(1069);");
  });

  it("renders nothing without a pid — no half-formed statement can be copied", () => {
    expect(mountWith({ pid: null }).find("[data-test='dbm-terminate-sql']").exists()).toBe(false);
  });

  it("names the instance in the hint, so the operator knows where to run it", () => {
    // The hint lives on OTooltip, which only renders its content on hover — so
    // the assertion reads the prop rather than the DOM.
    const content = mountWith({ instance: "dbmlab" })
      .findComponent({ name: "OTooltip" })
      .props("content") as string;
    expect(content).toContain("dbmlab");
    // It must also say plainly that O2 will not run it.
    expect(content).toContain("never run it for you");
  });

  it("still offers the statement when the instance is unknown", () => {
    const content = mountWith({ instance: null })
      .findComponent({ name: "OTooltip" })
      .props("content") as string;
    expect(content).toContain("never run it for you");
  });
});
