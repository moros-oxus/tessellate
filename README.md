<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/tessellate-lockup-inline-dark.png">
  <img alt="Tessellate" src="./assets/tessellate-lockup-inline.png">
</picture>

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
| [`packages/core`](./packages/core) | the pipeline, model intake (schema-validated, version-pinned — the model's contract version is `draft.NN` until its shape is declared stable, then `YYYY.MM`), fake-host test kit |
| [`packages/figma`](./packages/figma) | the Figma plugin — installing it, using it, and what it keeps in a file: see its [README](./packages/figma/README.md) |

## Developing

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test   # the gate
pnpm build                                 # every package that builds
```
