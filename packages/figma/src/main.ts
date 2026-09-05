import { apply, DEFAULT_POLICY, diff, plan, readModel } from '@tessellate/core';
import { FigmaAdapter } from './adapter';

/**
 * The plugin's main thread: holds the figma API, runs the pipeline, and answers the UI's two
 * questions — "what would this model change?" (diff, writes nothing) and "apply it" (plan
 * execution + report). The UI owns intake and rendering; nothing here renders.
 */

figma.showUI(__html__, { width: 420, height: 560 });

const adapter = new FigmaAdapter();

figma.ui.onmessage = async (message: {
  type: 'diff' | 'apply';
  model: string;
  capacity?: number;
}) => {
  const read = await readModel(message.model);
  if ('issues' in read) {
    figma.ui.postMessage({ type: 'issues', issues: read.issues });
    return;
  }
  const snapshot = await adapter.snapshot();
  const diffed = diff(read.model, snapshot);
  const planned = plan(
    read.model,
    diffed,
    message.capacity ?? adapter.modeCapacity(),
    DEFAULT_POLICY,
  );

  if (message.type === 'diff') {
    figma.ui.postMessage({
      type: 'diff',
      diff: diffed,
      notes: planned.notes,
      opCount: planned.ops.length,
    });
    return;
  }

  const report = await apply(planned, adapter);
  figma.ui.postMessage({ type: 'report', report });
};
