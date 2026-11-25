import test from 'node:test';
import assert from 'node:assert/strict';

import * as storage from '../js/storage.js';
import {
  FOLDER_MIME,
  SyncError,
  buildRemoteBase,
  createDriveApi,
  createSyncService,
  decideSyncAction,
  hasRemoteChanged,
  isMissingRemoteFile
} from '../js/drive-sync.js';
import {
  DATASET_A,
  DATASET_B,
  RECORD_A,
  RECORD_B,
  fixedClock,
  makePayload,
  makeRecord
} from './helpers/memory-storage.js';

function setup(options = {}) {
  const payload =
    options.payload ||
    makePayload({
      principal: options.empty ? [] : makePayload().principal,
      tarjetas: options.empty ? [] : makePayload().tarjetas,
      plantillas_fijas: []
    });
  storage.resetStorage();
  const adapter = {
    map: new Map(),
    writes: [],
    getItem(key) {
      return this.map.has(key) ? this.map.get(key) : null;
    },
    setItem(key, value) {
      this.writes.push(key);
      this.map.set(key, String(value));
    },
    removeItem(key) {
      this.map.delete(key);
    },
    seed(key, value) {
      this.map.set(key, String(value));
    },
    read(key) {
      return this.map.has(key) ? this.map.get(key) : null;
    }
  };
  storage.configureStorage(adapter);
  adapter.seed(storage.DB_KEY, storage.serializePayload(payload));
  fixedClock('2026-11-25T10:00:00.000Z');
  storage.loadDB();
  const known = options.known === undefined ? { version: '5', md5: 'md5-5' } : options.known;
  storage.updateSyncState({
    connected: options.connected !== false,
    folderId: options.folderId === undefined ? 'folder1' : options.folderId,
    fileId: options.fileId === undefined ? 'file1' : options.fileId,
    local_dirty: options.dirty === true,
    last_synced_remote_version: known ? known.version : null,
    last_synced_remote_md5: known ? known.md5 : null,
    last_synced_at: '2026-11-01T00:00:00.000Z'
  });
  return { adapter, payload };
}

function zeroCalls() {
  return {
    ensureAccess: 0,
    resolveFolder: 0,
    resolveFile: 0,
    getFileMetadata: 0,
    downloadFile: 0,
    updateFile: 0,
    createFile: 0,
    createFolder: 0,
    findAppFolders: 0,
    revokeAccess: 0,
    clearAccess: 0
  };
}

function driveFile(overrides = {}) {
  return {
    id: 'file-ok',
    name: 'apk-gastos-data.json',
    mimeType: 'application/json',
    parents: ['folder1'],
    version: '4',
    md5Checksum: 'm4',
    trashed: false,
    ...overrides
  };
}

function jsonResponse(data) {
  return { ok: true, status: 200, json: async () => data };
}

function fakeApi(context = {}) {
  const calls = zeroCalls();
  const api = {
    ensureAccess: async () => {
      calls.ensureAccess += 1;
    },
    resolveFolder: async () => {
      calls.resolveFolder += 1;
      if (context.folder !== undefined) return context.folder;
      return { id: 'folder1', mimeType: FOLDER_MIME };
    },
    resolveFile: async () => {
      calls.resolveFile += 1;
      if (context.file !== undefined) return context.file;
      return { id: 'file1', version: '5', md5Checksum: 'md5-5', trashed: false };
    },
    getFileMetadata: async (id) => {
      calls.getFileMetadata += 1;
      if (context.freshMeta !== undefined) return context.freshMeta;
      return context.file || { id, version: '5', md5Checksum: 'md5-5', trashed: false };
    },
    downloadFile: async () => {
      calls.downloadFile += 1;
      if (context.delay) await new Promise((resolve) => setTimeout(resolve, context.delay));
      if (context.downloadError) throw context.downloadError;
      return typeof context.remoteText === 'function' ? context.remoteText() : context.remoteText;
    },
    updateFile: async (id, text) => {
      calls.updateFile += 1;
      calls.lastUpload = text;
      if (context.updateError) throw context.updateError;
      return context.updatedMeta || { id, version: '6', md5Checksum: 'md5-6' };
    },
    createFile: async (folderId, text) => {
      calls.createFile += 1;
      calls.lastUpload = text;
      calls.createdFolderId = folderId;
      return context.createdMeta || { id: 'newfile', version: '1', md5Checksum: 'md5-new' };
    },
    createFolder: async () => {
      calls.createFolder += 1;
      return { id: 'newfolder', mimeType: FOLDER_MIME };
    },
    findAppFolders: async () => {
      calls.findAppFolders += 1;
      return context.folders || [];
    },
    revokeAccess: async () => {
      calls.revokeAccess += 1;
    },
    clearAccess: () => {
      calls.clearAccess += 1;
    }
  };
  if (context.overrides) Object.assign(api, context.overrides);
  return { api, calls };
}

