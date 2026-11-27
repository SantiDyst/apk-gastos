# Funciones de la Arquitectura — Respaldo Local y Google Drive

Inventario de funciones para implementar las Fases 0 a 3 de `02-roadmap.md`: almacenamiento, respaldo JSON, conexión con Google Drive y sincronización manual.

No define todavía las funciones de presupuestos, categorías editables, plantillas, búsqueda o exportación Excel. Esas mejoras deberán reutilizar esta misma capa cuando se implementen.

El listado separa responsabilidades, pero no obliga a exportar todas las funciones: varias son helpers internos de su módulo y podrán combinarse durante la implementación si eso mantiene el código más simple sin cambiar las reglas.

## 1. Convenciones

- `db`: datos financieros en memoria (`principal`, `tarjetas`, `config`, `plantillas_fijas`).
- `payload`: objeto JSON completo, con `db` y metadatos como `schema_version`, `dataset_id`, `revision`, `updated_at` y `device_label`.
- `syncState`: estado local de sincronización; nunca contiene tokens.
- Las funciones con operaciones de red o lectura de archivos son `async` y devuelven promesas.
- La UI no accede directamente a `localStorage` ni a Drive.
- `storage.js` no manipula DOM ni hace llamadas de red.
- `backup.js` no conoce Drive.
- `drive-sync.js` no modifica datos financieros directamente: utiliza las funciones de `storage.js` y `backup.js`.
- Una función que valida o parsea nunca modifica el estado actual si la entrada es inválida.

## 2. Dependencias entre módulos

```text
app.js / ui.js
       |
       +---- backup.js ----+
       |                   |
       +---- drive-sync.js +
                           |
                           v
                      storage.js
```

`drive-sync.js` también utiliza el serializador y validador expuestos por `backup.js`, de modo que una descarga de Drive pasa exactamente por las mismas defensas que una importación manual.

---

## 3. `js/storage.js`

Responsable de los datos locales, el contrato JSON, las migraciones y el estado local de sincronización.

### 3.1 Datos y esquema

- `createDefaultDB()` -> Crea una estructura vacía válida con categorías iniciales, configuración y colecciones requeridas.
- `createDefaultSyncState()` -> Crea el estado local inicial: sin conexión, sin cambios pendientes y sin versión remota conocida.
- `normalizeDB(rawDB)` -> Completa valores opcionales y normaliza campos sin cambiar el significado de los registros.
- `normalizeNotes(record)` -> Convierte `notas` a `notes`, conservando el valor no vacío cuando existe cualquiera de las variantes.
- `validateDB(db)` -> Verifica colecciones, registros, montos, cuotas, fechas, estados, categorías e IDs; devuelve errores sin modificar nada.
- `validatePayload(payload)` -> Comprueba metadatos y datos del archivo completo, incluyendo compatibilidad de `schema_version` y presencia de `dataset_id`.
- `migratePayload(rawPayload)` -> Convierte un respaldo anterior al formato vigente; conserva los datos y agrega los metadatos requeridos.
- `parsePayload(text)` -> Ejecuta `JSON.parse` con manejo de errores, migración y validación; devuelve un payload válido o un error, sin tocar `db`.
- `createPayload(db)` -> Construye el objeto versionado que se usará tanto para exportar como para sincronizar.
- `serializePayload(payload)` -> Convierte un payload ya validado a texto JSON.
- `getPayloadSummary(payload)` -> Devuelve cantidades de ingresos, gastos, tarjetas y plantillas para confirmaciones y vistas previas.
- `hasLocalData(db)` -> Indica si existen datos personales; evita tratar una estructura vacía recién creada como si tuviera información que respaldar.

### 3.2 Lectura y escritura local

- `loadDB()` -> Lee `finanzas_data_v3`, migra y valida su contenido; si está corrupto, informa el error y conserva el valor original para recuperación.
- `getDB()` -> Devuelve la copia local actualmente cargada para lectura.
- `saveRawDB(db)` -> Escribe una estructura ya validada en `localStorage`; es una función interna y no decide estados de sincronización.
- `commitDB(nextDB)` -> Valida una mutación, incrementa `revision`, actualiza `updated_at`, guarda localmente y marca `local_dirty = true`.
- `replaceFromPayload(payload, options)` -> Reemplaza `db` con un payload válido; se usa para importaciones y descargas, indicando si debe quedar pendiente de subida.
- `mutateDB(mutator)` -> Aplica un cambio mediante una única entrada y delega en `commitDB()` para evitar escrituras dispersas.
- `assertCurrentRevision(expectedRevision)` -> Comprueba que la pestaña siga trabajando sobre la última versión local antes de guardar o sincronizar.
- `onExternalDBChange(callback)` -> Escucha cambios hechos por otra pestaña y avisa que la copia actual quedó desactualizada.

