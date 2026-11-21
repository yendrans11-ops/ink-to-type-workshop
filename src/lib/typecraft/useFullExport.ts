// Build-testing access only; not a payment or a purchased entitlement.
export const FULL_EXPORT_TESTING = true;
export function useFullExport(): { full: boolean; checkoutReady: boolean } {
  return { full: FULL_EXPORT_TESTING, checkoutReady: false };
}
