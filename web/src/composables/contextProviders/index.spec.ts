import { describe, expect, it } from "vitest";
import * as moduleExports from "./index";
import registryDefault, { contextRegistry } from "./registry";
import { createAlertsContextProvider } from "./alertsContextProvider";
import { createDashboardsContextProvider } from "./dashboardsContextProvider";
import { createDefaultContextProvider } from "./defaultContextProvider";
import { createIncidentsContextProvider } from "./incidentsContextProvider";
import { createLogsContextProvider } from "./logsContextProvider";
import { createPipelinesContextProvider } from "./pipelinesContextProvider";

describe("contextProviders index exports", () => {
  it("re-exports registry and provider factory functions", () => {
    expect(moduleExports.contextRegistry).toBe(contextRegistry);
    expect(moduleExports.registry).toBe(registryDefault);

    expect(moduleExports.createAlertsContextProvider).toBe(createAlertsContextProvider);
    expect(moduleExports.createDashboardsContextProvider).toBe(createDashboardsContextProvider);
    expect(moduleExports.createDefaultContextProvider).toBe(createDefaultContextProvider);
    expect(moduleExports.createIncidentsContextProvider).toBe(createIncidentsContextProvider);
    expect(moduleExports.createLogsContextProvider).toBe(createLogsContextProvider);
    expect(moduleExports.createPipelinesContextProvider).toBe(createPipelinesContextProvider);
  });
});
