import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { resolveArchiveSales } from "@/lib/api/process-queue-options";

describe("resolveArchiveSales", () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
    delete process.env.FORCE_SALES_ARCHIVE;
    delete process.env.SKIP_SALES_ARCHIVE;
  });

  afterEach(() => {
    process.env = env;
  });

  it("returns true for archive_sales=1 query param", () => {
    const req = new Request("http://localhost/api/webhooks/process-queue?archive_sales=1");
    expect(resolveArchiveSales(req)).toBe(true);
  });

  it("returns false for archive_sales=0 query param", () => {
    const req = new Request("http://localhost/api/webhooks/process-queue?archive_sales=0");
    expect(resolveArchiveSales(req)).toBe(false);
  });

  it("returns true when x-archive-sales header is set", () => {
    const req = new Request("http://localhost/api/webhooks/process-queue", {
      headers: { "x-archive-sales": "1" },
    });
    expect(resolveArchiveSales(req)).toBe(true);
  });

  it("returns undefined when no override is provided", () => {
    const req = new Request("http://localhost/api/webhooks/process-queue");
    expect(resolveArchiveSales(req)).toBeUndefined();
  });

  it("respects FORCE_SALES_ARCHIVE env", () => {
    process.env.FORCE_SALES_ARCHIVE = "true";
    const req = new Request("http://localhost/api/webhooks/process-queue");
    expect(resolveArchiveSales(req)).toBe(true);
  });
});
