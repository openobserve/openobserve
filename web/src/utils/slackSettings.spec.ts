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

import { describe, expect, it } from "vitest";
import {
  domainOfEmail,
  firstPublicDomain,
  installerDomainDefault,
  isPublicEmailDomain,
  isSlackSettingsVisible,
  readSlackOrgConfig,
  slackDisabledVariable,
} from "./slackSettings";

describe("readSlackOrgConfig", () => {
  it("reads the three Slack fields of the org config", () => {
    expect(
      readSlackOrgConfig({
        slack_enabled: false,
        slack_disabled_reason: "other_region",
        slack_home_region: "us-west",
      }),
    ).toEqual({ enabled: false, reason: "other_region", homeRegion: "us-west" });
  });

  it("treats a config from a server without Slack fields as the OSS edition", () => {
    expect(readSlackOrgConfig({})).toEqual({ enabled: false, reason: "edition", homeRegion: null });
    expect(readSlackOrgConfig(undefined)).toEqual({
      enabled: false,
      reason: "edition",
      homeRegion: null,
    });
  });

  it("drops a stale reason once Slack is enabled", () => {
    expect(readSlackOrgConfig({ slack_enabled: true, slack_disabled_reason: "flag" }).reason).toBe(
      null,
    );
  });
});

describe("isSlackSettingsVisible", () => {
  const selfHosted = { isEnterprise: true, isCloud: false };
  const cloud = { isEnterprise: true, isCloud: true };
  const oss = { isEnterprise: false, isCloud: false };
  const on = { enabled: true, reason: null, homeRegion: null };
  const off = (reason: any) => ({ enabled: false, reason, homeRegion: null });

  it("shows an enabled org on Cloud and self-hosted, never in OSS", () => {
    expect(isSlackSettingsVisible(cloud, on)).toBe(true);
    expect(isSlackSettingsVisible(selfHosted, on)).toBe(true);
    expect(isSlackSettingsVisible(oss, on)).toBe(false);
  });

  it("shows the self-hosted disabled screens only for reasons the admin can fix", () => {
    for (const reason of ["flag", "master_key", "home_region_unset", "other_region"]) {
      expect(isSlackSettingsVisible(selfHosted, off(reason))).toBe(true);
      expect(isSlackSettingsVisible(cloud, off(reason))).toBe(false);
    }
    expect(isSlackSettingsVisible(selfHosted, off("allowlist"))).toBe(false);
    expect(isSlackSettingsVisible(selfHosted, off("edition"))).toBe(false);
  });
});

describe("slackDisabledVariable", () => {
  it("names the variable each disabled screen asks for", () => {
    expect(slackDisabledVariable("flag")).toBe("O2_SLACK_ENABLED");
    expect(slackDisabledVariable("master_key")).toBe("O2_MASTER_ENCRYPTION_KEY");
    expect(slackDisabledVariable("home_region_unset")).toBe("O2_SLACK_HOME_REGION");
    expect(slackDisabledVariable("allowlist")).toBe(null);
  });
});

describe("email domains", () => {
  it("finds the domain of an email, lower-cased", () => {
    expect(domainOfEmail("Ana@Acme.COM")).toBe("acme.com");
    expect(domainOfEmail("not-an-email")).toBe("");
  });

  it("knows public email domains", () => {
    expect(isPublicEmailDomain("gmail.com")).toBe(true);
    expect(isPublicEmailDomain("Outlook.com")).toBe(true);
    expect(isPublicEmailDomain("acme.com")).toBe(false);
  });

  it("prefills the installer's company domain but never a public one", () => {
    expect(installerDomainDefault("ana@acme.com")).toEqual(["acme.com"]);
    expect(installerDomainDefault("ana@gmail.com")).toEqual([]);
    expect(installerDomainDefault("")).toEqual([]);
  });

  it("returns the first public domain in a list, if any", () => {
    expect(firstPublicDomain(["acme.com", "Yahoo.com"])).toBe("yahoo.com");
    expect(firstPublicDomain(["acme.com"])).toBe(null);
  });
});
