# Prode Tiro Federal — Mundial 2026

Plataforma web mobile-first para gestionar un Prode (pronósticos deportivos) del Mundial de Fútbol 2026, con el objetivo de recolectar fondos para el Club Tiro Federal de Bahía Blanca.

## Resumen ejecutivo

- **Evento**: Copa Mundial de la FIFA 2026 (USA, México, Canadá)
- **Duración**: 11 de junio al 19 de julio de 2026 (39 días)
- **Partidos a pronosticar**: 104 partidos
- **Selecciones**: 48
- **Fases**: Grupos → 16avos → Octavos → Cuartos → Semifinales → Tercer Puesto + Final
- **Objetivo**: Recaudación de fondos para el club mediante inscripciones pagas

## Stack técnico

| Capa | Tecnología |
|------|-----------|
| Backend | NestJS + TypeScript |
| ORM | Prisma |
| Base de datos | PostgreSQL |
| Frontend | Next.js 15 (App Router) + React |
| Estilos | Tailwind CSS + shadcn/ui |
| Data fetching | TanStack Query |
| Auth | JWT (access + refresh) |
| Pagos | MercadoPago (Checkout Pro) + manual |
| Notificaciones | WhatsApp (whatsapp-web.js existente) |
| Deploy | Dokploy (VPS) |

## Estructura de la documentación

| Archivo | Contenido |
|---------|-----------|
| [01-plan-desarrollo.md](docs/01-plan-desarrollo.md) | Roadmap por fases con timeline |
| [02-sistema-puntos-premios.md](docs/02-sistema-puntos-premios.md) | Reglas de puntuación + simulador de recaudación |
| [03-arquitectura-tecnica.md](docs/03-arquitectura-tecnica.md) | Estructura de carpetas, patrones, decisiones |
| [04-modelo-datos.md](docs/04-modelo-datos.md) | Esquema Prisma completo + diagrama ER |
| [05-flujos-usuario.md](docs/05-flujos-usuario.md) | Flujos de registro, pago, predicciones |
| [06-panel-admin.md](docs/06-panel-admin.md) | Funcionalidades del panel administrativo |
| [07-integraciones.md](docs/07-integraciones.md) | MercadoPago, WhatsApp, API de fixtures |
| [08-seguridad.md](docs/08-seguridad.md) | Auth, validaciones, prevención de fraude |

## Características principales

### Para el usuario
- Login con DNI + contraseña (recuperación vía WhatsApp)
- Carga de predicciones de los 104 partidos
- Predicciones especiales: campeón, subcampeón, tercero, goleador, total de goles
- Tabla de posiciones global y por fase
- Mini-ligas (grupos privados con familia / amigos / trabajo)
- Notificaciones por WhatsApp (cierre de pronósticos, cambios en ranking)
- Historial de aciertos y estadísticas personales

### Para el admin
- Panel de control con métricas (recaudación, usuarios, predicciones cargadas)
- Gestión manual de pagos (efectivo / transferencia)
- Carga de resultados de partidos
- Cierre de fases y cálculo de ganadores
- Gestión de usuarios (alta, baja, modificación)
- Exportación de datos a Excel/PDF para reportes del club

## Hitos clave

| Hito | Fecha objetivo |
|------|----------------|
| Inicio del desarrollo | A definir |
| MVP funcional | -45 días pre-Mundial |
| Apertura de inscripciones | -30 días pre-Mundial |
| Cierre de carga de pronósticos especiales | 11 de junio 2026 |
| Inicio del Mundial | 11 de junio 2026 |
| Final del Mundial | 19 de julio 2026 |
| Distribución de premios | -7 días post-final |

## Contacto

Proyecto desarrollado para el **Club Tiro Federal de Bahía Blanca**.
