export const DB_KEY = 'finanzas_data_v3';
export const SYNC_KEY = 'apk_gastos_sync_v1';
export const AUTO_BACKUP_KEY = 'apk_gastos_autobackup_v1';
export const THEME_KEY = 'app-theme';
export const SCHEMA_VERSION = 1;

const DEFAULT_CAT_ING = ['Sueldo', 'Venta', 'Inversión', 'Otros'];
const DEFAULT_CAT_GAS = ['Hogar', 'Servicios', 'Ocio', 'Comida', 'Transporte', 'Salud', 'Educación', 'Otros'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIN_YEAR = 1900;
const MAX_YEAR = 3000;
const MAX_ERRORS = 40;

export class StorageError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
    this.details = details;
  }
}

let adapter = null;
let current = null;
let lastRaw = null;
let nowProvider = () => new Date().toISOString();

export function configureStorage(nextAdapter) {
  adapter = nextAdapter;
  current = null;
  lastRaw = null;
}

export function resetStorage() {
  adapter = null;
  current = null;
  lastRaw = null;
  nowProvider = () => new Date().toISOString();
}

export function setNowProvider(provider) {
  nowProvider = provider;
}

function now() {
  return nowProvider();
}

function getAdapter() {
  if (adapter) return adapter;
  if (typeof globalThis.localStorage !== 'undefined' && globalThis.localStorage) {
    return globalThis.localStorage;
  }
  throw new StorageError('storage_unavailable', 'El almacenamiento local no está disponible en este navegador.');
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function newId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isPlainObject(value)) {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

export function canonicalJSON(value) {
  return JSON.stringify(canonicalize(value));
}

export function createDefaultDB() {
  return {
    principal: [],
    tarjetas: [],
    config: {
      cat_ing: [...DEFAULT_CAT_ING],
      cat_gas: [...DEFAULT_CAT_GAS],
      presupuesto: null
    },
    plantillas_fijas: []
  };
}

export function createDefaultSyncState() {
  return {
    connected: false,
    folderId: null,
    fileId: null,
    local_dirty: false,
    last_synced_remote_version: null,
    last_synced_remote_md5: null,
    last_synced_at: null,
    sync_error: null
  };
}

export function normalizeNotes(record) {
  if (!isPlainObject(record)) return record;
  const hasNotes = Object.prototype.hasOwnProperty.call(record, 'notes');
  const hasLegacy = Object.prototype.hasOwnProperty.call(record, 'notas');
  if (!hasNotes && !hasLegacy) return record;
  const validNotes = !hasNotes || record.notes === undefined || typeof record.notes === 'string';
  const validLegacy = !hasLegacy || record.notas === undefined || typeof record.notas === 'string';
  if (!validNotes || !validLegacy) return record;
  const notesValue = typeof record.notes === 'string' ? record.notes : '';
  const legacyValue = typeof record.notas === 'string' ? record.notas : '';
  const value = notesValue.trim().length > 0 ? record.notes : legacyValue;
  const result = { ...record, notes: value };
  delete result.notas;
  return result;
}

export function normalizeDB(rawDB) {
  const raw = isPlainObject(rawDB) ? rawDB : {};
  const config = isPlainObject(raw.config) ? { ...raw.config } : {};
  if (config.presupuesto === undefined) config.presupuesto = null;
  const plantillas =
    raw.plantillas_fijas === undefined
      ? []
      : Array.isArray(raw.plantillas_fijas)
        ? raw.plantillas_fijas.map(normalizeNotes)
        : raw.plantillas_fijas;
  return {
    principal: Array.isArray(raw.principal) ? raw.principal.map(normalizeNotes) : raw.principal,
    tarjetas: Array.isArray(raw.tarjetas) ? raw.tarjetas.map(normalizeNotes) : raw.tarjetas,
    config,
    plantillas_fijas: plantillas
  };
}

function pushError(errors, message) {
  if (errors.length < MAX_ERRORS) errors.push(message);
}

function validateCategories(list, label, errors) {
  if (!Array.isArray(list)) {
    pushError(errors, `${label} debe ser una lista.`);
    return;
  }
  list.forEach((category, index) => {
    if (!isNonEmptyString(category)) {
      pushError(errors, `${label}[${index}] debe ser un texto no vacío.`);
    }
  });
}

function validatePrincipalRecord(record, index, errors) {
  const label = `principal[${index}]`;
  if (!isPlainObject(record)) {
    pushError(errors, `${label} debe ser un objeto.`);
    return;
  }
  if (!isUuid(record.id)) pushError(errors, `${label}.id no es un UUID válido.`);
  if (record.tipo !== 'Ingreso' && record.tipo !== 'Gasto') {
    pushError(errors, `${label}.tipo debe ser "Ingreso" o "Gasto".`);
  }
  if (!isNonEmptyString(record.descripcion)) pushError(errors, `${label}.descripcion es obligatoria.`);
  if (typeof record.monto !== 'number' || !Number.isFinite(record.monto) || record.monto <= 0) {
    pushError(errors, `${label}.monto debe ser un número finito mayor que cero.`);
  }
  if (!isNonEmptyString(record.categoria)) pushError(errors, `${label}.categoria es obligatoria.`);
  if (record.notes !== undefined && typeof record.notes !== 'string') {
    pushError(errors, `${label}.notes debe ser texto.`);
  }
  if (record.estado !== 'Pagado' && record.estado !== 'Pendiente') {
    pushError(errors, `${label}.estado debe ser "Pagado" o "Pendiente".`);
  }
  if (!Number.isInteger(record.mes) || record.mes < 1 || record.mes > 12) {
    pushError(errors, `${label}.mes debe ser un entero entre 1 y 12.`);
  }
  if (!Number.isInteger(record.anio) || record.anio < MIN_YEAR || record.anio > MAX_YEAR) {
    pushError(errors, `${label}.anio no es un año válido.`);
  }
}

function validateCardRecord(record, index, errors) {
  const label = `tarjetas[${index}]`;
  if (!isPlainObject(record)) {
    pushError(errors, `${label} debe ser un objeto.`);
    return;
  }
  if (!isUuid(record.id)) pushError(errors, `${label}.id no es un UUID válido.`);
  if (!isNonEmptyString(record.descripcion)) pushError(errors, `${label}.descripcion es obligatoria.`);
  if (typeof record.montoTotal !== 'number' || !Number.isFinite(record.montoTotal) || record.montoTotal <= 0) {
    pushError(errors, `${label}.montoTotal debe ser un número finito mayor que cero.`);
  }
  if (!Number.isInteger(record.cuotasTotales) || record.cuotasTotales < 1) {
    pushError(errors, `${label}.cuotasTotales debe ser un entero mayor o igual que 1.`);
  }
  if (!Number.isInteger(record.mesInicio) || record.mesInicio < 1 || record.mesInicio > 12) {
    pushError(errors, `${label}.mesInicio debe ser un entero entre 1 y 12.`);
  }
  if (!Number.isInteger(record.anioInicio) || record.anioInicio < MIN_YEAR || record.anioInicio > MAX_YEAR) {
    pushError(errors, `${label}.anioInicio no es un año válido.`);
  }
  if (record.notes !== undefined && typeof record.notes !== 'string') {
    pushError(errors, `${label}.notes debe ser texto.`);
  }
}

function validateTemplateRecord(record, index, errors) {
  const label = `plantillas_fijas[${index}]`;
  if (!isPlainObject(record)) {
    pushError(errors, `${label} debe ser un objeto.`);
    return;
  }
  if (!isUuid(record.id)) pushError(errors, `${label}.id no es un UUID válido.`);
  if (!isNonEmptyString(record.descripcion)) pushError(errors, `${label}.descripcion es obligatoria.`);
  if (typeof record.monto !== 'number' || !Number.isFinite(record.monto) || record.monto <= 0) {
    pushError(errors, `${label}.monto debe ser un número finito mayor que cero.`);
  }
  if (!isNonEmptyString(record.categoria)) pushError(errors, `${label}.categoria es obligatoria.`);
  if (record.notes !== undefined && typeof record.notes !== 'string') {
    pushError(errors, `${label}.notes debe ser texto.`);
  }
  if (typeof record.activo !== 'boolean') pushError(errors, `${label}.activo debe ser booleano.`);
}

export function validateDB(db) {
  const errors = [];
  if (!isPlainObject(db)) {
    return { valid: false, errors: ['Los datos deben ser un objeto.'] };
  }
  if (!Array.isArray(db.principal)) {
    pushError(errors, 'principal debe ser una lista.');
  } else {
    db.principal.forEach((record, index) => validatePrincipalRecord(record, index, errors));
  }
  if (!Array.isArray(db.tarjetas)) {
    pushError(errors, 'tarjetas debe ser una lista.');
  } else {
    db.tarjetas.forEach((record, index) => validateCardRecord(record, index, errors));
  }
  if (!isPlainObject(db.config)) {
    pushError(errors, 'config debe ser un objeto.');
  } else {
    validateCategories(db.config.cat_ing, 'config.cat_ing', errors);
    validateCategories(db.config.cat_gas, 'config.cat_gas', errors);
    if (db.config.presupuesto !== null && db.config.presupuesto !== undefined) {
      if (typeof db.config.presupuesto !== 'number' || !Number.isFinite(db.config.presupuesto) || db.config.presupuesto < 0) {
        pushError(errors, 'config.presupuesto debe ser nulo o un número mayor o igual que cero.');
      }
    }
  }
  if (db.plantillas_fijas !== undefined) {
    if (!Array.isArray(db.plantillas_fijas)) {
      pushError(errors, 'plantillas_fijas debe ser una lista.');
    } else {
      db.plantillas_fijas.forEach((record, index) => validateTemplateRecord(record, index, errors));
    }
  }
  return { valid: errors.length === 0, errors };
}

function isIsoDate(value) {
  return typeof value === 'string' && value.length >= 10 && !Number.isNaN(Date.parse(value));
}

export function validatePayload(payload) {
  const errors = [];
  if (!isPlainObject(payload)) {
    return { valid: false, errors: ['El archivo no contiene un objeto JSON.'] };
  }
  if (!Number.isInteger(payload.schema_version)) {
    pushError(errors, 'schema_version debe ser un entero.');
  } else if (payload.schema_version > SCHEMA_VERSION) {
    pushError(errors, `schema_version ${payload.schema_version} es más nueva que la soportada (${SCHEMA_VERSION}).`);
  } else if (payload.schema_version !== SCHEMA_VERSION) {
    pushError(errors, `schema_version ${payload.schema_version} no es compatible.`);
  }
  if (!isUuid(payload.dataset_id)) pushError(errors, 'dataset_id debe ser un UUID.');
  if (!Number.isInteger(payload.revision) || payload.revision < 1) {
    pushError(errors, 'revision debe ser un entero mayor o igual que 1.');
  }
  if (!isIsoDate(payload.updated_at)) pushError(errors, 'updated_at debe ser una fecha ISO válida.');
  if (payload.device_label !== null && payload.device_label !== undefined && typeof payload.device_label !== 'string') {
    pushError(errors, 'device_label debe ser texto o nulo.');
  } else if (typeof payload.device_label === 'string' && payload.device_label.length > 100) {
    pushError(errors, 'device_label es demasiado largo.');
  }
  const dbValidation = validateDB(payload);
  dbValidation.errors.forEach((error) => pushError(errors, error));
  return { valid: errors.length === 0, errors };
}

function normalizePayloadForWrite(raw, options) {
  const db = normalizeDB(raw);
  const generate = options && options.generateMetadata;
  const datasetId = isUuid(raw.dataset_id) ? raw.dataset_id : (generate ? newId() : raw.dataset_id);
  const revision = Number.isInteger(raw.revision) && raw.revision >= 1 ? raw.revision : (generate ? 1 : raw.revision);
  const updatedAt = isIsoDate(raw.updated_at) ? raw.updated_at : (generate ? now() : raw.updated_at);
  const deviceLabel = typeof raw.device_label === 'string' ? raw.device_label : null;
  return {
    schema_version: SCHEMA_VERSION,
    dataset_id: datasetId,
    revision,
    updated_at: updatedAt,
    device_label: deviceLabel,
    principal: db.principal,
    tarjetas: db.tarjetas,
    config: db.config,
    plantillas_fijas: db.plantillas_fijas
  };
}

export function migratePayload(rawPayload) {
  if (!isPlainObject(rawPayload)) {
    throw new StorageError('invalid_payload', 'El archivo no contiene un objeto JSON.');
  }
  const hasVersion = rawPayload.schema_version !== undefined && rawPayload.schema_version !== null;
  if (hasVersion) {
    if (!Number.isInteger(rawPayload.schema_version) || rawPayload.schema_version < 1) {
      throw new StorageError('invalid_version', 'schema_version no es válido.');
    }
    if (rawPayload.schema_version > SCHEMA_VERSION) {
      throw new StorageError(
        'future_version',
        `El archivo usa una versión de esquema desconocida (${rawPayload.schema_version}).`
      );
    }
    return normalizePayloadForWrite(rawPayload, { generateMetadata: false });
  }
  const looksLikeData = 'principal' in rawPayload || 'tarjetas' in rawPayload || 'config' in rawPayload;
  if (!looksLikeData) {
    throw new StorageError('invalid_payload', 'El archivo no tiene la estructura esperada.');
  }
  return normalizePayloadForWrite(rawPayload, { generateMetadata: true });
}

export function parsePayload(text) {
  if (typeof text !== 'string') {
    return { ok: false, errors: ['El contenido no es texto JSON.'] };
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: ['El archivo no es un JSON válido.'] };
  }
  let payload;
  try {
    payload = migratePayload(raw);
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }
  const validation = validatePayload(payload);
  if (!validation.valid) return { ok: false, errors: validation.errors };
  return { ok: true, payload, errors: [] };
}

