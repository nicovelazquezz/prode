# 06 — Panel de Administración

El panel admin es accesible solo para usuarios con `role = ADMIN`. Vive en una sección separada (`/admin`) con su propio layout.

## Acceso

- Login con DNI + contraseña (mismos campos que el público)
- Sistema detecta el rol y redirige a `/admin/dashboard` automáticamente
- Layout diferente: sidebar con navegación, header con datos del admin
- Logout cierra sesión y vuelve al login público

## Secciones

### 1. Dashboard

Pantalla principal con métricas en tiempo real. Cards con:

- **Recaudación total**
  - Bruto, fees, neto
  - Desglose: MercadoPago vs Manual
  - Gráfico de evolución diaria
- **Usuarios**
  - Total registrados
  - Pagados (% del total)
  - Pendientes de pago (con link a la tabla)
  - Inactivos
- **Predicciones**
  - Total cargadas
  - Promedio por usuario pagado
  - Usuarios sin cargar predicciones especiales (alerta si se acerca el cierre)
- **Próximos eventos**
  - Próximo partido (countdown)
  - Próximo cierre de fase
- **Notificaciones**
  - Pendientes de envío
  - Fallidas en últimas 24hs

### 2. Usuarios

Tabla con búsqueda y filtros. Columnas:
- DNI
- Nombre completo
- WhatsApp
- Estado (activo / inactivo / banned)
- Pagado (sí/no)
- Método de pago
- Fecha de pago
- Total predicciones cargadas
- Puntos actuales
- Acciones

Filtros rápidos:
- Solo pagados
- Solo pendientes
- Sin predicciones cargadas
- Inactivos > 7 días

#### Acciones individuales

Click en un usuario abre drawer/modal con:
- Datos completos
- Historial de pagos
- Lista de todas sus predicciones (con buscador por partido)
- Botones:
  - **Marcar como pagado** (selecciona método y monto, opcional nota)
  - **Reset password** (genera link de reset y lo envía por WhatsApp)
  - **Enviar mensaje WhatsApp** (campo libre)
  - **Desactivar usuario** (con confirmación)
  - **Banear** (con motivo, queda en log)

#### Acciones en bulk

Checkboxes para seleccionar múltiples usuarios:
- Enviar mensaje masivo
- Exportar a CSV
- Marcar como pagados (con mismo método)

### 3. Pagos

Tabla con todos los pagos:
- Usuario
- Monto
- Método
- Estado
- Fecha
- ID de MP (si aplica)
- Acciones

Filtros:
- Por estado
- Por método
- Por rango de fechas

Acciones:
- Ver detalles (incluye `mp_raw_data` para debug)
- Marcar manualmente como aprobado (último recurso)
- Reembolsar (solo informativo, el reembolso real se hace desde MP)

Exportación: CSV/Excel para contabilidad del club.

### 4. Partidos

Vista de los 104 partidos del Mundial.

Tabs por fase para navegación rápida.

Tabla:
- Número FIFA
- Fecha y hora
- Equipos (banderas + nombres, o placeholders si aún no se conocen)
- Sede
- Estado
- Resultado
- Acciones

#### Acciones

**Editar partido** (drawer):
- Cambiar fecha/hora
- Cambiar sede
- Asignar equipos (si era placeholder, ej: "Ganador Grupo C" → "Argentina")
- Recalcula automáticamente `predictionsLockAt`

**Cargar resultado**:
- Modal con inputs `scoreHome` y `scoreAway`
- Botón "Confirmar y calcular puntos"
- Sistema:
  1. Marca partido como `FINISHED`
  2. Calcula puntos para todas las predicciones de ese partido
  3. Actualiza `phase_winners` si cierra una fase
  4. Invalida cache de leaderboard
  5. Genera notificaciones a usuarios afectados

**Re-calcular puntos** (en caso de error):
- Permite cambiar el resultado
- Borra cálculos anteriores y vuelve a hacerlos
- Queda en `audit_logs`

**Marcar como en juego / pospuesto / cancelado**: cambios de estado puntuales.

### 5. Fases y premios

