# 08 — Seguridad

Este documento describe las medidas de seguridad para proteger la plataforma, los pagos y los datos de los usuarios. Como el sistema maneja dinero y compite con un objetivo (premios), es atractivo para fraude.

## Modelo de amenazas

### Activos a proteger
- Datos personales de usuarios (DNI, nombre, WhatsApp)
- Pagos y registros financieros
- Predicciones (no deben modificarse después del cierre)
- Resultados (no deben modificarse arbitrariamente)
- Cuentas de admin (acceso total al sistema)

### Actores hostiles
- Usuarios queriendo modificar predicciones después del cierre
- Atacantes externos buscando datos personales
- Insiders (un admin malintencionado)
- Bots intentando crear cuentas falsas

## Autenticación

### Hash de contraseñas

- bcrypt con `saltRounds = 12`
- Nunca guardar contraseñas en plano
- Nunca loggear contraseñas

```typescript
import * as bcrypt from 'bcrypt';

const hash = await bcrypt.hash(password, 12);
const isValid = await bcrypt.compare(password, user.passwordHash);
```

### Política de contraseñas

- Mínimo 8 caracteres
- Debe contener al menos 1 número
- Validación en frontend (Zod) y backend
- No exigir caracteres especiales (genera frustración y los usuarios anotan la pass)

### JWT

- Access token: vida corta (15 min)
- Refresh token: vida larga (7 días), guardado en cookie httpOnly
- Refresh tokens persistidos en BD para poder revocarlos
- Logout invalida el refresh

### Rate limiting

- Endpoint `/auth/login`: máximo 5 intentos por DNI por 15 minutos
- Endpoint `/auth/register`: máximo 3 registros por IP por hora
- Endpoint `/auth/password-reset`: máximo 3 pedidos por DNI por hora
- Endpoints públicos: 60 requests/min por IP

Usar `@nestjs/throttler` para esto.

### 2FA (post-MVP)

Para cuentas admin, considerar 2FA con TOTP (Google Authenticator) en el futuro. Para el MVP no es crítico ya que serán pocos admins y de confianza del club.

## Autorización

### Guards en NestJS

```typescript
// Decorator
export const Roles = (...roles: Role[]) => SetMetadata('roles', roles);

// Guard
@Injectable()
export class RolesGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.get<Role[]>('roles', context.getHandler());
    if (!requiredRoles) return true;
    
    const { user } = context.switchToHttp().getRequest();
    return requiredRoles.some((role) => user.role === role);
  }
}

// Uso
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Post('users/:id/mark-paid')
async markAsPaid(...) { ... }
```

### Reglas críticas

- **Solo admins** pueden cargar resultados de partidos
- **Solo admins** pueden marcar pagos manualmente
- **Solo admins** pueden ver los datos de otros usuarios
- **Solo el dueño** puede modificar sus propias predicciones
- **Nadie** puede modificar predicciones de partidos cuyo `predictionsLockAt` ya pasó

## Validación de predicciones

### Backend (crítico)

Toda lógica de tiempo se valida del lado servidor. **Nunca confiar en el frontend.**

```typescript
async createOrUpdatePrediction(userId: string, matchId: string, dto: PredictionDto) {
  // 1. Verificar que el usuario esté pagado
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user.isPaid) {
    throw new ForbiddenException('Usuario no ha completado el pago');
  }
  
  // 2. Verificar que el partido exista y no esté lockeado
  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!match) throw new NotFoundException();
  
  if (new Date() >= match.predictionsLockAt) {
    throw new BadRequestException('Las predicciones para este partido están cerradas');
  }
  
  // 3. Validar valores razonables
  if (dto.scoreHome < 0 || dto.scoreAway < 0 || dto.scoreHome > 99 || dto.scoreAway > 99) {
    throw new BadRequestException('Valores inválidos');
  }
  
  // 4. Upsert
  return prisma.prediction.upsert({...});
}
```

### Bloqueo automático

Un cron cada minuto que:
1. Encuentra partidos con `kickoffAt - predictionsLockAt < 0` y status `SCHEDULED`
2. Cambia status a `LOCKED`
3. Esto evita modificaciones aunque el chequeo de tiempo falle

## Validación de pagos

### Webhook de MP

- Validar firma criptográfica (HMAC-SHA256) en cada request
- Idempotencia: usar `mpPaymentId` como llave única
- Nunca confiar en el frontend para confirmar un pago

### Pago manual

- Solo admins pueden marcar como pagado
- Acción queda en `audit_logs` con: quién, cuándo, monto, método, nota
- Doble confirmación en UI antes de ejecutar

### Reconciliación

- Reporte diario que compara pagos en MP vs pagos en BD
- Alerta si hay discrepancias

## Validación de resultados

### Por qué importa

Si un admin malicioso (o accidentalmente) cambia el resultado de un partido, todos los puntos se recalculan. Esto puede afectar premios.

### Medidas

- **Auditoría completa**: cada carga/cambio de resultado queda en `audit_logs` con before/after
- **Confirmación doble**: UI pide confirmación explícita
- **Notificación a otros admins**: cuando un admin carga un resultado, los demás reciben notificación
- **Periodo de impugnación**: tras cargar resultado, hay 24hs donde otro admin puede revertir si fue error

### Inmutabilidad post-fase

