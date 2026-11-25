function getBootstrap() {
  return typeof bootstrap !== 'undefined' ? bootstrap : null;
}

function el(id) {
  return document.getElementById(id);
}

function formatDateLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function summarise(summary) {
  if (!summary) return 'Sin datos.';
  return `${summary.ingresos} ingresos, ${summary.gastos} gastos fijos, ${summary.tarjetas} tarjetas y ${summary.plantillas} plantillas.`;
}

function describePayload(meta, label) {
  if (!meta) return label;
  const parts = [];
  if (meta.revision !== undefined && meta.revision !== null) parts.push(`revisión ${meta.revision}`);
  if (meta.updated_at) {
    const label2 = formatDateLabel(meta.updated_at);
    if (label2) parts.push(label2);
  }
  const device = meta.device_label ? String(meta.device_label) : 'sin etiqueta';
  return `${label}: ${parts.join(', ') || 'sin datos'} (${device})`;
}

export function createDialogs(options = {}) {
  function openDialog(config) {
    const bootstrapApi = getBootstrap();
    const modalElement = el('modalDialog');
    if (!bootstrapApi || !modalElement) {
      return Promise.resolve(config.defaultValue !== undefined ? config.defaultValue : null);
    }
    el('dialog-title').textContent = config.title || '';
    el('dialog-message').textContent = config.message || '';
    const details = el('dialog-details');
    details.textContent = '';
    (config.details || []).forEach((text) => {
      const item = document.createElement('li');
      item.textContent = text;
      details.appendChild(item);
    });
    const actions = el('dialog-actions');
    actions.textContent = '';

    const modal = bootstrapApi.Modal.getOrCreateInstance(modalElement);
    return new Promise((resolve) => {
      let settled = false;
      const settle = (value) => {
        if (settled) return;
        settled = true;
        modalElement.removeEventListener('hidden.bs.modal', onHidden);
        modal.hide();
        resolve(value);
      };
      const onHidden = () => {
        if (!settled) {
          settled = true;
          modalElement.removeEventListener('hidden.bs.modal', onHidden);
          resolve(config.defaultValue !== undefined ? config.defaultValue : null);
        }
      };
      modalElement.addEventListener('hidden.bs.modal', onHidden);

      if (config.extraAction) {
        const extra = document.createElement('button');
        extra.type = 'button';
        extra.className = 'btn btn-sm btn-outline-secondary me-auto';
        extra.textContent = config.extraAction.label;
        extra.addEventListener('click', () => {
          try {
            config.extraAction.onClick();
          } catch (error) {
            // Exporting a copy must not break conflict resolution.
          }
        });
        actions.appendChild(extra);
      }
      (config.options || []).forEach((option) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `btn btn-sm ${option.className || 'btn-outline-secondary'}`;
        button.textContent = option.label;
        button.addEventListener('click', () => settle(option.value));
        actions.appendChild(button);
      });
      modal.show();
    });
  }

  function confirm(config) {
    return openDialog({
      title: config.title,
      message: config.message,
      details: config.details,
      options: [
        {
          value: true,
          label: config.confirmLabel || 'Aceptar',
          className: config.danger ? 'btn-danger' : 'btn-primary'
        },
        { value: false, label: config.cancelLabel || 'Cancelar', className: 'btn-outline-secondary' }
      ],
      defaultValue: false
    }).then((value) => value === true);
  }

  function choose(config) {
    return openDialog({
      title: config.title,
      message: config.message,
      details: config.details,
      extraAction: config.extraAction,
      options: config.options,
      defaultValue: config.defaultValue !== undefined ? config.defaultValue : null
    });
  }

  return {
    alert({ title, message, details }) {
      return openDialog({
        title,
        message,
        details,
        options: [{ value: true, label: 'Entendido', className: 'btn-primary' }],
        defaultValue: true
      });
    },
    confirm,
    choose,
    confirmCreateRemote(context) {
      return confirm({
        title: 'Crear copia en Google Drive',
        message: `No existe un archivo de datos en Drive. ¿Querés crear "${context.fileName}" dentro de "${context.folderName}"?`,
        details: [`Se subirán ${summarise(context.summary)}`],
        confirmLabel: 'Crear en Drive'
      });
    },
    confirmDownload(context) {
      return confirm({
        title: 'Descargar desde Google Drive',
        message: 'El archivo de Drive es válido y reemplazará los datos locales.',
        details: [
          `Datos remotos: ${summarise(context.summary)}`,
          'Se generará un backup local automático antes de reemplazar.'
        ],
        confirmLabel: 'Descargar y reemplazar'
      });
    },
    chooseConflict(context) {
      return choose({
        title: 'Conflicto de sincronización',
        message: 'Los datos locales y el archivo de Drive cambiaron desde la última sincronización.',
        details: [
          describePayload(context.localPayload, 'Este dispositivo'),
          describePayload(context.remotePayload, 'Archivo de Drive'),
          'La app no fusiona cambios registro por registro. Elegí qué versión conservar.'
        ],
        options: [
          { value: 'download', label: 'Descargar Drive', className: 'btn-primary' },
          { value: 'upload', label: 'Subir este dispositivo', className: 'btn-outline-primary' },
          { value: 'cancel', label: 'Cancelar', className: 'btn-outline-secondary' }
        ],
        extraAction: options.onExportLocalBackup
          ? { label: 'Exportar copia local', onClick: options.onExportLocalBackup }
          : null,
        defaultValue: 'cancel'
      });
    },
    chooseInitial(context) {
      return choose({
        title: 'Primera conexión con datos en ambos lados',
        message: 'Este dispositivo todavía no tiene una base común con el archivo de Drive.',
        details: [
          describePayload(context.localPayload, 'Este dispositivo'),
          describePayload(context.remotePayload, 'Archivo de Drive'),
          'Para proteger ambos lados, la app no sube ni descarga automáticamente.'
        ],
        options: [
          { value: 'download', label: 'Descargar Drive', className: 'btn-primary' },
          { value: 'upload', label: 'Subir este dispositivo', className: 'btn-outline-primary' },
          { value: 'cancel', label: 'Cancelar', className: 'btn-outline-secondary' }
        ],
        extraAction: options.onExportLocalBackup
          ? { label: 'Exportar copia local', onClick: options.onExportLocalBackup }
          : null,
        defaultValue: 'cancel'
      });
    },
    showDatasetMismatch(context) {
      return choose({
        title: 'Conjunto de datos distinto',
        message: 'El archivo de Drive no pertenece al mismo conjunto de datos que este dispositivo.',
        details: [
          `dataset_id local: ${context.localDatasetId}`,
          `dataset_id remoto: ${context.remoteDatasetId}`,
          'No se asociará automáticamente. Solo podés descargarlo si estás seguro, o cancelar.'
        ],
        options: [
          { value: 'download', label: 'Descargar de todos modos', className: 'btn-danger' },
          { value: 'cancel', label: 'Cancelar', className: 'btn-outline-secondary' }
        ],
        defaultValue: 'cancel'
      });
    }
  };
}