function buildService(context, dialogs = {}) {
  const { api, calls } = fakeApi(context);
  const service = createSyncService({
    api,
    dialogs,
    now: () => '2026-11-25T10:00:00.000Z'
  });
  return { service, api, calls };
}

test('decideSyncAction implements the sync decision table', () => {
  const base = { hasLocalData: true, localDirty: false, hasRemoteFile: true, hasKnownBase: true, remoteChanged: false };
  assert.equal(decideSyncAction(base), 'noop');
  assert.equal(decideSyncAction({ ...base, localDirty: true }), 'upload');
  assert.equal(decideSyncAction({ ...base, remoteChanged: true }), 'download');
  assert.equal(decideSyncAction({ ...base, localDirty: true, remoteChanged: true }), 'conflict');
  assert.equal(decideSyncAction({ ...base, hasRemoteFile: false }), 'create_remote');
  assert.equal(decideSyncAction({ ...base, hasRemoteFile: false, hasLocalData: false }), 'noop');
  assert.equal(decideSyncAction({ ...base, hasKnownBase: false }), 'initial_choice');
  assert.equal(decideSyncAction({ ...base, hasKnownBase: false, hasLocalData: false }), 'download');
  assert.equal(decideSyncAction({ ...base, localDirty: true, remoteChanged: true, sameContent: true }), 'noop');
});

test('buildRemoteBase and hasRemoteChanged compare version and md5', () => {
  const base = buildRemoteBase({ version: '3', md5Checksum: 'abc' });
  assert.deepEqual(base, { version: '3', md5: 'abc' });
  assert.equal(hasRemoteChanged(base, null), null);
  assert.equal(hasRemoteChanged(base, { version: '3', md5: 'abc' }), false);
  assert.equal(hasRemoteChanged(base, { version: '4', md5: 'abc' }), true);
  assert.equal(hasRemoteChanged(base, { version: '3', md5: 'zzz' }), true);
  assert.equal(hasRemoteChanged({ version: null, md5: null }, { version: '3', md5: 'abc' }), true);
});

test('synchronize without changes in either side does not write', async () => {
  const { payload } = setup({ dirty: false });
  const remoteText = storage.serializePayload(payload);
  const { service, calls } = buildService({
    remoteText,
    file: { id: 'file1', version: '5', md5Checksum: 'md5-5' }
  });
  const result = await service.synchronize();
  assert.equal(result.ok, true);
  assert.equal(result.action, 'noop');
  assert.equal(calls.updateFile, 0);
  assert.equal(calls.createFile, 0);
  assert.equal(storage.isLocalDirty(), false);
  assert.equal(storage.getSyncState().last_synced_remote_version, '5');
});

