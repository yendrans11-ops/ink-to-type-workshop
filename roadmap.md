# Roadmap

## Drawing finish and testing access
- [x] Keep nib/style/smoothing between characters and pages
- [x] Smooth Pencil input and add brush/calligraphy pens with matching exports
- [x] Enable free full English/Tamil exports during testing; defer payments until build completion
- [x] Verify drawing navigation and full downloads

- [x] iPad template format (2048×2732, bigger boxes) on Template + Upload pages
- [x] Draw page: Apple Pencil pad with metric guides, character sheet, live preview, export link
- [x] Gallery for iPad: bigger cards, swipeable previews (Swipe / Grid)
- [x] Header + home links, tests, AGENTS.md

## Studio grid + accounts + paid export
- [x] Character grid page (A–Z, a–z, 0–9, punctuation) → tile opens drawing canvas, save updates thumbnail + live preview
- [x] Lovable Cloud: sign-in (email, Google, Apple), font_projects table (stroke JSON per user), save/load
- [x] "Download .OTF": free = A–M only; full set requires upgrade
- [x] Tamil sets on the Grid page
- [ ] Future payments — deferred by user until the full build is finished; free full exports enabled for testing
- [x] Profiles: display name + avatar per account (profile table, photo upload, edit in account menu)

## Payments and Tamil correctness
- [ ] Future live payments — deferred until build completion, then owner claim/verification required
- [x] Fit Tamil signs and syllable guides inside Grid tiles and drawing pads
- [x] Verify க, கா, கி, கீ, கு, கூ, கெ, கே, கை, கொ, கோ, கௌ shaping in exported fonts (24 real HarfBuzz OTF/TTF tests)

## Purchase and account audit
- [x] Document current catalog, sign-in, account update, save, entitlement and billing flows with gaps
- [x] Apply shared download limits and validation to every font download entry point
- [x] Fix account save isolation and profile update reliability
- [x] Add self-service email and password changes (confirmed); no account deletion or data export requested
- [ ] Verify email/password changes end-to-end — temporary account password setup returned an account-service Internal Server Error; email confirmation requires mailbox access
- [ ] Future payment fulfillment/refund access — deferred with payments until build completion
- [x] Provide preview test checklist, including successful and declined test cards
