import { visit } from "jsonc-parser";

export type JSONValue = null | boolean | number | string | JSONValue[] | JSONObject;
export type JSONObject = { [key: string]: JSONValue };

function validString(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    let point = unit;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = value.charCodeAt(++i);
      if (!(low >= 0xdc00 && low <= 0xdfff)) return false;
      point = 0x10000 + ((unit - 0xd800) << 10) + low - 0xdc00;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
    if ((point >= 0xfdd0 && point <= 0xfdef) || (point & 0xfffe) === 0xfffe) return false;
  }
  return true;
}

function isJSON(value: unknown): value is JSONValue {
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "string") return validString(value);
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJSON);
  if (typeof value === "object") {
    const prototype: unknown = Object.getPrototypeOf(value);
    return (prototype === Object.prototype || prototype === null) &&
      Object.entries(value).every(([key, item]) => validString(key) && isJSON(item));
  }
  return false;
}

function decimalIdentity(value: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!match) throw new Error("number");
  const digits = (match[2] + (match[3] ?? "")).replace(/^0+/, "");
  if (!digits) return "0";
  const trimmed = digits.replace(/0+$/, "");
  const exponent = BigInt(match[4] ?? "0") - BigInt((match[3] ?? "").length) + BigInt(digits.length - trimmed.length);
  return `${match[1]}${trimmed}e${exponent}`;
}

export function parseStrictJSON(raw: Uint8Array, maxDepth = 8): JSONValue {
  if (raw.byteLength > 32768) throw new Error("INVALID_JSON");
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw);
    const keys: Set<string>[] = [];
    let depth = 0;
    visit(text, {
      onObjectBegin() { if (++depth > maxDepth) throw new Error("depth"); keys.push(new Set()); },
      onObjectEnd() { depth--; keys.pop(); },
      onArrayBegin() { if (++depth > maxDepth) throw new Error("depth"); },
      onArrayEnd() { depth--; },
      onObjectProperty(key) {
        const current = keys[keys.length - 1];
        if (!current || current.has(key) || !validString(key)) throw new Error("key");
        current.add(key);
      },
      onLiteralValue(value: unknown, offset, length) {
        if (typeof value === "string" && !validString(value)) throw new Error("string");
        if (typeof value === "number") {
          const literal = text.slice(offset, offset + length);
          if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)) ||
              decimalIdentity(literal) !== decimalIdentity(String(value))) throw new Error("number");
        }
      },
      onError() { throw new Error("syntax"); },
    }, { disallowComments: true, allowTrailingComma: false });
    const result: unknown = JSON.parse(text);
    if (!isJSON(result)) throw new Error("value");
    return result;
  } catch {
    throw new Error("INVALID_JSON");
  }
}
