# Roadmap de Evolución

## Fase 0 — Respaldo y estabilidad

Objetivo: asegurar que el estado actual pueda recuperarse.

Tareas:

- Crear una versión estable identificada.
- Guardar una copia del proyecto actual.
- Verificar exportación de datos.
- Documentar la estructura actual de los registros.
- Probar instalación y funcionamiento offline.

Resultado esperado:

La versión actual queda protegida antes de comenzar cambios importantes.

## Fase 1 — Refactor mínimo

Objetivo: preparar el código para cambiar el almacenamiento sin rehacer la interfaz.

Tareas:

- Separar estilos del HTML.
- Separar JavaScript del HTML.
- Crear una capa de almacenamiento.
- Evitar llamadas dispersas a `localStorage`.
- Mantener exactamente el comportamiento actual.

Resultado esperado:

La aplicación sigue funcionando igual, pero el código queda preparado para Supabase.

## Fase 2 — Modelo de datos

Objetivo: definir cómo se representarán gastos, ingresos y cuotas.

Tareas:

- Definir entidades.
- Agregar UUID a cada registro.
- Agregar fechas de creación y modificación.
- Definir estados de sincronización.
- Preparar una migración de datos locales.

Resultado esperado:

Los datos locales ya tienen una estructura compatible con la nube.

## Fase 3 — Supabase

Objetivo: crear la infraestructura remota.

Tareas:

- Crear proyecto en Supabase.
- Crear tablas.
- Configurar claves públicas.
- Habilitar Row Level Security.
- Crear políticas por `user_id`.
- Probar consultas desde un entorno de desarrollo.

Resultado esperado:

Supabase puede almacenar datos de varios usuarios de forma aislada y segura.

## Fase 4 — Autenticación opcional

Objetivo: permitir cuentas sin obligar a los usuarios actuales.

Tareas:

- Crear pantalla o modal de registro.
- Crear inicio de sesión.
- Crear cierre de sesión.
- Mostrar estado de cuenta.
- Mantener modo local sin cuenta.

Resultado esperado:

Un usuario puede seguir usando la app localmente o iniciar sesión para activar sincronización.

## Fase 5 — Migración inicial

Objetivo: subir los datos locales existentes.

Flujo sugerido:

1. Detectar datos locales.
2. Informar cuántos registros se encontraron.
3. Ofrecer guardar una copia de seguridad.
4. Solicitar confirmación.
5. Subir registros a Supabase.
6. Verificar la cantidad sincronizada.
7. Conservar copia local.

Resultado esperado:

El usuario no pierde sus registros al crear una cuenta.

## Fase 6 — Sincronización manual

Objetivo: implementar primero una sincronización fácil de entender.

Tareas:

- Agregar botón “Sincronizar”.
- Mostrar estado pendiente, sincronizando o actualizado.
- Subir cambios locales.
- Descargar cambios remotos.
- Registrar errores sin borrar datos.

Resultado esperado:

El usuario controla cuándo sincroniza y puede comprender el estado del proceso.

## Fase 7 — Sincronización automática moderada

Objetivo: mejorar comodidad sin generar complejidad innecesaria.

Posibles momentos de sincronización:

- Al iniciar sesión.
- Al abrir la aplicación.
- Al recuperar conexión.
- Al presionar el botón manual.
- Después de un cambio, con demora controlada.

Resultado esperado:

La app se mantiene actualizada sin depender exclusivamente de la acción manual.

## Fase 8 — Exportación

Objetivo: permitir al usuario conservar y analizar sus datos.

Formatos iniciales:

- CSV.
- JSON de respaldo.

Formato posterior:

- XLSX.

La exportación se realizará desde el navegador.

## Fase 9 — Importación con plantilla

Objetivo: importar datos sin intentar interpretar cualquier Excel.

Tareas:

- Crear plantilla oficial.
- Validar nombres de columnas.
- Mostrar vista previa.
- Informar filas inválidas.
- Evitar duplicados.
- Solicitar confirmación antes de guardar.

Resultado esperado:

El usuario puede migrar información desde una estructura conocida y controlada.

## Fase 10 — Mejoras futuras

Posibles funciones:

- Plantillas permanentes de gastos fijos.
- Notificaciones.
- Informes mensuales.
- Categorías personalizadas.
- Presupuestos.
- Gráficos adicionales.
- Sincronización de preferencias.
- Compartir información entre integrantes de un hogar.

Estas funciones no forman parte del alcance inicial.