test('synchronize uploads when only local changes exist', async () => {
  const { payload } = setup({ dirty: true });
  const remotePayload = makePayload({ revision: 2, principal: [makeRecord({ id: RECORD_B })] });
  const { service, calls } = buildService({
    remoteText: storage.serializePayload(remotePayload),
    file: { id: 'file1', version: '5', md5Checksum: 'md5-5' }
  });
  const result = await service.synchronize();
  assert.equal(result.action, 'upload');
  assert.equal(calls.updateFile, 1);
  assert.equal(calls.getFileMetadata, 1);
  assert.match(calls.lastUpload, /"dataset_id"/);
  assert.equal(storage.getDB().principal[0].id, RECORD_A);
  assert.equal(storage.isLocalDirty(), false);
  assert.equal(storage.getSyncState().last_synced_remote_version, '6');
  assert.equal(storage.getSyncState().last_synced_remote_md5, 'md5-6');
  assert.equal(storage.getSyncState().last_synced_at, '2026-11-25T10:00:00.000Z');
});

test('synchronize downloads remote-only changes with a local backup', async () => {
  const { adapter, payload } = setup({ dirty: false });
  const remotePayload = makePayload({
    revision: 6,
    principal: [makeRecord({ id: RECORD_B, descripcion: 'Remoto', monto: 1234 })]
  });
  const oldRaw = adapter.read(storage.DB_KEY);
  const { service, calls } = buildService({
    remoteText: storage.serializePayload(remotePayload),
    file: { id: 'file1', version: '6', md5Checksum: 'md5-6' }
  });
  const result = await service.synchronize();
  assert.equal(result.action, 'download');
  assert.equal(calls.updateFile, 0);
  assert.equal(storage.getDB().principal[0].descripcion, 'Remoto');
  assert.equal(storage.isLocalDirty(), false);
  assert.equal(storage.getSyncState().last_synced_remote_version, '6');
  const autoBackup = storage.getAutoBackup();
  assert.ok(autoBackup);
  assert.equal(autoBackup.text, oldRaw);
  assert.equal(payload.revision, 3);
});

test('synchronize reports a conflict and cancel changes nothing', async () => {
  const { adapter, payload } = setup({ dirty: true });
  const beforeRaw = adapter.read(storage.DB_KEY);
  const remotePayload = makePayload({ revision: 8, principal: [makeRecord({ id: RECORD_B })] });
  const { service, calls } = buildService(
    { remoteText: storage.serializePayload(remotePayload), file: { id: 'file1', version: '9', md5Checksum: 'md5-9' } },
    { chooseConflict: async () => 'cancel' }
  );
  const result = await service.synchronize();
  assert.equal(result.ok, true);
  assert.equal(result.action, 'cancelled');
  assert.equal(calls.updateFile, 0);
  assert.equal(adapter.read(storage.DB_KEY), beforeRaw);
  assert.equal(storage.getDB().principal[0].id, RECORD_A);
  assert.equal(storage.isLocalDirty(), true);
  assert.equal(storage.getPayloadMeta().revision, payload.revision);
  assert.equal(storage.getAutoBackup(), null);
  assert.equal(service.getSyncStatus().status, 'conflict');
});

test('conflict download replaces local data and conflict upload replaces remote', async () => {
  const remotePayload = makePayload({ revision: 8, principal: [makeRecord({ id: RECORD_B, descripcion: 'Remoto' })] });

  setup({ dirty: true });
  const download = buildService(
    { remoteText: storage.serializePayload(remotePayload), file: { id: 'file1', version: '9', md5Checksum: 'md5-9' } },
    { chooseConflict: async () => 'download' }
  );
  const downloadResult = await download.service.synchronize();
  assert.equal(downloadResult.action, 'download');
  assert.equal(storage.getDB().principal[0].descripcion, 'Remoto');
  assert.equal(storage.isLocalDirty(), false);

  setup({ dirty: true });
  const upload = buildService(
    { remoteText: storage.serializePayload(remotePayload), file: { id: 'file1', version: '9', md5Checksum: 'md5-9' } },
    { chooseConflict: async () => 'upload' }
  );
  const uploadResult = await upload.service.synchronize();
  assert.equal(uploadResult.action, 'upload');
  assert.equal(upload.calls.updateFile, 1);
  assert.equal(storage.getDB().principal[0].id, RECORD_A);
  assert.equal(storage.isLocalDirty(), false);
});

