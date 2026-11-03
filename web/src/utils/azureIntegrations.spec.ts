import { describe, it, expect } from "vitest";
import { azureIntegrations, generateARMTemplateURL } from "./azureIntegrations";

describe("generateARMTemplateURL", () => {
  it("passes the parameters the activity-logs ARM template declares", () => {
    const integration = azureIntegrations.find((i) => i.id === "activity-logs")!;
    const url = generateARMTemplateURL(
      integration,
      "https://o2.example.com/api/org1/azure-activity-logs/_json",
      "user@example.com",
      "secret",
    );
    const encoded = url.split("/parameters/")[1];
    const params = JSON.parse(decodeURIComponent(encoded));
    expect(params).toEqual({
      openObserveEndpoint: { value: "https://o2.example.com/api/org1/azure-activity-logs/_json" },
      openObserveUsername: { value: "user@example.com" },
      openObservePassword: { value: "secret" },
    });
  });
});
