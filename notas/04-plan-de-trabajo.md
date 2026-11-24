# Plan de Trabajo — Modularización, Cloudflare Pages y Supabase

Documento de arranque para retomar el proyecto. Las decisiones de fondo están en
`00-documento-maestro.md` y `01-arquitectura.md`; el modelo de datos en
`03-modelo-datos-y-sincronizacion.md`; las fases en `02-roadmap.md`. Este
documento define el orden de ejecución, el flujo de trabajo con agentes y el
setup de herramientas, para que cualquier sesión nueva pueda arrancar de acá.

## 1. Estado de partida

- La app es una PWA monolítica: `index.html` con HTML, CSS y JavaScript inline,
  más `sw.js` y `manifest.json`.
- Los datos viven únicamente en `localStorage`; no existe exportación.
- La publicación actual está en GitHub Pages; se migra a Cloudflare Pages.
- Stack decidido: **Cloudflare Pages (hosting) + Supabase (base de datos y
  autenticación)**, ambos en plan gratuito. D1 de Cloudflare descartado para
  esta etapa.

## 2. Por qué este stack (decisión registrada)

| Factor | Cloudflare D1 | Supabase Free |
|---|---|---|
| Capacidad para ~10 usuarios | Sobra | Sobra (500 MB) |
| Autenticación | Escribirla a mano en un Worker | Incluida |
| Aislamiento por usuario | Escribirlo a mano | RLS con `user_id` (ya diseñado en `notas/03`) |
| Apagado por inactividad | No | Pausa tras 7 días de baja actividad (mitigada, ver §8) |

La parte difícil del proyecto no es guardar datos: es la autenticación y que
cada usuario solo acceda a sus filas. Supabase lo resuelve sin código propio
de seguridad; D1 exigiría escribirlo a mano, con riesgo.

## 3. Orden de trabajo

Cada paso corresponde a las fases de `02-roadmap.md`.

1. **Respaldo y exportación (Fase 0).** Exportación básica de datos a JSON
   antes de tocar cualquier otra cosa. Ningún cambio posterior debe poder
   destruir los datos existentes.
2. **Modularización (Fase 1).** Partir `index.html` en módulos según la
   estructura de `01-arquitectura.md` §2 (`css/`, `js/app.js`, `js/storage.js`,
   `js/ui.js`, más adelante `js/auth.js`, `js/sync.js`). Prioridad: aislar el
   acceso a datos en funciones únicas (`getExpenses()`, `saveExpense()`, etc.).
   El comportamiento visible no cambia.
3. **Correcciones de riesgos (dentro de Fase 1).** La lista completa está en
   §4. Se corrigen después de modularizar, con el comportamiento ya igual al
   original y testeable.
4. **Cloudflare Pages (dentro de Fase 1).** Crear el proyecto, publicar la
   versión refactorizada y verificar la instalación como PWA desde el nuevo
   dominio. GitHub Pages queda como respaldo.
5. **Supabase (Fases 2 y 3).** Modelo de datos según `notas/03`, tablas con
   `user_id`, RLS activado, políticas por usuario.
6. **Autenticación opcional y migración (Fases 4 y 5).** Login opcional; el
   modo local sigue funcionando sin cuenta. Migración de datos locales con
   confirmación del usuario.
7. **Sincronización (Fases 6 y 7).** Primero manual con botón y estado
   visible; después automática moderada.

## 4. Riesgos detectados en la revisión inicial (a corregir)

Todos verificados en revisión estática sobre `index.html`, `sw.js` y
`manifest.json`:

1. Datos solo en `localStorage`, sin exportación implementada (Fase 0 la
   exige). Riesgo de pérdida de datos.
2. Descripciones y notas insertadas con `innerHTML` sin escapar → XSS
   almacenado si el contenido llega a ser externo.
3. `JSON.parse` y escrituras sin validación ni recuperación ante datos
   corruptos.
4. Dos pestañas abiertas pueden pisar los datos mutuamente (cada una guarda
   el objeto completo).
5. Cuotas admiten valores inválidos; importes con centavos se muestran
   redondeados.
6. El Service Worker borra todas las demás cachés del origen al activarse.
7. El `manifest.json` menciona Google Sheets, cuando la arquitectura eligió
   Supabase.

## 5. Cómo vamos a trabajar con agentes

Flujo de trabajo (ODD — Organic Driven Development), en criollo:

