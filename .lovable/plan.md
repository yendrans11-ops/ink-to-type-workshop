# Purchase and account flow repair

## Findings
- The workspace is already Pro. Built-in payments are connected in test mode, but the account is unclaimed. Creating the $9 product fails because catalog search is unavailable for this regional account.
- Grid applies the free-letter limit, but Export and Gallery do not. Grid skips pre-export validation and Gallery skips explicit warning acknowledgement.
- No checkout, purchase ledger, verified fulfillment, entitlement, refund/dispute handler or receipt history exists yet. The offer is one-time, so renewal periods and subscription cancellation are not applicable.
- Email, Google and Apple are enabled; signup is enabled, email confirmation is required, anonymous signup is disabled. Profile and font-project owner policies are present and the database linter is clean.
- Scheduled cloud saves can use a different account/project than the edit that scheduled them. Profile refreshes can reset unsaved edits; avatar replacements leave old files behind.
- Users lack self-service email/password changes. Recovery initialization can miss its event. Scanned projects lose their source tiles when saved to an account.

## Implement now
1. Use one tier-aware, preflight-aware download flow for Grid, Export and Gallery in both formats. Block errors and explicitly acknowledge warnings.
2. Bind and serialize cloud saves to the original account and project snapshot. Key font caches by account and clear private caches on identity changes.
3. Preserve scanned source tiles in cloud JSON and validate saved stroke/source inputs before loading.
4. Keep profile drafts stable, clean up replaced/failed avatar uploads, and handle sign-out failures.
5. Add signed-in email changes with confirmation and password changes with current password. Initialize recovery state in the single root auth listener.
6. Add regression tests and verify drawing, downloads, profile editing and account saves in the preview.

## Payment implementation held
After the owner claims the payment account and product creation succeeds, create the single $9 account-wide product, authenticated embedded checkout, environment-separated purchase/entitlement records, signed idempotent payment fulfillment and reconciliation. Full refunds or disputes revoke future full downloads. In India use tax calculation/collection only; the seller handles filing/remittance. Test payment completion, decline, duplicate events and revocation before live onboarding and publishing.

## Technical boundary
Browser previews already contain full generated fonts. Consistent download controls cannot make locally available font bytes tamper-proof. Strict paid asset protection would require changing the preview/export architecture; do not imply these client controls provide it.

## Implemented and verified
- Shared limits/preflight across Grid, Export and Gallery; actual downloaded OTF files include drawn A and exclude drawn N and Tamil.
- Immutable serial cloud-save queue, account-scoped caches, scan source preservation, profile draft stability and avatar cleanup.
- Account settings forms for email/password updates and root-owned recovery state.
- Signed-in browser verification passed profile/photo update and reload, cloud font save/reopen, warning-confirmed downloads on all three pages, and sign-out. No runtime errors.
- All 116 font tests passed and the preview reports build OK.
- Password update end-to-end remains unverified: initial password setup on the temporary test account returned Internal Server Error. Email confirmation and Google/Apple sign-in end-to-end remain unverified; mailbox/provider interaction is required.
- Checkout, receipts, verified entitlement fulfillment and refund/dispute revocation are still blocked by payment-account claim/catalog setup. No payment was taken and no paid access was fabricated.

## Preview testing
Test a free download containing A and excluding N/Tamil on all download pages; errors must block and warnings must require confirmation. Save/reopen a drawn and a scanned project. Edit name/photo and reload. Change password, then sign out/in. Change email and confirm emailed links. After checkout is enabled, use 4242 4242 4242 4242 with a future expiry and any three-digit CVC; use 4000 0000 0000 0002 for decline. Never use a real card in test mode. Verify full Tamil download remains unlocked after refresh and is revoked after a full test refund/dispute.