import type { FigmaModel } from '@vertekum/ext-export-figma';

/**
 * What a design file tracks: the artifact it was last applied from. It lives in the host's
 * DOCUMENT-level storage (Figma: `figma.root` plugin data), so every collaborator who opens the
 * file sees the same binding and it travels with the file.
 *
 * Identity is `source.target` — the exporter target that produced the model. A model built
 * outside a target carries none; its composition list stands in.
 */
export interface Binding {
  /** `source.target` — exact artifact identity. Absent when the model named no target. */
  target?: string;
  /** The compositions the model carried, in its order. */
  compositions: string[];
  /** The contract version last applied. */
  modelVersion: string;
  /** ISO timestamp of the last apply. */
  appliedAt: string;
  /** Human label for the panel and the relaunch button: `figma · acme + globex`. */
  label: string;
}

function identity(of: { target?: string; compositions: string[] }): string {
  return of.target ?? of.compositions.join(' + ');
}

function label(of: { target?: string; compositions: string[] }): string {
  const compositions = of.compositions.join(' + ');
  return of.target ? `${of.target} · ${compositions}` : compositions;
}

/** The binding an apply of `model` writes. */
export function bindingFor(model: FigmaModel, now: Date = new Date()): Binding {
  const { target, compositions } = model.source;
  return {
    ...(target !== undefined ? { target } : {}),
    compositions,
    modelVersion: model.version,
    appliedAt: now.toISOString(),
    label: label({ target, compositions }),
  };
}

/**
 * Whether `model` is a different artifact than the one the file is bound to — the case that
 * must not apply by accident. Returns the difference, stated, or `undefined` when it is the
 * same artifact (or the file is unbound).
 */
export function mismatch(
  binding: Binding | undefined,
  model: FigmaModel,
): string | undefined {
  if (!binding) return undefined;
  const bound = identity(binding);
  const dropped = identity(model.source);
  if (bound === dropped) return undefined;
  return `this file tracks '${bound}'; the dropped model is '${dropped}'`;
}

/** Parse stored binding JSON; anything unreadable is treated as no binding. */
export function parseBinding(raw: string): Binding | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<Binding>;
    if (
      !Array.isArray(parsed.compositions) ||
      typeof parsed.modelVersion !== 'string' ||
      typeof parsed.appliedAt !== 'string' ||
      typeof parsed.label !== 'string'
    ) {
      return undefined;
    }
    return parsed as Binding;
  } catch {
    return undefined;
  }
}
