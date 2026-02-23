import { describe, it, expect } from "vitest";
import {
  getPresetByPageType,
  resolveConfig,
  DASHBOARD_PRESET,
  METRICS_PRESET,
  LOGS_PRESET,
  BUILD_PRESET,
  ALL_CHART_TYPES,
  SELECT_STAR_ALLOWED_CHART_TYPES,
  AGGREGATION_REQUIRED_CHART_TYPES,
  type PanelEditorPageType,
  type PanelEditorConfig,
  type PanelEditorProps,
} from "./panelEditor";

describe("panelEditor types and utilities", () => {
  describe("Preset Configurations", () => {
    describe("DASHBOARD_PRESET", () => {
      it("should have correct default configuration", () => {
        expect(DASHBOARD_PRESET).toEqual({
          showQueryEditor: true,
          showQueryBuilder: true,
          showVariablesSelector: true,
          showLastRefreshedTime: true,
          showOutdatedWarning: true,
          showAddToDashboardButton: false,
          showQueryTypeSelector: false,
          showGeneratedQueryDisplay: false,
          hideChartPreview: false,
        });
      });

      it("should not show Add to Dashboard button (has Save button instead)", () => {
        expect(DASHBOARD_PRESET.showAddToDashboardButton).toBe(false);
      });

      it("should show variables selector", () => {
        expect(DASHBOARD_PRESET.showVariablesSelector).toBe(true);
      });
    });

    describe("METRICS_PRESET", () => {
      it("should have correct default configuration", () => {
        expect(METRICS_PRESET).toEqual({
          showQueryEditor: true,
          showQueryBuilder: true,
          showVariablesSelector: false,
          showLastRefreshedTime: true,
          showOutdatedWarning: true,
          showAddToDashboardButton: true,
          showQueryTypeSelector: false,
          showGeneratedQueryDisplay: false,
          hideChartPreview: false,
        });
      });

      it("should show Add to Dashboard button", () => {
        expect(METRICS_PRESET.showAddToDashboardButton).toBe(true);
      });

      it("should not show variables selector", () => {
        expect(METRICS_PRESET.showVariablesSelector).toBe(false);
      });
    });

    describe("LOGS_PRESET", () => {
      it("should have correct default configuration", () => {
        expect(LOGS_PRESET).toEqual({
          showQueryEditor: false,
          showQueryBuilder: false,
          showVariablesSelector: false,
          showLastRefreshedTime: false,
          showOutdatedWarning: true,
          showAddToDashboardButton: true,
          showQueryTypeSelector: false,
          showGeneratedQueryDisplay: false,
          hideChartPreview: false,
        });
      });

      it("should not show query editor (logs visualization receives external data)", () => {
        expect(LOGS_PRESET.showQueryEditor).toBe(false);
      });

      it("should not show query builder (logs visualization receives external data)", () => {
        expect(LOGS_PRESET.showQueryBuilder).toBe(false);
      });

      it("should show Add to Dashboard button", () => {
        expect(LOGS_PRESET.showAddToDashboardButton).toBe(true);
      });
    });

    describe("BUILD_PRESET", () => {
      it("should have correct default configuration", () => {
        expect(BUILD_PRESET).toEqual({
          showQueryEditor: false,
          showQueryBuilder: true,
          showVariablesSelector: false,
          showLastRefreshedTime: false,
          showOutdatedWarning: false,
          showAddToDashboardButton: true,
          showQueryTypeSelector: true,
          showGeneratedQueryDisplay: true,
          hideChartPreview: false,
        });
      });

      it("should show query type selector (SQL/PromQL toggle)", () => {
        expect(BUILD_PRESET.showQueryTypeSelector).toBe(true);
      });

      it("should show generated query display", () => {
        expect(BUILD_PRESET.showGeneratedQueryDisplay).toBe(true);
      });

      it("should show query builder for X/Y/Breakdown fields", () => {
        expect(BUILD_PRESET.showQueryBuilder).toBe(true);
      });

      it("should not show outdated warning", () => {
        expect(BUILD_PRESET.showOutdatedWarning).toBe(false);
      });
    });
  });

  describe("getPresetByPageType", () => {
    it("should return DASHBOARD_PRESET for dashboard page type", () => {
      expect(getPresetByPageType("dashboard")).toBe(DASHBOARD_PRESET);
    });

    it("should return METRICS_PRESET for metrics page type", () => {
      expect(getPresetByPageType("metrics")).toBe(METRICS_PRESET);
    });

    it("should return LOGS_PRESET for logs page type", () => {
      expect(getPresetByPageType("logs")).toBe(LOGS_PRESET);
    });

    it("should return BUILD_PRESET for build page type", () => {
      expect(getPresetByPageType("build")).toBe(BUILD_PRESET);
    });

    it("should return DASHBOARD_PRESET as default for unknown page type", () => {
      expect(getPresetByPageType("unknown" as PanelEditorPageType)).toBe(
        DASHBOARD_PRESET,
      );
    });
  });

  describe("resolveConfig", () => {
    it("should return preset defaults when no overrides provided", () => {
      const props: PanelEditorProps = {
        pageType: "dashboard",
      };

      const config = resolveConfig(props);

      expect(config).toEqual(DASHBOARD_PRESET);
    });

    it("should override showQueryEditor when provided in props", () => {
      const props: PanelEditorProps = {
        pageType: "dashboard",
        showQueryEditor: false,
      };

      const config = resolveConfig(props);

      expect(config.showQueryEditor).toBe(false);
      // Other values should remain from preset
      expect(config.showVariablesSelector).toBe(true);
    });

    it("should override showQueryBuilder when provided in props", () => {
      const props: PanelEditorProps = {
        pageType: "logs",
        showQueryBuilder: true,
      };

      const config = resolveConfig(props);

      expect(config.showQueryBuilder).toBe(true);
      // Verify it was originally false in LOGS_PRESET
      expect(LOGS_PRESET.showQueryBuilder).toBe(false);
    });

    it("should override showVariablesSelector when provided in props", () => {
      const props: PanelEditorProps = {
        pageType: "metrics",
        showVariablesSelector: true,
      };

      const config = resolveConfig(props);

      expect(config.showVariablesSelector).toBe(true);
    });

    it("should override showLastRefreshedTime when provided in props", () => {
      const props: PanelEditorProps = {
        pageType: "dashboard",
        showLastRefreshedTime: false,
      };

      const config = resolveConfig(props);

      expect(config.showLastRefreshedTime).toBe(false);
    });

    it("should override showOutdatedWarning when provided in props", () => {
      const props: PanelEditorProps = {
        pageType: "build",
        showOutdatedWarning: true,
      };

      const config = resolveConfig(props);

      expect(config.showOutdatedWarning).toBe(true);
      // Verify it was originally false in BUILD_PRESET
      expect(BUILD_PRESET.showOutdatedWarning).toBe(false);
    });

    it("should override showAddToDashboardButton when provided in props", () => {
      const props: PanelEditorProps = {
        pageType: "dashboard",
        showAddToDashboardButton: true,
      };

      const config = resolveConfig(props);

      expect(config.showAddToDashboardButton).toBe(true);
    });

    it("should override showQueryTypeSelector when provided in props", () => {
      const props: PanelEditorProps = {
        pageType: "dashboard",
        showQueryTypeSelector: true,
      };

      const config = resolveConfig(props);

      expect(config.showQueryTypeSelector).toBe(true);
    });

    it("should override showGeneratedQueryDisplay when provided in props", () => {
      const props: PanelEditorProps = {
        pageType: "logs",
        showGeneratedQueryDisplay: true,
      };

      const config = resolveConfig(props);

      expect(config.showGeneratedQueryDisplay).toBe(true);
    });

    it("should override hideChartPreview when provided in props", () => {
      const props: PanelEditorProps = {
        pageType: "build",
        hideChartPreview: true,
      };

      const config = resolveConfig(props);

      expect(config.hideChartPreview).toBe(true);
    });

    it("should allow multiple overrides at once", () => {
      const props: PanelEditorProps = {
        pageType: "logs",
        showQueryEditor: true,
        showQueryBuilder: true,
        showAddToDashboardButton: false,
      };

      const config = resolveConfig(props);

      expect(config.showQueryEditor).toBe(true);
      expect(config.showQueryBuilder).toBe(true);
      expect(config.showAddToDashboardButton).toBe(false);
      // Non-overridden values from LOGS_PRESET
      expect(config.showVariablesSelector).toBe(false);
      expect(config.showLastRefreshedTime).toBe(false);
    });

    it("should respect false overrides (not treat as undefined)", () => {
      const props: PanelEditorProps = {
        pageType: "dashboard",
        showQueryEditor: false,
        showQueryBuilder: false,
        showVariablesSelector: false,
      };

      const config = resolveConfig(props);

      expect(config.showQueryEditor).toBe(false);
      expect(config.showQueryBuilder).toBe(false);
      expect(config.showVariablesSelector).toBe(false);
    });
  });

  describe("Chart Type Constants", () => {
    describe("ALL_CHART_TYPES", () => {
      it("should contain all expected chart types", () => {
        expect(ALL_CHART_TYPES).toContain("area");
        expect(ALL_CHART_TYPES).toContain("area-stacked");
        expect(ALL_CHART_TYPES).toContain("bar");
        expect(ALL_CHART_TYPES).toContain("h-bar");
        expect(ALL_CHART_TYPES).toContain("stacked");
        expect(ALL_CHART_TYPES).toContain("h-stacked");
        expect(ALL_CHART_TYPES).toContain("line");
        expect(ALL_CHART_TYPES).toContain("scatter");
        expect(ALL_CHART_TYPES).toContain("pie");
        expect(ALL_CHART_TYPES).toContain("donut");
        expect(ALL_CHART_TYPES).toContain("metric");
        expect(ALL_CHART_TYPES).toContain("gauge");
        expect(ALL_CHART_TYPES).toContain("table");
        expect(ALL_CHART_TYPES).toContain("heatmap");
        expect(ALL_CHART_TYPES).toContain("geomap");
        expect(ALL_CHART_TYPES).toContain("sankey");
        expect(ALL_CHART_TYPES).toContain("html");
        expect(ALL_CHART_TYPES).toContain("markdown");
        expect(ALL_CHART_TYPES).toContain("custom_chart");
      });

      it("should have 19 chart types", () => {
        expect(ALL_CHART_TYPES.length).toBe(19);
      });
    });

    describe("SELECT_STAR_ALLOWED_CHART_TYPES", () => {
      it("should only contain table chart type", () => {
        expect(SELECT_STAR_ALLOWED_CHART_TYPES).toEqual(["table"]);
      });

      it("should have exactly 1 chart type", () => {
        expect(SELECT_STAR_ALLOWED_CHART_TYPES.length).toBe(1);
      });
    });

    describe("AGGREGATION_REQUIRED_CHART_TYPES", () => {
      it("should contain chart types that require aggregation", () => {
        expect(AGGREGATION_REQUIRED_CHART_TYPES).toContain("area");
        expect(AGGREGATION_REQUIRED_CHART_TYPES).toContain("bar");
        expect(AGGREGATION_REQUIRED_CHART_TYPES).toContain("line");
        expect(AGGREGATION_REQUIRED_CHART_TYPES).toContain("pie");
        expect(AGGREGATION_REQUIRED_CHART_TYPES).toContain("metric");
        expect(AGGREGATION_REQUIRED_CHART_TYPES).toContain("gauge");
        expect(AGGREGATION_REQUIRED_CHART_TYPES).toContain("heatmap");
        expect(AGGREGATION_REQUIRED_CHART_TYPES).toContain("geomap");
        expect(AGGREGATION_REQUIRED_CHART_TYPES).toContain("sankey");
      });

      it("should not contain table chart type", () => {
        expect(AGGREGATION_REQUIRED_CHART_TYPES).not.toContain("table");
      });

      it("should not contain html chart type", () => {
        expect(AGGREGATION_REQUIRED_CHART_TYPES).not.toContain("html");
      });

      it("should not contain markdown chart type", () => {
        expect(AGGREGATION_REQUIRED_CHART_TYPES).not.toContain("markdown");
      });

      it("should not contain custom_chart type", () => {
        expect(AGGREGATION_REQUIRED_CHART_TYPES).not.toContain("custom_chart");
      });

      it("should have 15 chart types", () => {
        expect(AGGREGATION_REQUIRED_CHART_TYPES.length).toBe(15);
      });
    });

    describe("Chart type consistency", () => {
      it("SELECT_STAR and AGGREGATION_REQUIRED should be mutually exclusive for regular charts", () => {
        const overlap = SELECT_STAR_ALLOWED_CHART_TYPES.filter((type) =>
          AGGREGATION_REQUIRED_CHART_TYPES.includes(type as any),
        );
        expect(overlap).toEqual([]);
      });

      it("all chart types should be accounted for", () => {
        const regularChartTypes = ALL_CHART_TYPES.filter(
          (type) => !["html", "markdown", "custom_chart"].includes(type),
        );

        regularChartTypes.forEach((type) => {
          const inSelectStar = SELECT_STAR_ALLOWED_CHART_TYPES.includes(
            type as any,
          );
          const inAggregation = AGGREGATION_REQUIRED_CHART_TYPES.includes(
            type as any,
          );
          expect(inSelectStar || inAggregation).toBe(true);
        });
      });
    });
  });

  describe("Type guards and validation", () => {
    it("PanelEditorConfig should have all required properties", () => {
      const config: PanelEditorConfig = {
        showQueryEditor: true,
        showQueryBuilder: true,
        showVariablesSelector: true,
        showLastRefreshedTime: true,
        showOutdatedWarning: true,
        showAddToDashboardButton: true,
        showQueryTypeSelector: true,
        showGeneratedQueryDisplay: true,
        hideChartPreview: false,
      };

      // All properties should be booleans
      expect(typeof config.showQueryEditor).toBe("boolean");
      expect(typeof config.showQueryBuilder).toBe("boolean");
      expect(typeof config.showVariablesSelector).toBe("boolean");
      expect(typeof config.showLastRefreshedTime).toBe("boolean");
      expect(typeof config.showOutdatedWarning).toBe("boolean");
      expect(typeof config.showAddToDashboardButton).toBe("boolean");
      expect(typeof config.showQueryTypeSelector).toBe("boolean");
      expect(typeof config.showGeneratedQueryDisplay).toBe("boolean");
      expect(typeof config.hideChartPreview).toBe("boolean");
    });

    it("PanelEditorPageType should accept valid page types", () => {
      const validTypes: PanelEditorPageType[] = [
        "dashboard",
        "metrics",
        "logs",
        "build",
      ];

      validTypes.forEach((type) => {
        const config = getPresetByPageType(type);
        expect(config).toBeDefined();
      });
    });
  });
});
