import { describe, it, expect } from "vitest";
import { getRole, maskRows } from "../lib/auth.js";

describe("getRole", () => {
  it("defaults to user when header is missing", () => {
    expect(getRole({})).toBe("user");
  });

  it("returns the role from x-trace-role header", () => {
    expect(getRole({ "x-trace-role": "admin" })).toBe("admin");
  });
});

describe("maskRows", () => {
  const columns = [
    { name: "id", type: "integer" },
    { name: "name", type: "varchar" },
    { name: "amount", type: "numeric" }
  ];
  const rows = [
    [1, "Alice", 100],
    [2, "Bob", 200]
  ];

  it("does not mask for admin role", () => {
    expect(maskRows(columns, rows, "admin")).toEqual(rows);
  });

  it("masks only specified columns for non-admin", () => {
    const result = maskRows(columns, rows, "user", ["name"]);
    expect(result[0][1]).toBe("***");
    expect(result[0][0]).toBe(1);
    expect(result[0][2]).toBe(100);
  });

  it("uses env mask list when columnsToMask omitted", () => {
    const result = maskRows(columns, rows, "user");
    expect(result[0][1]).toBe("***");
  });
});