export function createPayload(db, meta) {
  const normalized = normalizeDB(db);
  const validation = validateDB(normalized);
  if (!validation.valid) {
    throw new StorageError('invalid_db', `Los datos no son válidos: ${validation.errors[0]}`, {
      errors: validation.errors
    });
  }
  return {
    schema_version: SCHEMA_VERSION,
    dataset_id: meta.dataset_id,
    revision: meta.revision,
    updated_at: meta.updated_at,
    device_label: meta.device_label ?? null,
    principal: normalized.principal,
    tarjetas: normalized.tarjetas,
    config: normalized.config,
    plantillas_fijas: normalized.plantillas_fijas
  };
}

export function serializePayload(payload) {
  return JSON.stringify(payload, null, 2);
}

export function getPayloadSummary(payload) {
  const principal = Array.isArray(payload.principal) ? payload.principal : [];
  const tarjetas = Array.isArray(payload.tarjetas) ? payload.tarjetas : [];
  const config = isPlainObject(payload.config) ? payload.config : {};
  return {
    ingresos: principal.filter((item) => item.tipo === 'Ingreso').length,
    gastos: principal.filter((item) => item.tipo === 'Gasto').length,
    tarjetas: tarjetas.length,
    plantillas: Array.isArray(payload.plantillas_fijas) ? payload.plantillas_fijas.length : 0,
    categoriasIngreso: Array.isArray(config.cat_ing) ? config.cat_ing.length : 0,
    categoriasGasto: Array.isArray(config.cat_gas) ? config.cat_gas.length : 0
  };
}

