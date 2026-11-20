# Roadmap

- [x] iPad template format (2048×2732, bigger boxes) on Template + Upload pages
- [x] Draw page: Apple Pencil pad with metric guides, character sheet, live preview, export link
- [x] Gallery for iPad: bigger cards, swipeable previews (Swipe / Grid)
- [x] Header + home links, tests, AGENTS.md

## Studio grid + accounts + paid export
- [x] Character grid page (A–Z, a–z, 0–9, punctuation) → tile opens drawing canvas, save updates thumbnail + live preview
- [x] Lovable Cloud: sign-in (email, Google, Apple), font_projects table (stroke JSON per user), save/load
- [x] "Download .OTF": free = A–M only; full set requires upgrade
- [x] Tamil sets on the Grid page
- [ ] Stripe Checkout for upgrade — $9 one-time; Pro active and payments connected, product creation blocked by regional search restriction until owner claims payment account
- [x] Profiles: display name + avatar per account (profile table, photo upload, edit in account menu)

## Payments and Tamil correctness
- [ ] Live payments — account claim and verification by workspace owner
- [x] Fit Tamil signs and syllable guides inside Grid tiles and drawing pads
- [x] Verify க, கா, கி, கீ, கு, கூ, கெ, கே, கை, கொ, கோ, கௌ shaping in exported fonts (24 real HarfBuzz OTF/TTF tests)

## Purchase and account audit
- [ ] Document current catalog, sign-in, account update, save, entitlement and billing flows with gaps
- [ ] Apply shared download limits and validation to every font download entry point
- [ ] Fix account save isolation and profile update reliability
- [ ] Add self-service email and password changes (confirmed); no account deletion or data export requested
- [ ] Payment fulfillment must revoke future full downloads on full refund or dispute — blocked with catalog setup
- [ ] Provide preview test checklist, including successful and declined test cards
