# Modelo de Datos y Sincronización con Google Drive

## 1. Criterio general

El modelo debe representar la aplicación actual sin complicarla ni traducirla a una base de datos relacional que ya no se utilizará.

Se conserva una foto completa de los datos en JSON. La misma estructura se usa para exportación, importación y sincronización manual con Google Drive.

No habrá tablas `profiles`, `transactions` o `installment_purchases`, campos `user_id` ni políticas RLS. Los campos financieros actuales permanecen en español; la normalización obligatoria de notas será a `notes`.

## 2. Contrato JSON versionado

Formato inicial:

```json
{
  "schema_version": 1,
  "dataset_id": "uuid-estable",
  "revision": 12,
  "updated_at": "2026-11-23T15:30:00.000Z",
  "device_label": "Chrome PC",
  "principal": [],
  "tarjetas": [],
  "config": {
    "cat_ing": [],
    "cat_gas": [],
    "presupuesto": null
  },
  "plantillas_fijas": []
}
```

Los metadatos viven junto a los datos para que el archivo exportado y el archivo de Drive sean intercambiables.

La importación deberá aceptar también el formato local anterior:

```json
{
  "principal": [],
  "tarjetas": [],
  "config": {
    "cat_ing": [],
    "cat_gas": []
  }
}
```

Al leer ese formato viejo, la app completará los metadatos y valores opcionales sin perder los registros originales. Al exportar o sincronizar, escribirá solamente el formato vigente.

## 3. Significado de los metadatos

| Campo | Uso |
| --- | --- |
| `schema_version` | Seleccionar validaciones y migraciones de estructura. |
| `dataset_id` | Reconocer que dos archivos representan el mismo conjunto de datos. |
| `revision` | Trazar sucesivas fotos locales; se incrementa con cada mutación. |
| `updated_at` | Informar cuándo se modificó la foto local. No decide conflictos. |
| `device_label` | Mostrar el origen en avisos; es opcional y no identifica una cuenta. |

`revision` no es un contador global: dos dispositivos pueden generar el mismo número. Tampoco debe compararse como si un número mayor garantizara datos más nuevos.

La decisión de sincronización depende de `local_dirty` y de si el archivo remoto cambió respecto de la última versión conocida por ese dispositivo.

## 4. Datos incluidos

### 4.1 `principal`

Contiene ingresos y gastos con los campos actuales:

| Campo | Regla |
| --- | --- |
| `id` | UUID estable generado en el dispositivo. |
| `tipo` | `Ingreso` o `Gasto`. |
| `descripcion` | Texto requerido. |
| `monto` | Número finito y mayor que cero. |
| `categoria` | Texto de la categoría elegida. |
| `notes` | Notas opcionales; campo normalizado. |
| `estado` | `Pagado` o `Pendiente` según corresponda. |
| `mes` | Entero entre 1 y 12. |
| `anio` | Año válido. |

Hoy `tipo: 'Gasto'` no distingue un gasto fijo de uno común. Las plantillas permanentes son una entidad separada y no cambian ese comportamiento.

### 4.2 `tarjetas`

Representa compras en cuotas:

| Campo | Regla |
| --- | --- |
| `id` | UUID estable. |
| `descripcion` | Texto requerido. |
| `montoTotal` | Número finito y mayor que cero. |
| `cuotasTotales` | Entero mayor o igual que 1. |
| `mesInicio` | Entero entre 1 y 12. |
| `anioInicio` | Año válido. |

Si en el futuro se agregan categoría o notas a las tarjetas, viajarán dentro del mismo JSON. La regla de redondeo de cuotas pertenece a la mejora de deuda restante y no altera el contrato de sincronización.

### 4.3 `config`

Incluye como mínimo:

- `cat_ing`: categorías de ingreso.
- `cat_gas`: categorías de gasto.
- `presupuesto`: valor opcional cuando se implemente esa mejora.

Las categorías y el presupuesto forman parte del respaldo y de Drive. No quedan fuera ni requieren una tabla adicional.

### 4.4 `plantillas_fijas`

Cuando se implemente la mejora correspondiente, cada plantilla incluirá descripción, monto, categoría, notas opcionales, estado activo y UUID.

Editar o borrar una plantilla no modifica los registros ya creados. Ambos conjuntos viajan en el mismo archivo para conservar el estado completo.

## 5. Normalización y migración

La app actual escribe `notas`, aunque la lectura acepta `notes || notas`. La migración deberá:

1. Recorrer los registros que puedan tener notas.
2. Conservar el valor existente cualquiera sea el campo viejo utilizado.
3. Escribir el valor normalizado en `notes`.
4. Eliminar `notas` en el formato vigente.
5. No descartar una nota si el otro campo existe pero está vacío.

La lectura de respaldos antiguos seguirá aceptando ambos campos. La escritura nueva utilizará únicamente `notes`.

Cada cambio posterior de estructura requerirá aumentar `schema_version`, agregar una migración y probar la lectura de la versión anterior. Una versión futura desconocida no deberá importarse como si fuera compatible.

## 6. Estado local de sincronización

Estos metadatos pertenecen al dispositivo y no al contenido financiero exportado:

| Campo | Función |
| --- | --- |
| `local_dirty` | Indica cambios locales desde la última sincronización confirmada. |
| `last_synced_remote_version` | Versión del archivo de Drive conocida por este dispositivo. |
| `last_synced_remote_md5` | Huella del contenido remoto, cuando esté disponible, como comprobación complementaria. |
| `last_synced_at` | Fecha mostrada al usuario. |
| `folderId` / `fileId` | Referencias remotas recuperables, no garantías permanentes. |
| `sync_error` | Último error para diagnóstico y UI, sin exponer tokens. |