export function hasLocalData(db) {
  if (!isPlainObject(db)) return false;
  const principal = Array.isArray(db.principal) ? db.principal.length : 0;
  const tarjetas = Array.isArray(db.tarjetas) ? db.tarjetas.length : 0;
  const plantillas = Array.isArray(db.plantillas_fijas) ? db.plantillas_fijas.length : 0;
  return principal > 0 || tarjetas > 0 || plantillas > 0;
}

function freshPayload() {
  return {
    schema_version: SCHEMA_VERSION,
    dataset_id: newId(),
    revision: 1,
    updated_at: now(),
    device_label: null,
    ...createDefaultDB()
  };
}

function dbFromPayload(payload) {
  return {
    principal: payload.principal,
    tarjetas: payload.tarjetas,
    config: payload.config,
    plantillas_fijas: payload.plantillas_fijas
  };
}

function persistPayload(payload) {
  const text = serializePayload(payload);
  getAdapter().setItem(DB_KEY, text);
  current = { payload: clone(payload) };
  lastRaw = text;
}

export function loadDB() {
  const store = getAdapter();
  const raw = store.getItem(DB_KEY);
  if (raw === null || raw === undefined) {
    current = { payload: freshPayload() };
    lastRaw = null;
    return getDB();
  }
  const parsed = parsePayload(raw);
  if (!parsed.ok) {
    throw new StorageError('corrupt_data', `Los datos guardados no son válidos: ${parsed.errors[0]}`, {
      raw,
      errors: parsed.errors
    });
  }
  current = { payload: parsed.payload };
  lastRaw = raw;
  const normalizedText = serializePayload(parsed.payload);
  if (normalizedText !== raw) {
    store.setItem(DB_KEY, normalizedText);
    lastRaw = normalizedText;
  }
  return getDB();
}

