import { tenantIds } from "@nymbus/shared";

export function createTenantPicker(
  tenantCount: number,
  hotTenantFraction: number,
  hotTenantRatio: number,
  random: () => number = Math.random,
): { pick: () => string; hotTenants: ReadonlySet<string>; tenants: readonly string[] } {
  const tenants = tenantIds(tenantCount);
  const hotTenantCount = Math.max(1, Math.floor(tenants.length * hotTenantFraction));
  const hotTenants = new Set(tenants.slice(0, hotTenantCount));
  const hotPool = [...hotTenants];
  const coldPool = tenants.filter((tenant) => !hotTenants.has(tenant));

  const pick = (): string => {
    const preferredPool = random() < hotTenantRatio ? hotPool : coldPool;
    const pool = preferredPool.length > 0 ? preferredPool : tenants;
    return pool[Math.floor(random() * pool.length)];
  };

  return { pick, hotTenants, tenants };
}
