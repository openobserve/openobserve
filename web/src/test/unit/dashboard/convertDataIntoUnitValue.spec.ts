import { getUnitValue } from "./../../../utils/dashboard/convertDataIntoUnitValue";
import { describe, expect, it, test } from "vitest";

describe("getUnitValue", () => {
  // it("should convert a positive value to bytes", () => {
  //   expect(getUnitValue(1024, "bytes", "")).toEqual({
  //     value: "1.00",
  //     unit: "KB",
  //   });
  // });

  // it("should convert a negative value to bytes", () => {
  //   expect(getUnitValue(-1024, "bytes", "")).toEqual({
  //     value: "-1.00",
  //     unit: "KB",
  //   });
  // });

  // it("should convert a custom value to a custom unit", () => {
  //   expect(getUnitValue(100, "custom", "customUnit")).toEqual({
  //     value: "100.00",
  //     unit: "customUnit",
  //   });
  // });

  // it("should convert a value to seconds", () => {
  //   expect(getUnitValue(3600, "seconds", "")).toEqual({
  //     value: "1.00",
  //     unit: "h",
  //   });
  // });

  // it("should convert a value to microseconds", () => {
  //   expect(getUnitValue(1000000, "microseconds", "")).toEqual({
  //     value: "1.00",
  //     unit: "s",
  //   });
  // });

  // it("should convert a value to milliseconds", () => {
  //   expect(getUnitValue(60000, "milliseconds", "")).toEqual({
  //     value: "1.00",
  //     unit: "m",
  //   });
  // });

  // it("should convert a value to bps", () => {
  //   expect(getUnitValue(1024, "bps", "")).toEqual({
  //     value: "1.00",
  //     unit: "KB/s",
  //   });
  // });

  // it("should convert a value to percent-1", () => {
  //   expect(getUnitValue(0.01, "percent-1", "")).toEqual({
  //     value: "1.00",
  //     unit: "%",
  //   });
  // });

  // it("should convert a value to percent", () => {
  //   expect(getUnitValue(0.5, "percent", "")).toEqual({
  //     value: "0.50",
  //     unit: "%",
  //   });
  // });

  // it("should convert a value to kilobytes", () => {
  //   expect(getUnitValue(1048576, "kilobytes", "")).toEqual({
  //     value: "1.00",
  //     unit: "MB",
  //   });
  // });

  // it("should convert a value to megabytes", () => {
  //   expect(getUnitValue(1073741824, "megabytes", "")).toEqual({
  //     value: "1.00",
  //     unit: "GB",
  //   });
  // });

  // it("should convert a default value with invalid input", () => {
  //   expect(getUnitValue("invalid", "default", "")).toEqual({
  //     value: "invalid",
  //     unit: "",
  //   });
  // });

  // it("should convert a default value with a valid number input", () => {
  //   expect(getUnitValue(1000, "default", "")).toEqual({
  //     value: "1000.00",
  //     unit: "",
  //   });
  // });

  test("should handle bytes", () => {
    expect(getUnitValue(1023, "bytes", "")).toEqual({
      value: "1023",
      unit: "B",
    });
    expect(getUnitValue(1024, "bytes", "")).toEqual({
      value: "1.00",
      unit: "KB",
    });
    // Add more test cases for bytes unit
  });

  test("should handle custom units", () => {
    expect(getUnitValue(10, "custom", "cm")).toEqual({
      value: "10.00",
      unit: "cm",
    });
    // Add more test cases for custom units
  });

  test("should handle seconds", () => {
    expect(getUnitValue(3600, "seconds", "")).toEqual({
      value: "1.00",
      unit: "hour",
    });
    // Add more test cases for seconds unit
  });

  test("should handle microseconds", () => {
    expect(getUnitValue(1000, "microseconds", "")).toEqual({
      value: "1.00",
      unit: "ms",
    });
    // Add more test cases for microseconds unit
  });

  test("should handle milliseconds", () => {
    expect(getUnitValue(60000, "milliseconds", "")).toEqual({
      value: "1.00",
      unit: "minute",
    });
    // Add more test cases for milliseconds unit
  });

  test("should handle bps", () => {
    expect(getUnitValue(1023, "bps", "")).toEqual({
      value: "1023",
      unit: "B/s",
    });
    expect(getUnitValue(1024, "bps", "")).toEqual({
      value: "1.00",
      unit: "KB/s",
    });
    // Add more test cases for bps unit
  });

  test("should handle percent-1", () => {
    expect(getUnitValue(0.5, "percent-1", "")).toEqual({
      value: "50.00",
      unit: "%",
    });
    // Add more test cases for percent-1 unit
  });
});