`local_dirty` se activa con cualquier mutación: altas, ediciones, borrados, cambios de estado, clonado, categorías, presupuesto, plantillas e importaciones.

Los tokens de acceso no se guardan en este estado. Tampoco se incluyen en el JSON remoto.

## 7. Algoritmo de sincronización

Al pulsar **Sincronizar**:

1. Impedir que otra sincronización de la misma instancia esté en curso.
2. Verificar que exista una versión local válida y que la pestaña no esté desactualizada.
3. Obtener un token vigente si hace falta.
4. Localizar el archivo remoto y leer sus metadatos antes de escribir.
5. Comparar su `version` y, cuando esté disponible, su huella con la última base conocida.
6. Resolver el caso según los cambios locales y remotos.
7. Confirmar el resultado y guardar la nueva base remota.

| `local_dirty` | Remoto cambió | Resultado |
| --- | --- | --- |
| `false` | No | Actualizado; no escribir. |
| `true` | No | Subir la foto local. |
| `false` | Sí | Validar, hacer backup local y descargar. |
| `true` | Sí | Conflicto; no reemplazar automáticamente. |

Después de subir o descargar correctamente:

- `local_dirty` queda en `false`.
- Se actualiza la versión o huella remota conocida.
- Se registra `last_synced_at`.

Si la respuesta de una subida se pierde, la próxima operación vuelve a leer Drive. No se reintenta a ciegas porque el archivo podría haberse actualizado correctamente.

## 8. Conflictos

Un conflicto significa que los datos locales y el archivo remoto cambiaron desde la última base común. Puede ocurrir aunque los dispositivos hayan tocado registros distintos porque esta versión no fusiona cambios.

El diálogo deberá explicar el origen y la fecha disponible, y ofrecer:

- **Descargar Drive:** reemplaza los datos locales después de validar y generar backup.
- **Subir este dispositivo:** reemplaza el contenido remoto después de confirmación explícita.
- **Cancelar:** no modifica ninguno de los dos lados.

La app también ofrecerá exportar el estado local antes de elegir. Nunca decidirá el ganador únicamente por `updated_at`, `revision` o `device_label`.

Drive no proporciona aquí una transacción distribuida entre dispositivos. La lectura previa es una protección, no una garantía de colaboración simultánea; el alcance inicial es sincronización manual personal.

## 9. Primera conexión y recuperación

Sin una base remota conocida no se puede afirmar que solo uno de los lados cambió.

Reglas:

- Si no existe archivo remoto, ofrecer crear uno con los datos locales.
- Si el almacenamiento local está vacío y existe un archivo remoto válido, ofrecer descargarlo.
- Si existen datos en ambos lados y el dispositivo nunca sincronizó, pedir una elección antes de reemplazar.
- Si los IDs guardados no funcionan, buscar nuevamente antes de crear otro archivo.
- Si hay varios candidatos o un `dataset_id` inesperado, no elegir ni subir automáticamente.
- Si el usuario cambia de cuenta, tratar el archivo encontrado como una nueva asociación hasta confirmar su identidad y destino.
- Desconectar no borra el archivo ni los datos locales.

Estas reglas evitan que una reconexión convierta una subida inicial en la pérdida del respaldo remoto.

## 10. Validación y seguridad de datos

El mismo validador se utilizará para archivos locales y remotos.

Antes de reemplazar datos se comprobará:

- Que el JSON pueda parsearse.
- Que `schema_version` sea compatible.
- Que existan las colecciones requeridas y sean del tipo esperado.
- Que IDs, montos, meses, años, estados y cuotas cumplan las reglas.
- Que las categorías y estructuras de configuración sean válidas.
- Que el `dataset_id` sea coherente con la operación elegida.

Si falla una validación, no se modifica ningún dato local ni remoto.

Toda importación o descarga que reemplace información genera primero un backup local. Los textos recuperados se renderizan con las mismas defensas contra XSS que cualquier otro dato externo.

## 11. Duplicados y eliminaciones

Para reducir duplicados:

- Generar UUID en el dispositivo.
- Conservar el mismo UUID al exportar, importar y sincronizar.
- No crear un archivo remoto nuevo en cada reintento.
- Reutilizar el `fileId` confirmado o recuperar el archivo existente antes de crear otro.

Las eliminaciones forman parte de la nueva foto completa. No se necesita `deleted_at` para esta versión, pero una eliminación local tampoco puede pisar una versión remota cambiada sin pasar por el diálogo de conflicto.

## 12. Backups

El archivo principal de Drive representa el último estado sincronizado, no un historial ilimitado.

Google Drive puede eliminar revisiones antiguas no fijadas. Por eso:

- La exportación JSON manual se mantiene como respaldo independiente.
- El backup local previo a reemplazos es obligatorio.
- Los backups remotos con fecha y retención son una mejora posterior, no una dependencia de la primera sincronización.

## 13. Almacenamiento local

`localStorage` puede seguir utilizándose inicialmente porque el volumen esperado es pequeño y la sincronización transfiere una foto completa.

IndexedDB será una opción si más adelante aumentan los registros, las consultas o las importaciones. No se exige una migración antes de Google Drive, pero cualquier cambio futuro deberá conservar el contrato JSON y los metadatos de sincronización.