export function getDB() {
  if (!current) loadDB();
  return clone(dbFromPayload(current.payload));
}

export function getPayloadMeta() {
  if (!current) loadDB();
  return {
    schema_version: current.payload.schema_version,
    dataset_id: current.payload.dataset_id,
    revision: current.payload.revision,
    updated_at: current.payload.updated_at,
    device_label: current.payload.device_label
  };
}

export function getPayload() {
  if (!current) loadDB();
  return clone(current.payload);
}

export function getRawPayloadText() {
  return getAdapter().getItem(DB_KEY);
}

export function isStale() {
  if (!current) return false;
  return getAdapter().getItem(DB_KEY) !== lastRaw;
}

export function assertFresh() {
  if (isStale()) {
    throw new StorageError(
      'stale_tab',
      'Otra pestaña modificó los datos. Recargá la aplicación antes de guardar o sincronizar.'
    );
  }
}

export function commitDB(nextDB) {
  assertFresh();
  const normalized = normalizeDB(nextDB);
  const validation = validateDB(normalized);
  if (!validation.valid) {
    throw new StorageError('invalid_db', `Los datos no son válidos: ${validation.errors[0]}`, {
      errors: validation.errors
    });
  }
  const meta = getPayloadMeta();
  const payload = {
    schema_version: SCHEMA_VERSION,
    dataset_id: meta.dataset_id,
    revision: meta.revision + 1,
    updated_at: now(),
    device_label: meta.device_label,
    ...normalized
  };
  persistPayload(payload);
  markLocalDirty();
  return getDB();
}

