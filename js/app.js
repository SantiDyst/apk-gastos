import * as storage from './storage.js';
import * as backup from './backup.js';
import { createDriveApi, createGoogleAuth, createSyncService } from './drive-sync.js';
import {
  createDialogs,
  renderSyncPanel,
  setSyncBusy,
  showToast,
  showExternalTabWarning,
  showImportPreview
} from './ui.js';
import { GOOGLE_CLIENT_ID } from './config.js';

const THEMES = ['basic', 'dark', 'pastel'];
const THEME_META = { basic: '#2c3e50', dark: '#000000', pastel: '#6d5d6e' };
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

let db = null;
let dialogs = null;
let syncService = null;
let syncBusy = false;
let currentTheme = 'basic';
let mesAct = new Date().getMonth() + 1;
let anioAct = new Date().getFullYear();
let mGeneric = null;
let mTarjeta = null;

function createId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function el(id) {
  return document.getElementById(id);
}

function hasClientId() {
  return typeof GOOGLE_CLIENT_ID === 'string' && GOOGLE_CLIENT_ID.trim().length > 0;
}

function applyTheme(theme) {
  currentTheme = THEMES.includes(theme) ? theme : 'basic';
  document.documentElement.setAttribute('data-theme', currentTheme);
  const meta = el('meta-theme-color');
  if (meta) meta.setAttribute('content', THEME_META[currentTheme]);
}

function toggleTheme() {
  const nextIndex = (THEMES.indexOf(currentTheme) + 1) % THEMES.length;
  applyTheme(THEMES[nextIndex]);
  try {
    storage.setTheme(currentTheme);
  } catch (error) {
    // The theme is cosmetic; a storage failure must not break the app.
  }
}

function f(value) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 2
  }).format(Number.isFinite(value) ? value : 0);
}

function handleStorageError(error) {
  if (error && error.code === 'stale_tab') {
    showExternalTabWarning(() => window.location.reload());
    showToast(error.message, 'warning');
    return;
  }
  const message = (error && error.message) || 'No se pudo guardar el cambio.';
  showToast(message, 'danger');
}

function applyMutation(mutator) {
  try {
    db = storage.mutateDB(mutator);
    render();
    refreshSync();
    return true;
  } catch (error) {
    handleStorageError(error);
    return false;
  }
}

function initMonthUI() {
  const container = el('monthSelector');
  container.textContent = '';
  MESES.forEach((month, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `btn-month ${index + 1 === mesAct ? 'active' : ''}`;
    button.textContent = month;
    button.addEventListener('click', () => {
      mesAct = index + 1;
      updateMonthUI();
      render();
    });
    container.appendChild(button);
  });
  el('label-anio').textContent = String(anioAct);
}

function updateMonthUI() {
  const buttons = document.querySelectorAll('.btn-month');
  buttons.forEach((button, index) => button.classList.toggle('active', index + 1 === mesAct));
}

function changeYear(delta) {
  anioAct += delta;
  el('label-anio').textContent = String(anioAct);
  render();
}

function createTextElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

function renderList(containerId, items, emptyText, type) {
  const container = el(containerId);
  container.textContent = '';
  if (items.length === 0) {
    container.appendChild(createTextElement('p', 'text-muted small py-2 mb-0', emptyText));
    return;
  }
  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'row-item';

    const info = document.createElement('div');
    info.style.flex = '1';
    info.style.cursor = 'pointer';
    info.addEventListener('click', () => showModal(type, item.id));
    info.appendChild(createTextElement('div', 'fw-bold small', item.descripcion));
    info.appendChild(createTextElement('div', 'text-muted note-line', item.categoria));
    if (item.notes) {
      info.appendChild(createTextElement('div', 'text-info note-line note-italic', item.notes));
    }
    row.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'd-flex align-items-center gap-3';
    const amount = createTextElement('div', 'fw-bold small', f(item.monto));
    amount.style.cursor = 'pointer';
    amount.addEventListener('click', () => showModal(type, item.id));
    actions.appendChild(amount);

    if (item.tipo === 'Gasto') {
      const status = document.createElement('button');
      status.type = 'button';
      status.className = `status-dot ${item.estado === 'Pagado' ? 'status-pagado' : 'status-pendiente'}`;
      status.setAttribute(
        'aria-label',
        item.estado === 'Pagado' ? 'Marcar como pendiente' : 'Marcar como pagado'
      );
      status.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleStatus(item.id);
      });
      actions.appendChild(status);
    }
    row.appendChild(actions);
    container.appendChild(row);
  });
}