### 3.3 Estado local de sincronización

- `loadSyncState()` -> Lee y valida los metadatos locales de conexión y sincronización.
- `getSyncState()` -> Devuelve el estado local para consultas de la capa de sincronización.
- `saveSyncState(syncState)` -> Persiste metadatos locales permitidos; nunca debe recibir tokens.
- `updateSyncState(patch)` -> Actualiza campos puntuales sin descartar el resto del estado.
- `markLocalDirty()` -> Marca que existen cambios locales desde la última sincronización confirmada.
- `clearLocalDirty()` -> Limpia la marca únicamente después de una subida o descarga confirmada.
- `isLocalDirty()` -> Indica si hay cambios pendientes.
- `setDriveLocation(folderId, fileId)` -> Guarda referencias remotas recuperables.
- `getDriveLocation()` -> Devuelve los IDs conocidos, si existen.
- `clearDriveLocation()` -> Elimina referencias remotas durante desconexión o recuperación, sin borrar datos.
- `getLastSyncedRemoteBase()` -> Devuelve la última `version` y huella remota conocidas por este dispositivo.
- `setLastSyncedRemoteBase(remoteBase)` -> Guarda la nueva base después de una operación confirmada.
- `clearLastSyncedRemoteBase()` -> Elimina la base cuando ya no puede considerarse confiable, por ejemplo al asociar otra cuenta o archivo.
- `setLastSyncedAt(date)` -> Guarda la fecha que se mostrará como última sincronización.
- `recordSyncError(message)` -> Guarda un error seguro y acotado para diagnóstico, sin tokens ni respuestas sensibles.
- `clearSyncError()` -> Limpia el error anterior al comenzar o completar una operación.

---

## 4. `js/backup.js`

Responsable de exportar e importar el mismo JSON que utilizará Drive.

- `formatBackupFilename(date)` -> Genera un nombre como `apk-gastos-backup-2026-11-23.json`.
- `buildLocalBackup()` -> Crea y valida el payload del estado local actual sin modificar su revisión ni marcar una sincronización.
- `downloadJSON(text, filename)` -> Descarga texto JSON como archivo local.
- `exportLocalBackup()` -> Genera el payload actual y descarga el archivo de respaldo.
- `createAutomaticBackup(reason)` -> Genera una copia del estado vigente antes de una importación o descarga que vaya a reemplazarlo.
- `readJSONFile(file)` -> Lee el archivo elegido por el usuario y devuelve su texto, sin interpretarlo todavía.
- `inspectBackupFile(file)` -> Lee, parsea, migra y valida un archivo; devuelve payload y resumen sin cambiar los datos actuales.
- `importPayload(payload)` -> Después de la confirmación de UI, crea un backup automático y aplica el payload mediante `replaceFromPayload()`.
- `importBackupFile(file)` -> Coordina lectura, validación y preparación de importación; no muestra diálogos ni confirma por sí misma.
- `serializeForDrive(db)` -> Expone el mismo serializador de respaldo para la subida remota.
- `parseFromDrive(text)` -> Expone el mismo parseo, migración y validación para una descarga remota.

Regla: una importación válida deja `local_dirty = true`, porque todavía falta subir ese nuevo estado a Drive.

---

## 5. `js/drive-sync.js` — Autorización

Responsable de GIS y del token en memoria. Ninguna función de este grupo guarda tokens en almacenamiento persistente.

- `loadGIS()` -> Carga Google Identity Services bajo demanda; si falla, la app local sigue funcionando.
- `initTokenClient()` -> Inicializa el cliente OAuth con el Client ID y el alcance `drive.file`, sin abrir ventanas.
- `requestDriveAccess()` -> Solicita un token desde un clic directo del usuario y verifica que el permiso necesario haya sido otorgado.
- `hasValidAccessToken()` -> Comprueba en memoria si existe un token y si todavía no venció.
- `getAccessToken()` -> Devuelve el token vigente únicamente para uso interno del módulo.
- `clearAccessToken()` -> Elimina el token de memoria cuando vence, falla o se revoca.
- `ensureDriveAccess()` -> Obtiene un token si hace falta durante una acción explícita de conexión o sincronización.
- `revokeDriveAccess()` -> Revoca el permiso otorgado y limpia el token; no borra datos locales ni archivos remotos.

## 6. `js/drive-sync.js` — Archivos de Drive

Funciones internas para localizar, leer y escribir el archivo. Todas las respuestas remotas se consideran contenido externo.

