// Whether the signed-in user has bought the full character set.
// Always false until checkout is connected; then this reads the user's purchase record.
export function useFullExport(): { full: boolean; checkoutReady: boolean } {
  return { full: false, checkoutReady: false };
}
