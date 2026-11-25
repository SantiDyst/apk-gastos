import { configureStorage, resetStorage, setNowProvider } from '../../js/storage.js';

export const DATASET_A = '11111111-1111-4111-8111-111111111111';
export const DATASET_B = '22222222-2222-4222-8222-222222222222';
export const RECORD_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const RECORD_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const CARD_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

export function createMemoryAdapter(initial = {}) {
  const map = new Map(Object.entries(initial));
  const writes = [];
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      writes.push({ key, value: String(value) });
      map.set(key, String(value));
    },
    removeItem(key) {
      writes.push({ key, value: null });
      map.delete(key);
    },
    seed(key, value) {
      map.set(key, String(value));
    },
    read(key) {
      return map.has(key) ? map.get(key) : null;
    },
    writes,
    dump() {
      return Object.fromEntries(map);
    }
  };
}

export function freshStorage(seed = {}) {
  resetStorage();
  const adapter = createMemoryAdapter(seed);
  configureStorage(adapter);
  return adapter;
}

export function fixedClock(iso = '2026-11-25T10:00:00.000Z') {
  setNowProvider(() => iso);
}

export function makeRecord(overrides = {}) {
  return {
    id: RECORD_A,
    tipo: 'Gasto',
    descripcion: 'Alquiler',
    monto: 150000,
    categoria: 'Hogar',
    notes: '',
    estado: 'Pendiente',
    mes: 11,
    anio: 2026,
    ...overrides
  };
}

export function makeCard(overrides = {}) {
  return {
    id: CARD_A,
    descripcion: 'Notebook',
    montoTotal: 600000,
    cuotasTotales: 6,
    mesInicio: 11,
    anioInicio: 2026,
    ...overrides
  };
}

export function makePayload(overrides = {}) {
  return {
    schema_version: 1,
    dataset_id: DATASET_A,
    revision: 3,
    updated_at: '2026-11-20T12:00:00.000Z',
    device_label: 'Test device',
    principal: [makeRecord()],
    tarjetas: [makeCard()],
    config: {
      cat_ing: ['Sueldo', 'Otros'],
      cat_gas: ['Hogar', 'Comida'],
      presupuesto: null
    },
    plantillas_fijas: [],
    ...overrides
  };
}

export function oldPayload(overrides = {}) {
  return {
    principal: [makeRecord({ notes: undefined, notas: 'Nota vieja' })],
    tarjetas: [],
    config: { cat_ing: ['Sueldo'], cat_gas: ['Hogar'] },
    ...overrides
  };
}
