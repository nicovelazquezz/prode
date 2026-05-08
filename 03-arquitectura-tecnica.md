# 03 — Arquitectura Técnica

## Decisiones de stack

### Por qué NestJS

- Estructura modular bien definida (controllers, services, modules, providers)
- DI nativa, fácil de testear
- TypeScript first-class
- Decoradores expresivos (Guards, Interceptors, Pipes)
- Buena integración con Prisma
- Buen ecosistema (Passport, Throttler, Bull para jobs)

### Por qué Next.js 15

- App Router maduro, RSC para optimizar performance
- Mobile-first natural con Tailwind
- Buen SEO de cajón
- Edge functions disponibles si se necesitan
- Imágenes optimizadas built-in (importante para banderas y fotos)
- Server Actions para mutaciones simples (aunque preferimos API REST para consistencia)

### Por qué Prisma

- Type-safety extremo (autocomplete en queries)
- Migraciones declarativas
- Buen soporte de relaciones complejas
- Schema único como fuente de verdad
- Studio para inspección manual

### Por qué TanStack Query

- Estado del servidor manejado de forma desacoplada
- Cache inteligente con invalidación
- Refetch en focus / reconnect (ideal para tabla de posiciones en vivo)
- Optimistic updates para mejor UX en carga de predicciones
- DevTools excelentes

### Por qué PostgreSQL

- Transacciones ACID (críticas para pagos y predicciones)
- JSON nativo si se necesita (logs, payloads de webhooks)
- Excelente performance con índices apropiados
- Soporte robusto en Dokploy
- Backup y restore probados



###  repos separados

Más simple para empezar, pero genera duplicación de tipos. Si se elige esta vía:
- `backend` (NestJS)
- `frontend` (Next.js)
- Compartir tipos publicando un paquete privado o copiando manualmente (mantenible solo si los tipos cambian poco)

**Recomendación**: monorepo con pnpm workspaces o Turborepo. Si se prefiere simplicidad, repos separados con `zod` schemas compartidos por copia.

## Estructura de un módulo NestJS típico

Ejemplo del módulo de predicciones:

```
predictions/
├── dto/
│   ├── create-prediction.dto.ts
│   ├── update-prediction.dto.ts
│   └── special-prediction.dto.ts
├── entities/
│   └── prediction.entity.ts          # tipos derivados de Prisma
├── predictions.controller.ts          # endpoints REST
├── predictions.service.ts             # lógica de negocio
├── predictions.repository.ts          # acceso a datos vía Prisma
├── predictions.module.ts
└── predictions.spec.ts                # tests unitarios
```

### Patrón Repository

Aunque NestJS + Prisma se puede usar directamente con el cliente Prisma, agregar una capa de repository ayuda a:
- Aislar Prisma del resto del código (facilita migrar en el futuro)
- Centralizar queries reutilizables
- Testear más fácil con mocks

Si se prefiere simplicidad, se puede inyectar `PrismaService` directamente en el service.

## Patrón de manejo de errores

### Backend

- Filtros globales que mapean excepciones de Prisma a HTTP status codes
- Excepciones personalizadas en el dominio (`UserNotPaidException`, `PredictionLockedException`, etc.)
- Logger estructurado (Winston o Pino) con request ID
- Sentry o similar para producción

### Frontend

- Boundary global en App Router para errores no manejados
- TanStack Query maneja retry y errores transitorios automáticamente
- Toast notifications con shadcn/ui para feedback al usuario
- Mensajes de error en español, claros y accionables

## Configuración y variables de entorno

### Backend (.env)

```bash
# Database
DATABASE_URL="postgresql://user:pass@localhost:5432/prode"

# Server
PORT=3001
NODE_ENV=development

# JWT
JWT_ACCESS_SECRET="..."
JWT_REFRESH_SECRET="..."
JWT_ACCESS_EXPIRES_IN="15m"
JWT_REFRESH_EXPIRES_IN="7d"

# MercadoPago
MP_ACCESS_TOKEN="..."
MP_PUBLIC_KEY="..."
MP_WEBHOOK_SECRET="..."

# WhatsApp (tu backend existente)
WHATSAPP_API_URL="https://tu-whatsapp-backend.com"
WHATSAPP_API_TOKEN="..."

# Frontend URL (para CORS y links)
FRONTEND_URL="https://prodeplus.com"

# Inscripción
INSCRIPCION_PRECIO=5000
INSCRIPCION_CIERRE="2026-06-11T19:00:00-03:00"

# Admin
ADMIN_DEFAULT_DNI="..."
ADMIN_DEFAULT_PASSWORD="..."  # solo para seed inicial
```

### Frontend (.env.local)