export function mutateDB(mutator) {
  if (typeof mutator !== 'function') {
    throw new StorageError('invalid_mutator', 'La mutación debe ser una función.');
  }
  const next = getDB();
  mutator(next);
  return commitDB(next);
}

export function replaceFromPayload(payload, options = {}) {
  assertFresh();
  const normalized = normalizePayloadForWrite(payload, { generateMetadata: false });
  const validation = validatePayload(normalized);
  if (!validation.valid) {
    throw new StorageError('invalid_payload', `El respaldo no es válido: ${validation.errors[0]}`, {
      errors: validation.errors
    });
  }
  persistPayload(normalized);
  if (options.pendingUpload) markLocalDirty();
  else clearLocalDirty();
  return getDB();
}

export function resetLocalData() {
  const payload = freshPayload();
  persistPayload(payload);
  updateSyncState({ local_dirty: false });
  return getDB();
}

export function onExternalDBChange(callback) {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => {};
  }
  const handler = (event) => {
    if (event.key === DB_KEY) callback();
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}

function sanitizeSyncState(raw) {
  const defaults = createDefaultSyncState();
  if (!isPlainObject(raw)) return defaults;
  return {
    connected: raw.connected === true,
    folderId: typeof raw.folderId === 'string' && raw.folderId ? raw.folderId : null,
    fileId: typeof raw.fileId === 'string' && raw.fileId ? raw.fileId : null,
    local_dirty: raw.local_dirty === true,
    last_synced_remote_version:
      typeof raw.last_synced_remote_version === 'string' && raw.last_synced_remote_version
        ? raw.last_synced_remote_version
        : null,
    last_synced_remote_md5:
      typeof raw.last_synced_remote_md5 === 'string' && raw.last_synced_remote_md5
        ? raw.last_synced_remote_md5
        : null,
    last_synced_at: isIsoDate(raw.last_synced_at) ? raw.last_synced_at : null,
    sync_error: typeof raw.sync_error === 'string' && raw.sync_error ? raw.sync_error.slice(0, 300) : null
  };
}

