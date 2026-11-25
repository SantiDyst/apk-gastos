import * as storage from './storage.js';
import * as backup from './backup.js';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const APP_FOLDER_NAME = 'APK Gastos';
export const DATA_FILE_NAME = 'apk-gastos-data.json';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';

const FILE_FIELDS = 'id,name,version,md5Checksum,modifiedTime,trashed,mimeType,parents';
const API_BASE = 'https://www.googleapis.com/drive/v3';
const UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const GIS_URL = 'https://accounts.google.com/gsi/client';

export class SyncError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SyncError';
    this.code = code;
    this.details = details;
  }
}

export function buildRemoteBase(metadata) {
  if (!metadata) return null;
  return {
    version: metadata.version !== undefined && metadata.version !== null ? String(metadata.version) : null,
    md5: metadata.md5Checksum || null
  };
}

export function remoteBaseEquals(left, right) {
  if (!left || !right) return false;
  const comparisons = [];
  if (left.version && right.version) comparisons.push(left.version === right.version);
  if (left.md5 && right.md5) comparisons.push(left.md5 === right.md5);
  if (comparisons.length === 0) return false;
  return comparisons.every(Boolean);
}

export function hasRemoteChanged(currentBase, knownBase) {
  if (!knownBase) return null;
  if (!currentBase) return true;
  if (!currentBase.version && !currentBase.md5) return true;
  const comparisons = [];
  if (currentBase.version && knownBase.version) {
    comparisons.push(currentBase.version === knownBase.version);
  }
  if (currentBase.md5 && knownBase.md5) {
    comparisons.push(currentBase.md5 === knownBase.md5);
  }
  if (comparisons.length === 0) return true;
  return !comparisons.every(Boolean);
}

export function decideSyncAction(context) {
  const { hasLocalData, localDirty, hasRemoteFile, hasKnownBase, remoteChanged } = context;
  if (context.sameContent) return 'noop';
  if (!hasRemoteFile) return hasLocalData ? 'create_remote' : 'noop';
  if (!hasKnownBase) return hasLocalData ? 'initial_choice' : 'download';
  if (localDirty && remoteChanged) return 'conflict';
  if (localDirty) return 'upload';
  if (remoteChanged) return 'download';
  return 'noop';
}

export function isDatasetMismatch(remotePayload, localDatasetId) {
  if (!remotePayload || !localDatasetId) return false;
  return Boolean(remotePayload.dataset_id) && remotePayload.dataset_id !== localDatasetId;
}

export function isMissingRemoteFile(error) {
  return Boolean(error && (error.code === 'not_found' || error.code === 'trashed'));
}

function httpMessage(status) {
  if (status === 401) return 'La sesión de Google venció. Volvé a conectar Google Drive.';
  if (status === 403) return 'Google Drive rechazó la operación por permisos.';
  if (status === 404 || status === 410) return 'El archivo o la carpeta ya no existe en Google Drive.';
  if (status === 429) return 'Google Drive pidió esperar antes de reintentar.';
  if (status >= 500) return 'Google Drive no está disponible en este momento.';
  return `Google Drive devolvió un error (HTTP ${status}).`;
}