- **Cada paso grande se documenta antes de escribir código.** Se crea un
  documento de feature (`odd/tasks/<feature>.md`) con: los pedidos textuales
  del usuario, las tareas numeradas con su especificación, y un registro
  (log) de decisiones y correcciones. Ese documento es la fuente de verdad
  que leen los agentes antes de trabajar.
- **El agente principal coordina; no escribe todo él.** Trabajo chico o
  mecánico: lo hace inline. Unidades de comportamiento independientes y
  pesadas (por ejemplo, "capa de storage" y "correcciones de UI" como dos
  frentes separados): se delegan a subagentes escritores, cada uno con
  permisos de edición acotados a sus propios archivos, para que no pisen
  cambios entre sí.
- **Unidad de trabajo = unidad de commit.** Se commitea en rebanadas
  revisables (~400 líneas cambiadas), con tests y docs junto al código, y
  mensaje de commit descriptivo. No se pushea ni se publica sin pedido
  explícito del usuario.
- **Verificación antes de dar por bueno.** Cada tarea se marca completada
  solo cuando se observa que funciona (comportamiento igual al original tras
  modularizar, por ejemplo), no porque "parece" andar.
- **Memoria entre sesiones.** Las decisiones quedan guardadas en la memoria
  persistente del agente (Engram), y los documentos de feature en el repo:
  retomar no depende de recordar la charla.

Convención de idioma: conversación y notas en español; código, comentarios y
mensajes de commit en inglés, salvo la UI de la app que ya está en español.

## 6. Setup de herramientas (hacer una sola vez)

Requisitos: Node.js instalado (ya está: v24). Todo lo demás corre con `npx`.

### 6.1 Cloudflare

`wrangler` es la CLI oficial de Cloudflare (Workers, Pages, D1). Ya verificada
en esta máquina (v4.167.0 vía `npx`).

```bash
npx wrangler login        # abre el navegador y autoriza (OAuth)
npx wrangler whoami       # verifica la cuenta
npx wrangler pages project list
```

El token queda guardado localmente en la PC; ninguna contraseña pasa por el
chat. Alternativa más restringida: crear en el dashboard un token de solo
lectura (permisos Pages/Workers/D1 Read) y exportarlo como
`CLOUDFLARE_API_TOKEN` antes de correr wrangler.

### 6.2 Supabase

1. Entrar a https://supabase.com/dashboard → Account → **Access Tokens** →
   "Generate new token" (copiarlo; solo se muestra una vez).
2. Autenticar la CLI (no requiere instalación global; `npx` baja el binario):

```bash
npx supabase login        # pega el Access Token
npx supabase projects list
```

Opcional para tenerlo fijo: `npm install -g supabase`.

Con eso el agente puede listar proyectos, leer el esquema y volcar la base.

### 6.3 Checklist de "todo listo para arrancar"

- [ ] `npx wrangler whoami` muestra la cuenta de Cloudflare.
- [ ] `npx supabase projects list` muestra el proyecto (o la lista vacía, si
      todavía no se crea: crear el proyecto es tarea de Fase 3, no del setup).
- [ ] `notas/04-plan-de-trabajo.md` leído por el agente antes de empezar.

## 7. Reglas de seguridad de credenciales

1. Ninguna contraseña ni clave se escribe nunca en el chat: los logins
   guardan todo localmente.
2. La clave `anon` de Supabase es pública por diseño: va en el frontend.
3. La clave `service_role` **jamás** entra al frontend, al chat ni a ningún
   commit: con esa clave se saltean todas las reglas de seguridad.
4. Tokens de solo lectura cuando el alcance lo permita.

## 8. Operación continua (cuando Supabase esté activo)

- **Anti-pausa:** el plan gratuito pausa el proyecto tras 7 días de baja
  actividad. Mitigación: tarea programada gratuita (por ejemplo cron-job.org)
  que consulte la API del proyecto cada 2 o 3 días. Un proyecto pausado se
  restaura desde el dashboard y queda recuperable 90 días.
- **Backups:** el plan gratuito no incluye backups diarios. Mitigación:
  respaldo semanal con `npx supabase db dump` (o `pg_dump`), guardado fuera
  de la nube (PC personal o drive). Los usuarios confían sus datos al
  propietario de la cuenta; el backup es responsabilidad del propietario.
- **Doble respaldo por diseño:** copia local en el dispositivo del usuario
  (offline-first) + copia en Supabase. Si Supabase se cae, la app sigue
  andando; si el usuario pierde el dispositivo, los datos siguen en la nube.
