# Prompt de Implementación — APK Gastos con Google Drive

Sos un agente de desarrollo con capacidad para leer archivos, editar código y ejecutar pruebas. Vas a implementar la evolución completa de APK Gastos desde su estado actual hasta el respaldo JSON y la sincronización manual con Google Drive.

Trabajá sobre el repositorio actual. No conviertas este prompt en una explicación o en un plan solamente: ejecutá la implementación, verificala y reportá evidencia.

## 1. Fuente de verdad

Antes de escribir código, leé completos estos archivos:

1. `index.html`
2. `sw.js`
3. `manifest.json`
4. `notas/00-documento-maestro.md`
5. `notas/01-arquitectura.md`
6. `notas/02-roadmap.md`
7. `notas/03-modelo-datos-y-sincronizacion.md`
8. `notas/04-plan-de-trabajo.md`
9. `notas/05-mejoras-uso-personal.md`
10. `notas/06-funciones-arquitectura.md`

Las notas son la especificación. Este prompt resume el alcance, pero no las reemplaza.

`notas/06-funciones-arquitectura.md` separa responsabilidades, pero no obliga a exportar cada helper. Podés combinar funciones internas cuando eso produzca código más simple, siempre que conserves los contratos y reglas documentados.

## 2. Objetivo

Implementar las Fases 0 a 3 del roadmap:

- Fase 0: exportación e importación local de respaldos JSON.
- Fase 1: modularización, correcciones de seguridad/datos/PWA y preparación para Cloudflare Pages.
- Fase 2: payload versionado, migraciones y estado local de sincronización.
- Fase 3: integración con Google Identity Services y Google Drive, con sincronización manual y resolución explícita de conflictos.

La app debe seguir siendo una PWA estática, offline-first, usable desde Chrome de escritorio, Chrome móvil y PWA instalada.

## 3. Alcance explícito

### Incluye

- Conservar el comportamiento financiero actual: ingresos, gastos, tarjetas, cuotas, estados de pago, clonado mensual, navegación por mes/año y temas.
- Migrar sin pérdida los datos actuales de `localStorage` bajo `finanzas_data_v3`.
- Modularizar el monolito en CSS y JavaScript según `notas/01` y `notas/06`.
- Centralizar almacenamiento, validación, serialización, migraciones y mutaciones.
- Exportar e importar un único contrato JSON versionado.
- Normalizar `notas` a `notes` sin perder datos viejos.
- Incluir `principal`, `tarjetas`, `config.cat_ing`, `config.cat_gas`, `config.presupuesto` cuando exista y `plantillas_fijas` cuando exista.
- Implementar metadatos locales de sincronización y detección de pestañas desactualizadas.
- Implementar OAuth con GIS y alcance mínimo `https://www.googleapis.com/auth/drive.file`.
- Ubicar o crear `APK Gastos/` y `apk-gastos-data.json`.
- Subir y descargar el mismo JSON usado por los respaldos manuales.
- Implementar botones Conectar, Desconectar y Sincronizar, estados visibles y diálogo de conflictos.
- Preparar configuración y documentación para Cloudflare Pages y Google Cloud.
- Agregar pruebas automatizadas para la lógica determinística y pruebas con mocks para Drive.
- Actualizar `README.md`, ayuda visible y documentación afectada por comandos o configuración nuevos.

### No incluye

- Supabase, backend propio, tablas, RLS ni `user_id`.
- Sincronización automática.
- Fusión de cambios registro por registro.
- Colaboración simultánea.
- Migración a IndexedDB.
- Fases 4 a 6: exportación Excel/CSV, importación tabular o mejoras futuras.
- Implementar las interfaces de presupuestos, categorías editables, plantillas, búsqueda o informes de `notas/05`; solamente conservar sus lugares en el contrato JSON.
- Push, pull request, publicación, deploy o cambios en cuentas externas.
- Guardar backups remotos con fecha como requisito de esta entrega.

## 4. Reglas de trabajo

