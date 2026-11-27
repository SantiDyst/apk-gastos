# Arquitectura — Cloudflare Pages y Google Drive

## 1. Vista general

La arquitectura estará compuesta por tres partes:

1. PWA alojada en Cloudflare Pages.
2. Almacenamiento local para trabajo offline.
3. Google Drive como copia remota personal y opcional.

```text
Usuario
   |
   v
PWA en Cloudflare Pages
   |
   +---- Almacenamiento local
   |
   +---- Google Identity Services (autorización)
   |
   +---- Google Drive (archivo JSON del usuario)
```

No será necesario mantener una computadora personal encendida, ejecutar procesos en segundo plano ni administrar una base de datos central.

## 2. Frontend

El frontend seguirá utilizando HTML, CSS y JavaScript.

Antes de agregar sincronización, conviene separar gradualmente el código actual.

Estructura sugerida:

```text
/
├── index.html
├── manifest.json
├── sw.js
├── css/
│   └── styles.css
└── js/
    ├── app.js
    ├── storage.js
    ├── backup.js
    ├── drive-sync.js
    └── ui.js
```

No es obligatorio realizar toda la separación de una vez. La prioridad es aislar el acceso a datos y reutilizar el mismo formato y validador para exportación, importación y Drive.

`drive-sync.js` será responsable de Google Identity Services, la comunicación con Drive y los estados de sincronización. No deberá contener reglas de presentación ni escrituras dispersas de datos financieros.

## 3. Capa de almacenamiento

La interfaz deberá dejar de llamar a `localStorage` directamente desde muchas funciones.

Se recomienda crear funciones únicas, por ejemplo:

```js
getExpenses()
saveExpense(expense)
updateExpense(expense)
deleteExpense(id)
```

Al comienzo, estas funciones utilizarán almacenamiento local. Toda mutación deberá pasar por la capa común y marcar el estado local como pendiente de sincronización.

`localStorage` es suficiente para la primera versión y el volumen esperado. IndexedDB queda como alternativa futura si aumentan la cantidad de datos o las consultas locales; no es un requisito para integrar Drive.

## 4. Autorización con Google

Google Identity Services permitirá solicitar acceso a Drive desde el navegador mediante el modelo de tokens.

Reglas:

- Utilizar únicamente `https://www.googleapis.com/auth/drive.file`.
- Iniciar la conexión o renovación solamente desde una acción directa del usuario, como **Conectar Google Drive** o **Sincronizar**.
- No mostrar el diálogo de Google automáticamente al abrir la app.
- No guardar tokens de acceso en `localStorage` ni incluirlos en el JSON.
- Considerar que los tokens vencen: una nueva sesión o sincronización puede requerir un token nuevo aunque el consentimiento siga vigente.
- Verificar en las respuestas que el permiso necesario fue otorgado.
- Al desconectar, revocar el acceso y limpiar el estado de conexión local sin borrar datos locales ni remotos.

El Client ID web es público por diseño. No se utilizará un secreto de cliente en el frontend.

## 5. Almacenamiento en Google Drive

La app ubicará o creará una carpeta visible, por ejemplo `APK Gastos/`, y un archivo principal `apk-gastos-data.json` con tipo `application/json`.

Se podrán guardar localmente `folderId` y `fileId`, pero no se asumirá que esas referencias existen para siempre.

La recuperación deberá contemplar:

- Archivo o carpeta borrados o enviados a la papelera.
- Pérdida de los IDs al borrar los datos del navegador.
- Varios archivos o carpetas con el mismo nombre.
- Permiso revocado o cuenta de Google distinta.
- JSON remoto inválido o modificado externamente.

Si la búsqueda devuelve varios candidatos, la app no elegirá uno arbitrariamente. El `dataset_id` dentro del JSON ayudará a reconocer el conjunto de datos esperado.

El alcance `drive.file` restringe qué archivos puede tocar esta app, pero no provee cifrado de extremo a extremo ni impide el acceso del propio usuario o de otras apps autorizadas.

## 6. Flujo offline y sincronización manual

El flujo normal será:

1. El usuario crea o modifica un registro.
2. El cambio se guarda localmente de inmediato.
3. La capa de almacenamiento marca `local_dirty = true`.
4. Cuando el usuario pulsa **Sincronizar**, la app obtiene autorización si hace falta y consulta primero el estado remoto.
5. La app decide la acción comparando el cambio local con la versión remota vista por última vez en ese dispositivo.

Casos:

| Cambios locales | Cambios remotos | Acción |
| --- | --- | --- |
| No | No | Informar que está actualizado. |
| Sí | No | Subir el JSON local. |
| No | Sí | Validar, generar backup local y descargar. |
| Sí | Sí | Mostrar conflicto y esperar una elección. |

La fecha `updated_at` es informativa: no decide qué versión gana porque los relojes de los dispositivos pueden diferir.

