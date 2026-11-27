# Mejoras de Uso Personal — Especificación

Mejoras a implementar en la app actual (`index.html`), pensadas para uso
personal o pocos usuarios. Cada una es independiente y se puede implementar y
probar por separado, en el orden en que aparecen.

## Reglas generales (aplican a todas)

- No se rompe lo que ya funciona: los datos existentes en `localStorage`
  (`finanzas_data_v3`) se conservan.
- Cada cambio que toca datos pasa por `saveDB()` y la lectura centralizada de
  `db`; no se escribe `localStorage` en otros lugares.
- Cada mejora es un commit separado, con su verificación.
- La UI sigue en español; código, comentarios y mensajes de commit en inglés.

---

## Mejora 1 — Backup: exportar e importar

### Reglas de negocio

- El usuario puede exportar todos sus datos (ingresos, gastos, tarjetas,
  categorías y demás configuraciones o plantillas implementadas) a un archivo
  JSON descargable.
- El archivo exportado debe permitir recuperar el estado exacto al importarlo.
- El nombre del archivo incluye la fecha, por ejemplo
  `apk-gastos-backup-2026-11-23.json`.
- Importar valida la estructura antes de tocar nada: si el archivo no tiene la
  forma esperada, se muestra un error y no se modifica ningún dato.
- Importar pide confirmación y, antes de pisar los datos actuales, genera un
  backup automático con el mismo formato de exportación.
- El formato vigente agrega a `principal`, `tarjetas`, `config` y
  `plantillas_fijas` los metadatos `schema_version`, `dataset_id`, `revision`,
  `updated_at` y `device_label` opcional, según `notas/03`.
- La importación acepta el objeto `db` anterior (`principal`, `tarjetas`,
  `config`) y registros con `notas`; la exportación nueva escribe el formato
  versionado y el campo normalizado `notes`.
- La futura sincronización con Google Drive reutiliza exactamente este formato,
  sus migraciones y su validador; no define un JSON paralelo.

### Casos de uso

- El usuario cambia de teléfono: exporta en el viejo e importa en el nuevo.
- El usuario quiere una copia periódica: exporta y guarda el archivo.
- El usuario importa un archivo corrupto o de otra app: ve un error y sus
  datos no se tocan.

### Tareas

1. Botón "Exportar" en la UI que descarga el JSON versionado de `db`.
2. Botón "Importar" con selector de archivo: leer, `JSON.parse` con
   `try/catch`, validar estructura, migrar si corresponde, confirmar y cargar.
3. Validación: metadatos compatibles y colecciones `principal`, `tarjetas`,
   `config` y `plantillas_fijas` cuando corresponda, con todos sus campos y
   valores válidos.
4. Compatibilidad con el formato anterior y migración de `notas` a `notes`.
5. Backup automático antes de reemplazar en la importación.
6. Mensajes claros de éxito o error.
7. Dejar el serializador y validador disponibles para reutilizarlos en Drive.

---

## Mejora 2 — Presupuesto mensual

### Reglas de negocio

- El usuario define un tope de gasto mensual (opcional).
- El resumen muestra: lo gastado, el presupuesto y cuánto queda (o cuánto se
  excedió).
- Si no hay presupuesto definido, no se muestra ese dato (no cambia nada).
- El presupuesto es único por mes, no por categoría.
- Se guarda en `config` (por ejemplo `config.presupuesto`).

### Casos de uso

- El usuario define un tope de $500.000; ve "Gastado $430.000 de $500.000,
  te quedan $70.000".
- El usuario se pasa del tope; el aviso aparece en rojo con lo excedido.
- El usuario no define tope; la app se ve como hasta ahora.

### Tareas

1. Agregar `config.presupuesto` al objeto de datos.
2. UI para editar el presupuesto (modal o input).
3. En `render()`, comparar `totalGas` con el presupuesto y mostrar el aviso
   (quedan / excedido).
4. Persistir el valor con `saveDB()`.

