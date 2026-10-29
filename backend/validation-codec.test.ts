import { expect, test } from "bun:test";
import { canonicalJSON, hashJSON, parseStrictJSON, parseUint256 } from "./validation-codec";
import fixture from "./fixtures/validation.json";

const bytes = (text: string) => new TextEncoder().encode(text);
test("strict JSON rejects duplicate decoded keys, Unicode, invalid syntax and unsafe numbers", () => {
  for (const input of [
    '{"a":1,"a":1}', '{"x":{"a":1,"a":1}}', '{"a":1,"\\u0061":1}', '[{"a":1,"a":1}]',
    '{"\\ud800":1}', '{"\\ufdd0":1}', '{"\\udbff\\udfff":1}', '{"\ufdef":1}',
    '"\\ud800"', '"\\udc00"', '"\\ufdd0"', '"\\udbff\\udfff"',
    '{/*x*/"a":1}', '[1,]', '{} trailing', 'NaN', '1e999', '1e-999', '9007199254740992', '1.0000000000000001',
    '[[[[[[[[[]]]]]]]]]',
  ]) expect(() => parseStrictJSON(bytes(input))).toThrow();
  expect(() => parseStrictJSON(new Uint8Array([0xc3, 0x28]))).toThrow();
  expect(parseStrictJSON(bytes('"\\ud83d\\ude00"'))).toBe("😀");
  expect(parseStrictJSON(bytes('{"\\ud83d\\ude00":1}'))).toEqual({ "😀": 1 });
  expect(() => parseStrictJSON(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]))).toThrow();
  expect(parseStrictJSON(bytes('[[[[[[[[]]]]]]]]'))).toEqual([[[[[[[[]]]]]]]]);
  expect(() => parseStrictJSON(bytes(`"${"a".repeat(32766)}"`))).not.toThrow();
  expect(() => parseStrictJSON(bytes(`"${"a".repeat(32767)}"`))).toThrow();
  expect(Object.hasOwn(parseStrictJSON(bytes('{"__proto__":1}')) as object, "__proto__")).toBe(true);
  expect(canonicalJSON(parseStrictJSON(bytes('{"__proto__":{"constructor":1}}')))).toBe('{"__proto__":{"constructor":1}}');
});
test("JCS emits published literals and UTF-16 ordering, escapes and number forms", () => {
  expect<string>(hashJSON(fixture.request)).toBe(fixture.expected.requestHash);
  expect<string>(hashJSON(fixture.payment)).toBe(fixture.expected.paymentRequirementsHash);
  expect<string>(hashJSON(fixture.policy)).toBe(fixture.expected.validationPolicyId);
  expect(canonicalJSON({ "\ue000": 1, "😀": 2, a: -0, z: 1e30, s: "\n\"\\" })).toBe('{"a":0,"s":"\\n\\\"\\\\","z":1e+30,"😀":2,"\ue000":1}');
  expect(hashJSON({ b: 2, a: 1 })).toBe(hashJSON({ a: 1, b: 2 }));
  expect(hashJSON([1, 2])).not.toBe(hashJSON([2, 1]));
  expect(() => canonicalJSON("\ud800")).toThrow();
  expect(() => canonicalJSON(new Date(0))).toThrow();
  expect(() => canonicalJSON({ nested: new Date(0) })).toThrow();
  const nullPrototype = Object.create(null); Object.assign(nullPrototype, { a: 1 });
  expect(canonicalJSON(nullPrototype)).toBe('{"a":1}');
});
test("RFC 8785 Appendix B numeric serialization literals", () => {
  for (const [value, expected] of [
    [-0, "0"], [5e-324, "5e-324"], [-5e-324, "-5e-324"],
    [1e23, "1e+23"], [1e21, "1e+21"], [1e-6, "0.000001"], [1e-7, "1e-7"],
    [333333333.33333329, "333333333.3333333"],
  ] as const) expect(canonicalJSON(value)).toBe(expected);
  expect(() => parseStrictJSON(bytes("1e23"))).toThrow();
  expect(() => parseStrictJSON(bytes("333333333.33333329"))).toThrow();
});
test("uint256 requires canonical decimal and bounds", () => {
  expect(parseUint256((2n ** 256n - 1n).toString())).toBe(2n ** 256n - 1n);
  for (const value of ["", "01", "-1", (2n ** 256n).toString()]) expect(() => parseUint256(value)).toThrow();
});
