import test from 'node:test';
import assert from 'node:assert/strict';

import * as storage from '../js/storage.js';
import {
  DATASET_B,
  CARD_A,
  RECORD_A,
  RECORD_B,
  fixedClock,
  freshStorage,
  makeCard,
  makePayload,
  makeRecord,
  oldPayload
} from './helpers/memory-storage.js';

test('createDefaultDB produces a valid empty structure with default categories', () => {
  const db = storage.createDefaultDB();
  const validation = storage.validateDB(db);
  assert.equal(validation.valid, true);
  assert.deepEqual(db.principal, []);
  assert.deepEqual(db.tarjetas, []);
  assert.equal(db.config.presupuesto, null);
  assert.ok(db.config.cat_ing.includes('Sueldo'));
  assert.deepEqual(db.plantillas_fijas, []);
});

test('normalizeNotes keeps the non-empty value of notes or notas', () => {
  assert.equal(storage.normalizeNotes({ notes: '', notas: 'legacy' }).notes, 'legacy');
  assert.equal(storage.normalizeNotes({ notes: 'modern', notas: 'legacy' }).notes, 'modern');
  assert.equal(storage.normalizeNotes({ notas: 'only legacy' }).notes, 'only legacy');
  assert.equal(storage.normalizeNotes({ notes: '' }).notes, '');
  assert.equal('notas' in storage.normalizeNotes({ notes: 'x', notas: 'y' }), false);
});

test('migratePayload accepts the previous local format and adds metadata', () => {
  const payload = storage.migratePayload(oldPayload());
  assert.equal(payload.schema_version, 1);
  assert.match(payload.dataset_id, /^[0-9a-f-]{36}$/i);
  assert.equal(payload.revision, 1);
  assert.ok(Number.isFinite(Date.parse(payload.updated_at)));
  assert.equal(payload.principal[0].notes, 'Nota vieja');
  assert.equal('notas' in payload.principal[0], false);
  assert.deepEqual(payload.plantillas_fijas, []);
  assert.equal(payload.config.presupuesto, null);
});

test('parsePayload round-trips the current format', () => {
  const original = makePayload();
  const parsed = storage.parsePayload(storage.serializePayload(original));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.payload, original);
});

test('loadDB migrates finanzas_data_v3 without losing records and rewrites notes', () => {
  const adapter = freshStorage();
  adapter.seed(storage.DB_KEY, JSON.stringify(oldPayload()));
  const db = storage.loadDB();
  assert.equal(db.principal.length, 1);
  assert.equal(db.principal[0].notes, 'Nota vieja');
  assert.equal('notas' in db.principal[0], false);
  const meta = storage.getPayloadMeta();
  assert.equal(meta.schema_version, 1);
  const raw = JSON.parse(adapter.read(storage.DB_KEY));
  assert.equal(raw.schema_version, 1);
  assert.equal(raw.principal[0].notes, 'Nota vieja');
  assert.equal('notas' in raw.principal[0], false);
});

test('corrupt JSON is reported and the original value is preserved', () => {
  const adapter = freshStorage();
  adapter.seed(storage.DB_KEY, '{ broken json');
  assert.throws(
    () => storage.loadDB(),
    (error) => error.code === 'corrupt_data' && error.details.raw === '{ broken json'
  );
  assert.equal(adapter.read(storage.DB_KEY), '{ broken json');
});

test('future schema versions are rejected instead of imported', () => {
  const adapter = freshStorage();
  const future = storage.serializePayload(makePayload({ schema_version: 2 }));
  adapter.seed(storage.DB_KEY, future);
  assert.throws(
    () => storage.loadDB(),
    (error) => error.code === 'corrupt_data' && /desconocida/.test(error.message)
  );
  assert.equal(adapter.read(storage.DB_KEY), future);
});