test('first connection without remote file offers to create it', async () => {
  setup({ dirty: true, known: null, folderId: null, fileId: null });
  const confirmed = buildService(
    { folder: null, file: null },
    { confirmCreateRemote: async () => true }
  );
  const result = await confirmed.service.synchronize();
  assert.equal(result.action, 'create_remote');
  assert.equal(confirmed.calls.createFolder, 1);
  assert.equal(confirmed.calls.createFile, 1);
  assert.equal(confirmed.calls.updateFile, 0);
  assert.equal(storage.getSyncState().fileId, 'newfile');
  assert.equal(storage.getSyncState().folderId, 'newfolder');
  assert.equal(storage.isLocalDirty(), false);
});

test('initial creation re-checks Drive after confirmation and never duplicates', async () => {
  setup({ dirty: true, known: null, folderId: null, fileId: null });
  const appeared = {
    id: 'racefile',
    name: 'apk-gastos-data.json',
    mimeType: 'application/json',
    parents: ['racefolder'],
    version: '1',
    md5Checksum: 'm1'
  };
  let folderReads = 0;
  let fileReads = 0;
  const { api, calls } = fakeApi({ folder: null, file: null });
  api.resolveFolder = async () => {
    folderReads += 1;
    return folderReads === 1 ? null : { id: 'racefolder', mimeType: FOLDER_MIME };
  };
  api.resolveFile = async () => {
    fileReads += 1;
    return fileReads === 1 ? null : appeared;
  };
  const service = createSyncService({
    api,
    dialogs: { confirmCreateRemote: async () => true },
    now: () => '2026-11-25T10:00:00.000Z'
  });
  const result = await service.synchronize();
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'remote_appeared');
  assert.equal(calls.createFile, 0);
  assert.equal(calls.createFolder, 0);
  assert.equal(storage.isLocalDirty(), true);
  assert.equal(storage.getSyncState().fileId, null);
  assert.equal(storage.getSyncState().folderId, null);
});

test('initial folder creation refuses to continue when a duplicate appears', async () => {
  setup({ dirty: true, known: null, folderId: null, fileId: null });
  const { api, calls } = fakeApi({ folder: null, file: null });
  api.findAppFolders = async () => {
    calls.findAppFolders += 1;
    return [
      { id: 'newfolder', mimeType: FOLDER_MIME },
      { id: 'otherfolder', mimeType: FOLDER_MIME }
    ];
  };
  const service = createSyncService({
    api,
    dialogs: { confirmCreateRemote: async () => true },
    now: () => '2026-11-25T10:00:00.000Z'
  });
  const result = await service.synchronize();
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'ambiguous_location');
  assert.equal(calls.createFile, 0);
  assert.equal(calls.createFolder, 1);
  assert.equal(storage.isLocalDirty(), true);
});

test('first connection without remote file can be cancelled', async () => {
  const { adapter } = setup({ dirty: true, known: null, folderId: null, fileId: null });
  const beforeRaw = adapter.read(storage.DB_KEY);
  const { service, calls } = buildService(
    { folder: null, file: null },
    { confirmCreateRemote: async () => false }
  );
  const result = await service.synchronize();
  assert.equal(result.action, 'cancelled');
  assert.equal(calls.createFile, 0);
  assert.equal(calls.createFolder, 0);
  assert.equal(adapter.read(storage.DB_KEY), beforeRaw);
  assert.equal(storage.isLocalDirty(), true);
});

test('first contact with data on both sides never resolves automatically', async () => {
  const remotePayload = makePayload({ dataset_id: DATASET_B, revision: 4, principal: [makeRecord({ id: RECORD_B })] });
  setup({ dirty: false, known: null });
  const cancelled = buildService(
    { remoteText: storage.serializePayload(remotePayload), file: { id: 'file1', version: '1', md5Checksum: 'm1' } },
    { chooseInitial: async () => 'cancel' }
  );
  const result = await cancelled.service.synchronize();
  assert.equal(result.action, 'cancelled');
  assert.equal(cancelled.calls.updateFile, 0);
  assert.equal(storage.getDB().principal[0].id, RECORD_A);

  setup({ dirty: false, known: null });
  const downloaded = buildService(
    { remoteText: storage.serializePayload(remotePayload), file: { id: 'file1', version: '1', md5Checksum: 'm1' } },
    { chooseInitial: async () => 'download' }
  );
  const result2 = await downloaded.service.synchronize();
  assert.equal(result2.action, 'download');
  assert.equal(storage.getDB().principal[0].id, RECORD_B);
});