function escapeQueryName(name) {
  return String(name).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function isExpectedDataFile(metadata, folderId, fileName) {
  if (!metadata || metadata.trashed) return false;
  if (metadata.name !== fileName) return false;
  if (metadata.mimeType !== undefined && metadata.mimeType !== null && metadata.mimeType !== 'application/json') {
    return false;
  }
  if (folderId) {
    if (!Array.isArray(metadata.parents) || !metadata.parents.includes(folderId)) return false;
  }
  return true;
}

export function createDriveApi(options = {}) {
  const fetchImpl = options.fetchImpl || ((...args) => globalThis.fetch(...args));
  const getToken = options.getToken;
  const folderName = options.folderName || APP_FOLDER_NAME;
  const fileName = options.fileName || DATA_FILE_NAME;
  const apiBase = options.apiBase || API_BASE;
  const uploadBase = options.uploadBase || UPLOAD_BASE;

  async function request(url, requestOptions = {}) {
    let token;
    try {
      token = await getToken();
    } catch (error) {
      if (error instanceof SyncError) throw error;
      throw new SyncError('auth_required', 'La sesión de Google no está activa.');
    }
    if (!token) throw new SyncError('auth_required', 'La sesión de Google no está activa.');
    let response;
    try {
      response = await fetchImpl(url, {
        ...requestOptions,
        headers: { ...(requestOptions.headers || {}), Authorization: `Bearer ${token}` },
        cache: 'no-store'
      });
    } catch (error) {
      throw new SyncError('network', 'No se pudo conectar con Google Drive.', {
        cause: String((error && error.message) || error)
      });
    }
    if (!response || !response.ok) {
      const status = response ? response.status : 0;
      let body = '';
      try {
        body = await response.text();
      } catch (error) {
        body = '';
      }
      const code =
        status === 401
          ? 'unauthorized'
          : status === 403
            ? 'forbidden'
            : status === 404 || status === 410
              ? 'not_found'
              : 'api_error';
      throw new SyncError(code, httpMessage(status), { status, body: String(body).slice(0, 200) });
    }
    return response;
  }

  async function readJson(response) {
    try {
      return await response.json();
    } catch (error) {
      throw new SyncError('api_error', 'Google Drive devolvió una respuesta ilegible.');
    }
  }

  async function getFileMetadata(fileId) {
    const url = `${apiBase}/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(FILE_FIELDS)}`;
    const metadata = await readJson(await request(url));
    if (metadata && metadata.trashed) {
      throw new SyncError('trashed', 'El archivo está en la papelera de Google Drive.');
    }
    return metadata;
  }

  async function findAppFolders() {
    const query = `mimeType = '${FOLDER_MIME}' and name = '${escapeQueryName(folderName)}' and trashed = false and 'root' in parents`;
    const url = `${apiBase}/files?spaces=drive&fields=${encodeURIComponent(`files(${FILE_FIELDS})`)}&q=${encodeURIComponent(query)}`;
    const data = await readJson(await request(url));
    return data.files || [];
  }

  async function findDataFiles(folderId) {
    let query = `name = '${escapeQueryName(fileName)}' and trashed = false`;
    if (folderId) query += ` and '${escapeQueryName(folderId)}' in parents`;
    const url = `${apiBase}/files?spaces=drive&fields=${encodeURIComponent(`files(${FILE_FIELDS})`)}&q=${encodeURIComponent(query)}`;
    const data = await readJson(await request(url));
    return data.files || [];
  }

  async function createFolder() {
    const url = `${apiBase}/files?fields=${encodeURIComponent(FILE_FIELDS)}`;
    const response = await request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name: folderName, mimeType: FOLDER_MIME, parents: ['root'] })
    });
    return readJson(response);
  }

  async function createFile(folderId, text) {
    const boundary = `apk_gastos_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const metadata = JSON.stringify({ name: fileName, mimeType: 'application/json', parents: [folderId] });
    const body =
      `--${boundary}\r\n` +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      `${metadata}\r\n` +
      `--${boundary}\r\n` +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      `${text}\r\n` +
      `--${boundary}--`;
    const url = `${uploadBase}/files?uploadType=multipart&fields=${encodeURIComponent(FILE_FIELDS)}`;
    const response = await request(url, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body
    });
    return readJson(response);
  }

  async function updateFile(fileId, text) {
    const url = `${uploadBase}/files/${encodeURIComponent(fileId)}?uploadType=media&fields=${encodeURIComponent(FILE_FIELDS)}`;
    const response = await request(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: text
    });
    return readJson(response);
  }

  async function downloadFile(fileId) {
    const url = `${apiBase}/files/${encodeURIComponent(fileId)}?alt=media`;
    const response = await request(url);
    return response.text();
  }

  async function resolveFolder(context = {}) {
    const knownFolderId = context.knownFolderId;
    if (knownFolderId) {
      try {
        const metadata = await getFileMetadata(knownFolderId);
        if (metadata.mimeType === FOLDER_MIME) return metadata;
      } catch (error) {
        if (isMissingRemoteFile(error)) {
          // Fall through to a name search before creating anything.
        } else {
          throw error;
        }
      }
    }
    const folders = await findAppFolders();
    if (folders.length === 0) return null;
    if (folders.length > 1) {
      throw new SyncError(
        'ambiguous_location',
        'Hay varias carpetas "APK Gastos" en Drive. Depurá la ubicación antes de sincronizar.'
      );
    }
    return folders[0];
  }

  async function resolveFile(folderId, context = {}) {
    const knownFileId = context.knownFileId;
    if (knownFileId) {
      try {
        const metadata = await getFileMetadata(knownFileId);
        if (isExpectedDataFile(metadata, folderId, fileName)) return metadata;
        // The stored id still exists but no longer points to our data file:
        // ignore it and search by name/folder before creating anything.
      } catch (error) {
        if (isMissingRemoteFile(error)) {
          // Fall through to a name search.
        } else {
          throw error;
        }
      }
    }
    const files = await findDataFiles(folderId);
    const expected = files.filter((file) => isExpectedDataFile(file, folderId, fileName));
    if (expected.length === 0) {
      if (files.length > 0) {
        throw new SyncError(
          'ambiguous_location',
          'Hay un archivo con el nombre esperado en Drive que no es un respaldo JSON válido. Depurá la ubicación antes de sincronizar.'
        );
      }
      return null;
    }
    if (expected.length > 1) {
      throw new SyncError(
        'ambiguous_location',
        'Hay varios archivos "apk-gastos-data.json" en Drive. Depurá la ubicación antes de sincronizar.'
      );
    }
    return expected[0];
  }

  return {
    getFileMetadata,
    findAppFolders,
    findDataFiles,
    createFolder,
    createFile,
    updateFile,
    downloadFile,
    resolveFolder,
    resolveFile
  };
}

function injectScript(src) {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new SyncError('gis_unavailable', 'Google Identity Services solo está disponible en el navegador.'));
      return;
    }
    const googleApi = globalThis.google && globalThis.google.accounts && globalThis.google.accounts.oauth2;
    if (googleApi) {
      resolve();
      return;
    }
    const existing = Array.from(document.querySelectorAll('script')).find((script) => script.src === src);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () =>
        reject(new SyncError('gis_unavailable', 'No se pudo cargar Google Identity Services.'))
      );
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new SyncError('gis_unavailable', 'No se pudo cargar Google Identity Services.'));
    document.head.appendChild(script);
  });
}

export function createGoogleAuth(options = {}) {
  const clientId = options.clientId || '';
  const scope = options.scope || DRIVE_SCOPE;
  const loadScript = options.loadScript || injectScript;
  let token = null;
  let expiresAt = 0;
  let tokenClient = null;

  function hasValidAccessToken() {
    return Boolean(token) && Date.now() < expiresAt - 30_000;
  }

  function clearAccessToken() {
    token = null;
    expiresAt = 0;
  }

  async function loadGIS() {
    if (!clientId) {
      throw new SyncError(
        'missing_client_id',
        'Falta configurar el Client ID de Google en js/config.js. Google Drive está deshabilitado; el resto de la app funciona normalmente.'
      );
    }
    await loadScript(GIS_URL);
    if (!globalThis.google || !globalThis.google.accounts || !globalThis.google.accounts.oauth2) {
      throw new SyncError('gis_unavailable', 'Google Identity Services no está disponible.');
    }
  }

  function initTokenClient() {
    if (tokenClient) return tokenClient;
    if (!clientId) {
      throw new SyncError('missing_client_id', 'Falta configurar el Client ID de Google en js/config.js.');
    }
    tokenClient = globalThis.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope,
      callback: () => {}
    });
    return tokenClient;
  }

  function requestDriveAccess() {
    return new Promise((resolve, reject) => {
      let client;
      try {
        client = initTokenClient();
      } catch (error) {
        reject(error);
        return;
      }
      client.callback = (response) => {
        if (!response || response.error) {
          reject(
            new SyncError(
              'auth_denied',
              'No se otorgó el acceso a Google Drive.',
              { reason: response && response.error ? String(response.error).slice(0, 80) : 'unknown' }
            )
          );
          return;
        }
        if (!response.access_token) {
          reject(new SyncError('auth_denied', 'Google no devolvió un token de acceso.'));
          return;
        }
        const grantedScope = typeof response.scope === 'string' ? response.scope.split(/\s+/) : [];
        if (!grantedScope.includes(scope)) {
          reject(
            new SyncError(
              'scope_missing',
              'El permiso otorgado no incluye el acceso necesario a Google Drive. Volvé a intentarlo y aceptá el permiso de archivos.'
            )
          );
          return;
        }
        token = response.access_token;
        const lifetimeSeconds = Number(response.expires_in) > 0 ? Number(response.expires_in) : 3600;
        expiresAt = Date.now() + lifetimeSeconds * 1000;
        resolve(token);
      };
      try {
        client.requestAccessToken({ prompt: '' });
      } catch (error) {
        reject(new SyncError('auth_failed', 'No se pudo iniciar la autorización de Google.'));
      }
    });
  }

  async function ensureDriveAccess() {
    if (hasValidAccessToken()) return token;
    await loadGIS();
    return requestDriveAccess();
  }

  function getToken() {
    if (!hasValidAccessToken()) {
      throw new SyncError('auth_required', 'La sesión de Google venció. Volvé a conectar Google Drive.');
    }
    return token;
  }

  async function revokeDriveAccess() {
    const currentToken = token;
    clearAccessToken();
    if (!currentToken) return;
    try {
      const googleApi = globalThis.google && globalThis.google.accounts && globalThis.google.accounts.oauth2;
      if (googleApi && typeof googleApi.revoke === 'function') {
        googleApi.revoke(currentToken, () => {});
        return;
      }
      if (typeof globalThis.fetch === 'function') {
        await globalThis.fetch('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `token=${encodeURIComponent(currentToken)}`
        });
      }
    } catch (error) {
      // Revocation requires network; local cleanup still completes without it.
    }
  }

  return {
    hasValidAccessToken,
    clearAccessToken,
    loadGIS,
    initTokenClient,
    requestDriveAccess,
    ensureDriveAccess,
    getToken,
    revokeDriveAccess
  };
}

const DEFAULT_DIALOGS = {
  confirmCreateRemote: async () => false,
  chooseConflict: async () => 'cancel',
  chooseInitial: async () => 'cancel',
  confirmDownload: async () => false,
  showDatasetMismatch: async () => 'cancel'
};

function safeError(error) {
  if (error && error.code && error.message) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof storage.StorageError) {
    return { code: error.code, message: error.message };
  }
  return { code: 'unexpected', message: 'Ocurrió un error inesperado durante la sincronización.' };
}

export function createSyncService(options = {}) {
  const api = options.api;
  const dialogs = { ...DEFAULT_DIALOGS, ...(options.dialogs || {}) };
  const now = options.now || (() => new Date().toISOString());
  const onChange = typeof options.onChange === 'function' ? options.onChange : null;

  let syncing = false;
  let status = storage.getSyncState().connected ? 'connected' : 'disconnected';
  let message = '';

  function emit() {
    if (onChange) onChange(getSyncStatus());
  }

  function setStatus(next, nextMessage = '') {
    status = next;
    message = nextMessage;
    emit();
  }

  function getSyncStatus() {
    const sync = storage.getSyncState();
    return {
      status,
      message,
      connected: sync.connected,
      dirty: sync.local_dirty,
      folderId: sync.folderId,
      fileId: sync.fileId,
      lastSyncedAt: sync.last_synced_at,
      lastError: sync.sync_error
    };
  }

  function fail(error) {
    const safe = safeError(error);
    storage.recordSyncError(`${safe.code}: ${safe.message}`);
    setStatus('error', safe.message);
    return { ok: false, error: safe };
  }

  function completeSync(metadata, folderId, datasetId) {
    storage.updateSyncState({
      connected: true,
      folderId: folderId || null,
      fileId: metadata && metadata.id ? metadata.id : null,
      local_dirty: false,
      last_synced_remote_version:
        metadata && metadata.version !== undefined && metadata.version !== null ? String(metadata.version) : null,
      last_synced_remote_md5: (metadata && metadata.md5Checksum) || null,
      last_synced_at: now(),
      sync_error: null
    });
    return datasetId;
  }

  async function connectDrive() {
    if (syncing) return { ok: false, error: { code: 'sync_in_progress', message: 'Ya hay una operación en curso.' } };
    syncing = true;
    setStatus('connecting', 'Conectando con Google Drive…');
    try {
      await api.ensureAccess();
      const sync = storage.getSyncState();
      const folder = await api.resolveFolder({ knownFolderId: sync.folderId });
      const file = folder ? await api.resolveFile(folder.id, { knownFileId: sync.fileId }) : null;
      storage.clearSyncError();
      storage.updateSyncState({
        connected: true,
        folderId: folder ? folder.id : null,
        fileId: file ? file.id : null
      });
      setStatus(
        'connected',
        file
          ? 'Google Drive conectado. Archivo encontrado.'
          : folder
            ? 'Google Drive conectado. Todavía no hay archivo de datos.'
            : 'Google Drive conectado. Se creará la carpeta al sincronizar.'
      );
      return { ok: true, folder, file };
    } catch (error) {
      return fail(error);
    } finally {
      syncing = false;
    }
  }

  async function disconnectDrive() {
    try {
      await api.revokeAccess();
    } catch (error) {
      // The local association is cleared even if revocation cannot reach Google.
    }
    if (typeof api.clearAccess === 'function') api.clearAccess();
    storage.clearDriveLocation();
    storage.clearLastSyncedRemoteBase();
    storage.updateSyncState({ connected: false, sync_error: null });
    setStatus('disconnected', 'Google Drive desconectado. Los datos locales y el archivo remoto no se modificaron.');
    return { ok: true, ...getSyncStatus() };
  }

  async function doDownload({ remotePayload, remoteMeta, folderId, reason, needsConfirmation }) {
    if (needsConfirmation) {
      const confirmed = await dialogs.confirmDownload({
        summary: storage.getPayloadSummary(remotePayload),
        remoteMeta,
        reason
      });
      if (!confirmed) {
        setStatus('connected', 'Descarga cancelada. No se modificó ningún dato.');
        return { ok: true, action: 'cancelled' };
      }
    }
    backup.createAutomaticBackup(reason || 'before-download');
    storage.replaceFromPayload(remotePayload, { pendingUpload: false });
    completeSync(remoteMeta, folderId, remotePayload.dataset_id);
    setStatus('updated', 'Datos descargados desde Google Drive.');
    return { ok: true, action: 'download' };
  }

  async function doUpload({ fileMeta, folderId, localText, datasetId }) {
    const fresh = await api.getFileMetadata(fileMeta.id);
    if (!remoteBaseEquals(buildRemoteBase(fresh), buildRemoteBase(fileMeta))) {
      throw new SyncError(
        'remote_changed',
        'El archivo de Drive cambió durante la operación. Volvé a sincronizar para revisar los cambios.'
      );
    }
    let uploaded;
    try {
      uploaded = await api.updateFile(fileMeta.id, localText);
    } catch (error) {
      if (error && error.code === 'network') {
        storage.recordSyncError('upload_uncertain: no se pudo confirmar la subida a Google Drive.');
        setStatus(
          'error',
          'No se pudo confirmar la subida. La próxima sincronización va a volver a leer Drive; no se reintenta a ciegas.'
        );
        return {
          ok: false,
          error: {
            code: 'upload_uncertain',
            message: 'No se pudo confirmar la subida a Google Drive.'
          }
        };
      }
      throw error;
    }
    completeSync(uploaded, folderId, datasetId);
    setStatus('updated', 'Datos subidos a Google Drive.');
    return { ok: true, action: 'upload' };
  }

  async function createRemote({ folder, localText, datasetId, summary }) {
    const confirmed = await dialogs.confirmCreateRemote({
      summary,
      folderName: APP_FOLDER_NAME,
      fileName: DATA_FILE_NAME
    });
    if (!confirmed) {
      setStatus('connected', 'Creación del archivo remoto cancelada.');
      return { ok: true, action: 'cancelled' };
    }

    // Re-locate after the confirmation dialog: another device may have created
    // the folder or file while the user was deciding.
    let targetFolder = await api.resolveFolder({ knownFolderId: folder ? folder.id : null });
    const appeared = await api.resolveFile(targetFolder ? targetFolder.id : null, { knownFileId: null });
    if (appeared) {
      throw new SyncError(
        'remote_appeared',
        'El archivo de Drive apareció durante la confirmación. Volvé a sincronizar para revisar los cambios; no se creó un duplicado.'
      );
    }
    if (!targetFolder) {
      const createdFolder = await api.createFolder();
      const folders = await api.findAppFolders();
      if (folders.length > 1) {
        throw new SyncError(
          'ambiguous_location',
          'Se creó más de una carpeta "APK Gastos" durante la operación. Depurá la ubicación antes de sincronizar.'
        );
      }
      targetFolder = folders[0] || createdFolder;
    }
    const created = await api.createFile(targetFolder.id, localText);
    completeSync(created, targetFolder.id, datasetId);
    setStatus('updated', 'Copia inicial creada en Google Drive.');
    return { ok: true, action: 'create_remote' };
  }

  async function resolveConflict(context, localText, folderId) {
    const choice = await dialogs.chooseConflict(context);
    if (choice === 'download') {
      return doDownload({
        remotePayload: context.remotePayload,
        remoteMeta: context.remoteMeta,
        folderId,
        reason: 'before-conflict-download',
        needsConfirmation: false
      });
    }
    if (choice === 'upload') {
      return doUpload({
        fileMeta: context.remoteMeta,
        folderId,
        localText,
        datasetId: context.datasetId
      });
    }
    setStatus('conflict', 'Conflicto sin resolver. No se modificó ningún dato.');
    return { ok: true, action: 'cancelled' };
  }

  async function resolveInitialChoice(context, localText, folderId) {
    const choice = await dialogs.chooseInitial(context);
    if (choice === 'download') {
      return doDownload({
        remotePayload: context.remotePayload,
        remoteMeta: context.remoteMeta,
        folderId,
        reason: 'before-initial-download',
        needsConfirmation: false
      });
    }
    if (choice === 'upload') {
      return doUpload({
        fileMeta: context.remoteMeta,
        folderId,
        localText,
        datasetId: context.datasetId
      });
    }
    setStatus('connected', 'Primera conexión sin cambios. No se modificó ningún dato.');
    return { ok: true, action: 'cancelled' };
  }

  async function synchronize() {
    if (syncing) {
      return {
        ok: false,
        error: { code: 'sync_in_progress', message: 'Ya hay una sincronización en curso en esta pestaña.' }
      };
    }
    syncing = true;
    setStatus('syncing', 'Sincronizando con Google Drive…');
    try {
      storage.assertFresh();
      const db = storage.getDB();
      const meta = storage.getPayloadMeta();
      const localPayload = storage.createPayload(db, meta);
      const localValidation = storage.validatePayload(localPayload);
      if (!localValidation.valid) {
        throw new SyncError('invalid_local', `Los datos locales no son válidos: ${localValidation.errors[0]}`);
      }
      const localText = storage.serializePayload(localPayload);
      const localHasData = storage.hasLocalData(db);
      const sync = storage.getSyncState();

      await api.ensureAccess();
      const folder = await api.resolveFolder({ knownFolderId: sync.folderId });
      const folderId = folder ? folder.id : null;
      const fileMeta = await api.resolveFile(folderId, { knownFileId: sync.fileId });

      if (!fileMeta) {
        if (!localHasData) {
          setStatus('connected', 'No hay datos locales para subir y no existe un archivo en Drive.');
          return { ok: true, action: 'noop' };
        }
        return await createRemote({
          folder,
          localText,
          datasetId: localPayload.dataset_id,
          summary: storage.getPayloadSummary(localPayload)
        });
      }

      const remoteText = await api.downloadFile(fileMeta.id);
      const parsed = backup.parseFromDrive(remoteText);
      if (!parsed.ok) {
        throw new SyncError(
          'invalid_remote',
          `El archivo de Drive no es un respaldo válido: ${parsed.errors[0]}`
        );
      }
      const remotePayload = parsed.payload;
      const knownBase = storage.getLastSyncedRemoteBase();
      const hasKnownBase = Boolean(knownBase.version || knownBase.md5);

      if (hasKnownBase && localHasData && isDatasetMismatch(remotePayload, localPayload.dataset_id)) {
        const choice = await dialogs.showDatasetMismatch({
          localDatasetId: localPayload.dataset_id,
          remoteDatasetId: remotePayload.dataset_id,
          remoteMeta: fileMeta
        });
        if (choice === 'download') {
          return await doDownload({
            remotePayload,
            remoteMeta: fileMeta,
            folderId,
            reason: 'before-dataset-change',
            needsConfirmation: false
          });
        }
        throw new SyncError(
          'dataset_mismatch',
          'El archivo de Drive pertenece a otro conjunto de datos. No se modificó nada.'
        );
      }

      const sameContent = storage.canonicalJSON(localPayload) === storage.canonicalJSON(remotePayload);
      const currentBase = buildRemoteBase(fileMeta);
      const remoteChanged = hasKnownBase ? hasRemoteChanged(currentBase, knownBase) : null;
      const action = decideSyncAction({
        hasLocalData: localHasData,
        localDirty: sync.local_dirty,
        hasRemoteFile: true,
        hasKnownBase,
        remoteChanged,
        sameContent: localHasData && sameContent
      });

      if (action === 'noop') {
        completeSync(fileMeta, folderId, remotePayload.dataset_id);
        setStatus('updated', 'Todo está actualizado. No fue necesario escribir en Drive.');
        return { ok: true, action: 'noop' };
      }

      if (action === 'upload') {
        return await doUpload({
          fileMeta,
          folderId,
          localText,
          datasetId: localPayload.dataset_id
        });
      }

      if (action === 'download') {
        return await doDownload({
          remotePayload,
          remoteMeta: fileMeta,
          folderId,
          reason: localHasData ? 'before-remote-download' : 'before-initial-download',
          needsConfirmation: !localHasData
        });
      }

      if (action === 'initial_choice') {
        return await resolveInitialChoice(
          {
            localPayload,
            remotePayload,
            remoteMeta: fileMeta,
            datasetId: localPayload.dataset_id
          },
          localText,
          folderId
        );
      }

      return await resolveConflict(
        {
          localPayload,
          remotePayload,
          remoteMeta: fileMeta,
          datasetId: localPayload.dataset_id,
          hasKnownBase
        },
        localText,
        folderId
      );
    } catch (error) {
      return fail(error);
    } finally {
      syncing = false;
    }
  }

  return {
    connectDrive,
    disconnectDrive,
    synchronize,
    getSyncStatus
  };
}
