# Slab Engraving Studio

The live studio is `public/studio.html` in the app (served at `/studio`); its label engine is `public/slab/label.js`, shared with the public cert page `public/slabview.html` (`/v/<cert>`).

`SlabSense-Engraving-Studio.html` in this folder is the last self-contained offline build and is kept as a fallback only — do not edit it; change `public/slab/*` and run `npm run verify:label`.