test('empty local storage offers to download a valid remote file', async () => {
  const remotePayload = makePayload({ principal: [makeRecord({ id: RECORD_B, descripcion: 'Remoto' })] });
  setup({ empty: true, dirty: false, known: null });

  const rejected = buildService(
    { remoteText: storage.serializePayload(remotePayload), file: { id: 'file1', version: '1', md5Checksum: 'm1' } },
    { confirmDownload: async () => false }
  );
  const first = await rejected.service.synchronize();
  assert.equal(first.action, 'cancelled');
  assert.equal(storage.getDB().principal.length, 0);

  setup({ empty: true, dirty: false, known: null });
  const accepted = buildService(
    { remoteText: storage.serializePayload(remotePayload), file: { id: 'file1', version: '1', md5Checksum: 'm1' } },
    { confirmDownload: async () => true }
  );
  const second = await accepted.service.synchronize();
  assert.equal(second.action, 'download');
  assert.equal(storage.getDB().principal[0].id, RECORD_B);
  assert.equal(storage.isLocalDirty(), false);
});

test('an unexpected dataset id is never auto-associated', async () => {
  const { adapter } = setup({ dirty: true });
  const beforeRaw = adapter.read(storage.DB_KEY);
  const remotePayload = makePayload({ dataset_id: DATASET_B, revision: 7, principal: [makeRecord({ id: RECORD_B })] });
  const { service, calls } = buildService(
    { remoteText: storage.serializePayload(remotePayload), file: { id: 'file1', version: '9', md5Checksum: 'm9' } },
    { showDatasetMismatch: async () => 'cancel' }
  );
  const result = await service.synchronize();
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'dataset_mismatch');
  assert.equal(calls.updateFile, 0);
  assert.equal(adapter.read(storage.DB_KEY), beforeRaw);
  assert.equal(storage.isLocalDirty(), true);
});

test('a different dataset can be downloaded only after explicit confirmation', async () => {
  setup({ dirty: true });
  const remotePayload = makePayload({ dataset_id: DATASET_B, revision: 7, principal: [makeRecord({ id: RECORD_B })] });
  const { service } = buildService(
    { remoteText: storage.serializePayload(remotePayload), file: { id: 'file1', version: '9', md5Checksum: 'm9' } },
    { showDatasetMismatch: async () => 'download' }
  );
  const result = await service.synchronize();
  assert.equal(result.action, 'download');
  assert.equal(storage.getPayloadMeta().dataset_id, DATASET_B);
  assert.equal(storage.isLocalDirty(), false);
});

test('an expired token leaves data and sync flags untouched', async () => {
  const { adapter } = setup({ dirty: true });
  const beforeRaw = adapter.read(storage.DB_KEY);
  const { service, calls } = buildService({
    overrides: {
      ensureAccess: async () => {
        throw new SyncError('auth_required', 'La sesión de Google venció. Volvé a conectar Google Drive.');
      }
    }
  });
  const result = await service.synchronize();
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'auth_required');
  assert.equal(calls.updateFile, 0);
  assert.equal(adapter.read(storage.DB_KEY), beforeRaw);
  assert.equal(storage.isLocalDirty(), true);
  assert.equal(service.getSyncStatus().status, 'error');
});

test('invalid remote JSON never touches local data', async () => {
  const { adapter } = setup({ dirty: true });
  const beforeRaw = adapter.read(storage.DB_KEY);
  const { service, calls } = buildService({
    remoteText: '{ not valid json',
    file: { id: 'file1', version: '9', md5Checksum: 'm9' }
  });
  const result = await service.synchronize();
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'invalid_remote');
  assert.equal(calls.updateFile, 0);
  assert.equal(adapter.read(storage.DB_KEY), beforeRaw);
  assert.equal(storage.getAutoBackup(), null);
});

