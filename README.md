# CacaoAI UI demo

A standalone frontend mockup for sharing and reviewing the CacaoAI farm dashboard concept.

## View

Open `index.html` locally, or enable GitHub Pages from the `main` branch and `/ (root)` in the repository's Pages settings. The page is static HTML with bundled local images; pushing updates to `main` updates the published site.

## Scope and data

This repository contains only the UI prototype and generated illustrative cacao pod images. The sample images are not analyzed by CacaoAI. Photo Review, Tree Record, and Outcome View show illustrative screening signals and field-action flows; they are not live inference results. Photo pins, GPS availability, tree links, and location confidence values are also illustrative demo values. Other counts, dates, map areas, and outcome values are invented demo values.

## Valencia operations dashboard

The Valencia pilot operations dashboard is available at [`valencia-desktop/`](./valencia-desktop/). It keeps the existing demo's Farm Overview → Area Detail → Tree Record → Photo Review → Field Action workflow, and uses the 04 Nov historical scan snapshot (`cacaoai-pwa/data/valencia-tree-history-20261104.json`) together with the verified Area polygons and C / Bu / B1 tree registry. The map is rendered as operational layers: satellite base map, farm boundary, Area polygons, registered tree positions, and historical scan groups. Disease-specific heatmap filters show All signals, Black pod, Pest-like, Charcoal pod rot, or Frosty pod; circle size represents the selected signal count per GPS group. The 10/21 status image is available only as an optional reference context layer. It is the first desktop management slice; live Supabase/Drive reads and action writes are the next integration step.

The page does not connect to Drive/GAS, call the CacaoAI models, collect GPS, or save feedback. Do not use it for operational decisions or add real farm photos, precise locations, credentials, model weights, or customer records.
