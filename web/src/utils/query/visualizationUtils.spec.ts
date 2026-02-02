// Copyright 2023 OpenObserve Inc.
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
import { allSelectionFieldsHaveAlias } from "./visualizationUtils";

describe("visualizationUtils", () => {
  describe("allSelectionFieldsHaveAlias", () => {
    it("should return true for simple field selections without aliases", () => {
      const sql = "SELECT name, age FROM users";
      const result = allSelectionFieldsHaveAlias(sql);
      expect(result).toBe(true);
    });

    it("should return true when all function expressions have aliases", () => {
      const sql = "SELECT COUNT(*) as total_count, AVG(age) as average_age FROM users";
      const result = allSelectionFieldsHaveAlias(sql);
      expect(result).toBe(true);
    });

    it("should return false when function expressions don't have aliases", () => {
      const sql = "SELECT COUNT(*), AVG(age) FROM users";
      const result = allSelectionFieldsHaveAlias(sql);
      expect(result).toBe(false);
    });

    it("should return true for mixed simple fields and aliased functions", () => {
      const sql = "SELECT name, COUNT(*) as total FROM users GROUP BY name";
      const result = allSelectionFieldsHaveAlias(sql);
      expect(result).toBe(true);
    });

    it("should return false for invalid SQL", () => {
      const sql = "INVALID SQL QUERY";
      const result = allSelectionFieldsHaveAlias(sql);
      expect(result).toBe(false);
    });

    it("should return false for non-SELECT statements", () => {
      const sql = "INSERT INTO users (name) VALUES ('John')";
      const result = allSelectionFieldsHaveAlias(sql);
      expect(result).toBe(false);
    });

    it("should return false for empty column list", () => {
      const sql = "SELECT FROM users";
      const result = allSelectionFieldsHaveAlias(sql);
      expect(result).toBe(false);
    });

    it("should handle UNION queries correctly when all have aliases", () => {
      const sql = "SELECT name, COUNT(*) as total FROM users GROUP BY name UNION SELECT department, COUNT(*) as dept_total FROM employees GROUP BY department";
      const result = allSelectionFieldsHaveAlias(sql);
      expect(result).toBe(true);
    });

    it("should return false for UNION queries when some lack aliases", () => {
      const sql = "SELECT name, COUNT(*) FROM users GROUP BY name UNION SELECT department, COUNT(*) as dept_total FROM employees GROUP BY department";
      const result = allSelectionFieldsHaveAlias(sql);
      expect(result).toBe(false);
    });

    it("should handle subqueries with aliases", () => {
      const sql = "SELECT u.name, u.total FROM (SELECT name, COUNT(*) as total FROM users GROUP BY name) as u";
      const result = allSelectionFieldsHaveAlias(sql);
      expect(result).toBe(true);
    });

    it("should handle complex expressions with aliases", () => {
      const sql = "SELECT CASE WHEN age > 18 THEN 'adult' ELSE 'minor' END as age_category FROM users";
      const result = allSelectionFieldsHaveAlias(sql);
      expect(result).toBe(true);
    });

    it("should return false for complex expressions without aliases", () => {
      const sql = "SELECT CASE WHEN age > 18 THEN 'adult' ELSE 'minor' END FROM users";
      const result = allSelectionFieldsHaveAlias(sql);
      expect(result).toBe(false);
    });

    it("should handle mathematical expressions with aliases", () => {
      const sql = "SELECT price * quantity as total_amount FROM orders";
      const result = allSelectionFieldsHaveAlias(sql);
      expect(result).toBe(true);
    });

    it("should return false for mathematical expressions without aliases", () => {
      const sql = "SELECT price * quantity FROM orders";
      const result = allSelectionFieldsHaveAlias(sql);
      expect(result).toBe(false);
    });

    it("should handle SELECT * queries", () => {
      const sql = "SELECT * FROM users";
      const result = allSelectionFieldsHaveAlias(sql);
      expect(result).toBe(true);
    });

    it("should handle empty string input", () => {
      const sql = "";
      const result = allSelectionFieldsHaveAlias(sql);
      expect(result).toBe(false);
    });

    it("should handle whitespace-only input", () => {
      const sql = "   \n\t  ";
      const result = allSelectionFieldsHaveAlias(sql);
      expect(result).toBe(false);
    });

    it("should handle aggregation functions with GROUP BY", () => {
      const sql = "SELECT department, MIN(salary) as min_salary, MAX(salary) as max_salary FROM employees GROUP BY department";
      const result = allSelectionFieldsHaveAlias(sql);
      expect(result).toBe(true);
    });

    it("should return false when mixing aliased and non-aliased aggregations", () => {
      const sql = "SELECT department, MIN(salary), MAX(salary) as max_salary FROM employees GROUP BY department";
      const result = allSelectionFieldsHaveAlias(sql);
      expect(result).toBe(false);
    });

    it("should handle date functions with aliases", () => {
      const sql = "SELECT DATE_FORMAT(created_at, '%Y-%m') as month FROM logs";
      const result = allSelectionFieldsHaveAlias(sql);
      expect(result).toBe(true);
    });

    it("should return false for date functions without aliases", () => {
      const sql = "SELECT DATE_FORMAT(created_at, '%Y-%m') FROM logs";
      const result = allSelectionFieldsHaveAlias(sql);
      expect(result).toBe(false);
    });

    it("should handle string functions with aliases", () => {
      const sql = "SELECT UPPER(name) as uppercase_name, LENGTH(description) as desc_length FROM items";
      const result = allSelectionFieldsHaveAlias(sql);
      expect(result).toBe(true);
    });

    it("should handle window functions with aliases", () => {
      const sql = "SELECT name, ROW_NUMBER() OVER (ORDER BY salary DESC) as rank FROM employees";
      const result = allSelectionFieldsHaveAlias(sql);
      expect(result).toBe(true);
    });

    it("should return false when AST contains null or undefined columns", () => {
      // This test targets the uncovered lines 24-25 in columnsHaveAlias function
      const sql = "SELECT";
      const result = allSelectionFieldsHaveAlias(sql);
      expect(result).toBe(false);
    });

    it("should return false for SELECT with empty columns array", () => {
      // Target the empty array case in columnsHaveAlias function (lines 24-25)
      // Need to force a scenario where columns is an empty array
      const sql = "SELECT FROM users WHERE 1=0";
      const result = allSelectionFieldsHaveAlias(sql);
      expect(result).toBe(false);
    });

    it("should handle malformed SELECT statements with no column list", () => {
      // Another attempt to trigger the empty/null columns case
      const sql = "SELECT WHERE 1=1";
      const result = allSelectionFieldsHaveAlias(sql);
      expect(result).toBe(false);
    });

    it("should handle SELECT statements with various edge cases", () => {
      // Test multiple edge cases that might trigger the uncovered lines
      const edgeCases = [
        "",  // empty string
        "   ",  // whitespace only
        "SELECT;",  // bare SELECT with semicolon
        "SELECT\n",  // SELECT with newline
        "SELECT FROM",  // incomplete SELECT FROM
      ];
      
      edgeCases.forEach(sql => {
        const result = allSelectionFieldsHaveAlias(sql);
        expect(result).toBe(false);
      });
    });

    it("should return false for UNION with malformed second SELECT (line 73)", () => {
      // Target line 73: if (!node || node?.type !== "select") return false;
      // This occurs when a UNION has a malformed second part
      const sql = "SELECT name as n FROM users UNION INSERT INTO test VALUES (1)";
      const result = allSelectionFieldsHaveAlias(sql);
      expect(result).toBe(false);
    });

    it("should return false for complex expressions without aliases (line 12)", () => {
      // Target line 12: return column?.expr?.type === 'column_ref';
      // This tests when column has expr property but type is NOT 'column_ref'
      // Complex expressions like functions should require aliases
      const sql = "SELECT COUNT(*), SUM(price), AVG(rating) FROM products";
      const result = allSelectionFieldsHaveAlias(sql);
      expect(result).toBe(false);
    });
  });
});