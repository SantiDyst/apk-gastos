# Modelo de Datos y Sincronización

## 1. Criterio general

El modelo debe representar la aplicación actual sin complicarla innecesariamente.

La primera versión puede utilizar pocas tablas.

## 2. Tabla `profiles`

Datos complementarios del usuario.

Campos sugeridos:

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | UUID | Igual al identificador de Supabase Auth |
| `display_name` | Texto | Nombre visible opcional |
| `created_at` | Fecha y hora | Fecha de creación |
| `updated_at` | Fecha y hora | Última modificación |

No se guardan contraseñas en esta tabla.

## 3. Tabla `transactions`

Puede utilizarse una única tabla para ingresos y gastos.

Campos sugeridos:

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | UUID | Identificador único |
| `user_id` | UUID | Propietario |
| `type` | Texto | `income`, `fixed_expense` o similar |
| `description` | Texto | Concepto |
| `amount` | Decimal | Monto |
| `category` | Texto | Categoría |
| `notes` | Texto | Notas opcionales |
| `year` | Entero | Año |
| `month` | Entero | Mes |
| `status` | Texto | Pagado, pendiente u otro |
| `source_template_id` | UUID | Plantilla de origen, opcional |
| `created_at` | Fecha y hora | Creación |
| `updated_at` | Fecha y hora | Modificación |
| `deleted_at` | Fecha y hora | Borrado lógico opcional |

## 4. Tabla `installment_purchases`

Representa una compra con tarjeta.

Campos sugeridos:

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | UUID | Identificador |
| `user_id` | UUID | Propietario |
| `description` | Texto | Compra |
| `total_amount` | Decimal | Total |
| `installment_count` | Entero | Número de cuotas |
| `first_year` | Entero | Año inicial |
| `first_month` | Entero | Mes inicial |
| `category` | Texto | Categoría opcional |
| `created_at` | Fecha y hora | Creación |
| `updated_at` | Fecha y hora | Modificación |
| `deleted_at` | Fecha y hora | Borrado lógico |

La cuota mensual puede calcularse o almacenarse.

Para evitar diferencias por redondeo, conviene definir una regla clara para la última cuota.

## 5. Tabla `fixed_expense_templates`

Representa gastos que el usuario suele repetir.

Campos sugeridos:

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | UUID | Identificador |
| `user_id` | UUID | Propietario |
| `description` | Texto | Concepto |
| `default_amount` | Decimal | Monto sugerido |
| `category` | Texto | Categoría |
| `active` | Booleano | Si continúa vigente |
| `created_at` | Fecha y hora | Creación |
| `updated_at` | Fecha y hora | Modificación |

Esta tabla puede incorporarse después de estabilizar la sincronización.

## 6. Una tabla por usuario: descartado

No se crearán tablas como:

```text
gastos_usuario_1
gastos_usuario_2
gastos_usuario_3
```

Ese enfoque dificulta:

- Consultas.
- Mantenimiento.
- Actualizaciones.
- Seguridad.
- Migraciones.
- Escalabilidad.

Se utilizarán tablas compartidas con `user_id`.

## 7. Políticas de seguridad

Cada tabla con información del usuario deberá cumplir conceptualmente:

```text
SELECT: user_id = auth.uid()
INSERT: user_id = auth.uid()
UPDATE: user_id = auth.uid()
DELETE: user_id = auth.uid()
```

También se deberá evitar que el cliente inserte datos usando el identificador de otro usuario.

## 8. Estado local de sincronización

Cada objeto almacenado localmente puede incluir:

| Campo | Ejemplo |
|---|---|
| `sync_status` | `pending`, `synced`, `error` |
| `last_synced_at` | Fecha y hora |
| `local_updated_at` | Fecha y hora |
| `sync_error` | Mensaje opcional |

Estos campos no necesariamente deben guardarse en Supabase.

## 9. Flujo de sincronización inicial

### Subida

1. Buscar registros locales pendientes.
2. Verificar que exista sesión.
3. Enviar registros.
4. Confirmar respuesta.
5. Marcar como sincronizados.

### Descarga

1. Consultar registros modificados desde la última sincronización.
2. Comparar identificadores y fechas.
3. Insertar o actualizar la copia local.
4. Registrar la nueva fecha de sincronización.

## 10. Conflictos

Un conflicto ocurre cuando el mismo registro se modifica en dos dispositivos antes de sincronizar.

Primera política recomendada:

```text
La modificación más reciente gana.
```

Esta regla es sencilla, aunque no perfecta.

Más adelante se puede ofrecer una pantalla de resolución de conflictos si realmente aparece el problema.

## 11. Duplicados

Para reducir duplicados:

- Utilizar UUID generados en el dispositivo.
- Reutilizar el mismo UUID al sincronizar.
- No crear un registro remoto nuevo cada vez que se reintenta.
- Usar operaciones `upsert` cuando corresponda.

## 12. Migración desde `localStorage`

La migración deberá:

- Leer el formato actual.
- Transformar cada registro al nuevo modelo.
- Agregar UUID cuando falte.
- Agregar fechas.
- Validar montos y meses.
- Mantener una copia de respaldo.
- Subir solo después de la confirmación del usuario.

## 13. Recomendación sobre IndexedDB

`localStorage` puede seguir utilizándose inicialmente.

Sin embargo, IndexedDB será una mejor opción cuando aumenten:

- La cantidad de registros.
- Los estados de sincronización.
- Las consultas locales.
- Las operaciones offline.
- Las importaciones.

La migración a IndexedDB no tiene que realizarse antes de comenzar con Supabase, pero debería considerarse antes de implementar una sincronización compleja.