```bash
NEXT_PUBLIC_API_URL=https://api.prodeplus.com
NEXT_PUBLIC_MP_PUBLIC_KEY=...
NEXT_PUBLIC_WORLD_CUP_START="2026-06-11T18:00:00-03:00"
```

## Autenticación: detalles técnicos

### Estrategia: JWT con refresh

- **Access token**: vida corta (15 min), enviado en `Authorization: Bearer`
- **Refresh token**: vida larga (7 días), guardado en cookie `httpOnly` + `Secure` + `SameSite=Strict`
- Endpoint `/auth/refresh` que verifica refresh y emite nuevo access
- Logout invalida el refresh en BD (tabla `refresh_tokens` con `revoked_at`)

### Por qué cookie httpOnly para refresh

- Protege contra XSS (no accesible desde JS)
- El access token va en memoria del frontend (no localStorage)
- Cuando el access expira, llamada automática a `/auth/refresh` (interceptor de TanStack Query)

### Recuperación de contraseña

1. Usuario ingresa DNI en formulario
2. Si existe, se genera token de reset (random, expiración 30 min, guardado en `password_resets`)
3. Se envía link al WhatsApp registrado: `https://prodeplus.com/reset?token=...`
4. Usuario abre link, ingresa nueva contraseña
5. Token se marca como usado

## Manejo de fechas y zonas horarias

**Decisión**: todas las fechas en BD se guardan en UTC. El frontend las muestra en hora de Argentina (UTC-3).

- Prisma maneja timestamps como ISO strings
- Backend nunca asume zona horaria
- Frontend usa `date-fns` o `dayjs` con `timeZone: 'America/Argentina/Buenos_Aires'`

Esto es crítico porque los partidos se juegan en USA, México y Canadá (varias zonas horarias), pero los usuarios están en Argentina.

## Performance y caching

### Backend

- Cache en memoria (NestJS `@nestjs/cache-manager`) o Redis para:
  - Leaderboard global (TTL 60s, invalidar al cargar resultado)
  - Lista de partidos próximos
  - Datos de selecciones (banderas, nombres)
- Índices en BD:
  - `predictions(user_id, match_id)` único
  - `matches(phase, kickoff_at)`
  - `users(dni)` único
  - `payments(mp_payment_id)` único

### Frontend

- ISR (Incremental Static Regeneration) para páginas públicas (landing, reglas)
- TanStack Query con `staleTime` configurado por tipo de dato:
  - Leaderboard: 30s
  - Mis predicciones: 5 min
  - Partidos: 10 min
  - Datos de usuario: 30 min

## Testing

### Backend

- **Unitarios**: services con jest + mocks de repositorios
- **Integración**: módulos completos con BD de test (postgres en Docker)
- **E2E**: flujos críticos (registro → login → predicción → cálculo de puntos)

### Frontend

- **Componentes**: React Testing Library para UI crítica
- **E2E con Playwright**: flujos principales (puede correr sobre staging)

## Logs y observabilidad

- Logs estructurados en JSON
- Niveles: `error`, `warn`, `info`, `debug`
- Request ID único en cada request (header `x-request-id`)
- Logs de eventos críticos:
  - Pagos (creación, confirmación, fallo)
  - Carga de predicciones (con timestamp para auditoría)
  - Login fallidos (alerta si hay > 10 en 1 min para un mismo DNI)
  - Cierre de fases
  - Cálculos de puntos
- Sentry para errores en frontend y backend
- UptimeRobot o similar para monitoreo de disponibilidad

## Deploy con Dokploy

Aprovechando que ya manejás Dokploy:

- **Servicios**:
  - PostgreSQL (con backup automático a Backblaze B2)
  - API NestJS (puerto 3001)
  - Web Next.js (puerto 3000)
  - Reverse proxy (Traefik o Caddy, viene con Dokploy)
- **Dominios**:
  - `prodeplus.com` → web
  - `api.prodeplus.com` → api
- **SSL**: Let's Encrypt automático
- **Backups**:
  - BD: diario, retención 30 días
  - Logs: rotados, retención 14 días

## Decisiones pendientes para confirmar

1. **Monorepo o repos separados**: recomiendo monorepo con pnpm workspaces.
2. **shadcn/ui o ChakraUI o MUI**: recomiendo shadcn/ui (ya lo usás, customizable, sin overhead).
3. **TanStack Router en algún lugar**: no hace falta, Next.js cubre routing.
4. **Server Actions vs API REST**: API REST en NestJS para todo (más mantenible y testeable; Server Actions solo si hay un flujo muy específico).
5. **Redis o cache en memoria**: empezar con cache en memoria, agregar Redis si la carga lo justifica.
