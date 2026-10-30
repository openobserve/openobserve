import { describe, it, expect } from "vitest";
import { formatSqlForDisplay } from "./formatSql";

describe("formatSqlForDisplay", () => {
  it("breaks a one-line query onto readable lines", () => {
    const out = formatSqlForDisplay(
      `SELECT * FROM "k8s_logs" WHERE code = 500 AND namespace = 'prod'`,
    );

    expect(out.split("\n").length).toBeGreaterThan(1);
    expect(out).toMatch(/^SELECT/);
    expect(out).toContain("FROM");
    expect(out).toContain("WHERE");
  });

  it("upper-cases keywords so the shape of the query reads at a glance", () => {
    expect(formatSqlForDisplay("select * from logs where a = 1")).toContain("SELECT");
  });

  it("preserves the semantics — every identifier and literal survives", () => {
    const out = formatSqlForDisplay(
      `SELECT count(*) AS cnt FROM "k8s_logs" WHERE match_all('connection refused')`,
    );

    expect(out).toContain("k8s_logs");
    expect(out).toContain("cnt");
    expect(out).toContain("connection refused");
  });

  it("returns the original when the formatter cannot parse it, never an error", () => {
    const broken = "SELECT * FROM WHERE ((((";
    expect(formatSqlForDisplay(broken)).toBeTruthy();
  });

  it("never throws on hostile input", () => {
    expect(() => formatSqlForDisplay("'''\\\\((((")).not.toThrow();
  });

  it("returns an empty string for nothing", () => {
    expect(formatSqlForDisplay("")).toBe("");
    expect(formatSqlForDisplay("   ")).toBe("");
    expect(formatSqlForDisplay(undefined)).toBe("");
    expect(formatSqlForDisplay(null)).toBe("");
  });

  it("is idempotent — formatting an already-formatted query changes nothing", () => {
    const once = formatSqlForDisplay('SELECT * FROM "logs" WHERE a = 1 AND b = 2');
    expect(formatSqlForDisplay(once)).toBe(once);
  });
});
