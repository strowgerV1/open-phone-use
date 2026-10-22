# Visual QA · STROWGER rebrand

final result: passed

## Archive publiée

Ce dossier contient **79 captures et planches historiques récupérées** de la campagne du 22 octobre, ainsi que le rapport initial ci-dessous. Certaines images historiques ne sont pas présentes dans cette archive ; cela ne concerne pas les ressources du site, toutes incluses dans `site/`. Le rapport décrit la campagne complète initialement réalisée.


Scope: faithful marketing-page rebrand of https://www.phoneuse.com/ with user-confirmed reuse permission. This is a visual prototype, not proof of a commercial phone fleet. Source: 22 October 2026. Firecrawl map/crawl collected four public domain pages and full-page desktop/mobile captures; authenticated console and documentation subdomain were not exhaustively captured.

## Evidence

Evidence package: this directory (`docs/visual-review/`). Three side-by-side comparison sheets cover all twelve marketing sections, plus individual source/clone frames in `frames/`. Three frames per section per implementation (72 paired-state captures). Early captures were discarded when the viewport or smooth-scroll position was inconsistent.

Desktop: both pages 1280 × 720 CSS pixels, both captures 1280 × 720 pixels; density 1. No resizing for comparison. Animation phase differs because both pages run their own clocks.

Mobile: source and clone each inside a 390 × 844 CSS-pixel iframe in the same IAB browser, captured within the 1280 × 720 outer viewport and cropped to the same 390 × 720 visible region. `compare-mobile-matched.jpg` places both together. The separate Firecrawl mobile screenshot is 390 × 21143 pixels; it was not treated as a pixel-exact comparison because its effective layout differed from the desktop browser's mobile-width frame. Actual iOS/Android device testing has not been performed.

## Fidelity surfaces

- **Fonts/typography:** Season Mix Medium locally served; Host Grotesk and Geist Mono locally served, plus Gochi Hand for annotations. H1 computed values match: 84.24px, weight 500, line height 80.8704px, letter spacing -3.3696px; rectangle x=60, y=158.3984375, w=600, h=242.6015625 at 1280×720. Focused hero screenshots support the measurement. Mobile compared again after font loading; an initial fallback-font capture was rejected.
- **Spacing/layout:** original grids, padding, widths, responsive rules, radii, shadows and sticky stages retained. P2 found in booking: local iframe 627.3px vs source widget 490px, shifting closing section 137px. Fixed to 490px with display:block; inspected the corrected block. Text-length shifts in rebranded labels are intentional.
- **Colors/tokens:** source CSS token values retained, including #F2F1EC paper, #121314 ink and #FF4F14 signal orange. Light and dark theme states tested.
- **Assets:** original local GLB and Draco decoder, source image assets, original locally served fonts and source sprites retained. Three.js and associated licenses retained. Three demonstration videos served locally; Instagram video re-encoded to 1280px H.264 for hosting size. Image/canvas assets are not replaced with approximate CSS drawings. The hidden 3D rack requires its manifest and 114 image assets; they were collected and the loaded rack was visually verified.
- **Copy/content:** PhoneUse name changed to STROWGER. Prices, claimed fleet and capabilities remain reference prototype content, explicitly labelled as illustrative. Signup and docs links point to the local reproduction guide. Copy-setup prompt installs the actual local runtime. Code API/install examples use local STROWGER commands; MCP adapter is explicitly not implemented. Third-party booking is replaced by a non-submitting local demonstration; exact fidelity of that external service is excluded. No account purchase, booking, payment or real phone control is connected to the marketing page.

## Interaction checks

Observed and tested: three scroll frames per marketing section; hero camera transition; phone screen animations; component Camera selection; MCP/API/CLI tab switching; monthly/per-minute toggle (same $0.024 illustrative state); FAQ expansion; light/dark theme; mobile menu; hidden rack open and exit. Rack room screenshot saved after its loading/transition, not just its x-ray intermediary. Console checks returned no errors/warnings in the tested local path. Full touch-device behavior and all sixteen moving app-card targets have not been individually exercised.

## Comparison history

1. Blocked: mismatched source viewport 717×805 versus clone 1280×720. Opened a fresh source tab at the matching viewport and recaptured.
2. Blocked: smooth-scroll screenshots caught intermediate transitions. Added read-only scroll-position stability checks and recaptured the twelve sections.
3. Blocked: booking widget height caused a 137px downstream offset. Applied the 490px source height and removed inline baseline spacing; recaptured the corrected booking block.
4. Blocked: mobile screenshot taken before local font/reveal completion. Captured again after loading and compared both 390px frames together.
5. Passed for the visual-prototype scope: no remaining actionable P0/P1/P2 difference in the reviewed main-page surfaces, apart from the documented deliberate branding, notice, sample-code and booking-provider changes.

## Follow-up polish / limits

- Continuous animations cannot be pixel-diffed at independent wall-clock phases; compare geometry rather than transient text/phone-screen content.
- Hidden rack's pre-rendered screen textures are source snapshots and can still contain PhoneUse content. They are source assets, not STROWGER service evidence.
- Mobile QA is viewport-based, not device certification. CPU/GPU quality tiers and reduced-motion paths are inherited but not exhaustively tested across hardware.
- Backend readiness is evaluated independently in the Python tests and product documentation.
