import type { HostAdapter, Plan } from './types';

/**
 * Plan execution: ops in order, failures collected per op (one bad alias never aborts the
 * import), a report the UI renders verbatim. Adapters own idempotence; apply owns sequence.
 *
 * The report also says what happened to the library — removed, migrated, deprecated — as plain
 * lines a maintainer can paste into release notes: files using a published library only learn
 * of a removal when it is published.
 */

export interface ApplyReport {
  applied: number;
  failed: Array<{ op: string; detail: string; error: string }>;
  /** `collection/name` per variable, `style <name>` per style, `collection <name>` per collection. */
  removed: string[];
  /** Usages moved off a retired style onto its replacement. */
  migrated: Array<{ from: string; to: string; layers: number }>;
  /** Entities written as deprecated (`collection/name`, `style <name>`). */
  deprecated: string[];
}

export async function apply(
  plan: Plan,
  adapter: HostAdapter,
): Promise<ApplyReport> {
  const report: ApplyReport = {
    applied: 0,
    failed: [],
    removed: [],
    migrated: [],
    deprecated: [],
  };
  for (const op of plan.ops) {
    try {
      switch (op.op) {
        case 'ensureCollection':
          await adapter.ensureCollection(op.collection);
          break;
        case 'ensureMode':
          await adapter.ensureMode(op.collection, op.mode);
          break;
        case 'upsertVariable':
          await adapter.upsertVariable(op.collection, {
            name: op.name,
            type: op.type,
            valuesByMode: op.valuesByMode,
            ...(op.deprecated !== undefined
              ? { deprecated: op.deprecated }
              : {}),
            stamp: op.stamp,
          });
          if (op.deprecated !== undefined) {
            report.deprecated.push(`${op.collection}/${op.name}`);
          }
          break;
        case 'bindAlias':
          await adapter.bindAlias(op.collection, op.name, op.mode, op.target);
          break;
        case 'upsertTextStyle':
          await adapter.upsertTextStyle({
            name: op.name,
            properties: op.properties,
            bindings: op.bindings,
            ...(op.deprecated !== undefined
              ? { deprecated: op.deprecated }
              : {}),
            stamp: op.stamp,
          });
          if (op.deprecated !== undefined) {
            report.deprecated.push(`style ${op.name}`);
          }
          break;
        case 'migrateStyleUsages': {
          const layers = await adapter.migrateStyleUsages(op.from, op.to);
          report.migrated.push({ from: op.from, to: op.to, layers });
          break;
        }
        case 'removeTextStyle':
          await adapter.removeTextStyle(op.name);
          report.removed.push(`style ${op.name}`);
          break;
        case 'removeVariable':
          await adapter.removeVariable(op.collection, op.name);
          report.removed.push(`${op.collection}/${op.name}`);
          break;
        case 'removeCollection':
          await adapter.removeCollection(op.collection);
          report.removed.push(`collection ${op.collection}`);
          break;
      }
      report.applied++;
    } catch (error) {
      console.error('[tessellate] op failed', op, error);
      report.failed.push({
        op: op.op,
        detail:
          'collection' in op
            ? `${op.collection}/${'name' in op ? op.name : ''}`
            : 'name' in op
              ? op.name
              : `${op.from} → ${op.to}`,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return report;
}
