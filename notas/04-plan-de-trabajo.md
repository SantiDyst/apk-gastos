# Plan de Trabajo — Modularización, Cloudflare Pages y Google Drive

Documento de arranque para retomar el proyecto. Las decisiones de fondo están en `00-documento-maestro.md` y `01-arquitectura.md`; el contrato JSON y la sincronización en `03-modelo-datos-y-sincronizacion.md`; las fases en `02-roadmap.md`; las mejoras de uso personal en `05-mejoras-uso-personal.md`.

Este documento define el orden de ejecución, el flujo de trabajo con agentes y el setup necesario para que cualquier sesión nueva pueda arrancar sin reconstruir las decisiones.

## 1. Estado de partida

- La app es una PWA monolítica: `index.html` con HTML, CSS y JavaScript inline, más `sw.js` y `manifest.json`.
- Los datos viven únicamente en `localStorage`; no existe exportación ni importación.
- La publicación actual está en GitHub Pages; se migra a Cloudflare Pages.
- Stack decidido: **Cloudflare Pages (hosting) + Google Drive (copia remota personal) + Google Identity Services (autorización)**.
- La sincronización inicial será manual, con una foto completa del JSON y sin backend propio.
- Supabase queda descartado para esta etapa: no se crearán tablas, cuentas propias ni políticas RLS.

## 2. Por qué este stack

| Factor | Decisión con Google Drive |
| --- | --- |
| Datos | Cada usuario conserva un JSON en su propio Drive. |
| Autorización | GIS y OAuth con el alcance mínimo `drive.file`. |
| Aislamiento | No existe una base compartida entre usuarios que administrar. |
| Operación | No hay base que pausar, cron anti-inactividad ni `pg_dump`. |
| Offline | `localStorage` sigue siendo la fuente de trabajo; Drive es opcional. |
| Multi-dispositivo | Sincronización explícita del mismo JSON entre PC y celular. |
| Conflictos | Se detectan cambios en ambos lados y el usuario elige; no hay fusión automática. |

La parte delicada ya no es administrar tablas o sesiones: es evitar sobrescrituras, validar cualquier JSON recuperado y hacer comprensible la resolución de conflictos.

## 3. Orden de trabajo

Cada paso corresponde a las fases de `02-roadmap.md`.

1. **Respaldo local JSON (Fase 0).** Implementar exportación e importación antes de tocar cualquier otra cosa. El archivo debe validarse y permitir recuperar el estado sin destruir datos ante una entrada inválida.
2. **Modularización (Fase 1).** Partir `index.html` según `01-arquitectura.md` §2. Prioridad: aislar almacenamiento y compartir el formato/validador entre `backup.js` y `drive-sync.js`.
3. **Correcciones de riesgos (dentro de Fase 1).** Resolver la lista de §4 sin cambiar el comportamiento visible.
4. **Cloudflare Pages (dentro de Fase 1).** Crear el proyecto, publicar y verificar la PWA desde el nuevo dominio.
5. **Payload unificado (Fase 2).** Agregar metadatos, normalizar notas, migrar formatos viejos e incluir configuración y plantillas cuando existan.
6. **Google Drive (Fase 3).** Configurar Google Cloud e implementar conexión, archivo remoto, botón manual, estados, conflictos y recuperación.
7. **Formatos complementarios (Fases 4 y 5).** Agregar exportación tabular e importación por plantilla sin crear otro modelo de datos.

Ninguna sincronización se implementa antes de que el respaldo local y la validación sean confiables.

## 4. Riesgos detectados en la revisión inicial

Todos verificados en revisión estática sobre `index.html`, `sw.js` y `manifest.json`:

1. Datos solo en `localStorage`, sin exportación ni importación implementadas. Riesgo de pérdida de datos.
2. Descripciones y notas insertadas con `innerHTML` sin escapar → XSS almacenado si el contenido llega a ser externo.
3. `JSON.parse` y escrituras sin validación ni recuperación ante datos corruptos.
4. Dos pestañas abiertas pueden pisar los datos mutuamente porque cada una guarda el objeto completo.
5. Cuotas admiten valores inválidos; importes con centavos se muestran redondeados.
6. El Service Worker borra todas las demás cachés del origen al activarse.
7. El `manifest.json` menciona Google Sheets, una integración que no forma parte de la arquitectura elegida.

Drive agrega riesgos que deben verificarse en Fase 3:

- Tokens vencidos o permisos revocados.
- Archivos borrados, duplicados o modificados externamente.
- Primera conexión con datos en ambos lados.
- Cambios simultáneos locales y remotos.
- Respuesta de subida incierta y reintentos que puedan duplicar archivos.
- Cambio de cuenta de Google en un dispositivo con datos existentes.

Las reglas para tratarlos están en `03-modelo-datos-y-sincronizacion.md` §§7-10.

## 5. Cómo vamos a trabajar con agentes

Flujo de trabajo (ODD — Organic Driven Development), en criollo:

- **Cada paso grande se documenta antes de escribir código.** Se crea un documento de feature (`odd/tasks/<feature>.md`) con pedidos textuales, tareas numeradas y registro de decisiones. Ese documento es la fuente de verdad que leen los agentes.
- **El agente principal coordina.** Trabajo chico o mecánico: inline. Unidades de comportamiento independientes y pesadas: subagentes escritores con permisos de edición acotados para no pisarse.
- **Unidad de trabajo = unidad de commit.** Se commitea en rebanadas revisables (~400 líneas cambiadas), con tests y docs junto al código. No se pushea ni se publica sin pedido explícito del usuario.
- **Verificación antes de dar por bueno.** Una tarea se marca completada solo cuando se observa que funciona.
- **Memoria entre sesiones.** Las decisiones quedan guardadas en Engram y los documentos de feature en el repo.

