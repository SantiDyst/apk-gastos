# Sincronización con Google Drive — Enfoque PC y Celular

## 1. Cambio de enfoque en la nube

Se reemplaza la arquitectura centrada en **Supabase** (base de datos compartida, tablas con `user_id`, RLS y mantenimiento de servidor/cron) por un modelo de **almacenamiento personal en el Google Drive de cada usuario**, opcional y bajo demanda.

### Principios clave

- **100 % offline-first:** La app sigue funcionando localmente en el dispositivo (`localStorage` / IndexedDB) sin necesidad de cuenta ni conexión.
- **Sin backend propio ni base de datos central:** Los datos financieros y plantillas viven en el dispositivo del usuario y en su propio Google Drive.
- **Sincronización decidida por el usuario:** El usuario elige si conecta su cuenta de Google y cuándo sincronizar mediante acción explícita (botón **Sincronizar**).
- **Multi-dispositivo (PC + Celular):** El mismo flujo funciona en Chrome de escritorio, Chrome móvil y la PWA instalada.

---

## 2. Flujo de usuario (PC y Celular)

1. **Uso local (sin cuenta):**
   - El usuario abre la app en PC o celular y registra ingresos, gastos, cuotas y plantillas como hasta ahora.
2. **Vinculación única con Google Drive:**
   - El usuario pulsa **"Conectar con Google Drive"** (siempre disparado por clic directo del usuario para evitar bloqueos de popups en navegador móvil/PWA).
   - Autoriza el permiso mínimo `https://www.googleapis.com/auth/drive.file` (acceso exclusivo a los archivos y carpetas creados por la propia app, sin ver el resto del Drive).
   - La app ubica o crea una carpeta dedicada (por ejemplo, `APK Gastos/`) y su archivo principal de datos (`apk-gastos-data.json`), guardando localmente la referencia (`folderId` / `fileId`).
3. **Sincronización bajo demanda (botón "Sincronizar"):**
   - Al pulsar **Sincronizar**, la app verifica si el token de acceso sigue vigente (si expiró, solicita renovación al momento).
   - Compara la versión local con el archivo remoto en Drive antes de escribir:
     - **Si Drive tiene cambios más recientes** (por ejemplo, cargados desde el celular y abiertos luego en PC): avisa al usuario para descargar/actualizar antes de sobrescribir.
     - **Si local tiene cambios más recientes** (o es la primera sincronización): sube el JSON actualizado a la ruta identificada en Drive.
4. **Respaldo de plantillas y exportaciones:**
   - Desde la misma carpeta de Drive se pueden guardar o recuperar copias de respaldo JSON y plantillas de gastos fijos o importación.

---

## 3. Modificaciones necesarias en la aplicación

### 3.1 Arquitectura y módulos (`js/`)

- **Descartar módulos de Supabase:** No se implementan `supabase-client.js`, tablas SQL ni políticas RLS.
- **Incorporar `js/drive-sync.js`:** Módulo encargado de:
  - Inicializar Google Identity Services (GIS) para autenticación OAuth en cliente.
  - Buscar o crear la carpeta/archivo de la app en Google Drive (`drive.file`).
  - Subir y descargar el archivo de datos (`apk-gastos-data.json`) y plantillas.
  - Gestionar estados de UI (`desconectado`, `sincronizando`, `actualizado`, `error`, `conflicto / versión remota más nueva`).

### 3.2 Modelo de datos y control de versiones

- **Unificar el formato de respaldo y sincronización:** Utilizar la misma estructura JSON definida para exportación/importación (`principal`, `tarjetas`, `config`, `plantillas_fijas`) agregando metadatos mínimos de control:
  - `schema_version`: versión de estructura de datos.
  - `updated_at`: marca de tiempo ISO de la última modificación local.
  - `device_label` (opcional): identificador simple del origen (ej. "Chrome PC" / "Celular") para mostrar avisos claros si hay diferencias entre dispositivos.
- **Limpieza previa (ya prevista en Fase 1/2):**
  - Unificar campo `notes` (eliminando la duplicidad `notes || notas`).
  - Asegurar que `config.cat_ing`, `config.cat_gas`, `config.presupuesto` y `plantillas_fijas` viajen dentro del mismo JSON sincronizado.

### 3.3 Interfaz de usuario (UI)

- **Panel / Estado de sincronización accesible:**
  - Botón **"Conectar Google Drive"** / **"Desconectar"**.
  - Botón **"Sincronizar"** visible y claro.
  - Indicador de última sincronización (fecha y hora) y estado actual.
- **Diálogo de seguridad ante conflictos:**
  - Si al sincronizar en PC se detecta que el archivo en Drive fue actualizado más recientemente desde el celular (o viceversa), preguntar antes de pisar datos (*"Hay datos más nuevos en Drive. ¿Descargar en este dispositivo o reemplazar con los locales?"*).
- **Exportación / Importación local se mantiene:**
  - El respaldo manual a archivo JSON descargable sigue existiendo como red de seguridad independiente de Google Drive.

### 3.4 Consideraciones específicas para Chrome PC y Celular (PWA)

- **Autenticación siempre por interacción directa:** Nunca disparar el popup de Google automáticamente al abrir la página; hacerlo únicamente al pulsar conectar o sincronizar.
- **Service Worker (`sw.js`):**
  - No cachear llamadas a `googleapis.com` ni `accounts.google.com`; las peticiones a Drive siempre van a red y, si no hay conexión, muestran un aviso claro sin afectar el uso offline.
- **Hosting en Cloudflare Pages:**
  - Configurar los orígenes JavaScript autorizados en Google Cloud Console con el dominio de Cloudflare Pages (y `localhost` para desarrollo).

---

## 4. Impacto en el Roadmap existente

- **Fase 0 (Respaldo local JSON) y Fase 1 (Modularización, correcciones de seguridad/PWA y Cloudflare Pages):** Se mantienen sin cambios.
- **Fases 2 a 7 (Modelo remoto, Supabase, Auth y Sync):** Se simplifican en dos etapas:
  1. **Preparación del payload unificado** (JSON con `updated_at`, notas unificadas, categorías y plantillas incluidas).
  2. **Integración de Google Drive (`drive-sync.js`)** con conexión bajo demanda, ubicación automática de carpeta/archivo de la app y botón **Sincronizar** probado en Chrome PC y celular.