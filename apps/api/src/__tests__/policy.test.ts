import { describe, it, expect } from "vitest";
import { isSafeQuery } from "../lib/policy.js";

describe("isSafeQuery", () => {
  it("allows SELECT statements", () => {
    expect(isSafeQuery("SELECT * FROM orders")).toBe(true);
    expect(isSafeQuery("SELECT id, name FROM customers LIMIT 10")).toBe(true);
  });

  it("allows SELECT with semicolon at end", () => {
    expect(isSafeQuery("SELECT 1;")).toBe(true);
  });

  it("blocks INSERT", () => {
    expect(isSafeQuery("INSERT INTO orders VALUES (1, 2)")).toBe(false);
  });

  it("blocks UPDATE", () => {
    expect(isSafeQuery("UPDATE orders SET status = 'done'")).toBe(false);
  });

  it("blocks DELETE", () => {
    expect(isSafeQuery("DELETE FROM orders")).toBe(false);
  });

  it("blocks DROP", () => {
    expect(isSafeQuery("DROP TABLE orders")).toBe(false);
  });

  it("blocks CREATE", () => {
    expect(isSafeQuery("CREATE TABLE foo (id INT)")).toBe(false);
  });

  it("blocks multiple statements", () => {
    expect(isSafeQuery("SELECT 1; DROP TABLE orders")).toBe(false);
  });

  it("blocks TRUNCATE", () => {
    expect(isSafeQuery("TRUNCATE TABLE orders")).toBe(false);
  });
});
