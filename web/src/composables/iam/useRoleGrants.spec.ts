import { describe, it, expect } from "vitest";
import { useRoleGrants } from "@/composables/iam/useRoleGrants";

describe("useRoleGrants - staging against a late seed", () => {
  // The rail is clickable before the saved grants land, so a key can be added and then turn out to be saved.
  it("never sends the same grant in both add and remove", () => {
    const grants = useRoleGrants();
    const key = "logs:_all_default:AllowGet";

    grants.toggle(key);
    grants.seedSaved([key]);
    grants.toggle(key);

    const payload = grants.payload();
    expect(payload.add).toEqual([]);
    expect(payload.remove).toEqual([{ object: "logs:_all_default", permission: "AllowGet" }]);
  });
});
