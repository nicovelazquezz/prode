# 01 — Plan de Desarrollo

## Filosofía

Desarrollo iterativo en fases con entregables funcionales en cada etapa. El objetivo es tener el MVP listo **al menos 45 días antes** del 11 de junio de 2026 para poder testear con usuarios reales antes del torneo.

## Estimación general

Asumiendo 1 desarrollador full-time o equivalente:
- **MVP funcional**: ~6 semanas
- **Versión completa con todas las features**: ~10 semanas
- **Buffer de testing y ajustes**: ~3 semanas

## Fase 0 — Setup e infraestructura (3-5 días)

- Inicializar repositorio backend y frontend en carpetas separadas.
- Configurar NestJS con estructura modular
- Configurar Next.js 15 con App Router
- Setup de Prisma + PostgreSQL local con Docker Compose
- Desarrollo local y subida a prod
- Configurar variables de entorno (.env.example)
- Setup de ESLint + Prettier + Husky con commit hooks
- Setup de TypeScript strict en ambos proyectos
- CI/CD básico (Usaremos dokploy con nixpack o dockerfile en mi VPS)

**Entregable**: Hello World deployado en staging.

## Fase 1 — Modelo de datos y autenticación (5-7 días)

- Definir esquema Prisma completo (ver `04-modelo-datos.md`)
- Migraciones iniciales
- Seeds: 48 selecciones, 12 grupos, 104 partidos con fechas y horarios reales
- Módulo de auth en NestJS:
  - Registro: DNI, nombre, apellido, WhatsApp, contraseña
  - Login: DNI + contraseña → JWT
  - Refresh token
  - Recuperación de contraseña vía WhatsApp
- Guards y decorators de roles (`@Roles('admin')`, `@Roles('user')`)
- Validaciones: DNI argentino (7-8 dígitos), formato WhatsApp, contraseña fuerte
- Rate limiting en endpoints de auth
- Hash de contraseñas con bcrypt

**Entregable**: API con auth funcional + Postman collection.

## Fase 2 — Frontend público y registro (5-7 días)

- Layout base con Tailwind + shadcn/ui
- Páginas públicas:
  - Landing con countdown al primer partido
  - Cómo funciona / Reglas
  - Premios
  - Login / Registro
  - Recuperación de contraseña
- Implementar formularios con React Hook Form + Zod
- Integración con API de auth
- Manejo de tokens (httpOnly cookies preferido, o localStorage con refresh)
- Persistencia de sesión
- Mobile-first responsive

**Entregable**: Usuarios pueden registrarse, loguearse y ver landing.

## Fase 3 — Predicciones de partidos (7-10 días)

- Endpoint GET `/matches` con paginación y filtros (por fase, por fecha)
- Endpoint POST/PUT `/predictions/match/:id` con validaciones:
  - Solo usuarios pagados pueden cargar
  - Solo antes del `locked_at` del partido
  - Validar que el resultado sea válido (números no negativos, máx 99)
- Endpoint GET `/predictions/me` con todas las predicciones del usuario
- Frontend:
  - Vista "Mis predicciones" agrupada por fase y fecha
  - Componente de partido con inputs para resultado
  - Indicador de tiempo restante para cargar
  - Auto-save con debounce
  - Indicador visual de "ya cargado" / "pendiente" / "cerrado"
  - Vista "Próximos partidos" con countdown

**Entregable**: Usuarios pagados pueden cargar predicciones de los 104 partidos.

## Fase 4 — Predicciones especiales (3-4 días)

- Endpoint POST/PUT `/predictions/special` (campeón, subcampeón, tercero, goleador, total de goles)
- Validaciones:
  - Solo se pueden cargar antes del 11 de junio (kickoff del torneo)
  - Subcampeón distinto a campeón
  - Tercero distinto a campeón y subcampeón
- Frontend:
  - Vista dedicada con selectores de país (con bandera + nombre)
  - Input de texto autocompletado para goleador (lista de jugadores prearmada)
  - Input numérico para total de goles con sugerencia
  - Confirmación antes de guardar

**Entregable**: Usuarios pueden cargar predicciones especiales.

## Fase 5 — Pagos (5-7 días)

- Setup de MercadoPago SDK
- Endpoint POST `/payments/checkout` que crea preferencia y devuelve URL
- Webhook POST `/payments/webhook` con validación de firma
- Lógica de actualización de estado del usuario (pendiente → pagado)
- Frontend:
  - Vista de "Pago pendiente" con botones "Pagar con MercadoPago" o "Pagar al admin"
  - Página de retorno post-pago (success / failure / pending)
- Logs detallados de todos los eventos de pago
- Manejo de casos edge: pagos duplicados, contracargos, refunds

**Entregable**: Usuarios pueden pagar online o esperar confirmación manual.

## Fase 6 — Panel de administración (7-10 días)