test('a remote change detected before upload aborts the upload', async () => {
  setup({ dirty: true });
  const remotePayload = makePayload({ revision: 2, principal: [makeRecord({ id: RECORD_B })] });
  const { service, calls } = buildService({
    remoteText: storage.serializePayload(remotePayload),
    file: { id: 'file1', version: '5', md5Checksum: 'md5-5' },
    freshMeta: { id: 'file1', version: '7', md5Checksum: 'md5-7' }
  });
  const result = await service.synchronize();
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'remote_changed');
  assert.equal(calls.updateFile, 0);
  assert.equal(storage.isLocalDirty(), true);
});

test('a lost upload response is not retried blind and the next sync reconciles it', async () => {
  setup({ dirty: true });
  const remotePayload = makePayload({ revision: 2, principal: [makeRecord({ id: RECORD_B })] });
  const context = {
    remoteText: storage.serializePayload(remotePayload),
    file: { id: 'file1', version: '5', md5Checksum: 'md5-5' }
  };
  const { service, api, calls } = buildService(context);
  let uploads = 0;
  api.updateFile = async (id, text) => {
    uploads += 1;
    context.remoteText = text;
    context.file = { id, version: '6', md5Checksum: 'md5-6' };
    throw new SyncError('network', 'No se pudo conectar con Google Drive.');
  };

  const first = await service.synchronize();
  assert.equal(first.ok, false);
  assert.equal(first.error.code, 'upload_uncertain');
  assert.equal(uploads, 1);
  assert.equal(storage.isLocalDirty(), true);
  assert.equal(storage.getSyncState().last_synced_remote_version, '5');

  const second = await service.synchronize();
  assert.equal(second.ok, true);
  assert.equal(second.action, 'noop');
  assert.equal(uploads, 1);
  assert.equal(storage.isLocalDirty(), false);
  assert.equal(storage.getSyncState().last_synced_remote_version, '6');
  assert.equal(calls.updateFile, 0);
});

test('two parallel synchronizations run only one operation', async () => {
  const { payload } = setup({ dirty: false });
  const { service, calls } = buildService({
    remoteText: storage.serializePayload(payload),
    file: { id: 'file1', version: '5', md5Checksum: 'md5-5' },
    delay: 25
  });
  const firstPromise = service.synchronize();
  const second = await service.synchronize();
  assert.equal(second.ok, false);
  assert.equal(second.error.code, 'sync_in_progress');
  const first = await firstPromise;
  assert.equal(first.ok, true);
  assert.equal(first.action, 'noop');
  assert.equal(calls.downloadFile, 1);
});

test('a change made by another tab blocks the sync before touching Drive', async () => {
  const { adapter } = setup({ dirty: true });
  adapter.seed(
    storage.DB_KEY,
    storage.serializePayload(makePayload({ revision: 50, principal: [makeRecord({ id: RECORD_B })] }))
  );
  const { service, calls } = buildService({
    remoteText: storage.serializePayload(makePayload()),
    file: { id: 'file1', version: '9', md5Checksum: 'm9' }
  });
  const result = await service.synchronize();
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'stale_tab');
  assert.equal(calls.ensureAccess, 0);
  assert.equal(calls.updateFile, 0);
});

test('connectDrive locates the remote file without uploading or downloading', async () => {
  setup({ dirty: true, known: null });
  const { service, calls } = buildService({
    file: { id: 'file1', version: '2', md5Checksum: 'm2' }
  });
  const result = await service.connectDrive();
  assert.equal(result.ok, true);
  assert.equal(calls.ensureAccess, 1);
  assert.equal(calls.updateFile, 0);
  assert.equal(calls.createFile, 0);
  assert.equal(storage.getSyncState().connected, true);
  assert.equal(storage.getSyncState().fileId, 'file1');
});

