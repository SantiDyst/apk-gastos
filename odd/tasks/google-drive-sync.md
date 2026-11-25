# Feature — Local JSON backup and manual Google Drive sync

Source of truth: `notas/01-arquitectura.md`, `notas/02-roadmap.md`,
`notas/03-modelo-datos-y-sincronizacion.md`, `notas/04-plan-de-trabajo.md`,
`notas/06-funciones-arquitectura.md` and `notas/07-prompt-implementacion-agente.md`.
This document tracks implementation; it does not add requirements.

## 1. Scope

Phases 0 to 3 of the roadmap:

- Phase 0: local JSON export/import with validation, migration and automatic
  backup before replacing data.
- Phase 1: modularization, security/data/PWA fixes and Cloudflare Pages
  preparation.
- Phase 2: versioned payload, migrations and local sync state.
- Phase 3: Google Identity Services plus Drive REST, manual sync and explicit
  conflict resolution.

Out of scope: Supabase, backend, automatic sync, record-level merge, IndexedDB,
Excel/CSV, budget/category/template/search UIs, deploy, push, PR.

## 2. Specifications

1. `localStorage` key `finanzas_data_v3` keeps holding the current data. New
   writes store the versioned payload; old shapes are migrated on read.
2. The JSON contract is exactly `notas/03`: `schema_version`, `dataset_id`,
   `revision`, `updated_at`, `device_label`, `principal`, `tarjetas`, `config`
   and `plantillas_fijas`.
3. Old `{ principal, tarjetas, config }` payloads are accepted and migrated
   without losing records.
4. `notas` is read and migrated to `notes`; a non-empty value in either variant
   is preserved. New writes only emit `notes`.
5. Validation rejects corrupt JSON, unknown future `schema_version`, invalid
   UUIDs, non-finite or non-positive amounts, non-integer or `< 1` installments,
   months outside `1..12`, invalid years/states/categories/config shapes.
6. A failed parse or validation never modifies local or remote data.
7. Every financial or configuration mutation increments `revision`, updates
   `updated_at` and sets `local_dirty = true`. Export and sync do not increment
   `revision`.
8. Import/download replaces data only after validation and an automatic local
   backup; a local import stays pending upload (`local_dirty = true`), a
   confirmed remote download ends synchronized (`local_dirty = false`).
9. Only `storage.js` touches `localStorage`. UI never does.
10. Other-tab changes are detected; stale tabs cannot commit or sync.
11. Manual backups are named `apk-gastos-backup-YYYY-MM-DD.json`.
12. Drive sync state (device-local) stores `local_dirty`,
    `last_synced_remote_version`, `last_synced_remote_md5`, `last_synced_at`,
    `folderId`, `fileId` and a bounded `sync_error`. Tokens live only in memory.
13. Sync decision table: no changes -> `noop`; local only -> `upload`; remote
    only -> `download`; both -> `conflict`; no remote file -> `create_remote`
    with confirmation; first contact with data on both sides -> `initial_choice`.
14. Upload re-reads remote metadata before writing; a concurrent remote change
    aborts the upload. A lost upload response is never retried blind; the next
    sync re-reads Drive and reconciles identical content.
15. Drive uses `https://www.googleapis.com/auth/drive.file`, `APK Gastos/` and
    `apk-gastos-data.json`. IDs are not assumed permanent; missing IDs, trashed
    items, duplicate candidates and unexpected `dataset_id` never auto-resolve.
16. Service worker deletes only this app's versioned caches and never caches
    Google auth/Drive traffic.
17. Manifest, header and title use one name; the icon is local and cached.

## 3. Tasks

- [x] T1. Feature branch and task document.
- [x] T2. `css/styles.css` extracted from `index.html`.
- [x] T3. `js/storage.js`: defaults, normalization, validation, migration,
      payload serialization, local persistence, revision/dirty state, sync
      state, theme, automatic backup slot, other-tab detection.
- [x] T4. `js/backup.js`: filename, export, automatic backup, file inspection,
      confirmed import, Drive serializer/parser.
- [x] T5. `js/drive-sync.js`: pure decision helpers, Drive REST client, GIS
      auth, sync service with conflict and first-contact dialogs.
- [x] T6. `js/ui.js` + `js/app.js` + `index.html`: DOM built without
      `innerHTML` for external/user data, sync panel, import preview, conflict
      and initial-choice dialogs.
- [x] T7. `sw.js`, `manifest.json`, local icons, README and docs.
- [x] T8. Automated tests with `node:test` for storage, backup and Drive mocks.
- [x] T9. Full-suite verification and static checks.

## 4. Decisions log

- 2026-11-25: Single storage key `finanzas_data_v3` stores the versioned
  payload; sync metadata lives in `apk_gastos_sync_v1` so it never travels in
  the JSON.
- 2026-11-25: `storage.js` exposes an injectable storage adapter for tests;
  the browser adapter is the default.
- 2026-11-25: The sync service is created with an injected Drive API and dialog
  layer, so decision and effect tests run without network or DOM.
- 2026-11-25: "Same content" comparison uses canonical JSON of the full payload
  to reconcile an upload whose response was lost.
- 2026-11-25: Automatic backups are stored in `apk_gastos_autobackup_v1` and
  also downloaded as a dated JSON file.

## 5. Verification

Commands:

```bash
npm test
```

Evidence collected on 2026-11-25:

- `npm test`: 59 tests passed, 0 failed. Suites: `tests/storage.test.js`,
  `tests/backup.test.js`, `tests/drive-sync.test.js`.
- Chrome headless against a local static server (no real Google credentials):
  - Old `finanzas_data_v3` migrates to `schema_version: 1`, `notas` becomes
    `notes`, records still render, totals keep the amount.
  - Adding a record through the real form increments `revision`, sets
    `local_dirty = true` and re-renders.
  - A note containing `<img onerror>` renders as literal text; no image node is
    created and no script runs.
  - Export -> mutate -> import restores the exported records; an invalid import
    is rejected and `revision` stays unchanged.
  - Corrupt `finanzas_data_v3` shows the recovery banner, preserves the raw
    value, and explicit reset writes a fresh valid payload.
  - After the service worker activates, reloading with the network disabled
    still renders the app from `apk-gastos-v4.0.0`; no other origin cache is
    deleted.
- Pending: real OAuth + Drive round-trip between two devices. No Google Client
  ID exists in `js/config.js`, so this remains the only unverified step.

## 6. Log

- 2026-11-25: Implementation completed on branch `feat/google-drive-sync`.
  Automated suites cover storage, backup, sync decisions, Drive error mapping
  and the required sync scenarios. Real OAuth/Drive verification remains
  pending: no Google Client ID is configured; every Drive test uses mocks.
- 2026-11-25: Cross-checked the app in Chrome headless (migration, form
  mutation, XSS-safe rendering, export/import recovery, corrupt-data recovery,
  offline reload). No deploy, push or PR performed.
- 2026-11-25: Fix review blockers. A stored `fileId` is now accepted only when
  its name, MIME type and parent folder still identify the expected data file;
  otherwise the app searches by name, ignores wrong-MIME candidates and never
  overwrites an unrelated file. Initial remote creation re-resolves folder and
  file after the user confirmation, aborts with `remote_appeared` if another
  device created the file, and aborts if duplicate folders appeared. Added six
  regression tests (now 59 total).
