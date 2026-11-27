# APK Gastos

PWA personal de control de gastos: minimalista, offline-first, sin backend. Los
datos viven en `localStorage` y se pueden exportar/importar como JSON y
sincronizar manualmente con una copia propia en Google Drive.

La hoja de ruta y las decisiones de arquitectura están en `notas/`; el detalle
de esta entrega está en `odd/tasks/google-drive-sync.md`.

## Funcionalidad

- Ingresos y gastos por mes/año, estado pagado/pendiente y copia del mes anterior.
- Compras en cuotas con navegación por mes/año y tres temas visuales.
- Respaldo JSON versionado con validación completa antes de importar.
- Migración sin pérdida del formato viejo (`principal`, `tarjetas`, `config`) y
  del campo `notas` al campo normalizado `notes`.
- Backup automático del estado vigente antes de cualquier importación o
  descarga que reemplace datos.
- Sincronización manual con Google Drive: `APK Gastos/apk-gastos-data.json`,
  alcance mínimo `drive.file`, tokens solo en memoria.
- Resolución explícita de conflictos: descargar Drive, subir este dispositivo o
  cancelar, con opción de exportar una copia local antes de elegir.
- Detección de cambios hechos por otra pestaña; una pestaña desactualizada no
  puede guardar ni sincronizar.
- Uso offline de la app y del respaldo local; Drive siempre va a la red.

## Estructura

```text
index.html          marcado de la app
css/styles.css      estilos y temas
js/app.js           arranque, mutaciones y render
js/storage.js       almacenamiento local, contrato JSON, validación y sync state
js/backup.js        exportación, importación y backups automáticos
js/drive-sync.js    GIS, Drive REST y algoritmo de sincronización
js/ui.js            diálogos, panel de sync y mensajes
js/config.js        Client ID público de Google (vacío por defecto)
sw.js               service worker versionado, sin cachear Google
manifest.json       metadatos PWA e iconos locales
tests/              pruebas con node:test
```

`localStorage` guarda el payload versionado en `finanzas_data_v3`. El estado de
sincronización queda aparte, en `apk_gastos_sync_v1`, y nunca viaja en el JSON.
Los tokens de Google no se persisten.

## Desarrollo

Requiere Node.js 24 o superior para las pruebas.

```bash
npm test
```

Servir la carpeta como sitio estático (módulos ES y service worker requieren
HTTP, no `file://`):

```bash
python -m http.server 8080
# o
npx serve .
```

Abrir `http://localhost:8080`.

## Google Drive (opcional)

Estado actual: `js/config.js` ya contiene el Client ID del proyecto
`app-gastos-515923` (credencial de tipo **Aplicación web**), con el origen
`http://localhost:8080` autorizado y la cuenta de prueba habilitada en la consola.
La conexión y la primera subida están verificadas en una cuenta real; el ciclo
entre dos dispositivos sigue pendiente. Falta registrar el dominio de producción o
de Cloudflare Pages cuando exista.

Si `GOOGLE_CLIENT_ID` queda vacío, Google Drive se deshabilita con un aviso y el
respaldo JSON local funciona igual.

1. Crear o elegir un proyecto en Google Cloud Console.
2. Habilitar **Google Drive API**.
3. Configurar la pantalla de consentimiento OAuth y los usuarios de prueba
   mientras la app esté en pruebas.
4. Crear credenciales OAuth de tipo **Aplicación web** (Client ID público, sin
   Client Secret en el frontend).
5. Registrar los orígenes JavaScript autorizados:
   - dominio final de producción;
   - dominio de Cloudflare Pages utilizado (producción y previews, según el
     dominio que se use);
   - `http://localhost:8080` (o el puerto local elegido).
6. Copiar el Client ID en `GOOGLE_CLIENT_ID` dentro de `js/config.js`.

La guía completa para probar OAuth real en Chrome, entre dos perfiles, en celular
y como PWA instalada está en `notas/08-prueba-oauth-drive-real.md`. Mientras
queden advertencias de revisión pendientes, usar solamente datos descartables.

La app pide acceso únicamente con `https://www.googleapis.com/auth/drive.file`.
La primera autorización ocurre al pulsar **Conectar Google Drive** o
**Sincronizar**; nunca al abrir la app.

## Sincronización