1. Revisá `git status` antes de empezar. No borres ni sobrescribas trabajo del usuario y no uses `git reset`, `git clean` o restauraciones generales.
2. Si estás en la rama por defecto, creá una rama de feature antes de modificar código.
3. Creá `odd/tasks/google-drive-sync.md` antes del primer cambio de código, con especificaciones numeradas, tareas y log. Usá las notas como fuente y no agregues requisitos ajenos.
4. Trabajá por fases y unidades pequeñas. No intentes reescribir todo en una única edición gigante.
5. Para comportamientos con resultado esperado claro, escribí primero una prueba que falle, observá el fallo, implementá y verificá que pase.
6. Ejecutá pruebas enfocadas y luego la suite completa. No declares una tarea terminada con pruebas fallidas o sin verificar.
7. Mantené pruebas y documentación junto al comportamiento correspondiente.
8. Hacé commits por unidades revisables en la rama de feature si tu flujo de trabajo lo permite. No hagas push ni deploy.
9. No instales dependencias ni agregues un framework salvo necesidad demostrable. Preferí JavaScript vanilla, módulos ES y herramientas livianas ya disponibles. Para lógica pura, evaluá primero `node:test` antes de agregar un runner.
10. No preguntes permiso para pasar de una fase a otra. Continuá hasta completar el alcance o encontrar una decisión humana real, una credencial externa faltante o una operación prohibida.
11. Si falta el Client ID de Google, no lo inventes y no te detengas: completá todo el código y las pruebas con mocks. Dejá pendiente únicamente la prueba OAuth/Drive real.

## 5. Contrato de datos

Usá el contrato exacto de `notas/03-modelo-datos-y-sincronizacion.md`.

La foto vigente contiene, como mínimo:

