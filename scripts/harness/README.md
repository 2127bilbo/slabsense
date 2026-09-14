# Software Grade harness

Scores the client-side Software Grade (detectors + adapter + engine) against 507 TAG-graded cards.

    npm run harness -- --label <name>          # full run, writes results/<date>-<name>.{json,md}
    npm run harness -- --limit 20 --cert X     # quick iteration
    npm run harness:compare results/A.json results/B.json

Ground truth: `ground-truth.json`, regenerated with
`scripts/tag-dataset/.venv/Scripts/python scripts/harness/export_ground_truth.py`.

Photos: `scripts/Tag scraper/dig info/weights by tag/TAG Map/{Front,Back}` (studio shots, card fills ~96% of frame).
Centering fed to the engine is TAG's own, so the numbers measure detector accuracy only.
Sign convention: software − TAG; positive = software too lenient.

Memory: node-canvas 3.x leaks native memory per `Image` and per `createCanvas()` (measured ~9 MB and ~6 MB each, invisible to V8's GC). `run.mjs` therefore reuses one Image and one canvas for the whole run and clears `img.src` after each decode; the `--expose-gc` flag in the npm script is belt-and-braces. Do not "simplify" this back to `loadImage()` per card.
Resized 1400-px copies are cached in the OS temp dir (`--cache <dir>` to move, `--no-cache` to disable).

Results are committed. Every detector change must ship with a new results file and a compare against the previous one.
