import { describe, expect, test } from "bun:test";
import { encodeRfqV1, specificationDescription } from "../../shared/rfq";

describe("RFQ v1 specification", () => {
  test("trims descriptions and stores exactly the JCS v1 bytes", () => {
    expect(encodeRfqV1(" \t Verify a business.\n")).toBe('{"description":"Verify a business.","schemaVersion":"unmet-rfq-v1"}');
    expect(encodeRfqV1("Verify a business.")).toBe(encodeRfqV1("\u00a0Verify a business.\u00a0"));
    expect(encodeRfqV1('é 🧪\n"\\')).toBe('{"description":"é 🧪\\n\\"\\\\","schemaVersion":"unmet-rfq-v1"}');
    expect(encodeRfqV1("é")).not.toBe(encodeRfqV1("e\u0301"));
  });

  test.each(["", " \t\r\n", "\ud800", "\udfff", "a\ufdd0", "a\uffff", "a\u{10ffff}"])("rejects empty or invalid Unicode %j", (value) => {
    expect(() => encodeRfqV1(value)).toThrow("DEMAND_INVALID_SPEC");
  });

  test("bounds the serialized UTF-8 bytes, including escaping and metadata", () => {
    for (const value of ["a".repeat(1999), "🧪".repeat(499) + "abc", '"'.repeat(999) + "a"]) {
      expect(new TextEncoder().encode(encodeRfqV1(value)).length).toBe(2048);
      expect(() => encodeRfqV1(value + "a")).toThrow("DEMAND_INVALID_SPEC");
    }
    expect(encodeRfqV1(" " + "a".repeat(1999) + " ")).toBe(encodeRfqV1("a".repeat(1999)));
  });

  test("presents v1 description while retaining opaque legacy and future specifications", () => {
    expect(specificationDescription(encodeRfqV1("Readable description"))).toBe("Readable description");
    for (const raw of ["  historical prose  ", "{broken", '{"description":"other"}',
      '{"schemaVersion":"unmet-rfq-v2","description":"future"}',
      '{"schemaVersion":"unmet-rfq-v1","description":"v1","extra":true}',
      '{"schemaVersion":"unmet-rfq-v1","description":" "}', "[]", "null"]) {
      expect(specificationDescription(raw)).toBe(raw);
    }
  });
});