```json
{
  "schema_version": 1,
  "dataset_id": "uuid-estable",
  "revision": 1,
  "updated_at": "fecha ISO",
  "device_label": "origen opcional",
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

Reglas obligatorias:

- Conservar los campos financieros actuales en español; no traducir el modelo a tablas o entidades en inglés.
- Aceptar el formato viejo `{ principal, tarjetas, config }` y registros con `notas` o `notes`.
- Normalizar la escritura nueva a `notes` sin descartar una nota cuando la otra variante está vacía.
- Validar estructura completa, tipos, UUID, montos finitos y positivos, cuotas enteras >= 1, meses, años, estados, categorías y `schema_version`.
- Rechazar versiones futuras desconocidas en vez de importarlas como compatibles.
- Si falla el parseo o la validación, no modificar datos locales ni remotos.
- Exportar o sincronizar no incrementa `revision` por sí mismo.
- Toda mutación financiera o de configuración incrementa revisión, actualiza fecha y marca `local_dirty = true`.
- Una importación local válida queda pendiente de subida; una descarga remota confirmada queda sincronizada.
- `revision`, `updated_at` y `device_label` son informativos para conflictos, no selectores automáticos de un ganador.

## 6. Almacenamiento y comportamiento actual

- Ninguna parte de la UI debe llamar directamente a `localStorage`.
- Reemplazá escrituras dispersas de `saveDB()` por una única capa como `mutateDB()` / `commitDB()`.
- No reemplaces silenciosamente datos corruptos por una estructura vacía: conservá el valor original y mostrá recuperación/error.
- Detectá cambios de otra pestaña y evitá guardar o sincronizar desde una copia desactualizada.
- Mantené identificadores UUID estables al importar/exportar; al clonar gastos, generá UUID nuevos.
- Corregí validación de cuotas y montos sin alterar reglas financieras no solicitadas.
- Los textos de registros, notas, categorías o JSON remoto deben renderizarse con `textContent`, nodos DOM o escapado seguro. No uses `innerHTML` con contenido externo o del usuario.

## 7. Respaldo local

Implementá exportación e importación con esta secuencia:

1. Leer el archivo elegido.
2. Parsear con manejo de errores.
3. Migrar si corresponde.
4. Validar todo sin tocar el estado actual.
5. Mostrar resumen y pedir confirmación.
6. Generar backup automático del estado vigente.
7. Aplicar el payload mediante la capa de almacenamiento.
8. Marcar el estado como pendiente de sincronización y renderizar.

El nombre manual debe incluir fecha, por ejemplo `apk-gastos-backup-2026-11-23.json`.

Agregá pruebas para:

- Formato vigente válido.
- Formato anterior válido.
- `notas` y `notes`, incluyendo una variante vacía.
- JSON corrupto.
- Estructura inválida y `schema_version` incompatible.
- Montos/cuotas/meses inválidos.
- Confirmación cancelada.
- Verificación de que toda entrada rechazada deja datos, revisión y contadores exactamente iguales.
- Backup generado antes de un reemplazo confirmado.

## 8. Estado y algoritmo de sincronización

Guardá localmente, separado del contenido financiero exportado:

- `local_dirty`.
- `last_synced_remote_version`.
- `last_synced_remote_md5` cuando esté disponible.
- `last_synced_at`.
- `folderId` / `fileId` cuando existan.
- Errores seguros y acotados para diagnóstico.

Nunca guardes tokens en `localStorage`, en el JSON, en logs o mensajes.

Al pulsar Sincronizar:

1. Impedí otra sincronización paralela en la misma instancia.
2. Verificá que la pestaña y los datos sean válidos y actuales.
3. Obtené un token si hace falta mediante la acción explícita del usuario.
4. Localizá y leé Drive antes de escribir.
5. Compará la versión/huella remota con la última base conocida.
6. Decidí según esta tabla:

| Cambios locales | Cambios remotos | Acción |
| --- | --- | --- |
| No | No | Informar actualizado; no escribir. |
| Sí | No | Subir. |
| No | Sí | Validar, generar backup local y descargar. |
| Sí | Sí | Conflicto; esperar elección. |

Además:

- Si no existe archivo remoto recuperable, pedí confirmación para crearlo con los datos locales.
- Si el almacenamiento local está vacío y hay remoto válido, ofrecé descargarlo.
- Si hay datos en ambos lados durante la primera conexión y no existe base común, pedí una elección; no uses el camino ordinario de subida.
- Antes de cualquier subida, releé la versión remota para detectar un cambio aparecido durante la operación.
- Si la respuesta de una subida se pierde, no reintentés a ciegas: la próxima operación debe releer Drive.
- Después de subir o descargar correctamente, limpiá `local_dirty`, guardá la nueva base remota y actualizá `last_synced_at`.
- Desconectar revoca acceso y limpia asociación local, pero no borra datos ni archivos.

El diálogo de conflicto debe permitir Descargar Drive, Subir este dispositivo o Cancelar, y ofrecer exportar antes una copia local.

## 9. Google Identity Services y Drive

- Cargá GIS bajo demanda; la app debe abrir offline aunque Google no esté disponible.
- Inicializar el token client no debe abrir ventanas ni pedir permisos al cargar la página.
- Conectar y renovar tokens solamente desde interacción directa del usuario.
- Mantené tokens únicamente en memoria.
- Verificá que el alcance otorgado incluya `drive.file`.
- El Client ID puede residir en configuración pública del frontend. No uses Client Secret.
- Si el Client ID no está configurado, deshabilitá solamente Drive con un mensaje accionable; toda la funcionalidad local debe seguir operativa.
- Implementá llamadas REST con los metadatos mínimos necesarios y manejo claro de errores HTTP, red, permisos y vencimiento.
- No asumas que `folderId` o `fileId` existen para siempre.
- Si los IDs fallan, buscá antes de crear otro archivo.
- Excluí elementos en papelera.
- Si hay carpetas/archivos duplicados o `dataset_id` inesperado, no elijas ni reemplaces automáticamente.
- Tratá una cuenta Google distinta como una asociación nueva hasta confirmar identidad y destino.
- Validá el JSON remoto con exactamente el mismo validador que una importación local.
- No interpretes las revisiones de Drive como historial garantizado.

## 10. Service Worker, PWA y Cloudflare

- Corregí el Service Worker para borrar únicamente cachés propios y versionados de esta app, no todas las del origen.
- No caches llamadas a `googleapis.com`, `accounts.google.com` ni recursos de autenticación/Drive.
- Las llamadas a Drive van siempre a red; sus errores no afectan el uso offline local.
- Revisá instalación y actualización de la PWA.
- Corregí nombre, descripción, icono y colores inconsistentes del manifest/HTML. El icono debe ser local y estar disponible offline.
- Eliminá la mención a Google Sheets.
- Documentá los orígenes que deben configurarse en Google Cloud: dominio final, dominio de Cloudflare Pages utilizado y localhost con puerto.
- No ejecutes deploy ni modifiques proyectos externos.

## 11. Pruebas mínimas de sincronización

Usá funciones puras y mocks de Drive para probar, como mínimo:

- Sin cambios en ningún lado.
- Solo cambios locales.
- Solo cambios remotos.
- Cambios en ambos lados.
- Primera conexión sin archivo remoto.
- Primera conexión con datos en ambos lados.
- Local vacío con remoto válido.
- Archivo remoto inexistente o en papelera.
- IDs perdidos y recuperación por búsqueda.
- Archivos/carpetas duplicados.
- `dataset_id` distinto.
- Token vencido y permiso revocado.
- JSON remoto inválido sin modificación local.
- Cambio remoto detectado entre la primera lectura y la subida.
- Respuesta de subida incierta sin reintento ciego.
- Dos intentos de sincronización paralela.
- Descarga válida con backup y limpieza de `local_dirty`.
- Cancelación de conflicto sin cambios en ningún lado.
- Cambio de otra pestaña antes de guardar o sincronizar.

Las pruebas deben verificar efectos observables completos: resultado, errores, contenido guardado, `local_dirty`, revisión, base remota y ausencia de escrituras cuando una operación es rechazada.

Las pruebas con mocks no prueban OAuth real. Reportalas exactamente como mocks.

## 12. Verificación funcional

Cuando el entorno lo permita, verificá también:

- La app actual abre y conserva los registros anteriores.
- Alta, edición, borrado, estado de pago, clonado y tarjetas siguen funcionando.
- Exportar → cambiar datos → importar recupera el estado esperado.
- Un archivo inválido no cambia nada.
- La app funciona sin conexión después de cargar sus recursos locales.
- La UI es usable en una vista angosta de celular.
- Conectar no produce popups automáticos al abrir la app.

Si existen Client ID y una cuenta de prueba autorizada, realizá una prueba manual controlada con datos descartables entre dos perfiles/dispositivos. Si no existen, dejá esta única verificación como pendiente y proporcioná pasos exactos para ejecutarla después.

No uses datos financieros reales para pruebas de Drive.

## 13. Entrega final

Antes de cerrar:

- Revisá el diff completo y el estado de Git.
- Ejecutá las pruebas enfocadas y la suite completa disponible.
- Verificá que no queden referencias operativas a Supabase ni Google Sheets.
- Verificá que no haya tokens, secretos o datos reales en archivos, logs o tests.
- Actualizá `odd/tasks/google-drive-sync.md` con resultados y commits si corresponde.
- Reportá por fase: qué se implementó, archivos principales, comandos de prueba y resultados.
- Listá explícitamente cualquier prueba omitida, pendiente o fallida y su motivo.
- Distinguí claramente entre pruebas automatizadas, mocks y prueba real de Google Drive.
- No afirmes que Drive funciona realmente si solamente se probaron mocks.
- No hagas push, PR, deploy ni publicación.

El resultado esperado es una app local completamente funcional, con respaldo JSON confiable y sincronización manual de Drive implementada y probada hasta el nivel que las credenciales disponibles permitan.