function renderListT(items) {
  const container = el('table-tarjetas');
  container.textContent = '';
  if (items.length === 0) {
    container.appendChild(createTextElement('p', 'text-muted small py-2 mb-0', 'Sin cuotas este mes'));
    return;
  }
  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'row-item';
    row.style.cursor = 'pointer';
    row.addEventListener('click', () => showModal('tarjeta', item.id));

    const info = document.createElement('div');
    info.style.flex = '1';
    info.appendChild(createTextElement('div', 'fw-bold small', item.descripcion));
    info.appendChild(createTextElement('div', 'text-info note-line', `Cuota ${item.cuotaInfo}`));
    const original = db.tarjetas.find((card) => card.id === item.id);
    if (original && original.notes) {
      info.appendChild(createTextElement('div', 'text-info note-line note-italic', original.notes));
    }
    row.appendChild(info);
    row.appendChild(createTextElement('div', 'fw-bold small', f(item.montoCuota)));
    container.appendChild(row);
  });
}

function render() {
  const ingresos = db.principal.filter(
    (item) => item.mes === mesAct && item.anio === anioAct && item.tipo === 'Ingreso'
  );
  const gastosFijos = db.principal.filter(
    (item) => item.mes === mesAct && item.anio === anioAct && item.tipo === 'Gasto'
  );

  let totalTarjetas = 0;
  const tarjetasActivas = [];
  db.tarjetas.forEach((card) => {
    const diff = (anioAct - card.anioInicio) * 12 + (mesAct - card.mesInicio);
    if (diff >= 0 && diff < card.cuotasTotales) {
      const montoCuota = card.montoTotal / card.cuotasTotales;
      tarjetasActivas.push({
        id: card.id,
        descripcion: card.descripcion,
        cuotaInfo: `${diff + 1}/${card.cuotasTotales}`,
        montoCuota
      });
      totalTarjetas += montoCuota;
    }
  });

  const totalIng = ingresos.reduce((sum, item) => sum + item.monto, 0);
  const totalFijos = gastosFijos.reduce((sum, item) => sum + item.monto, 0);
  const totalGas = totalFijos + totalTarjetas;
  const balance = totalIng - totalGas;

  el('res-ingresos').textContent = f(totalIng);
  el('res-gastos').textContent = f(totalGas);
  el('res-balance').textContent = f(balance);
  el('foot-fijos').textContent = f(totalFijos);
  el('foot-tarjetas').textContent = f(totalTarjetas);

  const balanceCard = el('balanceCard');
  balanceCard.className =
    balance >= 0
      ? 'finance-card mb-0 text-center bg-success bg-opacity-10 text-success'
      : 'finance-card mb-0 text-center bg-danger bg-opacity-10 text-danger';

  el('btn-clonar').style.display = gastosFijos.length === 0 ? 'inline-block' : 'none';

  renderList('table-gastos', gastosFijos, 'Sin registros', 'gasto');
  renderList('table-ingresos', ingresos, 'Sin registros', 'ingreso');
  renderListT(tarjetasActivas);
}

function addCategoryOption(select, category) {
  const option = document.createElement('option');
  option.value = category;
  option.textContent = category;
  select.appendChild(option);
}

function showModal(tipo, id = null) {
  if (tipo === 'tarjeta') {
    const form = el('formTarjeta');
    form.reset();
    const card = id ? db.tarjetas.find((item) => item.id === id) : null;
    el('card-id').value = id || '';
    el('modalTarjetaTitle').textContent = id ? 'Editar Tarjeta' : 'Nueva Tarjeta';
    el('btn-eliminar-tarjeta').style.display = id ? 'block' : 'none';
    el('btn-guardar-tarjeta').textContent = id ? 'Guardar Cambios' : 'Registrar';
    if (card) {
      el('card-desc').value = card.descripcion;
      el('card-total').value = card.montoTotal;
      el('card-cuotas').value = card.cuotasTotales;
    }
    mTarjeta.show();
    return;
  }

  const form = el('formGeneric');
  form.reset();
  const record = id ? db.principal.find((item) => item.id === id) : null;
  const resolvedTipo = record ? record.tipo : tipo === 'ingreso' ? 'Ingreso' : 'Gasto';
  el('form-id').value = id || '';
  el('form-tipo').value = resolvedTipo;
  el('modalTitle').textContent = id
    ? 'Editar Registro'
    : resolvedTipo === 'Ingreso'
      ? '💰 Ingreso'
      : '📌 Gasto';
  el('btn-eliminar').style.display = id ? 'block' : 'none';

  const select = el('form-cat');
  select.textContent = '';
  const categories = resolvedTipo === 'Ingreso' ? db.config.cat_ing : db.config.cat_gas;
  categories.forEach((category) => addCategoryOption(select, category));
  if (record && !categories.includes(record.categoria)) {
    addCategoryOption(select, record.categoria);
  }

  if (record) {
    el('form-desc').value = record.descripcion;
    el('form-monto').value = record.monto;
    el('form-cat').value = record.categoria;
    el('form-notas').value = record.notes || '';
  }
  mGeneric.show();
}

