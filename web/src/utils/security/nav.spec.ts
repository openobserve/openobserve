// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";

import { securityNavLinks } from "./nav";

describe("securityNavLinks", () => {
  it("lists the Sources page with the icon its header uses", () => {
    const links = securityNavLinks((key: string) => key as never);
    const sources = links.find((link) => link.name === "securitySources");
    expect(sources).toMatchObject({ link: "/security/sources", icon: "cloud-upload" });
  });
});
