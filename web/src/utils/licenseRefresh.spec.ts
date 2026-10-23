import { describe, expect, it } from "vitest";
import { gt } from "@/types/i18n";
import { isOldNodeBody, refreshMessage, statusLabel } from "./licenseRefresh";

const errors = {
  unreachable: "Could not reach the license server.",
  timeout: "Could not reach the license server.",
  blocked: "blocked by OpenObserve",
  superseded: "replaced by another license",
  key_conflict: "registered with another key",
  refused_by_env: "O2_LICENSE_KEY",
  rev_ignored: "newer key",
  rev_conflict: "different content",
  disabled: "turned off",
  airgapped: "not an online license",
  not_v2: "not an online license",
  not_online: "not an online license",
  no_license: "No license",
  licence_inactive: "inactive",
  licence_expired: "expired",
  rate_limited: "Try again in 30 s",
  unsupported_server: "does not support",
  invalid_response: "invalid response",
  rejected: "rejected",
  validator_rejected: "validator",
  instance_key_unreadable: "cannot be read",
  lock_unavailable: "lock",
  internal: "could not be completed",
  rotation_unsettled: "could not be completed",
};
describe("license refresh messages", () => {
  it.each(Object.entries(errors))("maps %s to translated copy", (error, text) => {
    expect(refreshMessage({ error, retry_after_s: 30, limits_refreshed: true }, gt).text).toContain(
      text,
    );
  });
  it("includes waiver counts", () => {
    expect(
      refreshMessage({ outcome: "updated", waivers_added: 1, waivers_removed: 0 }, gt).text,
    ).toBe("License updated: 1 waiver added / 0 removed");
  });
  it("formats plural counts", () => {
    expect(
      refreshMessage({ outcome: "updated", waivers_added: 2, waivers_removed: 1 }, gt).text,
    ).toContain("2 waivers added / 1 removed");
  });
  it("inserts the retry interval", () => {
    expect(refreshMessage({ error: "rate_limited", retry_after_s: 47 }, gt).text).toContain("47 s");
  });
  it("uses env renewal copy when a successor was fetched", () => {
    expect(
      refreshMessage(
        {
          error: "refused_by_env",
          successor_available: { license_id: "new", expires_at: 1793577600000000 },
        },
        gt,
      ).text,
    ).toBe("A renewed license is available. Update O2_LICENSE_KEY to use it.");
  });
  it("uses the renewed expiry", () => {
    expect(
      refreshMessage(
        { outcome: "renewed", renewed: { license_id: "new", expires_at: 1825113600000000 } },
        gt,
      ).text,
    ).toContain("Nov 2, 2027");
  });
  it("recognizes empty old-node bodies", () => {
    expect(isOldNodeBody("")).toBe(true);
    expect(isOldNodeBody({})).toBe(false);
    expect(refreshMessage("", gt).text).toBe(
      "Limits refreshed; online refresh needs all nodes upgraded",
    );
  });
  it("does not claim local limits succeeded when they failed", () => {
    expect(refreshMessage({ error: "timeout", limits_refreshed: false }, gt).text).not.toContain(
      "Limits were refreshed",
    );
  });
  it("maps numeric busy replies", () => {
    expect(
      refreshMessage({ code: 409, reason: "refresh_in_progress", limits_refreshed: true }, gt).text,
    ).toContain("already running");
  });
  it("uses translated fallbacks for unknown outcomes and statuses", () => {
    expect(refreshMessage({ error: "future_error" }, gt).text).toBe(
      "Online refresh could not be completed. Try again or contact OpenObserve support.",
    );
    expect(statusLabel("rotation_unsettled", gt)).toBe("Status unavailable");
    expect(statusLabel("registered", gt)).toBe("Registered");
  });
});