test('invalid amounts, installments, months and states are rejected', () => {
  const invalidPayloads = [
    makePayload({ principal: [makeRecord({ monto: -1 })] }),
    makePayload({ principal: [makeRecord({ monto: Number.NaN })] }),
    makePayload({ principal: [makeRecord({ mes: 13 })] }),
    makePayload({ principal: [makeRecord({ estado: 'Otro' })] }),
    makePayload({ principal: [makeRecord({ id: 'no-uuid' })] }),
    makePayload({ tarjetas: [makeCard({ cuotasTotales: 0 })] }),
    makePayload({ tarjetas: [makeCard({ cuotasTotales: 1.5 })] }),
    makePayload({ tarjetas: [makeCard({ montoTotal: 0 })] }),
    makePayload({ config: { cat_ing: 'Sueldo', cat_gas: [] } })
  ];
  invalidPayloads.forEach((payload) => {
    const validation = storage.validatePayload(payload);
    assert.equal(validation.valid, false);
  });
});

test('validatePayload rejects invalid metadata and nonexistent dataset ids', () => {
  assert.equal(storage.validatePayload(makePayload({ dataset_id: 'nope' })).valid, false);
  assert.equal(storage.validatePayload(makePayload({ revision: 0 })).valid, false);
  assert.equal(storage.validatePayload(makePayload({ updated_at: 'ayer' })).valid, false);
  assert.equal(storage.validatePayload(makePayload({ schema_version: 9 })).valid, false);
});

test('commitDB increments revision once, updates the date and marks dirty', () => {
  const adapter = freshStorage();
  adapter.seed(storage.DB_KEY, JSON.stringify(makePayload()));
  fixedClock('2026-11-25T10:00:00.000Z');
  storage.loadDB();
  const before = storage.getPayloadMeta();
  storage.commitDB({
    ...storage.getDB(),
    principal: [...storage.getDB().principal, makeRecord({ id: RECORD_B, descripcion: 'Luz', monto: 25000 })]
  });
  const after = storage.getPayloadMeta();
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.updated_at, '2026-11-25T10:00:00.000Z');
  assert.equal(storage.isLocalDirty(), true);
  assert.equal(storage.getDB().principal.length, 2);
  storage.resetStorage();
});

test('a failed mutation leaves data, revision and dirty flag untouched', () => {
  const adapter = freshStorage();
  const original = makePayload();
  adapter.seed(storage.DB_KEY, JSON.stringify(original));
  fixedClock('2026-11-25T10:00:00.000Z');
  storage.loadDB();
  const beforeRaw = adapter.read(storage.DB_KEY);
  assert.throws(() =>
    storage.commitDB({
      ...storage.getDB(),
      principal: [makeRecord({ monto: -50 })]
    })
  );
  assert.equal(adapter.read(storage.DB_KEY), beforeRaw);
  assert.equal(storage.getPayloadMeta().revision, original.revision);
  assert.equal(storage.isLocalDirty(), false);
  storage.resetStorage();
});

test('exporting a payload does not increment revision or mark dirty', () => {
  const adapter = freshStorage();
  adapter.seed(storage.DB_KEY, JSON.stringify(makePayload()));
  storage.loadDB();
  const before = storage.getPayloadMeta();
  const text = storage.serializePayload(storage.createPayload(storage.getDB(), before));
  const parsed = storage.parsePayload(text);
  assert.equal(parsed.ok, true);
  assert.equal(storage.getPayloadMeta().revision, before.revision);
  assert.equal(storage.isLocalDirty(), false);
});

