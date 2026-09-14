# Documento Maestro — APK Gastos

## 1. Propósito

APK Gastos es una aplicación personal de control de gastos diseñada para ser:

- Minimalista.
- Rápida.
- Fácil de usar desde el celular y el navegador.
- Utilizable sin conexión.
- Capaz de sincronizar datos entre dispositivos.
- Sencilla de mantener y evolucionar.

El objetivo inmediato no es convertirla en un producto comercial masivo, sino ofrecer una herramienta gratuita y confiable para un grupo reducido de usuarios.

## 2. Estado actual

La aplicación funciona como una PWA publicada mediante GitHub Pages.

Tecnologías actuales:

- HTML.
- CSS.
- JavaScript.
- Bootstrap.
- `localStorage`.
- Service Worker.
- `manifest.json`.

El usuario puede instalarla desde Google Chrome y utilizarla como si fuera una aplicación móvil.

Actualmente, los datos quedan almacenados únicamente en el dispositivo donde fueron creados.

## 3. Problema que se quiere resolver

El almacenamiento local tiene limitaciones:

- Los datos no aparecen automáticamente en otros dispositivos.
- El usuario puede perder información si borra los datos del navegador o cambia de teléfono.
- No existe autenticación.
- No existe una copia centralizada de los datos.

La evolución propuesta consiste en permitir que el usuario cree una cuenta, inicie sesión y sincronice sus datos con la nube sin perder la posibilidad de trabajar offline.

## 4. Decisión principal de arquitectura

Se utilizará:

- GitHub Pages para alojar la PWA.
- Supabase Auth para el registro e inicio de sesión.
- Supabase Database para guardar los datos.
- `localStorage` o IndexedDB como almacenamiento local y soporte offline.

Por ahora no se desarrollará un backend propio.

La aplicación JavaScript podrá comunicarse directamente con Supabase mediante su API y su cliente oficial.

## 5. Principios del proyecto

### 5.1 Simplicidad primero

No se agregará infraestructura que todavía no sea necesaria.

### 5.2 No romper lo que ya funciona

Las versiones nuevas deberán conservar los datos locales existentes y permitir una migración gradual.

### 5.3 Autenticación opcional al comienzo

El usuario podrá seguir usando la aplicación localmente. Crear una cuenta será una opción para habilitar respaldo y sincronización.

### 5.4 Una sola base de datos

No se creará una base de datos ni una tabla por usuario.

Los datos de todos los usuarios estarán en tablas compartidas y cada registro incluirá un `user_id`.

Las políticas de seguridad de Supabase deberán garantizar que cada usuario solo pueda acceder a sus propios datos.

### 5.5 Offline como característica central

La aplicación debe continuar siendo útil sin conexión.

La nube no reemplazará inmediatamente el almacenamiento local: funcionará como respaldo y mecanismo de sincronización.

### 5.6 Evolución por etapas

Cada etapa deberá quedar estable antes de comenzar la siguiente.

## 6. Funciones principales

- Registrar ingresos.
- Registrar gastos fijos.
- Registrar compras con tarjeta y cuotas.
- Marcar estados de pago.
- Copiar gastos de meses anteriores.
- Consultar información por mes y año.
- Instalar la aplicación como PWA.
- Trabajar offline.
- Crear una cuenta e iniciar sesión.
- Sincronizar datos entre dispositivos.
- Exportar datos.
- Importar datos mediante una plantilla controlada.

## 7. Excel y archivos

La base de datos será la fuente principal de información.

Excel o CSV se utilizarán como formatos complementarios para:

- Exportar datos.
- Crear copias personales.
- Analizar información.
- Importar datos mediante una plantilla definida por la aplicación.

La primera versión de importación no intentará interpretar cualquier archivo creado por el usuario.

Se entregará una plantilla con columnas conocidas. Una importación flexible con mapeo de columnas podrá evaluarse en el futuro.

## 8. Cuándo considerar un backend propio

No se necesita un servidor propio para:

- Autenticación con Supabase.
- Guardar y consultar gastos.
- Sincronizar datos.
- Exportar CSV o Excel desde el navegador.
- Importar una plantilla desde el navegador.

Podría ser necesario un backend propio cuando aparezcan necesidades como:

- Envío automático de correos.
- Procesamiento programado.
- Integraciones privadas con servicios externos.
- Pagos.
- Generación automática de informes pesados.
- Reglas de negocio que no deban ejecutarse en el navegador.
- Tareas recurrentes.
- Uso de claves secretas que no puedan exponerse en el frontend.

## 9. Escala inicial

El proyecto está pensado inicialmente para aproximadamente 5 a 20 usuarios.

Para esa escala, Supabase ofrece capacidad más que suficiente para manejar registros de gastos y sincronizaciones normales.

El foco no debe estar en optimizar para millones de usuarios, sino en:

- Evitar pérdida de datos.
- Mantener una experiencia rápida.
- Implementar una sincronización confiable.
- Facilitar el mantenimiento del código.

## 10. Regla para nuevas funciones

Antes de agregar una función, se deberán responder estas preguntas:

1. ¿Resuelve un problema real del usuario?
2. ¿Mantiene la aplicación simple?
3. ¿Puede implementarse sin romper los datos existentes?
4. ¿Debe hacerse ahora o puede esperar?
5. ¿Aumenta significativamente el mantenimiento?

Si una función agrega más complejidad que valor, se postergará.