- Layout de admin separado del público
- Dashboard con métricas:
  - Total recaudado (online + manual)
  - Usuarios totales / pagados / pendientes
  - Predicciones cargadas vs esperadas
  - Recaudación por método de pago
- Gestión de usuarios:
  - Tabla con búsqueda por DNI / nombre / WhatsApp
  - Acciones: marcar como pagado (con método), reset password, desactivar
  - Detalle individual con todas las predicciones del usuario
- Gestión de partidos:
  - Tabla con todos los partidos
  - Editar fecha/hora
  - Cargar resultado y marcar como finalizado → trigger de cálculo de puntos
- Gestión de fases:
  - Vista por fase con partidos pendientes vs finalizados
  - Botón "Cerrar fase" → calcula ganador y lo persiste en `phase_winners`
  - Marcar premio como entregado
- Reportes:
  - Exportar lista de pagos (CSV/Excel)
  - Exportar tabla de posiciones (PDF imprimible)
  - Exportar predicciones de un usuario (para resolver disputas)

**Entregable**: Admin puede gestionar todo el sistema sin tocar la BD.

## Fase 7 — Tabla de posiciones y rankings (4-5 días)

- Endpoint GET `/leaderboard/global` con paginación
- Endpoint GET `/leaderboard/phase/:phase`
- Endpoint GET `/leaderboard/me/around` (mi posición + 5 arriba y 5 abajo)
- Cálculo de puntos:
  - Servicio que evalúa cada predicción contra resultado
  - Aplicar multiplicador por fase
  - Persistir `points_earned` en cada `Prediction`
  - Sumarizar por usuario
- Frontend:
  - Vista de tabla global con top 100
  - Vista de tabla por fase
  - Mi posición destacada
  - Filtro por mini-liga
- Cache estratégico (Redis o in-memory) — la tabla se recalcula al cargar resultado, no en cada request

**Entregable**: Tabla de posiciones en vivo.

## Fase 8 — Mini-ligas (3-4 días)

- Endpoint POST `/leagues` para crear mini-liga
- Endpoint POST `/leagues/:id/join` con código de invitación
- Endpoint GET `/leagues/:id/leaderboard`
- Frontend:
  - Crear mini-liga con nombre y descripción
  - Compartir código por WhatsApp
  - Unirse con código
  - Ver ranking de la mini-liga

**Entregable**: Usuarios pueden crear grupos privados.

## Fase 9 — Notificaciones por WhatsApp (3-5 días)

- Integración con tu backend existente de whatsapp-web.js
- Sistema de jobs/cron para envíos:
  - 2 horas antes de cada partido: recordatorio si el usuario no cargó predicción
  - Al cerrar una fase: anuncio del ganador
  - Cambios significativos en el ranking (subió 10+ puestos)
- Endpoint admin para enviar broadcast manual
- Preferencias del usuario para activar/desactivar

**Entregable**: Sistema de notificaciones funcional.

## Fase 10 — Pulido y testing (5-7 días)

- Tests unitarios de servicios críticos (cálculo de puntos, evaluación de predicciones)
- Tests e2e de flujos principales (registro → pago → predicción → puntos)
- Optimización de performance:
  - Índices en BD
  - Lazy loading en frontend
  - Imágenes optimizadas
- Accesibilidad básica (a11y)
- SEO básico (meta tags, OG image)
- PWA: manifest.json, service worker, instalable
- Pruebas con usuarios beta del club
- Corrección de bugs reportados

**Entregable**: Aplicación lista para producción.

## Fase 11 — Lanzamiento y operación (continuo)

- Apertura de inscripciones
- Soporte a usuarios (canal de WhatsApp del club)
- Carga de resultados después de cada partido (idealmente dentro de 2hs)
- Monitoreo de logs y errores
- Atención de incidencias

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|-----------|
| MercadoPago rechaza la cuenta del club por monto/volumen | Tener listo el flujo de pago manual desde el día 1 |
| Caída del servidor durante la final | Backup de BD diario; servidor con buen uptime; HTTPS forzado |
| Disputa por una predicción | Logs inmutables de cuándo se cargó cada predicción; campo `locked_at` en partidos |
| Usuario olvida contraseña justo antes del partido | Recuperación rápida vía WhatsApp |
| Resultado oficial cambia post-partido (raro pero pasa) | Endpoint admin para "recalcular puntos del partido X" |
| Carga manual de 104 resultados es tediosa | Considerar API automática como mejora post-MVP |

## Backlog post-Mundial (ideas futuras)

- Predicciones por jornada (no solo Mundial, sino Liga Argentina, Champions, etc.)
- Sistema de chat / muro entre usuarios
- Gamificación con badges y logros
- Comparación cabeza a cabeza entre usuarios
- App nativa con Expo (reusando know-how del Columbus)
