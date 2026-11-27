# Guía de Prueba Real — OAuth y Google Drive

La prueba real se realiza desde el navegador. **No hay que empaquetar la aplicación ni generar una APK.** La PWA instalada utiliza la misma aplicación web y el mismo flujo OAuth.

Orden recomendado:

1. Chrome de escritorio en `localhost`.
2. Dos perfiles de Chrome conectados a la misma cuenta de Drive.
3. Chrome móvil mediante el dominio HTTPS de Cloudflare Pages.
4. PWA instalada, como verificación final.

> **Advertencia:** mientras queden pendientes los bypasses de identidad del archivo señalados en la revisión de `a7cc296`, usar solamente una cuenta y datos descartables. No probar con información financiera real ni con el único respaldo disponible.

## 1. Preparar Google Cloud

### 1.1 Crear el proyecto y habilitar Drive

1. Entrar a [Google Cloud Console](https://console.cloud.google.com/).
2. Crear o seleccionar un proyecto.
3. Abrir **APIs y servicios → Biblioteca**.
4. Buscar **Google Drive API**.
5. Presionar **Habilitar**.

### 1.2 Configurar el consentimiento OAuth

1. Abrir **Pantalla de consentimiento OAuth**. En algunas consolas aparece como **Google Auth Platform → Público**.
2. Elegir **Externo**.
3. Completar nombre de la aplicación y correo de soporte.
4. Declarar el alcance:
   ```text
   https://www.googleapis.com/auth/drive.file
   ```
5. Mientras la aplicación esté en modo **Pruebas**, agregar el correo de la cuenta Google utilizada en **Usuarios de prueba**.

Una cuenta no registrada como usuario de prueba puede ser rechazada. El aviso de “aplicación no verificada” puede aparecer durante esta etapa; la publicación pública se revisa por separado.

### 1.3 Crear el Client ID web

1. Abrir **Credenciales → Crear credenciales → ID de cliente de OAuth**.
2. Seleccionar **Aplicación web**. Aunque luego se instale la PWA, no elegir Android ni aplicación de escritorio.
3. En **Orígenes JavaScript autorizados**, agregar exactamente:
   ```text
   http://localhost:8080
   ```
   Sin barra final ni rutas adicionales.
4. No hace falta configurar una URI de redirección para el modelo de tokens de GIS utilizado por la app.
5. Copiar el Client ID, que normalmente termina en `.apps.googleusercontent.com`.

El Client ID es público por diseño. El Client Secret no se utiliza ni se incorpora al frontend.

## 2. Configurar y ejecutar la app local

Editar localmente `js/config.js`:

```js
export const GOOGLE_CLIENT_ID = 'TU_CLIENT_ID.apps.googleusercontent.com';
```

Desde la raíz del repositorio, iniciar un servidor estático:

```bash
python -m http.server 8080
```

Abrir en Chrome:

```text
http://localhost:8080
```

No utilizar `file://`: los módulos ES y el Service Worker necesitan HTTP.

La funcionalidad local debe seguir operativa si Google no está disponible. La autorización no debe aparecer automáticamente al abrir la página.

## 3. Primera conexión y creación remota

Utilizar datos descartables:

1. Cargar un gasto de prueba.
2. Exportar un respaldo JSON y conservarlo fuera del flujo de prueba.
3. Pulsar **Conectar Google Drive**.
4. Elegir la cuenta registrada como usuario de prueba.
5. Autorizar el acceso con `drive.file`.
6. Pulsar **Sincronizar**.
7. Confirmar la creación del archivo remoto.
8. Abrir [Google Drive](https://drive.google.com/) y comprobar:
   ```text
   APK Gastos/
   └── apk-gastos-data.json
   ```

Resultado esperado:

- **Conectar Google Drive** autoriza y localiza, pero no sube ni descarga datos por sí mismo.
- La creación remota ocurre durante **Sincronizar**, después de confirmación.
- El archivo contiene el contrato JSON vigente y el `dataset_id` esperado.
- No se crean carpetas ni archivos duplicados en el flujo normal.

En **Chrome DevTools → Application → Local Storage**, comprobar que existan los datos y `apk_gastos_sync_v1`, pero ningún token de Google.

## 4. Prueba entre dos perfiles de Chrome

Dos perfiles de Chrome tienen almacenamiento local independiente y pueden conectarse a la misma cuenta de Drive. Esto permite simular PC y celular sin empaquetar ni usar dos dispositivos físicos.

### 4.1 Subida y descarga

1. En el perfil A, cargar y sincronizar un gasto de prueba.
2. En el perfil B, conectar la misma cuenta y sincronizar.
3. Verificar que B descargue el gasto de A.
4. Agregar otro gasto en B y sincronizar.
5. Volver a A y sincronizar; debería descargar el gasto de B.

En cada descarga que reemplace información, verificar que se genere el backup local correspondiente y que la interfaz quede actualizada.

### 4.2 Conflicto en ambos lados

1. Partir de ambos perfiles sincronizados.
2. Hacer un cambio local en A y otro en B, sin sincronizar todavía.
3. Sincronizar A: debería subir su foto local.
4. Sincronizar B: debería detectar cambios locales y remotos y mostrar el diálogo de conflicto.
5. Elegir **Cancelar**: no debe modificarse ningún lado.
6. Repetir la operación y probar **Descargar Drive**:
   - se valida el JSON;
   - se genera backup local;
   - se reemplaza el estado de B;
   - `local_dirty` queda limpio.
7. Repetir el escenario y probar **Subir este dispositivo** solamente después de confirmar que esa es la versión que se desea conservar.

Ninguna versión debe ganar automáticamente por fecha, revisión o nombre del dispositivo.

## 5. Renovación y revocación de acceso

### Nueva sesión

1. Recargar completamente la app o cerrar y volver a abrir Chrome.
2. Pulsar **Sincronizar**.
3. Verificar que la app solicite un token nuevo si el anterior ya no está en memoria.
4. Confirmar que no haya tokens persistidos después de recargar.

No hace falta esperar una hora para comprobar que el token no se persistió.

### Permiso revocado

1. Abrir [Permisos de la cuenta Google](https://myaccount.google.com/permissions).
2. Revocar el acceso de la app desde la cuenta de prueba.
3. Volver a la app y pulsar **Sincronizar**.
4. Verificar un error o pedido de autorización comprensible, sin pérdida ni reinicio de datos locales.
5. **Desconectar** dentro de la app no debe borrar datos locales ni el archivo de Drive.

## 6. Prueba en celular y PWA

Para probar cómodamente en celular, utilizar el dominio HTTPS de Cloudflare Pages. No hace falta empaquetar.

1. Publicar manualmente el sitio estático cuando corresponda; esta guía no autoriza deploy automático.
2. Agregar el origen exacto en Google Cloud, por ejemplo:
   ```text
   https://apk-gastos.pages.dev
   ```
3. Si se utiliza un dominio personalizado o previews, registrar cada origen que realmente vaya a ejecutar OAuth.
4. Abrir ese dominio desde Chrome móvil.
5. Repetir conexión, subida, descarga y conflicto con datos descartables.
6. Finalmente, usar **Agregar a pantalla principal** y repetir una sincronización desde la PWA instalada.

El origen debe coincidir exactamente: protocolo, dominio y puerto cuando corresponda.

## 7. Checklist de resultado

- [ ] No aparece OAuth al abrir la app.
- [ ] Conectar funciona desde un clic directo.
- [ ] El permiso solicitado es solamente `drive.file`.
- [ ] No se persiste ningún token.
- [ ] Se crea una única carpeta/archivo en el flujo normal.
- [ ] La primera sincronización no pisa datos sin confirmación.
- [ ] A sube y B descarga; B sube y A descarga.
- [ ] Un conflicto permite Descargar, Subir o Cancelar.
- [ ] Cancelar no modifica datos ni contadores.
- [ ] Toda descarga que reemplaza datos genera backup previo.
- [ ] Una revocación muestra error sin borrar datos locales.
- [ ] Desconectar conserva datos locales y remotos.
- [ ] La app local sigue funcionando sin conexión.
- [ ] Chrome móvil y la PWA instalada funcionan desde el mismo origen HTTPS.

## 8. Registro de la prueba

Anotar al ejecutarla:

- Fecha.
- Commit probado.
- Origen utilizado.
- Chrome de escritorio/móvil/PWA y versión.
- Cuenta de prueba, sin incluir tokens ni credenciales en el repo.
- Resultado de cada caso.
- Archivos o datos creados, todos descartables.
- Errores observados y pasos para reproducirlos.

Las pruebas automatizadas y los mocks no sustituyen este recorrido. La integración real puede considerarse verificada únicamente después de completar estos casos con el Client ID y una cuenta autorizada.

### 8.1 Resultado registrado (2026-11-27)

Alcance cubierto: **Chrome de escritorio en `localhost`, una sola cuenta**.

- Commit probado: `c34c295` sobre la rama `feat/google-drive-sync`.
- Origen: `http://localhost:8080` servido con `python -m http.server 8080`.
- Proyecto de Google Cloud: `app-gastos-515923`, credencial de tipo **Aplicación web**.
- Cuenta: la cuenta personal del autor, agregada previamente en **Usuarios de prueba**.

Casos observados:

- ✅ Conectar desde un clic directo abre el consentimiento y devuelve un token válido.
- ✅ Se crea una única carpeta `APK Gastos/` con el archivo `apk-gastos-data.json` en el Drive de la cuenta.
- ✅ La app no abre OAuth al cargar: el flujo arranca solo al pulsar el botón.

Casos todavía sin ejecutar en un entorno real (siguen pendientes y cubiertos solo
por pruebas con mocks):

- A sube y B descarga; B sube y A descarga.
- Resolución de conflicto, backup previo a una descarga y cancelación sin cambios.
- Revocación de permiso y desconexión.
- Chrome móvil y PWA instalada desde el origen HTTPS de Cloudflare Pages.

Observación útil: la primera autorización falló con `403 access_denied` porque la
cuenta no figuraba en **Usuarios de prueba**. Ese error lo emite Google antes de
que la app intervenga, así que no es un fallo del código. Agregar el correo en la
consola y reintentar lo resuelve.

Mientras las tres últimas líneas de pendientes no se ejecuten, la sincronización
entre dispositivos queda implementada y probada con mocks, pero no verificada de
punta a punta en un entorno real.