const STATUS_TEXT = {
  disconnected: 'Google Drive desconectado.',
  connecting: 'Conectando con Google Drive…',
  connected: 'Google Drive conectado.',
  syncing: 'Sincronizando con Google Drive…',
  updated: 'Sincronización completada.',
  error: 'No se pudo completar la operación.',
  conflict: 'Hay un conflicto pendiente de resolución.'
};

export function renderSyncPanel(state, options = {}) {
  const badge = el('sync-badge');
  const statusText = el('sync-status');
  const lastText = el('sync-last');
  const btnConnect = el('btn-connect');
  const btnDisconnect = el('btn-disconnect');
  const btnSync = el('btn-sync');
  if (!statusText) return;

  const driveConfigured = options.driveConfigured !== false;
  const busy = Boolean(el('sync-card') && el('sync-card').dataset.busy === 'true');
  const status = state.status || 'disconnected';
  const baseText = state.message || STATUS_TEXT[status] || '';
  let text = baseText;
  if (state.connected && state.dirty && status !== 'syncing') {
    text = `${text} Hay cambios locales pendientes de subir.`.trim();
  }
  statusText.textContent = text;

  if (lastText) {
    lastText.textContent = state.lastSyncedAt
      ? `Última sincronización: ${formatDateLabel(state.lastSyncedAt)}`
      : 'Todavía no sincronizaste con Google Drive.';
  }
  if (badge) {
    badge.textContent =
      status === 'updated'
        ? 'Actualizado'
        : status === 'error'
          ? 'Error'
          : status === 'conflict'
            ? 'Conflicto'
            : state.connected
              ? state.dirty
                ? 'Cambios pendientes'
                : 'Conectado'
              : 'Desconectado';
    badge.dataset.status = status;
    badge.dataset.dirty = state.dirty ? 'true' : 'false';
  }
  if (btnConnect) {
    btnConnect.style.display = state.connected ? 'none' : 'inline-block';
    btnConnect.disabled = !driveConfigured || busy;
    btnConnect.title = driveConfigured ? '' : 'Configurá GOOGLE_CLIENT_ID en js/config.js';
  }
  if (btnDisconnect) btnDisconnect.style.display = state.connected ? 'inline-block' : 'none';
  if (btnDisconnect) btnDisconnect.disabled = busy;
  if (btnSync) {
    btnSync.style.display = state.connected ? 'inline-block' : 'none';
    btnSync.disabled = !driveConfigured || busy;
  }
  if (!driveConfigured) {
    statusText.textContent =
      'Google Drive no está configurado. Agregá tu Client ID en js/config.js; el respaldo JSON local sigue funcionando.';
  }
}

export function setSyncBusy(isBusy) {
  ['btn-connect', 'btn-disconnect', 'btn-sync'].forEach((id) => {
    const button = el(id);
    if (button) button.disabled = Boolean(isBusy);
  });
  const card = el('sync-card');
  if (card) card.dataset.busy = isBusy ? 'true' : 'false';
}

export function showToast(message, type = 'info') {
  const container = el('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `app-toast app-toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('app-toast-out');
    setTimeout(() => toast.remove(), 300);
  }, 4200);
}

export function showExternalTabWarning(onReload) {
  const banner = el('external-tab-warning');
  if (!banner) return;
  banner.hidden = false;
  const button = el('btn-reload-tab');
  if (button && typeof onReload === 'function') {
    button.onclick = onReload;
  }
}

export function showImportPreview(dialogs, summary) {
  return dialogs.confirm({
    title: 'Importar respaldo',
    message: 'El archivo es válido y reemplazará los datos actuales.',
    details: [
      `Contiene ${summarise(summary)}`,
      'Se generará un backup automático del estado actual antes de reemplazarlo.',
      'Después de importar, los datos quedarán pendientes de subir a Drive.'
    ],
    confirmLabel: 'Importar y reemplazar'
  });
}

export function formatSummaryLine(summary) {
  return summarise(summary);
}