Después de una subida confirmada se limpia `local_dirty` y se guarda la nueva versión remota. Después de una descarga confirmada se hace lo mismo con la versión descargada.

## 7. Conflictos y alcance de la primera versión

La sincronización utilizará una foto completa del JSON. No fusionará cambios registro por registro.

Existe conflicto cuando ambos lados cambiaron desde la última sincronización, aunque hayan modificado registros distintos. El usuario podrá elegir:

- Descargar y reemplazar los datos locales.
- Subir y reemplazar el archivo remoto.
- Exportar antes una copia local de seguridad.

En la primera conexión, si ya existen datos locales y remotos y el dispositivo no tiene una versión base conocida, también deberá preguntar antes de reemplazar cualquiera de los dos.

La lectura previa reduce el riesgo de sobrescritura, pero no convierte Drive en un sistema colaborativo transaccional. Se evitarán sincronizaciones paralelas desde una misma instancia y, ante una respuesta de red incierta, se releerá el estado remoto en lugar de reintentar a ciegas.

También se detectarán cambios realizados por otra pestaña del mismo navegador para evitar guardar o sincronizar desde una copia local desactualizada.

## 8. Identificadores y metadatos

Cada registro conservará un UUID generado en el dispositivo. Esto evita duplicados al exportar, importar o reintentar operaciones.

El JSON incluirá como mínimo:

- `schema_version`: versión de la estructura.
- `dataset_id`: identificador estable del conjunto de datos.
- `revision`: número local de la foto, útil para trazabilidad pero no para decidir conflictos.
- `updated_at`: última modificación local en formato ISO, solo informativa.
- `device_label`: origen opcional para mostrar avisos comprensibles.

El estado exclusivamente local incluirá:

- `local_dirty`.
- `last_synced_remote_version` y, cuando corresponda, la huella de contenido remota.
- `last_synced_at`.
- `folderId` y `fileId`, si están disponibles.

Ninguno de estos metadatos reemplaza la validación del contenido ni autoriza a pisar datos sin confirmación cuando no existe una base común conocida.

## 9. Eliminación

No se requiere borrado lógico para la primera versión.

Cuando el usuario elimina un registro, la baja forma parte de la nueva foto local y se propaga al subir el JSON completo. Si Drive también cambió desde la última sincronización, la eliminación no se aplicará sin pasar por el diálogo de conflicto.

## 10. Respaldo y recuperación

El mismo JSON versionado se utilizará para:

- Exportación manual.
- Importación manual.
- Archivo principal de Drive.

Toda importación o descarga que reemplace datos deberá:

1. Leer y validar el contenido completo sin modificar el estado actual.
2. Generar un backup local del estado vigente.
3. Solicitar confirmación cuando corresponda.
4. Reemplazar los datos y actualizar los metadatos.

Las revisiones antiguas de Drive pueden eliminarse automáticamente si no se fijan. Por eso el archivo remoto principal no se considera un historial de backups garantizado; la exportación manual independiente se mantiene como red de seguridad.

## 11. Service Worker

El Service Worker seguirá siendo responsable del funcionamiento offline de los archivos de la aplicación.

Reglas para la integración:

- No cachear respuestas de `googleapis.com`, `accounts.google.com` ni otros recursos de autenticación y Drive.
- Las llamadas a Drive siempre irán a red.
- GIS se cargará bajo demanda para que un problema con Google no impida abrir la app offline.
- Un error de red deberá mostrar un estado claro sin modificar los datos locales.

El Service Worker no se utilizará como almacenamiento de datos financieros.

## 12. Cloudflare Pages y Google Cloud

Cloudflare Pages alojará los archivos estáticos. GitHub Pages queda como alternativa de respaldo si se desea mantener la publicación anterior.

En Google Cloud se deberá:

1. Crear o seleccionar un proyecto.
2. Habilitar Google Drive API.
3. Configurar la pantalla de consentimiento OAuth y los usuarios de prueba mientras corresponda.
4. Crear un Client ID de aplicación web.
5. Registrar los orígenes JavaScript reales: dominio final, dominio de Cloudflare Pages utilizado y `localhost` con su puerto de desarrollo.

No se expondrán secretos privados ni tokens administrativos en el frontend, el chat o el repositorio.

## 13. Decisiones registradas

- Cloudflare Pages reemplaza a GitHub Pages como hosting principal.
- Google Drive reemplaza a Supabase para la copia remota personal.
- No habrá tablas, `user_id`, RLS, cron anti-pausa ni backups administrados con `pg_dump`.
- La sincronización inicial será manual y de foto completa, sin fusión automática.
- `localStorage` se mantiene inicialmente; IndexedDB no es una dependencia.
- La autorización usa `drive.file` y tokens de corta duración solicitados por acciones del usuario.
- El usuario conserva sus datos locales, su archivo de Drive y la responsabilidad de conservar exportaciones independientes.