function submitPrincipal(event) {
  event.preventDefault();
  const id = el('form-id').value;
  const descripcion = el('form-desc').value.trim();
  const monto = Number.parseFloat(el('form-monto').value);
  const categoria = el('form-cat').value;
  if (!descripcion) {
    showToast('La descripción es obligatoria.', 'danger');
    return;
  }
  if (!Number.isFinite(monto) || monto <= 0) {
    showToast('Ingresá un monto válido mayor que cero.', 'danger');
    return;
  }
  if (!categoria) {
    showToast('Elegí una categoría.', 'danger');
    return;
  }
  const existing = id ? db.principal.find((item) => item.id === id) : null;
  const record = {
    id: id || createId(),
    mes: mesAct,
    anio: anioAct,
    tipo: el('form-tipo').value,
    descripcion,
    monto,
    categoria,
    notes: el('form-notas').value,
    estado: existing ? existing.estado : 'Pendiente'
  };
  const saved = applyMutation((next) => {
    if (id) {
      const index = next.principal.findIndex((item) => item.id === id);
      if (index === -1) throw new storage.StorageError('not_found', 'El registro ya no existe.');
      next.principal[index] = record;
    } else {
      next.principal.push(record);
    }
  });
  if (saved) {
    mGeneric.hide();
    showToast('Registro guardado.', 'success');
  }
}

function deletePrincipal() {
  const id = el('form-id').value;
  if (!id) return;
  if (!window.confirm('¿Eliminar este registro?')) return;
  const removed = applyMutation((next) => {
    next.principal = next.principal.filter((item) => item.id !== id);
  });
  if (removed) {
    mGeneric.hide();
    showToast('Registro eliminado.', 'success');
  }
}

function submitCard(event) {
  event.preventDefault();
  const id = el('card-id').value;
  const descripcion = el('card-desc').value.trim();
  const montoTotal = Number.parseFloat(el('card-total').value);
  const cuotasTotales = Number.parseInt(el('card-cuotas').value, 10);
  if (!descripcion) {
    showToast('La descripción es obligatoria.', 'danger');
    return;
  }
  if (!Number.isFinite(montoTotal) || montoTotal <= 0) {
    showToast('Ingresá un monto total válido mayor que cero.', 'danger');
    return;
  }
  if (!Number.isInteger(cuotasTotales) || cuotasTotales < 1) {
    showToast('Las cuotas deben ser un número entero mayor o igual que 1.', 'danger');
    return;
  }
  const existing = id ? db.tarjetas.find((item) => item.id === id) : null;
  const card = {
    id: id || createId(),
    mesInicio: existing ? existing.mesInicio : mesAct,
    anioInicio: existing ? existing.anioInicio : anioAct,
    descripcion,
    montoTotal,
    cuotasTotales,
    notes: existing && existing.notes ? existing.notes : ''
  };
  const saved = applyMutation((next) => {
    if (id) {
      const index = next.tarjetas.findIndex((item) => item.id === id);
      if (index === -1) throw new storage.StorageError('not_found', 'La compra ya no existe.');
      next.tarjetas[index] = card;
    } else {
      next.tarjetas.push(card);
    }
  });
  if (saved) {
    mTarjeta.hide();
    showToast('Compra en cuotas guardada.', 'success');
  }
}

