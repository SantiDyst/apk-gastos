# Documento Maestro — APK Gastos

## 1. Propósito

APK Gastos es una aplicación personal de control de gastos diseñada para ser:

- Minimalista.
- Rápida.
- Fácil de usar desde el celular y el navegador.
- Utilizable sin conexión.
- Capaz de sincronizar datos entre dispositivos bajo control del usuario.
- Sencilla de mantener y evolucionar.

El objetivo inmediato no es convertirla en un producto comercial masivo, sino ofrecer una herramienta gratuita y confiable para un grupo reducido de usuarios.

## 2. Estado actual

La aplicación funciona como una PWA publicada mediante GitHub Pages.

El hosting se migrará a Cloudflare Pages según la decisión registrada en `notas/04-plan-de-trabajo.md`.

Tecnologías actuales:

- HTML.
- CSS.
- JavaScript.
- Bootstrap.
- `localStorage`.
- Service Worker.
- `manifest.json`.

El usuario puede instalarla desde Google Chrome y utilizarla como si fuera una aplicación móvil.

Actualmente, los datos quedan almacenados únicamente en el dispositivo donde fueron creados. No existe todavía exportación, importación ni sincronización remota.

## 3. Problema que se quiere resolver

El almacenamiento local tiene limitaciones:

- Los datos no aparecen en otros dispositivos.
- El usuario puede perder información si borra los datos del navegador o cambia de teléfono.
- No existe una copia remota recuperable.

La evolución propuesta consiste en permitir que el usuario conecte opcionalmente su cuenta de Google y guarde una copia de sus datos en su propio Google Drive, sin perder la posibilidad de trabajar offline.

La aplicación no requerirá crear una cuenta propia ni dependerá de una base de datos central administrada por el proyecto.

## 4. Decisión principal de arquitectura

Se utilizará:

- Cloudflare Pages para alojar la PWA.
- `localStorage` como almacenamiento local inicial y soporte offline.
- Google Identity Services (GIS) para la autorización OAuth en el navegador.
- Google Drive API para guardar y recuperar un archivo JSON por usuario.
- El permiso `https://www.googleapis.com/auth/drive.file`, limitado a los archivos creados o habilitados para la aplicación.

No se desarrollará un backend propio ni se utilizará Supabase. La copia remota vivirá en una carpeta visible del Google Drive de cada usuario, por ejemplo `APK Gastos/`, y no en infraestructura del propietario de la app.

La sincronización será manual mediante un botón **Sincronizar**. El usuario podrá seguir usando toda la funcionalidad local sin conectar Google Drive.

Cloudflare se eligió como hosting porque ya existe una cuenta con un proyecto pequeño funcionando en el plan gratuito.

## 5. Principios del proyecto

### 5.1 Simplicidad primero

No se agregará infraestructura que todavía no sea necesaria.

La primera sincronización utilizará una foto completa de los datos en JSON, sin fusión automática registro por registro.

### 5.2 No romper lo que ya funciona

Las versiones nuevas deberán conservar los datos locales existentes y permitir una migración gradual.

Toda importación o descarga que reemplace datos deberá validar el contenido y generar antes una copia local de seguridad.

### 5.3 Conexión opcional

El usuario podrá seguir usando la aplicación localmente. Conectar Google Drive será una opción para habilitar respaldo remoto y sincronización entre dispositivos.

Conectar no significa conservar para siempre un token de acceso: los tokens vencen y la app podrá solicitar uno nuevo durante una acción explícita del usuario.

### 5.4 Datos personales en el Drive del usuario

No se crearán tablas compartidas ni registros con `user_id`.

Cada usuario tendrá su propio archivo de datos en su Drive. La aplicación no ofrecerá una base compartida entre usuarios ni permitirá ver los datos de otras cuentas.

El alcance `drive.file` limita el acceso de la app, pero no cifra el contenido ni impide que el usuario u otras aplicaciones autorizadas accedan al archivo.

### 5.5 Offline como característica central

La aplicación debe continuar siendo útil sin conexión.

La copia local seguirá siendo la fuente de trabajo. Drive funcionará como respaldo remoto y mecanismo de sincronización cuando el usuario lo solicite.

### 5.6 Evolución por etapas

Cada etapa deberá quedar estable antes de comenzar la siguiente.

Primero se implementará respaldo local y preparación del JSON; después, integración con Drive y sincronización manual. La sincronización automática queda fuera del alcance inicial.

## 6. Funciones principales

- Registrar ingresos.
- Registrar gastos fijos.
- Registrar compras con tarjeta y cuotas.
- Marcar estados de pago.
- Copiar gastos de meses anteriores.
- Consultar información por mes y año.
- Instalar la aplicación como PWA.
- Trabajar offline.
- Exportar e importar respaldos JSON.
- Conectar y desconectar Google Drive.
- Sincronizar manualmente entre dispositivos.
- Elegir cómo resolver un conflicto sin pisar datos automáticamente.
- Importar datos posteriormente mediante una plantilla controlada.

## 7. Excel y archivos

Los datos locales serán la fuente principal de información y el archivo de Drive conservará el mismo formato JSON versionado que los respaldos manuales.

Excel o CSV se utilizarán como formatos complementarios para:

- Exportar datos.
- Crear copias personales.
- Analizar información.
- Importar datos mediante una plantilla definida por la aplicación.

La primera versión de importación tabular no intentará interpretar cualquier archivo creado por el usuario. Se entregará una plantilla con columnas conocidas.

## 8. Cuándo considerar un backend propio

No se necesita un servidor propio para:

- Solicitar autorización OAuth desde el navegador.
- Guardar y consultar el archivo JSON en Google Drive.
- Exportar CSV o Excel desde el navegador.
- Importar una plantilla desde el navegador.
- Sincronizar manualmente una foto completa de los datos.

Podría ser necesario un backend propio cuando aparezcan requisitos como:

- Envío automático de correos.
- Procesamiento programado.
- Integraciones privadas con servicios externos.
- Pagos.
- Generación automática de informes pesados.
- Reglas de negocio que no deban ejecutarse en el navegador.
- Tareas recurrentes.
- Uso de claves secretas que no puedan exponerse en el frontend.

Un cambio hacia sincronización automática, colaboración simultánea o fusión de cambios por registro requeriría revisar la arquitectura antes de implementarlo.

## 9. Escala inicial

El proyecto está pensado inicialmente para aproximadamente 5 a 20 usuarios, principalmente en uso personal.

Google Drive evita administrar capacidad, aislamiento por usuario, pausas de base de datos y backups de una infraestructura compartida. Cada usuario conserva el control de su copia remota.

El foco no debe estar en optimizar para millones de usuarios, sino en:

- Evitar pérdida de datos.
- Detectar cambios locales y remotos antes de escribir.
- Resolver conflictos de forma comprensible.
- Mantener una experiencia rápida.
- Facilitar el mantenimiento del código.

## 10. Regla para nuevas funciones

Antes de agregar una función, se deberán responder estas preguntas:

1. ¿Resuelve un problema real del usuario?
2. ¿Mantiene la aplicación simple?
3. ¿Puede implementarse sin romper los datos existentes?
4. ¿Debe hacerse ahora o puede esperar?
5. ¿Aumenta significativamente el mantenimiento?

Si una función agrega más complejidad que valor, se postergará.
