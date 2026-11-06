import type { FigmaModel } from '@vertekum/ext-export-figma';
import { fit } from './layout';
import { DEFAULT_POLICY, type HostSnapshot, type PlanPolicy } from './types';

/**
 * What the model no longer holds. The DTCG files are the source of truth: a token removed from
 * them is removed on purpose, so whatever tessellate made from it goes too. Tessellate knows what
 * it made — every variable and style it writes carries its stamp — so RETIRED means stamped by
 * tessellate and absent from the model. Anything without a stamp is the designer's own and is
 * never touched. ONE rule shared by diff and plan (like `fit`).
 */

export interface RetiredStyle {
  name: string;
  /** The model's style that takes this one's usages, when exactly one does. */
  replacement?: string;
}

export interface Retirement {
  variables: Array<{ collection: string; name: string }>;
  styles: RetiredStyle[];
  /** Host collections whose every variable retires — they go with them. */
  collections: string[];
  notes: string[];
}

export function retired(
  model: FigmaModel,
  snapshot: HostSnapshot,
  capacity: number | undefined,
  policy: PlanPolicy = DEFAULT_POLICY,
): Retirement {
  const notes: string[] = [];

  // Where the model's variables land for THIS seat, and every collection name the model's
  // collections take under ANY seat (whole, or split per mode).
  const landed = new Map<string, Set<string>>();
  const layouts = new Map<string, { of: string; whole: boolean }>();
  for (const collection of model.collections) {
    const names = new Set(collection.variables.map((v) => v.name));
    for (const part of fit(collection, capacity, policy).parts) {
      landed.set(part.name, names);
    }
    layouts.set(collection.name, { of: collection.name, whole: true });
    for (const mode of collection.modes) {
      layouts.set(`${collection.name}/${mode}`, {
        of: collection.name,
        whole: false,
      });
    }
  }

  const variables: Retirement['variables'] = [];
  const collections: string[] = [];
  for (const host of snapshot.collections) {
    const stamped = host.variables.filter((v) => v.stamp !== undefined);
    if (stamped.length === 0) continue;
    const names = landed.get(host.name);
    if (names === undefined) {
      // A layout of a model collection this seat doesn't write is a seat change, not a removal:
      // the bindings to it would break for nothing. Kept, and said.
      const layout = layouts.get(host.name);
      if (layout) {
        notes.push(
          layout.whole
            ? `collection '${host.name}' is '${layout.of}' whole, for another seat — kept`
            : `collection '${host.name}' is '${layout.of}' split for another seat — kept`,
        );
        continue;
      }
    }
    const gone = stamped.filter((v) => !names?.has(v.name));
    for (const variable of gone) {
      variables.push({ collection: host.name, name: variable.name });
    }
    if (gone.length > 0 && gone.length === host.variables.length) {
      collections.push(host.name);
    }
  }

  // Text styles — the only kind tessellate writes. A style the exporter now emits under the other
  // naming (per composition ⇄ shared) is the same token: per-composition → shared has exactly
  // one replacement; shared → per-composition has one per composition, and picking one would
  // mean knowing each layer's mode.
  const wanted = new Set(
    model.styles.filter((s) => s.kind === 'text').map((s) => s.name),
  );
  const compositions = model.source.compositions ?? [];
  const styles: RetiredStyle[] = [];
  for (const style of snapshot.styles) {
    if (style.kind !== 'text' || style.stamp === undefined) continue;
    if (wanted.has(style.name)) continue;
    const [head, ...rest] = style.name.split('/');
    const shared = rest.join('/');
    if (
      head !== undefined &&
      compositions.includes(head) &&
      wanted.has(shared)
    ) {
      styles.push({ name: style.name, replacement: shared });
      continue;
    }
    if (compositions.some((c) => wanted.has(`${c}/${style.name}`))) {
      notes.push(
        `style '${style.name}' is now one per composition — no single replacement; layers using it keep their values, unlinked`,
      );
    }
    styles.push({ name: style.name });
  }

  return { variables, styles, collections, notes };
}
