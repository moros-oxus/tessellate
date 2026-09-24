/**
 * The UI iframe: what this file tracks (status, first), model intake (file pick / drag-drop),
 * the diff rendered BEFORE anything writes, and the apply report. Plain DOM — no framework in
 * a 400px panel.
 */

type VariableDiff = {
  name: string;
  state: 'add' | 'update' | 'unchanged' | 'drift';
  details: string[];
};
type CollectionDiff = {
  name: string;
  exists: boolean;
  missingModes: string[];
  variables: VariableDiff[];
};
type DiffMessage = {
  type: 'diff';
  diff: {
    collections: CollectionDiff[];
    styles: Array<{ name: string; state: string }>;
    counts: Record<string, number>;
  };
  notes: string[];
  opCount: number;
  bound: boolean;
  /** Set when the dropped model is a different artifact than the file's binding. */
  mismatch?: string;
  readout: {
    compositions: string[];
    collections: Array<{ name: string; modes: Record<string, string[]> }>;
  };
};
type StatusMessage = {
  type: 'status';
  binding?: {
    target?: string;
    compositions: string[];
    modelVersion: string;
    label: string;
  };
  appliedAt?: string;
  drift: { count: number; variables: string[] };
};

const $ = (id: string): HTMLElement => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`no #${id}`);
  return node;
};

/** Names and labels come from files — never inject them as markup. */
const esc = (text: string): string =>
  text.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c,
  );

let model: string | undefined;
/** The user acknowledged a mismatch — the next apply rebinds the file. */
let rebind = false;

function post(type: 'diff' | 'apply'): void {
  if (!model) return;
  const capacity = ($('limited') as HTMLInputElement).checked ? 1 : undefined;
  parent.postMessage({ pluginMessage: { type, model, capacity, rebind } }, '*');
}

async function intake(file: File): Promise<void> {
  $('report').innerHTML = '';
  rebind = false;
  model = await file.text();
  $('file-name').textContent = file.name;
  post('diff');
}

$('pick').addEventListener('change', (event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) void intake(file);
});
document.body.addEventListener('dragover', (event) => event.preventDefault());
document.body.addEventListener('drop', (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files[0];
  if (file) void intake(file);
});
$('limited').addEventListener('change', () => post('diff'));
$('apply').addEventListener('click', () => post('apply'));
$('rebind').addEventListener('click', () => {
  rebind = true;
  post('diff');
});

function badge(state: string): string {
  return `<span class="badge ${state}">${state}</span>`;
}

function renderStatus(message: StatusMessage): void {
  const { binding, drift } = message;
  const status = $('status');
  // An unbound file with no stamped drift has nothing to say — the drop invitation is enough.
  if (!binding && drift.count === 0) {
    status.hidden = true;
    return;
  }
  status.hidden = false;
  const driftRow =
    drift.count === 0
      ? 'none'
      : `${badge('drift')} ${drift.count} variable(s) edited since the last apply` +
        `<details><summary>which</summary><ul>${drift.variables
          .map((v) => `<li><code>${esc(v)}</code></li>`)
          .join('')}</ul></details>`;
  status.innerHTML = binding
    ? `<strong>This file tracks ${esc(binding.label)}</strong><dl>` +
      `<dt>artifact</dt><dd><code>${esc(binding.target ?? '(no target)')}</code></dd>` +
      `<dt>compositions</dt><dd>${binding.compositions.map(esc).join(', ')}</dd>` +
      `<dt>model</dt><dd>${esc(binding.modelVersion)}</dd>` +
      `<dt>last applied</dt><dd>${esc(message.appliedAt ?? '')}</dd>` +
      `<dt>drift</dt><dd>${driftRow}</dd></dl>`
    : `<strong>This file is not bound yet</strong><dl><dt>drift</dt><dd>${driftRow}</dd></dl>`;
}

