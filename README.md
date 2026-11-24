# APK Gastos

PWA de control de gastos personales: minimalista, offline-first, para un grupo
reducido de usuarios.

## Por dónde empezar

1. **`notas/04-plan-de-trabajo.md`** — plan de arranque: stack decidido
   (Cloudflare Pages + Supabase), orden de trabajo, riesgos pendientes, flujo
   de trabajo con agentes y setup de herramientas.
2. `notas/00-documento-maestro.md` — propósito, principios y alcance.
3. `notas/01-arquitectura.md` — arquitectura y decisiones registradas.
4. `notas/02-roadmap.md` — fases de evolución.
5. `notas/03-modelo-datos-y-sincronizacion.md` — modelo de datos, RLS y sync.
6. `notas/05-mejoras-uso-personal.md` — mejoras locales (backup, presupuesto,
   categorías, deuda de tarjetas, plantillas, búsqueda) con reglas de negocio,
   casos de uso y tareas.

## Estado actual

App monolítica (`index.html`, `sw.js`, `manifest.json`) publicada en GitHub
Pages. Datos solo en `localStorage`, sin exportación. Migración a Cloudflare
Pages + Supabase en curso según `notas/04`.
