import test from 'node:test';
import assert from 'node:assert/strict';

import * as storage from '../js/storage.js';
import * as backup from '../js/backup.js';
import {
  DATASET_B,
  RECORD_A,
  RECORD_B,
  fixedClock,
  freshStorage,
  makePayload,
  makeRecord,
  oldPayload
} from './helpers/memory-storage.js';

function seedCurrent(overrides = {}) {
  const adapter = freshStorage();
  const payload = makePayload(overrides);
  adapter.seed(storage.DB_KEY, storage.serializePayload(payload));
  fixedClock('2026-11-25T10:00:00.000Z');
  storage.loadDB();
  return { adapter, payload };
}

test('formatBackupFilename includes the ISO date', () => {
  assert.equal(backup.formatBackupFilename(new Date(2026, 10, 23)), 'apk-gastos-backup-2026-11-23.json');
});

test('exportLocalBackup serializes the current versioned payload', () => {
  const { payload } = seedCurrent();
  const exported = backup.exportLocalBackup();
  assert.equal(exported.filename, backup.formatBackupFilename());
  const reparsed = storage.parsePayload(exported.text);
  assert.equal(reparsed.ok, true);
  assert.deepEqual(reparsed.payload, payload);
  assert.equal(storage.getPayloadMeta().revision, payload.revision);
  assert.equal(storage.isLocalDirty(), false);
});

test('inspectBackupFile accepts the old format and reports a summary', async () => {
  const inspected = await backup.inspectBackupFile({ text: JSON.stringify(oldPayload()) });
  assert.equal(inspected.ok, true);
  assert.equal(inspected.payload.schema_version, 1);
  assert.equal(inspected.payload.principal[0].notes, 'Nota vieja');
  assert.deepEqual(inspected.summary, {
    ingresos: 0,
    gastos: 1,
    tarjetas: 0,
    plantillas: 0,
    categoriasIngreso: 1,
    categoriasGasto: 1
  });
});

test('inspectBackupText rejects corrupt JSON and future versions', () => {
  assert.equal(backup.inspectBackupText('{ nope').ok, false);
  assert.equal(
    backup.inspectBackupText(storage.serializePayload(makePayload({ schema_version: 4 }))).ok,
    false
  );
  assert.equal(
    backup.inspectBackupText(storage.serializePayload(makePayload({ principal: [makeRecord({ monto: -2 })] })))
      .ok,
    false
  );
});

test('a cancelled import does not touch data, revision, dirty flag or storage', async () => {
  const { adapter, payload } = seedCurrent();
  const beforeRaw = adapter.read(storage.DB_KEY);
  const writesBefore = adapter.writes.length;
  const incoming = makePayload({ principal: [makeRecord({ id: RECORD_B, descripcion: 'Nuevo' })] });
  const result = await backup.importWithConfirmation(
    { ok: true, payload: incoming, summary: storage.getPayloadSummary(incoming) },
    { confirm: async () => false }
  );
  assert.equal(result.imported, false);
  assert.equal(result.cancelled, true);
  assert.equal(adapter.read(storage.DB_KEY), beforeRaw);
  assert.equal(adapter.writes.length, writesBefore);
  assert.equal(storage.getPayloadMeta().revision, payload.revision);
  assert.equal(storage.isLocalDirty(), false);
});

test('a confirmed import creates an automatic backup before replacing data', async () => {
  const { adapter } = seedCurrent();
  const oldRaw = adapter.read(storage.DB_KEY);
  const incoming = makePayload({
    dataset_id: DATASET_B,
    revision: 11,
    principal: [makeRecord({ id: RECORD_B, descripcion: 'Nuevo', monto: 999 })]
  });
  const result = await backup.importWithConfirmation(
    { ok: true, payload: incoming, summary: storage.getPayloadSummary(incoming) },
    { confirm: async () => true }
  );
  assert.equal(result.imported, true);
  assert.equal(storage.getDB().principal.length, 1);
  assert.equal(storage.getDB().principal[0].descripcion, 'Nuevo');
  assert.equal(storage.getPayloadMeta().revision, 11);
  assert.equal(storage.isLocalDirty(), true);

  const autoBackup = storage.getAutoBackup();
  assert.ok(autoBackup);
  assert.equal(autoBackup.reason, 'before-import');
  assert.equal(autoBackup.text, oldRaw);
  storage.resetStorage();
});

test('an invalid import leaves every stored value identical', async () => {
  const { adapter, payload } = seedCurrent();
  const beforeRaw = adapter.read(storage.DB_KEY);
  const writesBefore = adapter.writes.length;
  const result = await backup.importWithConfirmation({
    ok: false,
    error: 'El archivo no es un JSON válido.'
  });
  assert.equal(result.imported, false);
  assert.equal(adapter.read(storage.DB_KEY), beforeRaw);
  assert.equal(adapter.writes.length, writesBefore);
  assert.equal(storage.getPayloadMeta().revision, payload.revision);
  assert.equal(storage.getAutoBackup(), null);
});

test('importPayload refuses invalid payloads without writing', () => {
  const { adapter } = seedCurrent();
  const writesBefore = adapter.writes.length;
  assert.throws(() => backup.importPayload(makePayload({ revision: 0 })));
  assert.equal(adapter.writes.length, writesBefore);
});

test('parseFromDrive uses the same validator as local import', () => {
  const valid = backup.parseFromDrive(storage.serializePayload(makePayload()));
  assert.equal(valid.ok, true);
  const invalid = backup.parseFromDrive('{"principal": "x"}');
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.length > 0);
});