test('disconnect revokes access but keeps financial data and dirty state', async () => {
  const { payload } = setup({ dirty: true });
  const { service, calls } = buildService({});
  await service.disconnectDrive();
  assert.equal(calls.revokeAccess, 1);
  assert.equal(storage.getSyncState().connected, false);
  assert.equal(storage.getSyncState().folderId, null);
  assert.equal(storage.getSyncState().fileId, null);
  assert.equal(storage.getDB().principal[0].id, payload.principal[0].id);
  assert.equal(storage.isLocalDirty(), true);
});

test('Drive API maps HTTP and network failures to safe errors', async () => {
  const makeResponse = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(body),
    text: async () => body
  });

  const unauthorized = createDriveApi({
    getToken: () => 'token',
    fetchImpl: async () => makeResponse(401, '{"error":"invalid token"}')
  });
  await assert.rejects(
    () => unauthorized.getFileMetadata('file1'),
    (error) => error.code === 'unauthorized' && /sesión/.test(error.message)
  );

  const missing = createDriveApi({
    getToken: () => 'token',
    fetchImpl: async () => makeResponse(404, 'not found')
  });
  await assert.rejects(
    () => missing.getFileMetadata('file1'),
    (error) => error.code === 'not_found' && isMissingRemoteFile(error) === true
  );

  const forbidden = createDriveApi({
    getToken: () => 'token',
    fetchImpl: async () => makeResponse(403, '{"error":"permission revoked"}')
  });
  await assert.rejects(
    () => forbidden.getFileMetadata('file1'),
    (error) => error.code === 'forbidden' && isMissingRemoteFile(error) === false
  );

  const network = createDriveApi({
    getToken: () => 'token',
    fetchImpl: async () => {
      throw new Error('socket closed');
    }
  });
  await assert.rejects(
    () => network.getFileMetadata('file1'),
    (error) => error.code === 'network'
  );

  const noToken = createDriveApi({
    getToken: () => {
      throw new SyncError('auth_required', 'La sesión de Google venció.');
    },
    fetchImpl: async () => makeResponse(200, '{}')
  });
  await assert.rejects(
    () => noToken.getFileMetadata('file1'),
    (error) => error.code === 'auth_required'
  );
});

test('Drive API recovers a lost file id by searching before creating anything', async () => {
  const urls = [];
  const api = createDriveApi({
    getToken: () => 'token',
    fetchImpl: async (url) => {
      urls.push(url);
      if (url.includes('/files/lost-file')) {
        return { ok: false, status: 404, text: async () => 'not found' };
      }
      if (url.includes('spaces=drive')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            files: [
              {
                id: 'found-file',
                name: 'apk-gastos-data.json',
                mimeType: 'application/json',
                parents: ['folder1'],
                version: '3',
                md5Checksum: 'm3',
                trashed: false
              }
            ]
          })
        };
      }
      throw new Error(`Unexpected URL ${url}`);
    }
  });
  const found = await api.resolveFile('folder1', { knownFileId: 'lost-file' });
  assert.equal(found.id, 'found-file');
  assert.ok(urls.some((url) => decodeURIComponent(url).includes("trashed = false")));
  assert.ok(urls.some((url) => decodeURIComponent(url).includes("'folder1' in parents")));
});

test('Drive API refuses to pick one of several duplicate folders or files', async () => {
  let call = 0;
  const folderApi = createDriveApi({
    getToken: () => 'token',
    fetchImpl: async () => {
      call += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          files: [
            { id: 'folder1', mimeType: FOLDER_MIME },
            { id: 'folder2', mimeType: FOLDER_MIME }
          ]
        })
      };
    }
  });
  await assert.rejects(
    () => folderApi.resolveFolder({}),
    (error) => error.code === 'ambiguous_location'
  );
  assert.equal(call, 1);

  const fileApi = createDriveApi({
    getToken: () => 'token',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        files: [
          {
            id: 'file1',
            name: 'apk-gastos-data.json',
            mimeType: 'application/json',
            parents: ['folder1'],
            md5Checksum: 'a',
            version: '1'
          },
          {
            id: 'file2',
            name: 'apk-gastos-data.json',
            mimeType: 'application/json',
            parents: ['folder1'],
            md5Checksum: 'b',
            version: '1'
          }
        ]
      })
    })
  });
  await assert.rejects(
    () => fileApi.resolveFile('folder1', {}),
    (error) => error.code === 'ambiguous_location'
  );
});