1. **Exportar JSON**: descarga `apk-gastos-backup-AAAA-MM-DD.json`.
2. **Importar JSON**: valida el archivo, muestra un resumen, pide confirmación y
   genera un backup automático antes de reemplazar. Si el archivo es inválido no
   se modifica nada.
3. **Conectar Google Drive**: autoriza y localiza la carpeta/archivo remoto; no
   sube ni descarga datos.
4. **Sincronizar**: lee Drive primero y decide:

| Cambios locales | Cambios remotos | Acción |
| --- | --- | --- |
| No | No | Informa actualizado; no escribe |
| Sí | No | Sube la foto local |
| No | Sí | Valida, genera backup local y descarga |
| Sí | Sí | Pide resolución de conflicto |

No hay fusión registro por registro ni sincronización automática. El archivo de
Drive es la última foto sincronizada, no un historial de backups: conservá tus
exportaciones JSON como respaldo independiente.

**Desconectar** revoca el acceso y limpia la asociación local; no borra datos
locales ni el archivo de Drive.

## Publicación en Cloudflare Pages

El proyecto es estático: no hay compilación de assets, pero sí un paso de armado.
`npm run build` copia el shell de la app a `dist/` — solo `index.html`,
`manifest.json`, `sw.js`, `_headers`, `css/`, `js/` e `icons/`. Las notas, las
pruebas y los documentos internos de `odd/` no se publican.

El archivo `_headers` define cabeceras de seguridad y desactiva el cacheo del
service worker, del HTML y de los módulos, para que un deploy nuevo no quede
servido desde caché vieja.

### Opción A — integración con Git (recomendada)

1. Subir la rama a GitHub (`git push origin feat/google-drive-sync`).
2. En el panel de Cloudflare: **Workers & Pages → Create → Pages → Connect to
   Git**, repositorio `SantiDyst/apk-gastos`.
3. Rama de producción: `master`.
4. Build command: `npm run build`. Build output directory: `dist`.
5. Cada push a la rama de producción publica; las demás ramas generan previews
   con su propia URL.

### Opción B — subida directa con Wrangler

```bash
npm run build
npx wrangler login
npm run deploy
```

`npm run deploy` publica `dist/` en el proyecto `apk-gastos` usando
`wrangler pages deploy`. La primera ejecución descarga wrangler vía `npx` y crea
el proyecto si todavía no existe.

### Después del primer deploy

1. Registrar en Google Cloud los orígenes del dominio publicado
   (`https://<proyecto>.pages.dev` y el dominio propio si se agrega), además de
   `http://localhost:8080`, sin barra final. Sin este paso OAuth falla con
   `403 access_denied`.
2. Probar la conexión desde el dominio HTTPS: es el único origen donde se puede
   instalar la PWA y probar Chrome móvil.
3. Verificar que `sw.js` se actualice después de cada deploy (el número de
   `CACHE_NAME` tiene que cambiar para invalidar el caché anterior).

El deploy no está ejecutado todavía: esta entrega deja el armado y la
configuración listos para publicar.

## Pruebas

`npm test` ejecuta las suites de `node:test`:

- `tests/storage.test.js` — contrato JSON, migraciones, validaciones, revisión,
  `local_dirty` y pestañas desactualizadas.
- `tests/build.test.js` — el armado publica solo el shell de la app y no deja
  escribir en la raíz del repositorio.
- `tests/backup.test.js` — exportación, importación, archivos inválidos y backup
  automático antes de reemplazar.
- `tests/drive-sync.test.js` — tabla de decisión, conflictos, primera conexión,
  tokens vencidos, JSON remoto inválido, cambios concurrentes, reintentos,
  sincronización paralela y mocks de Drive.

Todas las pruebas de Drive usan mocks. Con el Client ID configurado, la conexión y
la primera subida quedaron verificadas a mano en Chrome de escritorio; el ciclo
entre dos dispositivos, con datos descartables, sigue pendiente.

## Estado

Implementadas las fases 0 a 3 del roadmap: respaldo JSON local, modularización y
correcciones, payload versionado con estado de sincronización, e integración
manual con Google Drive. Fuera de alcance: Supabase, backend propio, IndexedDB,
exportación Excel/CSV, presupuestos/categorías/plantillas editables y
sincronización automática.
