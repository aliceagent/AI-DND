# packs/ — campaign content (PRIVATE)

This directory holds campaign packs: ingested module data, reveal-tagged
entity cards, beat graphs, boxed-text seeds, and generated assets.

**Nothing in this directory (except this README) is ever committed.** The
first pack is *Hoard of the Dragon Queen* (D&D Encounters edition) — Wizards
of the Coast IP, licensed for personal use only. The engine/pack boundary is
the legal boundary: the engine is built on SRD 5.2 (CC-BY-4.0) and is
product-clean; packs are local, removable, and never redistributed.

Engine code may only touch packs through the pack-loader interface. If you
find yourself importing pack data directly anywhere else, stop.

Layout (created by the ingestion pipeline):
```
packs/hotdq/
  source/        the PDF (reference only)
  beats/         beat.schema.json instances
  entities/      entity_card.schema.json instances
  assets/        anchors, variants, LoRAs
  voices/        casting registry
  pack.json      manifest + approval state
```