function deleteCard() {
  const id = el('card-id').value;
  if (!id) return;
  if (!window.confirm('¿Eliminar este plan de cuotas?')) return;
  const removed = applyMutation((next) => {
    next.tarjetas = next.tarjetas.filter((item) => item.id !== id);
  });
  if (removed) {
    mTarjeta.hide();
    showToast('Compra eliminada.', 'success');
  }
}

function toggleStatus(id) {
  applyMutation((next) => {
    const record = next.principal.find((item) => item.id === id);
    if (!record) return;
    record.estado = record.estado === 'Pagado' ? 'Pendiente' : 'Pagado';
  });
}

function clonePreviousMonth() {
  if (!window.confirm('¿Copiar gastos fijos del mes anterior?')) return;
  const originMonth = mesAct === 1 ? 12 : mesAct - 1;
  const originYear = mesAct === 1 ? anioAct - 1 : anioAct;
  const cloned = applyMutation((next) => {
    const source = next.principal.filter(
      (item) => item.mes === originMonth && item.anio === originYear && item.tipo === 'Gasto'
    );
    source.forEach((item) => {
      next.principal.push({
        ...item,
        id: createId(),
        mes: mesAct,
        anio: anioAct,
        estado: 'Pendiente'
      });
    });
  });
  if (cloned) showToast('Gastos fijos copiados.', 'success');
}

function refreshSync() {
  if (!syncService) {
    renderSyncPanel(
      {
        status: 'disconnected',
        message: '',
        connected: false,
        dirty: false,
        lastSyncedAt: null
      },
      { driveConfigured: false }
    );
    return;
  }
  renderSyncPanel(syncService.getSyncStatus(), { driveConfigured: hasClientId() });
}

function withSyncBusy(callback) {
  return async () => {
    if (syncBusy) return;
    syncBusy = true;
    setSyncBusy(true);
    refreshSync();
    try {
      await callback();
    } finally {
      syncBusy = false;
      setSyncBusy(false);
      refreshSync();
    }
  };
}

async function onConnectDrive() {
  if (!hasClientId()) {
    showToast('Configurá el Client ID de Google en js/config.js para usar Drive.', 'warning');
    return;
  }
  await withSyncBusy(async () => {
    const result = await syncService.connectDrive();
    if (result.ok) showToast('Google Drive conectado.', 'success');
    else showToast(result.error.message, 'danger');
  })();
}

async function onDisconnectDrive() {
  const confirmed = await dialogs.confirm({
    title: 'Desconectar Google Drive',
    message: 'Se revocará el acceso en este dispositivo. No se borran los datos locales ni el archivo de Drive.',
    confirmLabel: 'Desconectar'
  });
  if (!confirmed) return;
  await withSyncBusy(async () => {
    await syncService.disconnectDrive();
    showToast('Google Drive desconectado.', 'success');
  })();
}

async function onSynchronize() {
  if (!hasClientId()) {
    showToast('Google Drive no está configurado.', 'warning');
    return;
  }
  await withSyncBusy(async () => {
    const result = await syncService.synchronize();
    if (result.ok) {
      if (result.action === 'upload') showToast('Datos subidos a Google Drive.', 'success');
      else if (result.action === 'download') showToast('Datos descargados desde Google Drive.', 'success');
      else if (result.action === 'create_remote') showToast('Copia creada en Google Drive.', 'success');
      else if (result.action === 'cancelled') showToast('Operación cancelada.', 'info');
      else showToast('Todo está actualizado.', 'success');
      db = storage.getDB();
      render();
    } else {
      showToast(result.error.message, 'danger');
      if (result.error.code === 'stale_tab') showExternalTabWarning(() => window.location.reload());
    }
  })();
}

async function onExportBackup() {
  try {
    const result = backup.exportLocalBackup();
    showToast(`Respaldo exportado: ${result.filename}`, 'success');
  } catch (error) {
    showToast((error && error.message) || 'No se pudo exportar el respaldo.', 'danger');
  }
}

async function onImportFile(file) {
  if (!file) return;
  const inspected = await backup.inspectBackupFile(file);
  if (!inspected.ok) {
    showToast(`No se importó nada: ${inspected.error}`, 'danger');
    return;
  }
  const confirmed = await showImportPreview(dialogs, inspected.summary);
  if (!confirmed) return;
  try {
    const result = await backup.importWithConfirmation(inspected, { confirm: async () => true });
    if (!result.imported) {
      showToast(result.error || 'Importación cancelada.', 'warning');
      return;
    }
    db = storage.getDB();
    render();
    refreshSync();
    showToast('Respaldo importado. Queda pendiente subirlo a Drive.', 'success');
  } catch (error) {
    handleStorageError(error);
  }
}