---

## Mejora 3 — Categorías editables

### Reglas de negocio

- El usuario puede agregar, renombrar y borrar categorías de ingreso y de
  gasto.
- Las categorías se guardan en `config.cat_ing` y `config.cat_gas`.
- No se puede borrar una categoría que esté en uso por al menos un registro;
  se bloquea con un aviso.
- Renombrar una categoría no rompe los registros existentes (ver caso de uso).

### Casos de uso

- El usuario agrega "Mascota" a gastos; aparece en el selector al cargar un
  gasto.
- El usuario renombra "Ocio" a "Salidas". Lo simple: los registros existentes
  conservan el texto viejo; solo cambia el nombre disponible para nuevos
  registros.
- El usuario borra una categoría sin uso; desaparece del selector.
- El usuario intenta borrar una en uso; ve "No se puede, está en uso".

### Tareas

1. Pantalla o modal "Categorías" con las listas de ingreso y gasto.
2. Agregar, renombrar y borrar categorías.
3. Bloquear el borrado si la categoría aparece en algún registro.
4. Guardar cambios en `config` y refrescar los selectores de los modales.

---

## Mejora 4 — Deuda restante de tarjetas

### Reglas de negocio

- Para cada compra en cuotas, mostrar cuánto falta pagar en total y cuántas
  cuotas restan, contando desde el mes actual.
- Las compras ya terminadas no se muestran.
- El cálculo usa el mismo reparto actual: `montoTotal / cuotasTotales`.
- Definir regla de redondeo: la última cuota absorbe la diferencia para que la
  suma cierre exacta.

### Casos de uso

- Compra de $120.000 en 6 cuotas, ya pagadas 2: se ve "Faltan $80.000
  (4 cuotas)".
- El usuario ve, además del detalle por compra, el total de deuda de todas las
  tarjetas.

### Tareas

1. En la vista de tarjetas, calcular cuotas restantes y monto pendiente por
   compra.
2. Mostrar "Falta $X (N cuotas)" por compra y un total general.
3. Implementar la regla de redondeo (la última cuota ajusta).

---

## Mejora 5 — Plantillas de gastos fijos

### Reglas de negocio

- El usuario puede definir un gasto como "fijo" (plantilla recurrente).
- Cada plantilla guarda: descripción, monto, categoría y notas opcionales.
- Un botón "Cargar fijos del mes" crea los registros reales en el mes actual,
  con estado "Pendiente".
- No se duplican: si ya se cargaron los fijos de ese mes, el botón no vuelve a
  crear los mismos.
- Editar o borrar una plantilla afecta a los próximos meses, no a los
  registros ya creados.

### Casos de uso

- El usuario define "Alquiler $300.000" como fijo; al abrir un mes nuevo,
  pulsa "Cargar fijos del mes" y se crean los registros.
- El usuario cambia el monto de una plantilla; el mes siguiente usa el nuevo.
- El usuario borra una plantilla; deja de cargarse.

### Tareas

1. Nueva estructura en `db` o `config` para las plantillas
   (`plantillas_fijas`).
2. UI para administrar plantillas (agregar, editar, borrar).
3. Botón "Cargar fijos del mes" que crea los registros y evita duplicados.
4. Convivir o reemplazar el botón "Copiar Anterior" actual.

---

## Mejora 6 — Buscar y mini-informe por categoría

### Reglas de negocio

- Búsqueda por texto en la descripción y las notas de los registros.
- Resumen del total gastado por categoría en el período seleccionado
  (mes/año).
- Sin gráficos: listado y totales alcanzan.

### Casos de uso

- El usuario busca "nafta" y ve todos los gastos que lo contienen.
- El usuario ve "Comida: $X, Transporte: $Y" del mes actual.

### Tareas

1. Campo de búsqueda que filtra los registros del mes/año.
2. Vista "Por categoría" que agrupa y suma los gastos.
3. Mantener la vista usable en celular (responsive).
