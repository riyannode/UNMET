const CAPABILITY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeCapability(value: string): string {
  const capability = value.trim().toLowerCase().replace(/\s+/g, "-");
  if (!CAPABILITY_PATTERN.test(capability) || capability.length > 64) throw new Error("DEMAND_INVALID_CAPABILITY");
  return capability;
}