function showCorruptData(error) {
  const banner = el('corrupt-banner');
  const message = el('corrupt-message');
  if (message) message.textContent = error.message || 'No se pudieron leer los datos locales.';
  if (banner) banner.hidden = false;
  el('btn-export-raw').addEventListener('click', () => {
    const raw = storage.getRawPayloadText();
    if (raw) backup.downloadJSON(raw, 'finanzas_data_v3-crudo.json');
    else showToast('No hay contenido crudo para exportar.', 'warning');
  });
  el('btn-reset-data').addEventListener('click', async () => {
    const confirmed = await dialogs.confirm({
      title: 'Reiniciar datos locales',
      message: 'Esto descarta el contenido dañado de finanzas_data_v3. Exportá el contenido crudo antes si querés conservarlo.',
      confirmLabel: 'Reiniciar',
      danger: true
    });
    if (!confirmed) return;
    db = storage.resetLocalData();
    if (banner) banner.hidden = true;
    if (!syncService) {
      setupSync();
      storage.onExternalDBChange(handleExternalChange);
    }
    initMonthUI();
    render();
    refreshSync();
    showToast('Datos locales reiniciados.', 'success');
  });
}

function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then((registration) => {
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          const updateButton = el('update-btn');
          if (updateButton) updateButton.style.display = 'inline-block';
        }
      });
    });
  });
}

function setupSync() {
  const auth = createGoogleAuth({ clientId: GOOGLE_CLIENT_ID });
  const api = createDriveApi({ getToken: () => auth.getToken() });
  api.ensureAccess = () => auth.ensureDriveAccess();
  api.revokeAccess = () => auth.revokeDriveAccess();
  api.clearAccess = () => auth.clearAccessToken();
  syncService = createSyncService({
    api,
    dialogs,
    onChange: () => refreshSync()
  });
}

function wireUI() {
  mGeneric = new bootstrap.Modal(el('modalGeneric'));
  mTarjeta = new bootstrap.Modal(el('modalTarjeta'));

  el('btn-theme').addEventListener('click', toggleTheme);
  el('btn-year-prev').addEventListener('click', () => changeYear(-1));
  el('btn-year-next').addEventListener('click', () => changeYear(1));
  el('btn-add-gasto').addEventListener('click', () => showModal('gasto'));
  el('btn-add-tarjeta').addEventListener('click', () => showModal('tarjeta'));
  el('btn-clonar').addEventListener('click', clonePreviousMonth);
  el('card-ingresos').addEventListener('click', () => showModal('ingreso'));

  el('formGeneric').addEventListener('submit', submitPrincipal);
  el('formTarjeta').addEventListener('submit', submitCard);
  el('btn-eliminar').addEventListener('click', deletePrincipal);
  el('btn-eliminar-tarjeta').addEventListener('click', deleteCard);

  el('btn-export').addEventListener('click', onExportBackup);
  el('btn-import').addEventListener('click', () => el('file-import').click());
  el('file-import').addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    await onImportFile(file);
  });

  el('btn-connect').addEventListener('click', onConnectDrive);
  el('btn-disconnect').addEventListener('click', onDisconnectDrive);
  el('btn-sync').addEventListener('click', onSynchronize);
  el('update-btn').addEventListener('click', () => window.location.reload());
}

function handleExternalChange() {
  showExternalTabWarning(() => window.location.reload());
  showToast('Otra pestaña modificó los datos. Recargá antes de seguir.', 'warning');
}

function initApp() {
  dialogs = createDialogs({ onExportLocalBackup: () => onExportBackup() });
  try {
    applyTheme(storage.getTheme());
  } catch (error) {
    applyTheme('basic');
  }
  wireUI();
  setupServiceWorker();

  try {
    db = storage.loadDB();
  } catch (error) {
    showCorruptData(error);
    return;
  }

  setupSync();
  storage.onExternalDBChange(handleExternalChange);

  initMonthUI();
  render();
  refreshSync();

  if (!hasClientId()) {
    const button = el('btn-connect');
    if (button) button.title = 'Configurá GOOGLE_CLIENT_ID en js/config.js';
  }
}

initApp();