test('Drive API discards a stored file id that no longer identifies the data file', async () => {
  const mismatches = [
    { name: 'otro-archivo.json' },
    { mimeType: 'text/plain' },
    { parents: ['another-folder'] }
  ];
  for (const mismatch of mismatches) {
    const urls = [];
    const api = createDriveApi({
      getToken: () => 'token',
      fetchImpl: async (url) => {
        urls.push(url);
        if (url.includes('/files/known-file')) {
          return jsonResponse(driveFile({ id: 'known-file', ...mismatch }));
        }
        if (url.includes('spaces=drive')) {
          return jsonResponse({ files: [driveFile({ id: 'correct-file' })] });
        }
        throw new Error(`Unexpected URL ${url}`);
      }
    });
    const resolved = await api.resolveFile('folder1', { knownFileId: 'known-file' });
    assert.equal(resolved.id, 'correct-file', `mismatch ${JSON.stringify(mismatch)} must fall back to search`);
    assert.ok(urls.some((url) => url.includes('spaces=drive')));
  }
});

test('Drive API accepts a stored file id only when name, MIME and folder match', async () => {
  const urls = [];
  const api = createDriveApi({
    getToken: () => 'token',
    fetchImpl: async (url) => {
      urls.push(url);
      if (url.includes('/files/known-file')) return jsonResponse(driveFile({ id: 'known-file' }));
      throw new Error(`Unexpected URL ${url}`);
    }
  });
  const resolved = await api.resolveFile('folder1', { knownFileId: 'known-file' });
  assert.equal(resolved.id, 'known-file');
  assert.equal(urls.length, 1);
  assert.equal(urls.some((url) => url.includes('spaces=drive')), false);
});

test('Drive API does not create over a same-name file that is not JSON', async () => {
  const api = createDriveApi({
    getToken: () => 'token',
    fetchImpl: async () =>
      jsonResponse({ files: [driveFile({ id: 'wrong', mimeType: 'text/plain' })] })
  });
  await assert.rejects(
    () => api.resolveFile('folder1', {}),
    (error) => error.code === 'ambiguous_location' && /no es un respaldo JSON/.test(error.message)
  );
});

test('Drive API returns no file when the stored id is invalid and nothing matches', async () => {
  const api = createDriveApi({
    getToken: () => 'token',
    fetchImpl: async (url) => {
      if (url.includes('/files/known-file')) {
        return jsonResponse(driveFile({ id: 'known-file', name: 'otro.json' }));
      }
      if (url.includes('spaces=drive')) return jsonResponse({ files: [] });
      throw new Error(`Unexpected URL ${url}`);
    }
  });
  const resolved = await api.resolveFile('folder1', { knownFileId: 'known-file' });
  assert.equal(resolved, null);
});

test('Drive API treats trashed metadata as a missing file', async () => {
  const api = createDriveApi({
    getToken: () => 'token',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: 'file1', trashed: true })
    })
  });
  await assert.rejects(
    () => api.getFileMetadata('file1'),
    (error) => error.code === 'trashed' && isMissingRemoteFile(error) === true
  );
});

test('Drive API creates a JSON file as multipart content', async () => {
  let captured;
  const api = createDriveApi({
    getToken: () => 'token',
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'newfile', version: '1', md5Checksum: 'm1' })
      };
    }
  });
  const created = await api.createFile('folder1', '{"hello":"world"}');
  assert.equal(created.id, 'newfile');
  assert.match(captured.url, /uploadType=multipart/);
  assert.match(captured.options.headers['Content-Type'], /multipart\/related/);
  assert.match(captured.options.body, /"hello":"world"/);
  assert.match(captured.options.body, /"name":"apk-gastos-data.json"/);
  assert.match(captured.options.headers.Authorization, /^Bearer token$/);
});
