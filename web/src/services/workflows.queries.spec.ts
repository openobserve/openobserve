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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryClient } from "@/composables/query/queryClient";
import { NORMAL_STALE_TIME } from "@/composables/query/cachePolicy";
import http from "@/services/http";
import * as declarations from "./workflows.queries";
import {
  deleteHttpTriggerMutation,
  putHttpTriggerMutation,
  revealHttpCredentialSecretMutation,
  revokeHttpCredentialMutation,
  rotateHttpCredentialMutation,
  workflowHttpTriggerQuery,
} from "./workflows.queries";
import { workflowKeys } from "./workflows.querykeys";

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("@/services/http", () => ({ default: vi.fn() }));

const org = "acme";
const id = "wf1";
const permissions = { edit: true, test: true, reveal: true };

const runMutation = async (options: any, variables: unknown) => {
  const mutation = queryClient.getMutationCache().build(queryClient, options);
  return mutation.execute(variables);
};

const invalidatedKeys = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.map(([filters]: any[]) => filters?.queryKey);

describe("workflow HTTP endpoint declarations", () => {
  let api: Record<"get" | "post" | "put" | "delete", ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    api = { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() };
    (http as any).mockReturnValue(api);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("workflowHttpTriggerQuery is keyed under workflowKeys.all", () => {
    const options = workflowHttpTriggerQuery(org, id);

    expect(options.queryKey.slice(0, workflowKeys.all(org).length)).toEqual([
      ...workflowKeys.all(org),
    ]);
    expect(options.queryKey).toEqual(workflowKeys.httpTrigger(org, id));
    expect(options.staleTime).toBe(NORMAL_STALE_TIME);
  });

  it("refetches on every mount, so a reopened panel never shows an old last call", () => {
    expect(workflowHttpTriggerQuery(org, id).refetchOnMount).toBe("always");
  });

  it("is enabled only when org and id are set", () => {
    expect(workflowHttpTriggerQuery("", id).enabled).toBe(false);
    expect(workflowHttpTriggerQuery(org, "").enabled).toBe(false);
    expect(workflowHttpTriggerQuery(org, id).enabled).toBe(true);
  });

  it("a 404 not_configured resolves to configured:false", async () => {
    api.get.mockRejectedValue({
      response: {
        status: 404,
        data: {
          error_detail: "not_configured",
          permissions,
          org_rate_limit_per_minute: 600,
          secrets_encrypted_at_rest: true,
        },
      },
    });

    await expect(queryClient.fetchQuery(workflowHttpTriggerQuery(org, id))).resolves.toEqual({
      configured: false,
      permissions,
      org_rate_limit_per_minute: 600,
      secrets_encrypted_at_rest: true,
    });
  });

  it("a remount within the tier makes 0 calls", async () => {
    api.get.mockResolvedValue({ data: { id: "t1", permissions } });

    await queryClient.fetchQuery(workflowHttpTriggerQuery(org, id));
    await queryClient.fetchQuery(workflowHttpTriggerQuery(org, id));

    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("putHttpTrigger invalidates the trigger and the list", async () => {
    api.put.mockResolvedValue({ data: { id: "t1", secret: null } });
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    await runMutation(putHttpTriggerMutation(org, id), { enabled: true, auth_mode: "token" });

    expect(invalidatedKeys(spy)).toEqual(
      expect.arrayContaining([workflowKeys.httpTrigger(org, id), workflowKeys.list(org)]),
    );
  });

  it("putHttpTrigger also expires every folder and search list the list page reads", async () => {
    api.put.mockResolvedValue({ data: { id: "t1", secret: null } });
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    await runMutation(putHttpTriggerMutation(org, id), { enabled: false, auth_mode: "token" });

    expect(invalidatedKeys(spy)).toEqual(
      expect.arrayContaining([workflowKeys.folders(org), workflowKeys.searches(org)]),
    );
    expect(workflowKeys.folder(org, "f1").slice(0, 4)).toEqual([...workflowKeys.folders(org)]);
    expect(workflowKeys.search(org, "x").slice(0, 4)).toEqual([...workflowKeys.searches(org)]);
  });

  it("deleteHttpTrigger invalidates the trigger and the list", async () => {
    api.delete.mockResolvedValue({ data: null });
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    await runMutation(deleteHttpTriggerMutation(org, id), undefined);

    expect(api.delete).toHaveBeenCalledWith("/api/acme/workflows/wf1/http_trigger");
    expect(invalidatedKeys(spy)).toEqual(
      expect.arrayContaining([workflowKeys.httpTrigger(org, id), workflowKeys.list(org)]),
    );
  });

  it("rotate and revoke invalidate only the trigger", () => {
    expect(rotateHttpCredentialMutation(org, id).meta?.invalidates).toEqual([
      workflowKeys.httpTrigger(org, id),
    ]);
    expect(revokeHttpCredentialMutation(org, id).meta?.invalidates).toEqual([
      workflowKeys.httpTrigger(org, id),
    ]);
  });

  it("declares no HTTP trigger test mutation; the Test dialog runs /workflows/test", () => {
    expect(Object.keys(declarations)).not.toContain("testHttpTriggerMutation");
  });

  it("the writes the section renders a failure for are silent", () => {
    for (const options of [
      putHttpTriggerMutation(org, id),
      deleteHttpTriggerMutation(org, id),
      rotateHttpCredentialMutation(org, id),
      revokeHttpCredentialMutation(org, id),
      revealHttpCredentialSecretMutation(org, id),
    ]) {
      expect(options.meta?.silentError).toBe(true);
    }
  });

  it("reveal is a mutation with no persister and no invalidation", async () => {
    api.get.mockResolvedValue({ data: { id: "c1", secret: "o2wh_value" } });
    const options = revealHttpCredentialSecretMutation(org, id);
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    await expect(runMutation(options, { credential_id: "c1" })).resolves.toEqual({
      id: "c1",
      secret: "o2wh_value",
    });

    expect(options.meta?.invalidates).toBeUndefined();
    expect(options).not.toHaveProperty("persister");
    expect(spy).not.toHaveBeenCalled();
    expect(Object.keys(declarations).filter((name) => /reveal/i.test(name))).toEqual([
      "revealHttpCredentialSecretMutation",
    ]);
  });

  it("no HTTP endpoint declaration has a persister", () => {
    for (const options of [
      workflowHttpTriggerQuery(org, id),
      putHttpTriggerMutation(org, id),
      deleteHttpTriggerMutation(org, id),
      rotateHttpCredentialMutation(org, id),
      revokeHttpCredentialMutation(org, id),
      revealHttpCredentialSecretMutation(org, id),
    ]) {
      expect(options).not.toHaveProperty("persister");
      expect(options).not.toHaveProperty("gcTime");
    }
  });

  it("every new key starts with the org root", () => {
    for (const key of [
      workflowKeys.httpTrigger(org, id),
      workflowKeys.folders(org),
      workflowKeys.searches(org),
    ]) {
      expect(key.slice(0, 3)).toEqual(["org", org, "workflows"]);
    }
  });
});