- `driveFetch(path, options)` -> Ejecuta una llamada autenticada a Drive, agrega encabezados, evita caché y normaliza errores de red/API.
- `findAppFolder()` -> Busca carpetas visibles creadas por la app con el nombre configurado y fuera de la papelera.
- `createAppFolder()` -> Crea `APK Gastos/` y devuelve su ID.
- `getOrCreateAppFolder()` -> Recupera una carpeta unívoca o crea una; si hay candidatos ambiguos, devuelve un conflicto de ubicación.
- `getFileMetadata(fileId)` -> Obtiene `id`, `name`, `version`, `md5Checksum`, `modifiedTime`, `trashed` y demás campos necesarios.
- `findDataFile(folderId)` -> Busca `apk-gastos-data.json` dentro de la carpeta de la app sin elegir arbitrariamente entre duplicados.
- `createDataFile(folderId, payload)` -> Crea el archivo remoto inicial con tipo `application/json` y devuelve sus metadatos.
- `downloadDataFile(fileId)` -> Descarga el texto del archivo remoto sin aplicarlo a los datos locales.
- `uploadDataFile(fileId, payload)` -> Reemplaza el contenido de un archivo existente y devuelve los metadatos resultantes.
- `locateRemoteFile()` -> Intenta usar el `fileId` guardado; si no sirve, busca nuevamente antes de crear otro archivo.
- `readRemoteSnapshot()` -> Obtiene metadatos y contenido remoto; devuelve una foto para comparar o validar.
- `buildRemoteBase(metadata)` -> Extrae la versión y huella que se guardarán como última base conocida.
- `hasRemoteChanged(remoteBase)` -> Compara la base remota actual con la guardada por este dispositivo.
- `isMissingRemoteFile(error)` -> Reconoce archivo inexistente, papelera o pérdida de acceso para iniciar recuperación sin asumir que Drive está vacío.
- `isDatasetMismatch(payload)` -> Detecta que el `dataset_id` remoto no coincide con la asociación esperada.

## 7. `js/drive-sync.js` — Sincronización

Coordina el flujo completo. Es la única parte que decide entre subir, descargar o pedir resolución de conflicto.

- `connectDrive()` -> Desde un clic, autoriza y localiza el archivo remoto; nunca sube ni descarga datos automáticamente durante la conexión.
- `disconnectDrive()` -> Revoca acceso y limpia conexión y base remota local, conservando los datos financieros y el archivo de Drive.
- `synchronize()` -> Ejecuta la sincronización manual completa y serializada; es la función llamada por el botón **Sincronizar**.
- `decideSyncAction(context)` -> Determina `noop`, `upload`, `download`, `create_remote`, `initial_choice` o `conflict` según datos locales, base conocida y cambios remotos.
- `uploadLocalSnapshot()` -> Vuelve a comprobar la versión remota antes de escribir y sube el payload local solamente si no apareció un cambio concurrente.
- `downloadRemoteSnapshot(snapshot)` -> Valida el contenido, genera backup local, reemplaza los datos y deja `local_dirty = false`.
- `createRemoteSnapshot()` -> Crea el primer archivo remoto después de confirmar que no existe uno recuperable y que el usuario autorizó la subida inicial.
- `resolveConflict(choice)` -> Ejecuta `download`, `upload` o `cancel` según la elección explícita del usuario.
- `resolveInitialChoice(choice)` -> Resuelve una primera conexión con datos en ambos lados sin asumir una versión ganadora.
- `completeSync(remoteMetadata)` -> Limpia `local_dirty`, guarda la nueva base remota y registra la fecha de sincronización.
- `handleSyncError(error)` -> Convierte errores en estados comprensibles, conserva los datos y evita reintentos ciegos.
- `getSyncStatus()` -> Devuelve el estado actual de la operación para la UI.
- `onSyncStatusChange(callback)` -> Permite que la UI escuche estados sin controlar la lógica de Drive.
- `setSyncStatus(status)` -> Actualiza internamente `desconectado`, `pendiente`, `sincronizando`, `actualizado`, `error`, `conflicto` u otros estados definidos.

### Decisiones mínimas de `decideSyncAction()`

| Situación | Acción |
| --- | --- |
| Sin cambios locales ni remotos | `noop` |
| Solo cambios locales | `upload` |
| Solo cambios remotos | `download` |
| Cambios en ambos lados | `conflict` |
| No existe archivo remoto recuperable | `create_remote`, con confirmación |
| Primera conexión con datos en ambos lados y sin base común | `initial_choice` |

`updated_at`, `revision` y `device_label` pueden mostrarse en los avisos, pero no cambian estas decisiones.

---

## 8. `js/ui.js` — Integración visual

Responsable de botones, diálogos y mensajes. No decide por sí misma si debe subir o descargar.

