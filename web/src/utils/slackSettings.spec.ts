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
} from "./slackSettings";

describe("readSlackOrgConfig", () => {
  it("reads the two Slack fields of the org config", () => {
    expect(
      readSlackOrgConfig({ slack_enabled: false, slack_disabled_reason: "super_cluster" }),
    ).toEqual({ enabled: false, reason: "super_cluster" });
  });

  it("treats a config from a server without Slack fields as the OSS edition", () => {
    expect(readSlackOrgConfig({})).toEqual({ enabled: false, reason: "edition" });
    expect(readSlackOrgConfig(undefined)).toEqual({ enabled: false, reason: "edition" });
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
  const on = { enabled: true, reason: null };
  const off = (reason: any) => ({ enabled: false, reason });

  it("shows an enabled org on Cloud and self-hosted, never in OSS", () => {
    expect(isSlackSettingsVisible(cloud, on)).toBe(true);
    expect(isSlackSettingsVisible(selfHosted, on)).toBe(true);
    expect(isSlackSettingsVisible(oss, on)).toBe(false);
  });

  it("hides Settings › Slack for every disabled reason on every edition", () => {
    for (const reason of ["flag", "master_key", "super_cluster", "edition"]) {
      expect(isSlackSettingsVisible(selfHosted, off(reason))).toBe(false);
      expect(isSlackSettingsVisible(cloud, off(reason))).toBe(false);
      expect(isSlackSettingsVisible(oss, off(reason))).toBe(false);
    }
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
