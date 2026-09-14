# Arquitectura Propuesta

## 1. Vista general

La arquitectura inicial estará compuesta por tres partes:

1. PWA alojada en GitHub Pages.
2. Almacenamiento local para trabajo offline.
3. Supabase para autenticación y persistencia remota.

```text
Usuario
   |
   v
PWA en GitHub Pages
   |
   +---- Almacenamiento local
   |
   +---- Supabase Auth
   |
   +---- Supabase Database
```

No será necesario mantener una computadora personal encendida ni ejecutar procesos en segundo plano.

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
    ├── ui.js
    ├── auth.js
    ├── sync.js
    └── supabase-client.js
```

No es obligatorio realizar toda la separación de una vez.

La prioridad es aislar el acceso a datos.

## 3. Capa de almacenamiento

La interfaz debería dejar de llamar a `localStorage` directamente desde muchas funciones.

Se recomienda crear funciones únicas, por ejemplo:

```js
getExpenses()
saveExpense(expense)
updateExpense(expense)
deleteExpense(id)
```

Al comienzo, estas funciones podrán utilizar almacenamiento local.

Más adelante, podrán guardar localmente y sincronizar con Supabase sin modificar toda la interfaz.

## 4. Autenticación

Supabase Auth se encargará de:

- Crear cuentas.
- Iniciar sesión.
- Cerrar sesión.
- Recuperar contraseñas.
- Mantener la sesión.
- Identificar al usuario actual.

La aplicación no deberá guardar contraseñas.

## 5. Base de datos compartida

Todos los usuarios utilizarán las mismas tablas.

Cada fila incluirá un identificador de usuario:

```text
user_id
```

Supabase deberá tener Row Level Security habilitado.

Ejemplo conceptual:

```text
El usuario solo puede leer filas donde user_id sea igual a su usuario autenticado.
```

Nunca se deberá confiar únicamente en filtros hechos desde JavaScript.

## 6. Modo offline

La aplicación conservará una copia local de los datos.

El flujo sugerido será:

1. El usuario crea o modifica un registro.
2. El cambio se guarda localmente inmediatamente.
3. El registro queda marcado como pendiente de sincronización.
4. Cuando existe conexión, se envía a Supabase.
5. Al confirmarse el guardado remoto, se marca como sincronizado.

Esto permite que la aplicación siga siendo rápida aunque la conexión sea lenta o inexistente.

## 7. Identificadores

Cada registro debería utilizar un identificador único generado en el dispositivo.

Se recomienda utilizar UUID.

Esto evita depender de la base de datos para crear el identificador y facilita el trabajo offline.

## 8. Fechas importantes

Cada registro debería incluir como mínimo:

- `created_at`.
- `updated_at`.
- `deleted_at`, opcional.
- `last_synced_at`, solo en almacenamiento local.
- `sync_status`, solo en almacenamiento local.

## 9. Eliminación

Para facilitar la sincronización, puede ser útil implementar borrado lógico.

En vez de eliminar inmediatamente un registro local, se puede marcar con:

```text
deleted_at
```

Después de sincronizar la eliminación, el registro puede limpiarse del dispositivo.

## 10. Service Worker

El Service Worker seguirá siendo responsable del funcionamiento offline de los archivos de la aplicación.

No debería utilizarse como única capa para almacenar los datos financieros.

Los datos estarán en almacenamiento local estructurado y en Supabase.

## 11. GitHub Pages

GitHub Pages seguirá alojando los archivos estáticos.

Las claves públicas necesarias para conectarse a Supabase pueden estar en el frontend.

Nunca deberán exponerse:

- Claves de servicio.
- Credenciales administrativas.
- Secretos privados.
