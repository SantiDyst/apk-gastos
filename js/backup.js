import * as storage from './storage.js';

export function formatBackupFilename(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `apk-gastos-backup-${year}-${month}-${day}.json`;
}

function automaticFilename(reason, date = new Date()) {
  const base = formatBackupFilename(date).replace(/\.json$/, '');
  const safeReason = String(reason || 'automatic').replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
  return `${base}-${safeReason}.json`;
}

export function buildLocalBackup() {
  const db = storage.getDB();
  const meta = storage.getPayloadMeta();
  return storage.createPayload(db, meta);
}

export function downloadJSON(text, filename) {
  if (typeof document === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') {
    return false;
  }
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

export function exportLocalBackup() {
  const payload = buildLocalBackup();
  const text = storage.serializePayload(payload);
  const filename = formatBackupFilename();
  downloadJSON(text, filename);
  return { payload, text, filename };
}

export function createAutomaticBackup(reason) {
  const payload = buildLocalBackup();
  const text = storage.serializePayload(payload);
  const at = new Date().toISOString();
  const filename = automaticFilename(reason);
  storage.saveAutoBackup({ reason, at, filename, text });
  downloadJSON(text, filename);
  return { payload, text, filename, at };
}

export async function readJSONFile(file) {
  if (!file) throw new Error('No se eligió ningún archivo.');
  if (typeof file.text === 'function') return file.text();
  if (typeof file.text === 'string') return file.text;
  if (typeof file.content === 'string') return file.content;
  throw new Error('No se pudo leer el archivo elegido.');
}

export function inspectBackupText(text) {
  const parsed = storage.parsePayload(text);
  if (!parsed.ok) {
    return { ok: false, errors: parsed.errors, error: parsed.errors[0] };
  }
  return {
    ok: true,
    payload: parsed.payload,
    summary: storage.getPayloadSummary(parsed.payload),
    errors: []
  };
}

export async function inspectBackupFile(file) {
  let text;
  try {
    text = await readJSONFile(file);
  } catch (error) {
    return { ok: false, errors: [error.message], error: error.message };
  }
  return inspectBackupText(text);
}

export async function importWithConfirmation(inspected, options = {}) {
  if (!inspected || !inspected.ok) {
    return { imported: false, error: (inspected && inspected.error) || 'El respaldo no es válido.' };
  }
  const validation = storage.validatePayload(inspected.payload);
  if (!validation.valid) {
    return { imported: false, error: validation.errors[0] };
  }
  if (typeof options.confirm === 'function') {
    const confirmed = await options.confirm(inspected);
    if (!confirmed) return { imported: false, cancelled: true };
  }
  const backup = createAutomaticBackup('before-import');
  storage.replaceFromPayload(inspected.payload, { pendingUpload: true });
  return { imported: true, backup };
}

export function importPayload(payload) {
  const validation = storage.validatePayload(payload);
  if (!validation.valid) {
    throw new storage.StorageError('invalid_payload', `El respaldo no es válido: ${validation.errors[0]}`, {
      errors: validation.errors
    });
  }
  const backup = createAutomaticBackup('before-import');
  storage.replaceFromPayload(payload, { pendingUpload: true });
  return { backup };
}

export function serializeForDrive() {
  return storage.serializePayload(buildLocalBackup());
}

export function parseFromDrive(text) {
  return storage.parsePayload(text);
}
