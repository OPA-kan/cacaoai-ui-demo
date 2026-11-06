# CacaoAI UI demo

A standalone frontend mockup for sharing and reviewing the CacaoAI farm dashboard concept.

## View

Open `index.html` locally, or enable GitHub Pages from the `main` branch and `/ (root)` in the repository's Pages settings. The page is static HTML with bundled local images; pushing updates to `main` updates the published site.

## Scope and data

This repository contains only the UI prototype and generated illustrative cacao pod images. The sample images are not analyzed by CacaoAI. Photo Review, Tree Record, and Outcome View show illustrative screening signals and field-action flows; they are not live inference results. Photo pins, GPS availability, tree links, and location confidence values are also illustrative demo values. Other counts, dates, map areas, and outcome values are invented demo values.

## Valencia operations dashboard

The Valencia pilot operations dashboard is available at [`valencia-desktop/`](./valencia-desktop/). It keeps the existing demo's Farm Overview → Area Detail → Tree Record → Photo Review → Field Action workflow, but uses the Valencia status-map image and the 04 Nov historical scan snapshot (`cacaoai-pwa/data/valencia-tree-history-20261104.json`). It is the first desktop management slice; live Supabase/Drive reads and action writes are the next integration step.

The page does not connect to Drive/GAS, call the CacaoAI models, collect GPS, or save feedback. Do not use it for operational decisions or add real farm photos, precise locations, credentials, model weights, or customer records.
