import canonicalize from "canonicalize";

export function encodeRfqV1(description: string): string {
  description = description.trim();
  if (!description) throw new Error("DEMAND_INVALID_SPEC");
  for (const character of description) {
    const point = character.codePointAt(0)!;
    if ((point >= 0xd800 && point <= 0xdfff) || (point >= 0xfdd0 && point <= 0xfdef) || (point & 0xfffe) === 0xfffe) {
      throw new Error("DEMAND_INVALID_SPEC");
    }
  }
  const specification = canonicalize({ schemaVersion: "unmet-rfq-v1", description });
  if (specification === undefined || new TextEncoder().encode(specification).length > 2048) throw new Error("DEMAND_INVALID_SPEC");
  return specification;
}

export function specificationDescription(specification: string): string {
  try {
    const value: unknown = JSON.parse(specification);
    if (typeof value === "object" && value !== null && !Array.isArray(value) &&
        Object.keys(value).length === 2 && "schemaVersion" in value && value.schemaVersion === "unmet-rfq-v1" &&
        "description" in value && typeof value.description === "string") {
      encodeRfqV1(value.description);
      return value.description;
    }
  } catch { /* Historical specifications remain opaque text. */ }
  return specification;
}
