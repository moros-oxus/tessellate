# @tessellate/figma

The Figma plugin: drop a `figma.model.json` (from Vertekum's `figma` exporter) onto it,
preview what would change, and apply — variables, collections, modes, aliases and text
styles. Re-applying the same model is a no-op; edits made in Figma since the last apply
show as **drift**.

## Installing the plugin (unpublished)

The plugin is not published to the Figma Community, so it runs as a **development
plugin** loaded from this repository. Development plugins need the **Figma desktop app**
— the browser version cannot import one.

1. **Build it** from the repository root:

   ```bash
   pnpm install
   pnpm --filter @tessellate/figma build   # → packages/figma/dist/code.js + dist/ui.html
   ```

2. **Import it** in the Figma desktop app, with any design file open:
   **Plugins → Development → Import plugin from manifest…** and choose
   `packages/figma/manifest.json`.

3. **Run it:** **Plugins → Development → Tessellate**.

The import is per machine and per Figma account: everyone who runs the plugin builds and
imports it themselves.

**Updating.** Pull and rebuild — Figma loads `dist/` fresh on the next run, so a new build
needs no re-import. A change to `manifest.json` itself (a new relaunch button, a changed
permission) does: remove the plugin under **Plugins → Development → Manage plugins in
development** and import it again.

The manifest declares no network access: the plugin reads only the file you drop.

## Using it

1. Run the plugin and drop a `figma.model.json` onto the panel (or choose the file).
2. Read the preview: per collection, which variables are **add** / **update** /
   **drift** / **unchanged**, which modes are missing, and the plan's notes. Nothing is
   written yet.
3. Click **Apply**. Failures are listed and stay on screen; the panel then re-diffs, so a
   clean apply shows everything **unchanged**.

Text styles take their font family and weight from the model: the weight picks the
family's own upright style (`Bold`, `SemiBold`, `Semi Bold` alike), falling to the nearest
weight the family has. The family must be available to Figma.

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

### Seats with fewer modes

The model is seat-agnostic; a merged collection can hold more modes than a seat allows
(Starter has none beyond one, Professional 10, Organization 20). Tick **limited-modes seat**
and the plan splits every over-budget collection into single-mode siblings
(`color-mode/acme/light`), naming the compositions involved in the plan notes before
anything is written. Each split part is stamped with what it holds, so a split file reads
as clean on the next open. The setting is not remembered: tick it again for a split file.
