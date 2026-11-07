# CacaoAI UI demo

A standalone frontend mockup for sharing and reviewing the CacaoAI farm dashboard concept.

## View

Open `index.html` locally, or enable GitHub Pages from the `main` branch and `/ (root)` in the repository's Pages settings. The page is static HTML with bundled local images; pushing updates to `main` updates the published site.

## Scope and data

This repository contains only the UI prototype and generated illustrative cacao pod images. The sample images are not analyzed by CacaoAI. Photo Review, Tree Record, and Outcome View show illustrative screening signals and field-action flows; they are not live inference results. Photo pins, GPS availability, tree links, and location confidence values are also illustrative demo values. Other counts, dates, map areas, and outcome values are invented demo values.

## Valencia operations dashboard

The Valencia pilot operations dashboard is available at [`valencia-desktop/`](./valencia-desktop/). It keeps the existing demo's Farm Overview → Area Detail → Tree Record → Photo Review → Field Action workflow, and uses the 04 Nov historical scan snapshot (`cacaoai-pwa/data/valencia-tree-history-20261104.json`) together with the verified Area polygons and C / Bu / B1 tree registry. The map is rendered as operational layers: satellite base map, farm boundary, Area polygons, all registered tree positions, and historical scan groups. Registered trees are always shown first and classified as No linked scan, Low signal, Follow-up, or Priority only when a nearby scan can be safely linked; unlinked GPS warnings remain separate instead of being falsely attached to a tree. Disease-specific heatmap filters show All signals, Black pod, Pest-like, Charcoal pod rot, or Frosty pod; circle size represents the selected signal count per GPS group. The scan timeline switches between available scan dates and All scans. Field actions can be recorded against a Tree or Area, then compared against the before/after scan rate; the UI explicitly labels this as an observed scan change until a synced treatment record supports attribution. The 10/21 status image is available only as an optional reference context layer. It is the first desktop management slice; live Supabase/Drive reads and action writes are the next integration step.

The original root page remains a static UI concept. The Valencia desktop page now reads lightweight photo metadata and field actions from Supabase at startup; it does not download image binaries until an operator opens a Drive source link. If the cloud tables cannot be read, it falls back to the historical JSON snapshot. The PWA is still responsible for camera/GPS capture and Drive upload through the existing bridge. Keep RLS enabled on the `photos` and `field_actions` tables before sharing this app, and do not use the prototype for operational decisions until the model results and field observations are verified.