- `renderSyncPanel(syncState)` -> Muestra conexión, cambios pendientes, último resultado y fecha de última sincronización.
- `setSyncBusy(isBusy)` -> Habilita o bloquea botones para impedir dos sincronizaciones paralelas.
- `updateLastSyncLabel(date)` -> Actualiza la fecha visible sin interpretarla como versión de conflicto.
- `showConflictDialog(context)` -> Presenta origen y fechas disponibles y devuelve `download`, `upload` o `cancel`.
- `showInitialChoiceDialog(context)` -> Pregunta cómo proceder cuando la primera conexión encuentra datos en ambos lados.
- `showDatasetMismatchDialog(context)` -> Advierte que el archivo encontrado pertenece a otro conjunto de datos y evita asociarlo automáticamente.
- `showSyncError(message)` -> Muestra un error claro sin borrar datos ni exponer información sensible.
- `showOfflineSyncMessage()` -> Informa que Drive necesita conexión y que el uso local puede continuar.
- `showExternalTabWarning()` -> Avisa que otra pestaña modificó los datos y exige actualizar antes de seguir escribiendo.
- `showImportPreview(summary)` -> Muestra cantidades y advertencias antes de importar.
- `confirmImport()` -> Obtiene la confirmación explícita para reemplazar el estado local.
- `onConnectDriveClick()` -> Llama a `connectDrive()` desde interacción directa.
- `onSynchronizeClick()` -> Llama a `synchronize()` desde interacción directa.
- `onDisconnectDriveClick()` -> Confirma y llama a `disconnectDrive()`.
- `onExportClick()` -> Llama a `exportLocalBackup()`.
- `onImportFileSelected(file)` -> Llama a `inspectBackupFile()` y presenta la vista previa.

---

## 9. `js/app.js` — Inicialización y mutaciones actuales

Responsable de arrancar la app y conectar las acciones existentes con la capa de almacenamiento.

- `initApp()` -> Carga datos y estado local, inicializa UI y renderiza; no solicita Google OAuth automáticamente.
- `addOrUpdatePrincipal(input)` -> Crea o edita un ingreso/gasto mediante `mutateDB()`.
- `deletePrincipal(id)` -> Elimina un registro mediante `mutateDB()`.
- `togglePrincipalStatus(id)` -> Alterna `Pagado`/`Pendiente` y marca el cambio como pendiente.
- `clonePreviousMonth(month, year)` -> Clona gastos con UUID nuevos y una única mutación pendiente de sincronización.
- `addOrUpdateCard(input)` -> Crea o edita una compra en cuotas mediante `mutateDB()`.
- `deleteCard(id)` -> Elimina una compra en cuotas mediante `mutateDB()`.
- `importLocalBackup(file)` -> Coordina vista previa, confirmación, backup automático e `importPayload()`.
- `handleExternalDBChange()` -> Bloquea escrituras desde la copia vieja y ofrece recargar el estado actualizado.
- `handleSyncDownload(payload)` -> Aplica una descarga ya validada y vuelve a renderizar la interfaz.

Las funciones de renderizado existentes (`render()`, `renderList()`, `renderListT()`, `showModal()`, navegación por mes/año y formato monetario) pueden conservar su responsabilidad, pero ya no deberán llamar directamente a `saveDB()` ni a `localStorage`.

---

## 10. Reemplazos respecto del código actual

| Código actual | Reemplazo previsto |
| --- | --- |
| `JSON.parse(localStorage.getItem(DB_KEY))` | `loadDB()` con parseo seguro, migración y validación. |
| `saveDB()` llamado desde cada formulario | `mutateDB()` / `commitDB()` con revisión y `local_dirty`. |
| Escritura directa del objeto completo | Una única capa de almacenamiento y control de pestaña desactualizada. |
| Exportación inexistente | `exportLocalBackup()`. |
| Importación inexistente | `inspectBackupFile()` + confirmación + `importPayload()`. |
| Descarga remota aplicada directamente | `parseFromDrive()` + backup + `downloadRemoteSnapshot()`. |
| Comparación por fechas | `decideSyncAction()` con `local_dirty` y base remota conocida. |

## 11. Reglas que ninguna función debe romper

1. Ninguna validación fallida modifica datos locales o remotos.
2. Ninguna importación o descarga reemplaza datos sin backup previo.
3. Ninguna primera conexión pisa datos automáticamente.
4. Ningún token se persiste, exporta, registra en logs ni aparece en mensajes.
5. Ninguna subida se realiza sin releer antes el estado remoto.
6. Ningún error de red se traduce en borrado, reinicio de datos o reintento ciego.
7. Ninguna sincronización corre en paralelo con otra de la misma instancia.
8. Ninguna versión gana únicamente por fecha, número de revisión o nombre del dispositivo.
9. Desconectar nunca elimina el archivo de Drive ni los datos locales.
10. Exportación, importación y Drive usan el mismo contrato JSON y validador.
