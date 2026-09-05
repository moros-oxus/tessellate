import type { HostAdapter, Plan } from './types';

/**
 * Plan execution: ops in order, failures collected per op (one bad alias never aborts the
 * import), a report the UI renders verbatim. Adapters own idempotence; apply owns sequence.
 */

export interface ApplyReport {
  applied: number;
  failed: Array<{ op: string; detail: string; error: string }>;
}

export async function apply(
  plan: Plan,
  adapter: HostAdapter,
): Promise<ApplyReport> {
  const report: ApplyReport = { applied: 0, failed: [] };
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
            stamp: op.stamp,
          });
          break;
        case 'bindAlias':
          await adapter.bindAlias(op.collection, op.name, op.mode, op.target);
          break;
        case 'upsertTextStyle':
          await adapter.upsertTextStyle({
            name: op.name,
            properties: op.properties,
            stamp: op.stamp,
          });
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
            : op.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return report;
}
