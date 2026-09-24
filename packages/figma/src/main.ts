import {
  apply,
  bindingFor,
  compositionReadout,
  DEFAULT_POLICY,
  diff,
  hostDrift,
  mismatch,
  plan,
  readModel,
} from '@tessellate/core';
import { FigmaAdapter, when } from './adapter';

/**
 * The plugin's main thread: holds the figma API, runs the pipeline, and answers the UI —
 * "what does this file track?" (status, on open), "what would this model change?" (diff,
 * writes nothing) and "apply it" (plan execution + report, then the binding). The UI owns
 * intake and rendering; nothing here renders.
 */

figma.showUI(__html__, { width: 420, height: 600 });

const adapter = new FigmaAdapter();

/**
 * The status view, posted on open and after every apply. A plain run and the file's relaunch
 * button (`figma.command === 'open'`) land in the same place: status first, no model needed.
 */
async function postStatus(): Promise<void> {
  const binding = await adapter.readBinding();
  figma.ui.postMessage({
    type: 'status',
    binding,
    appliedAt: binding ? when(binding.appliedAt) : undefined,
    drift: hostDrift(await adapter.snapshot()),
  });
}

void postStatus();

figma.ui.onmessage = async (message: {
  type: 'diff' | 'apply';
  model: string;
  capacity?: number;
  /** The user clicked "Rebind this file" for a mismatched model. */
  rebind?: boolean;
}) => {
  const read = await readModel(message.model);
  if ('issues' in read) {
    figma.ui.postMessage({ type: 'issues', issues: read.issues });
    return;
  }
  const binding = await adapter.readBinding();
  const conflict = mismatch(binding, read.model);
  const snapshot = await adapter.snapshot();
  // Diff and plan share one capacity, so a split file diffs against its split collections.
  const capacity = message.capacity ?? adapter.modeCapacity();
  const diffed = diff(read.model, snapshot, capacity, DEFAULT_POLICY);
  const planned = plan(read.model, diffed, capacity, DEFAULT_POLICY);

  if (message.type === 'diff') {
    figma.ui.postMessage({
      type: 'diff',
      diff: diffed,
      notes: planned.notes,
      opCount: planned.ops.length,
      bound: binding !== undefined,
      mismatch: conflict,
      readout: compositionReadout(read.model),
    });
    return;
  }

  // The UI disables Apply on a mismatch; this guard holds even if it did not.
  if (conflict && !message.rebind) {
    figma.ui.postMessage({
      type: 'issues',
      issues: [
        { path: '/source/target', message: `${conflict} — rebind first` },
      ],
    });
    return;
  }
  const report = await apply(planned, adapter);
  if (report.failed.length === 0) {
    await adapter.writeBinding(bindingFor(read.model));
  }
  figma.ui.postMessage({ type: 'report', report });
  await postStatus();
};
