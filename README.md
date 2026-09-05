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

## Packages

| Package | What |
| --- | --- |
| `packages/core` | the pipeline, model intake (schema-validated, version-pinned), fake-host test kit |
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