export function loadSyncState() {
  const raw = getAdapter().getItem(SYNC_KEY);
  if (!raw) return createDefaultSyncState();
  try {
    return sanitizeSyncState(JSON.parse(raw));
  } catch (error) {
    return createDefaultSyncState();
  }
}

export function getSyncState() {
  return loadSyncState();
}

export function saveSyncState(syncState) {
  const sanitized = sanitizeSyncState(syncState);
  getAdapter().setItem(SYNC_KEY, JSON.stringify(sanitized));
  return clone(sanitized);
}

export function updateSyncState(patch) {
  const next = { ...loadSyncState(), ...(patch || {}) };
  return saveSyncState(next);
}

export function markLocalDirty() {
  return updateSyncState({ local_dirty: true });
}

export function clearLocalDirty() {
  return updateSyncState({ local_dirty: false });
}

export function isLocalDirty() {
  return loadSyncState().local_dirty;
}

export function setDriveLocation(folderId, fileId) {
  return updateSyncState({ folderId: folderId || null, fileId: fileId || null });
}

export function getDriveLocation() {
  const state = loadSyncState();
  return { folderId: state.folderId, fileId: state.fileId };
}

export function clearDriveLocation() {
  return updateSyncState({ folderId: null, fileId: null });
}

export function getLastSyncedRemoteBase() {
  const state = loadSyncState();
  return {
    version: state.last_synced_remote_version,
    md5: state.last_synced_remote_md5
  };
}

export function setLastSyncedRemoteBase(remoteBase) {
  return updateSyncState({
    last_synced_remote_version: remoteBase && remoteBase.version ? String(remoteBase.version) : null,
    last_synced_remote_md5: remoteBase && remoteBase.md5 ? String(remoteBase.md5) : null
  });
}

export function clearLastSyncedRemoteBase() {
  return updateSyncState({ last_synced_remote_version: null, last_synced_remote_md5: null });
}

export function setLastSyncedAt(date) {
  return updateSyncState({ last_synced_at: isIsoDate(date) ? date : now() });
}

export function recordSyncError(message) {
  return updateSyncState({ sync_error: typeof message === 'string' ? message.slice(0, 300) : null });
}

export function clearSyncError() {
  return updateSyncState({ sync_error: null });
}

export function saveAutoBackup({ reason, at, filename, text }) {
  getAdapter().setItem(
    AUTO_BACKUP_KEY,
    JSON.stringify({ reason: reason || 'automatic', at: at || now(), filename: filename || null, text })
  );
}

export function getAutoBackup() {
  const raw = getAdapter().getItem(AUTO_BACKUP_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

export function getTheme() {
  const value = getAdapter().getItem(THEME_KEY);
  return value === 'dark' || value === 'pastel' ? value : 'basic';
}

export function setTheme(theme) {
  const value = theme === 'dark' || theme === 'pastel' ? theme : 'basic';
  getAdapter().setItem(THEME_KEY, value);
  return value;
}