Vista por fase con:
- Cantidad de partidos finalizados / totales
- Estado: en curso / finalizada
- Tabla de top 10 por puntos en esa fase
- Botón "Cerrar fase":
  - Aparece cuando todos los partidos de la fase están `FINISHED`
  - Determina el ganador (mayor puntaje en la fase)
  - Persiste en `phase_winners`
  - Permite asignar el monto del premio
  - Dispara notificación al ganador

#### Premios

Vista resumen con:
- Pozo total
- Distribución actual (configurable desde `app_config`)
- Lista de premios:
  - Top 1, 2, 3 generales (calculados al final)
  - Ganadores de cada fase (a medida que se cierran)
  - Estado: pending / paid
  - Botón "Marcar como entregado"

### 6. Notificaciones

#### Centro de mensajería

Tabs:
- **Mensajes individuales**: enviar a un usuario específico
- **Broadcast**: enviar a todos / a un segmento
- **Plantillas**: mensajes predefinidos (recordatorio de pago, bienvenida, etc.)
- **Historial**: todos los mensajes enviados con estado (entregado, fallido, leído si se puede)

#### Plantillas sugeridas

- **Recordatorio de pago** (para `isPaid = false` con > 3 días registrado)
- **Cierre próximo del Mundial** (para `specialPrediction` no completada)
- **Bienvenida**: post-pago confirmado
- **Cambio en posición**: subió/bajó significativamente

### 7. Configuración

Editor de `app_config` con UI amigable:
- Precio de inscripción
- Fecha de cierre de inscripciones
- Distribución del pozo (slider o inputs numéricos)
- Activar/desactivar notificaciones
- Configurar mensajes WhatsApp

Cambios quedan auditados.

### 8. Auditoría

Vista del `audit_logs`:
- Todos los eventos críticos del sistema
- Filtro por entidad, acción, usuario, rango de fechas
- Útil para resolver disputas: "¿Quién cambió el resultado del partido X?"
- Útil para troubleshooting: "¿Por qué Juan no aparece como pagado?"

### 9. Reportes

Generadores de reportes exportables:
- **Tabla de posiciones final** (PDF imprimible para mostrar en el club)
- **Listado de pagos para contabilidad** (Excel)
- **Predicciones de un usuario** (PDF, útil ante disputas)
- **Resumen del torneo** (PDF con stats: total recaudado, mejor pronosticador, predicción más rara que acertó, etc.)

Estos reportes pueden generarse con HTML imprimible (siguiendo tu enfoque preferido de Puppeteer / HTML-to-PDF en vez de PDFKit).

## Permisos granulares (futuro)

En MVP basta con el flag `role = ADMIN`. Si en el futuro se quiere granularidad:
- `admin.users.read`, `admin.users.write`
- `admin.matches.write`
- `admin.payments.confirm`
- `admin.config.write`

Permisos por usuario admin, configurables.

## Buenas prácticas operativas

### Quién es admin

El primer admin se crea por seed con DNI y contraseña inicial. Una vez logueado, puede crear otros admins (botón "Promover a admin" en la vista de usuarios).

Recomendación: máximo 2-3 admins, con responsabilidades claras.

### Carga de resultados

Idealmente:
- 1 persona responsable de cargar resultados
- Tope: 30 minutos después de terminado el partido
- Validación cruzada con fuente oficial (FIFA.com)

### Backup y seguridad

- BD respaldada diariamente a Backblaze B2 (configuración que ya manejás)
- Logs de admin guardados al menos hasta 6 meses post-Mundial
- 2FA para cuentas admin (futuro, no MVP)

## UI sugerida (descripción textual)

- Sidebar lateral con secciones (íconos + texto, colapsable en mobile)
- Header con: logo del club, nombre del admin, botón logout
- Contenido principal con breadcrumbs
- Tablas con paginación, ordenamiento y búsqueda
- Acciones secundarias en menús contextuales (3 puntos)
- Toasts para feedback (shadcn/ui sonner)
- Modales / drawers para detalle y edición
- Tema claro / oscuro

Si querés mantener consistencia con tu otros sistemas (Gabeiras Gast, etc.), reutilizá los mismos colores y patrones visuales del club.