Una vez que se cierra una fase y se asigna premio:
- No se puede modificar resultados de partidos de esa fase
- Si hay un error genuino, requiere intervención manual con justificación documentada

## Protección de datos personales

### Cumplimiento normativo

En Argentina aplica la Ley 25.326 (Protección de Datos Personales).

Medidas:
- Consentimiento explícito al registrarse (checkbox de aceptación de términos)
- Política de privacidad clara y accesible
- Posibilidad de solicitar baja y eliminación de datos

### Almacenamiento

- DNI guardado como string (no encriptado, pero solo accesible por queries autenticadas)
- WhatsApp guardado en formato normalizado
- No almacenar más datos de los necesarios (no pedir dirección, fecha de nacimiento, etc., a menos que el club lo requiera para premios)

### Logs

- Logs no deben contener:
  - Contraseñas
  - Tokens completos (loggear primeros 6 caracteres)
  - Datos completos de tarjetas (MP nunca nos los manda completos, pero igual cuidar)
- Logs sí deben contener:
  - User ID
  - DNI parcial (ej: `12.***.789`) si es necesario

### Backups

- Backups encriptados en B2
- Acceso al bucket restringido
- Rotación de credenciales semestral

## Protección contra abuso

### Cuentas duplicadas

- Validación de DNI único (constraint en BD + check en backend)
- Validación de WhatsApp único
- Si alguien intenta registrarse con DNI ya usado, mensaje claro: "Ya existe una cuenta con este DNI. Si la olvidaste, recuperala desde aquí."

### Bots de registro

- CAPTCHA en registro (Cloudflare Turnstile, gratuito y privacy-friendly)
- Honeypot fields
- Rate limiting por IP

### Comportamiento sospechoso

- Múltiples logins fallidos → bloqueo temporal de la cuenta
- Cambio repentino de WhatsApp + cambio de password → alerta al admin
- Login desde IPs muy distintas en corto tiempo → alerta

## Protección de la infraestructura

### HTTPS forzado

- Certificado SSL via Let's Encrypt (Dokploy lo maneja)
- HSTS header
- Redirect HTTP → HTTPS

### Headers de seguridad

```typescript
// main.ts
app.use(helmet({
  contentSecurityPolicy: { ... },
  crossOriginEmbedderPolicy: false, // si causa problemas con MP iframe
}));
```

Configurar:
- `Content-Security-Policy`
- `X-Frame-Options: DENY` (excepto para callbacks de MP)
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`

### CORS

- Solo permitir el dominio del frontend
- Credentials habilitadas para cookies httpOnly

```typescript
app.enableCors({
  origin: process.env.FRONTEND_URL,
  credentials: true,
});
```

### Inyección SQL

- Prisma previene SQL injection automáticamente (usa prepared statements)
- Nunca usar `$queryRawUnsafe` con input del usuario
- Si se usa raw SQL, parametrizar siempre

### XSS

- React/Next.js escapa por defecto
- Si se renderiza HTML del usuario (ej: nombre de mini-liga), usar siempre `{value}` no `dangerouslySetInnerHTML`
- Sanitizar inputs de texto largo

### CSRF

- Cookies con `SameSite=Strict` (refresh token)
- Access tokens en headers (no en cookies) → no son enviados automáticamente por el browser
- Tokens CSRF para mutations sensibles si se usan cookies de sesión (no aplica si todo va por JWT en headers)

## Auditoría y logs

### Eventos a auditar

Todos quedan en `audit_logs`:
- Login (exitoso y fallido)
- Cambio de password
- Recuperación de password
- Pago confirmado (manual o webhook)
- Carga/edición de predicción
- Carga/edición de resultado de partido
- Cierre de fase
- Asignación de premio
- Marcado de premio como pagado
- Promoción a admin
- Baneo de usuario

### Retención

- Logs de aplicación: 30 días
- Logs de seguridad: 1 año
- `audit_logs` en BD: indefinido (al menos hasta cierre del Mundial + 6 meses)

## Plan de respuesta a incidentes

### Incidentes posibles

1. **Filtración de datos**: notificar a la AAIP (Agencia de Acceso a la Información Pública), avisar a usuarios afectados
2. **Cuenta admin comprometida**: revocar todos los tokens del admin, cambiar credenciales, auditar acciones recientes
3. **Webhook de MP comprometido**: rotar secret, revisar pagos sospechosos
4. **Pérdida de BD**: restaurar desde backup más reciente, perder máximo 24hs de datos

### Contactos de emergencia

Documentar en privado:
- Admin principal del club
- Desarrollador (vos)
- Soporte de MercadoPago
- Soporte de Dokploy / VPS

## Checklist de seguridad pre-lanzamiento

- [ ] HTTPS configurado y funcionando
- [ ] Variables de entorno en producción (no commiteadas)
- [ ] Secrets rotados de los del entorno de desarrollo
- [ ] Backups configurados y probados (hacer un restore de prueba)
- [ ] Rate limiting activo
- [ ] Helmet con headers de seguridad
- [ ] CORS configurado
- [ ] CAPTCHA en registro
- [ ] Webhooks de MP con validación de firma activa
- [ ] Sentry capturando errores
- [ ] Logs sin información sensible
- [ ] Política de privacidad y términos publicados
- [ ] Pruebas de penetración básicas (intentar saltar validaciones, modificar predicciones de otros usuarios, etc.)
- [ ] Plan de rollback en caso de problema durante el lanzamiento
