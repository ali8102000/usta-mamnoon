import Constants from "expo-constants";

export type MamnoonAppVariant = "customer" | "worker" | "driver" | "large_driver";

const configuredVariant = Constants.expoConfig?.extra?.appVariant;
export const APP_VARIANT: MamnoonAppVariant =
  configuredVariant === "worker" ||
  configuredVariant === "driver" ||
  configuredVariant === "large_driver"
    ? configuredVariant
    : "customer";

export const REQUIRED_APP_ROLE = APP_VARIANT;

const privilegedRoles = new Set([
  "admin",
  "super_admin",
  "support",
  "finance",
  "moderator",
]);

export function isRoleAllowedInApp(role: string): boolean {
  return role === REQUIRED_APP_ROLE || privilegedRoles.has(role);
}

export function filterRolesForApp(roles: string[]): string[] {
  return roles.filter(isRoleAllowedInApp);
}

export function getInitialRoleForApp(roles: string[]): string | null {
  const allowed = filterRolesForApp(roles);
  if (allowed.includes(REQUIRED_APP_ROLE)) return REQUIRED_APP_ROLE;
  for (const role of ["super_admin", "admin", "support", "finance", "moderator"]) {
    if (allowed.includes(role)) return role;
  }
  return null;
}
