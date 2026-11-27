# Roadmap de Evolución

La arquitectura remota cambia de Supabase a Google Drive. Las antiguas fases de base de datos, autenticación propia y migración a Supabase se reemplazan por dos etapas: preparación del JSON e integración manual con Drive.

## Fase 0 — Respaldo local JSON y estabilidad

Objetivo: asegurar que el estado actual pueda recuperarse antes de cambios importantes.

Tareas:

- Crear una versión estable identificada.
- Guardar una copia del proyecto actual.
- Implementar exportación e importación de datos, hoy ausentes.
- Definir un JSON versionado compartido por respaldo local y futura sincronización.
- Validar todo el archivo antes de importar y generar un backup automático antes de reemplazar datos.
- Aceptar el formato local anterior para no perder registros existentes.
- Documentar la estructura actual de los registros.
- Probar instalación y funcionamiento offline.

Resultado esperado:

La versión actual queda protegida y el usuario puede exportar, importar y verificar la recuperación de su estado.

## Fase 1 — Refactor mínimo, correcciones y Cloudflare Pages

Objetivo: preparar el código para cambiar el almacenamiento sin rehacer la interfaz, corregir los riesgos conocidos y mudar la publicación.

Tareas:

- Separar estilos del HTML.
- Separar JavaScript del HTML.
- Crear una capa de almacenamiento.
- Evitar llamadas dispersas a `localStorage`.
- Corregir escapado de HTML (XSS), validación de `JSON.parse`, valores inválidos de cuotas, cachés que borra el Service Worker y metadatos incorrectos del `manifest.json`.
- Detectar cambios provenientes de otra pestaña antes de sobrescribir datos.
- Mantener exactamente el comportamiento actual.
- Crear el proyecto en Cloudflare Pages y publicar la versión refactorizada.
- Verificar la instalación como PWA desde el dominio de Cloudflare Pages.

Resultado esperado:

La aplicación sigue funcionando igual, pero el código queda preparado para el respaldo unificado y Google Drive.

## Fase 2 — Payload unificado y estado de sincronización

Objetivo: usar exactamente el mismo contrato JSON para exportación, importación y Drive.

Tareas:

- Agregar `schema_version`, `dataset_id`, `revision`, `updated_at` y `device_label` opcional.
- Normalizar `notes` sin perder los valores antiguos guardados como `notas`.
- Incluir `principal`, `tarjetas`, `config.cat_ing`, `config.cat_gas` y `config.presupuesto` cuando exista.
- Incluir `plantillas_fijas` cuando se implemente esa mejora.
- Preparar migraciones y validación por `schema_version`.
- Mantener compatibilidad de lectura con respaldos del formato anterior.
- Registrar localmente `local_dirty`, la versión remota conocida y la última sincronización.
- Marcar cambios en altas, ediciones, borrados, estados, clonado, configuración, plantillas e importaciones.

Resultado esperado:

Todos los datos personales viajan en un único JSON validado y la app puede distinguir cambios locales de cambios remotos sin depender del reloj del dispositivo.

## Fase 3 — Integración con Google Drive y sincronización manual

Objetivo: conectar opcionalmente el Drive del usuario y sincronizar entre PC y celular sin sobrescrituras automáticas.

Tareas:

- Crear y configurar el proyecto de Google Cloud, Drive API, pantalla OAuth y Client ID web.
- Registrar los orígenes de Cloudflare Pages y desarrollo local.
- Incorporar `js/drive-sync.js` con GIS y el alcance mínimo `drive.file`.
- Ubicar o crear la carpeta `APK Gastos/` y el archivo `apk-gastos-data.json`.
- Implementar subida, descarga y validación del mismo JSON de respaldo.
- Recuperar la conexión cuando falten IDs, haya duplicados, se revoque el permiso o cambie la cuenta.
- Agregar botones **Conectar Google Drive**, **Desconectar** y **Sincronizar**.
- Mostrar estados desconectado, cambios pendientes, sincronizando, actualizado, error y conflicto.
- Consultar Drive antes de escribir y comparar la versión remota con la última conocida.
- Preguntar ante cambios en ambos lados o una primera conexión con datos en ambos orígenes.
- Generar backup local antes de descargar una versión que reemplace datos.
- Impedir sincronizaciones paralelas y releer Drive ante resultados de red inciertos.
- Evitar caché de autenticación y Drive en el Service Worker.
- Probar conexión, vencimiento de token, conflicto, recuperación y uso offline en Chrome de escritorio, Chrome móvil y PWA instalada.

Resultado esperado:

El usuario controla cada sincronización y puede trasladar sus datos entre dispositivos sin que la app decida automáticamente qué versión pisar.

## Fase 4 — Exportación tabular

Objetivo: permitir que el usuario analice sus datos fuera de la app.

Formatos iniciales:

- CSV.
- JSON de respaldo, ya implementado en Fase 0.

Formato posterior:

- XLSX.

La exportación se realizará desde el navegador. El JSON de sincronización no se duplicará en otro módulo ni tendrá un formato distinto.

## Fase 5 — Importación con plantilla

Objetivo: importar datos tabulares sin intentar interpretar cualquier Excel.

Tareas:

- Crear plantilla oficial.
- Validar nombres de columnas.
- Mostrar vista previa.
- Informar filas inválidas.
- Evitar duplicados mediante UUID y reglas explícitas.
- Solicitar confirmación antes de guardar.
- Generar backup antes de reemplazar o incorporar datos.
- Reutilizar la capa de almacenamiento y marcar los cambios como pendientes de sincronización.

Resultado esperado:

El usuario puede migrar información desde una estructura conocida y controlada sin romper el respaldo JSON ni la sincronización.

## Fase 6 — Mejoras futuras

Posibles funciones:

- Plantillas permanentes de gastos fijos.
- Notificaciones.
- Informes mensuales.
- Categorías personalizadas.
- Presupuestos.
- Gráficos adicionales.
- Backups remotos con fecha y política de retención.
- Sincronización automática moderada, únicamente después de validar la experiencia manual.
- Compartir información entre integrantes de un hogar.

La fusión registro por registro, la colaboración simultánea y la sincronización automática no forman parte del alcance inicial. Compartir datos entre usuarios requeriría revisar la arquitectura y los permisos de Drive.
