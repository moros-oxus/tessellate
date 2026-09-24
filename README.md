# tessellate

Design-tool plugins for the **Figma-shaped model** — the versioned artifact
(`figma.model.json`) emitted by [Vertekum](https://github.com/moros-oxus/vertekum)'s
`figma` exporter. A host-agnostic core drives every plugin through one pipeline:

```
snapshot  →  diff  →  plan  →  apply
```

- **snapshot** — the host's current variables/collections/styles, read through a
  per-host `HostAdapter`;
- **diff** — model vs host, per variable: add / update / unchanged / **drift**
  (edited in the host since the last apply — detected by identity stamps, not
  guessed by name);
- **plan** — an ordered, delete-free, serializable operation list, seat-aware
  (collections whose modes exceed the seat's capacity split into single-mode
  siblings, stated in the plan's notes);
- **apply** — the adapter executes; re-importing the same model is a no-op diff.

## One file to drop

A model may hold **several compositions** — two brands, say — already merged by the
exporter: collections that resolve identically are shared, and only the ones that differ
carry a mode per composition (`color-mode` → `acme/light`, `acme/dark`, `globex/light`,
…). The structure is decided at build time, from the resolvers; the plugin never combines
files. It lists the model's compositions and, per merged collection, which modes belong to
which — read from the model's `modeSources`, never parsed from mode names.

### What the file remembers

The first successful apply **binds** the design file to the artifact it came from. The
binding lives on the document itself, so every collaborator sees it and it travels with the
file:

- the artifact (`source.target`), its compositions, the model version, and when it was
  last applied;
- on open, before anything is dropped, the plugin shows all of that plus a **live drift
  count** — variables edited in Figma since the last apply, read from the identity stamps
  alone;
- dropping a model from a **different** artifact shows a banner naming both, and Apply stays
  disabled until you click **Rebind this file** — legitimate when a file is repurposed,
  never by accident.

Binding also puts an **Open Tessellate** button in the file's properties panel (with
nothing selected), labelled with the artifact and the last apply — one click back into the
status view.

### The seat split happens here

The model is seat-agnostic; a merged collection can hold more modes than a seat allows
(Starter has none beyond one, Professional 10, Organization 20). Tick **limited-modes seat**
and the plan splits every over-budget collection into single-mode siblings
(`color-mode/acme/light`), naming the compositions involved in the plan notes before
anything is written. Each split part is stamped with what it holds, so a split file reads
as clean on the next open.

## Packages

| Package | What |
| --- | --- |
| `packages/core` | the pipeline, model intake (schema-validated, version-pinned — the model's contract version is `draft.NN` until its shape is declared stable, then `YYYY.MM`), fake-host test kit |
| `packages/figma` | the Figma plugin: model intake, diff preview, apply (`pnpm --filter @tessellate/figma build` → `dist/`, load `manifest.json` as a development plugin) |

## Developing

```bash
pnpm install
pnpm lint && pnpm test        # the gate
pnpm --filter @tessellate/figma build
```

In Figma: Plugins → Development → Import plugin from manifest… →
`packages/figma/manifest.json`. Feed it any `figma.model.json` produced by
`vertekum build`.
