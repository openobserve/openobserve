import { describe, expect, it } from "vitest";
import type { Scope, Version } from "@/services/service_versions";
import { lastGoodOf } from "./useLastGood";
const scope = {
  org: "org",
  user: "u",
  service: "web",
  where: "k8s:c1/web",
  current: { version: "0.50.0", image: null },
};
const scopes = [
  { service: "web", where_key: "k8s:c2/web", last_good_version: "0.48.0" },
  {
    service: "web",
    where_key: "k8s:c1/web",
    last_good_version: "0.49.2",
    last_good_image: "8ebf1f7",
  },
] as Scope[];
const day = 86400 * 1e6;
const versions = [
  { version: "0.49.2", where_key: "k8s:c2/web", first_seen: 0, last_seen: day },
  { version: "0.49.2", where_key: "k8s:c1/web", first_seen: 0, last_seen: 30 * day },
  {
    version: "0.49.2",
    image: "8ebf1f7",
    where_key: "k8s:c1/web",
    first_seen: day,
    last_seen: 10 * day,
  },
] as Version[];
describe("last good version", () => {
  it("reads the scope's last good build and how long that build ran in that where", () => {
    expect(lastGoodOf(scopes, versions, scope)).toEqual({
      version: "0.49.2",
      image: "8ebf1f7",
      ran: 9 * day,
    });
  });
  it("omits the run time when the version row is not loaded", () => {
    expect(lastGoodOf(scopes, [], scope)).toEqual({
      version: "0.49.2",
      image: "8ebf1f7",
      ran: undefined,
    });
  });
  it("shows nothing without a last good version or when it is the build being judged", () => {
    expect(lastGoodOf([], versions, scope)).toBeUndefined();
    const judged = { version: "0.49.2", image: "8ebf1f7" };
    expect(lastGoodOf(scopes, versions, { ...scope, current: judged })).toBeUndefined();
    expect(lastGoodOf(undefined, versions, scope)).toBeUndefined();
  });
  it("keeps the last good build when the judged build only shares its version text", () => {
    const judged = { version: "0.49.2", image: "f167103" };
    expect(lastGoodOf(scopes, versions, { ...scope, current: judged })).toEqual({
      version: "0.49.2",
      image: "8ebf1f7",
      ran: 9 * day,
    });
  });
});