test('replaceFromPayload adopts the payload and controls dirty state', () => {
  const adapter = freshStorage();
  adapter.seed(storage.DB_KEY, JSON.stringify(makePayload()));
  storage.loadDB();
  const incoming = makePayload({
    dataset_id: DATASET_B,
    revision: 9,
    principal: [makeRecord({ id: RECORD_B, descripcion: 'Internet', monto: 20000 })]
  });
  storage.replaceFromPayload(incoming, { pendingUpload: true });
  assert.equal(storage.getPayloadMeta().dataset_id, DATASET_B);
  assert.equal(storage.getPayloadMeta().revision, 9);
  assert.equal(storage.getDB().principal[0].descripcion, 'Internet');
  assert.equal(storage.isLocalDirty(), true);
  storage.replaceFromPayload(incoming, { pendingUpload: false });
  assert.equal(storage.isLocalDirty(), false);
});

test('an external write makes the current tab stale before committing', () => {
  const adapter = freshStorage();
  adapter.seed(storage.DB_KEY, JSON.stringify(makePayload()));
  storage.loadDB();
  const external = makePayload({
    revision: 20,
    principal: [makeRecord({ id: RECORD_B, descripcion: 'Otra pestaña', monto: 1000 })]
  });
  adapter.seed(storage.DB_KEY, storage.serializePayload(external));
  assert.throws(
    () => storage.commitDB(storage.getDB()),
    (error) => error.code === 'stale_tab'
  );
  assert.equal(adapter.read(storage.DB_KEY), storage.serializePayload(external));
});

test('dataset id stays stable across commits and summaries count records', () => {
  const adapter = freshStorage();
  adapter.seed(storage.DB_KEY, JSON.stringify(makePayload()));
  storage.loadDB();
  const datasetId = storage.getPayloadMeta().dataset_id;
  storage.mutateDB((db) => db.principal.push(makeRecord({ id: RECORD_B })));
  assert.equal(storage.getPayloadMeta().dataset_id, datasetId);
  const summary = storage.getPayloadSummary(storage.getPayload());
  assert.equal(summary.gastos, 2);
  assert.equal(summary.tarjetas, 1);
});

test('sync state hides tokens, survives patches and resets when corrupted', () => {
  const adapter = freshStorage();
  storage.updateSyncState({ connected: true, folderId: 'folder', fileId: 'file', local_dirty: true });
  const state = storage.getSyncState();
  assert.equal(state.connected, true);
  assert.equal(state.local_dirty, true);
  storage.setLastSyncedRemoteBase({ version: '7', md5: 'abc' });
  assert.deepEqual(storage.getLastSyncedRemoteBase(), { version: '7', md5: 'abc' });
  storage.saveSyncState({ ...storage.getSyncState(), access_token: 'secret-token' });
  assert.equal('access_token' in JSON.parse(adapter.read(storage.SYNC_KEY)), false);
  adapter.seed(storage.SYNC_KEY, 'not json');
  assert.equal(storage.getSyncState().connected, false);
  assert.equal(storage.getSyncState().local_dirty, false);
  assert.equal(adapter.read(storage.SYNC_KEY), 'not json');
});

test('resetLocalData replaces corrupt data with a fresh valid payload', () => {
  const adapter = freshStorage();
  adapter.seed(storage.DB_KEY, '{ corrupt');
  assert.throws(() => storage.loadDB());
  const db = storage.resetLocalData();
  assert.equal(db.principal.length, 0);
  assert.ok(adapter.read(storage.DB_KEY));
  assert.equal(storage.isLocalDirty(), false);
});

test('invalid category and preset budget shapes are rejected', () => {
  assert.equal(
    storage.validateDB({ ...storage.createDefaultDB(), config: { cat_ing: [], cat_gas: [], presupuesto: -3 } })
      .valid,
    false
  );
  assert.equal(
    storage.validateDB({ ...storage.createDefaultDB(), plantillas_fijas: 'nope' }).valid,
    false
  );
  assert.equal(
    storage.validateDB({
      ...storage.createDefaultDB(),
      plantillas_fijas: [
        {
          id: CARD_A,
          descripcion: 'Alquiler',
          monto: 100,
          categoria: 'Hogar',
          notes: '',
          activo: true
        }
      ]
    }).valid,
    true
  );
});