Convención de idioma: conversación y notas en español; código, comentarios y mensajes de commit en inglés, salvo la UI de la app que ya está en español.

## 6. Setup de herramientas

Requisito: Node.js instalado (ya está: v24). Cloudflare se administra con `npx`; Google Cloud se configura desde su consola.

### 6.1 Cloudflare

`wrangler` es la CLI oficial de Cloudflare y se ejecuta vía `npx` (la primera vez
descarga la versión vigente).

```bash
npx wrangler login
npx wrangler whoami
npx wrangler pages project list
```

El token queda guardado localmente en la PC; ninguna contraseña pasa por el chat. Como alternativa restringida, usar un token de Cloudflare con solo los permisos necesarios y exportarlo como `CLOUDFLARE_API_TOKEN` antes de ejecutar wrangler.

Publicación: el armado se hace con `npm run build`, que deja el sitio en `dist/`
solo con los archivos de la app. Después, dos caminos:

- Integración con Git en el panel de Cloudflare (build `npm run build`, salida
  `dist`), recomendada porque agrega previews por rama.
- Subida directa: `npm run deploy` (arma y publica `dist/` con
  `wrangler pages deploy`).

### 6.2 Google Cloud y Drive

1. Crear o seleccionar un proyecto en Google Cloud Console.
2. Habilitar **Google Drive API**.
3. Configurar la pantalla de consentimiento OAuth.
4. Mientras la app esté en pruebas, registrar las cuentas Google autorizadas como usuarios de prueba.
5. Crear credenciales OAuth de tipo **Aplicación web**.
6. Agregar los orígenes JavaScript del dominio final, del dominio de Cloudflare Pages utilizado y de `localhost` con su puerto.
7. Incorporar el Client ID en la configuración pública del frontend cuando se implemente Fase 3.

No se necesita un Client Secret para el modelo de tokens de GIS en el navegador. La primera autorización real se hará desde el botón de la app y no pasará por el chat.

### 6.3 Checklist de preparación

- [ ] `npx wrangler whoami` muestra la cuenta de Cloudflare.
- [x] Existe un proyecto de Google Cloud con Drive API habilitada.
- [x] La pantalla OAuth y los usuarios de prueba están configurados.
- [x] Existe un Client ID web con todos los orígenes necesarios: están
      `http://localhost:8080` y falta confirmar `https://apk-gastos.pages.dev`
      (producción). Las URLs con hash y los aliases de rama no sirven como origen
      estable.
- [x] `npm run build` deja el sitio publicable en `dist/`.
- [x] Cloudflare Pages publica en `https://apk-gastos.pages.dev` por subida
      directa (`npm run deploy`); el proyecto no está conectado a Git.
- [ ] `notas/04-plan-de-trabajo.md` fue leído antes de empezar.

La configuración de Google puede prepararse antes de Fase 3, pero no reemplaza las fases de respaldo y validación.

## 7. Reglas de seguridad y credenciales

1. Ninguna contraseña, token o clave privada se escribe en el chat ni en el repositorio.
2. El Client ID web de Google es público por diseño y puede estar en el frontend.
3. No se agregará un Client Secret ni credenciales administrativas al frontend.
4. Se solicitará únicamente `https://www.googleapis.com/auth/drive.file`.
5. Los tokens de acceso no se guardan en `localStorage`, en el JSON ni en logs.
6. La UI deberá mostrar errores sin exponer tokens ni respuestas sensibles.
7. Los textos importados o descargados se consideran contenido externo y requieren validación y renderizado seguro.

## 8. Operación y respaldos con Drive

- No se necesita cron anti-pausa ni mantenimiento de una base compartida.
- Cada usuario controla su archivo `APK Gastos/apk-gastos-data.json` y su cuota de Drive.
- La app mantiene una copia local para uso offline y una copia remota cuando el usuario sincroniza.
- El archivo remoto principal no garantiza historial: Drive puede eliminar revisiones antiguas no fijadas.
- La exportación manual JSON se conserva como respaldo independiente.
- Antes de importar o descargar una versión que reemplace datos, la app genera un backup local.
- Desconectar Google no borra datos locales ni remotos.
- Los backups remotos con fecha y política de retención quedan para una mejora posterior.

## 9. Pendientes de las revisiones anteriores

Estos puntos siguen siendo trabajo de implementación aunque su destino ya esté definido en las notas:

1. **Nombre de la app inconsistente.** Elegir uno y aplicarlo en repo, título, manifest y encabezado (Fase 1).
2. **Ícono desde CDN.** Guardarlo local y cachearlo en el Service Worker (Fase 1).
3. **Color de tema desincronizado.** Alinear manifest, HTML y cambios por JavaScript (Fase 1).
4. **Migración del formato actual.** La app conserva campos en español; la normalización y compatibilidad están definidas en `notas/03` §5 (Fases 0 y 2).
5. **Campo de notas duplicado.** La app escribe `notas` y lee `notes || notas`; migrar a `notes` sin perder datos (Fases 0 y 2).
6. **Categorías y configuración.** `config.cat_ing`, `config.cat_gas`, `config.presupuesto` y `plantillas_fijas` viajan dentro del mismo JSON; falta implementar las mejoras que aún no existen.
7. **Manifest desactualizado.** Reemplazar la referencia a Google Sheets por la descripción real de la app, sin afirmar que Drive ya está implementado (Fase 1).
