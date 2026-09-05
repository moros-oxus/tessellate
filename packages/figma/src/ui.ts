/**
 * The UI iframe: model intake (file pick / drag-drop), the diff rendered BEFORE anything
 * writes, and the apply report. Plain DOM — no framework in a 400px panel.
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
};

const $ = (id: string): HTMLElement => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`no #${id}`);
  return node;
};

let model: string | undefined;

function post(type: 'diff' | 'apply'): void {
  if (!model) return;
  const capacity = ($('limited') as HTMLInputElement).checked ? 1 : undefined;
  parent.postMessage({ pluginMessage: { type, model, capacity } }, '*');
}

async function intake(file: File): Promise<void> {
  $('report').innerHTML = '';
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

function badge(state: string): string {
  return `<span class="badge ${state}">${state}</span>`;
}

function renderDiff(message: DiffMessage): void {
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
  ($('apply') as HTMLButtonElement).disabled = message.opCount === 0;
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
    // Re-diff so the panel shows the post-apply truth (idempotence made visible).
    post('diff');
  }
};