function renderReadout(readout: DiffMessage['readout']): void {
  const panel = $('compositions');
  if (readout.compositions.length < 2) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const rows = readout.collections
    .map(
      (collection) =>
        `<li><strong>${esc(collection.name)}</strong> — ${Object.entries(
          collection.modes,
        )
          .map(
            ([composition, modes]) =>
              `${esc(composition)}: ${modes.map(esc).join(', ')}`,
          )
          .join(' · ')}</li>`,
    )
    .join('');
  panel.innerHTML =
    `compositions: <strong>${readout.compositions.map(esc).join(', ')}</strong>` +
    (rows
      ? `<ul>${rows}</ul>`
      : ' <small>(every collection resolves identically — none gained modes)</small>');
}

function renderDiff(message: DiffMessage): void {
  const blocked = message.mismatch !== undefined && !rebind;
  $('mismatch').hidden = !blocked;
  if (blocked) {
    $('mismatch-text').textContent =
      `${message.mismatch}. Applying would repoint this file.`;
  }
  renderReadout(message.readout);

  const { counts } = message.diff;
  $('summary').innerHTML =
    `${badge('add')} ${counts.add ?? 0} · ${badge('update')} ${counts.update ?? 0} · ` +
    `${badge('drift')} ${counts.drift ?? 0} · ${badge('unchanged')} ${counts.unchanged ?? 0}` +
    ` — ${message.opCount} operation(s) planned`;
  $('notes').innerHTML = message.notes.map((n) => `<li>${n}</li>`).join('');
  $('detail').innerHTML = message.diff.collections
    .map((collection) => {
      const rows = collection.variables
        .filter((v) => v.state !== 'unchanged')
        .map(
          (v) =>
            `<li>${badge(v.state)} <code>${v.name}</code>${
              v.details.length ? ` <small>${v.details.join('; ')}</small>` : ''
            }</li>`,
        )
        .join('');
      const modes = collection.missingModes.length
        ? ` <small>+modes: ${collection.missingModes.join(', ')}</small>`
        : '';
      return `<details open><summary><strong>${collection.name}</strong>${
        collection.exists ? '' : ' (new)'
      }${modes}</summary><ul>${rows || '<li><small>no changes</small></li>'}</ul></details>`;
    })
    .join('');
  // Nothing to write and nothing to (re)bind → nothing to apply.
  const bindOnly = !message.bound || (rebind && message.mismatch !== undefined);
  ($('apply') as HTMLButtonElement).disabled =
    blocked || (message.opCount === 0 && !bindOnly);
}

window.onmessage = (event: MessageEvent) => {
  const message = event.data.pluginMessage;
  if (!message) return;
  if (message.type === 'issues') {
    $('summary').innerHTML = `<strong>model refused:</strong>`;
    $('detail').innerHTML = message.issues
      .map(
        (issue: { path: string; message: string }) =>
          `<li><code>${issue.path || '/'}</code> ${issue.message}</li>`,
      )
      .join('');
    ($('apply') as HTMLButtonElement).disabled = true;
    return;
  }
  if (message.type === 'status') {
    renderStatus(message as StatusMessage);
    return;
  }
  if (message.type === 'diff') {
    renderDiff(message as DiffMessage);
    return;
  }
  if (message.type === 'report') {
    const { report } = message;
    // The report PERSISTS in its own element — the re-diff below repaints summary/detail,
    // and a failure the user cannot read is a failure that did not happen.
    $('report').innerHTML =
      report.failed.length === 0
        ? ''
        : `<strong>applied ${report.applied}, FAILED ${report.failed.length}:</strong><ul>${report.failed
            .map(
              (f: { op: string; detail: string; error: string }) =>
                `<li>${f.op} <code>${f.detail}</code>: ${f.error}</li>`,
            )
            .join('')}</ul>`;
    // A clean apply wrote the binding — a rebind is spent.
    if (report.failed.length === 0) rebind = false;
    // Re-diff so the panel shows the post-apply truth (idempotence made visible).
    post('diff');
  }
};
