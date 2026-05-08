# 07 — Integraciones

## MercadoPago

### Setup inicial

1. El club crea cuenta de MercadoPago Empresas (si no la tiene)
2. Generar credenciales en https://www.mercadopago.com.ar/developers/panel
3. Obtener:
   - `Access Token` (privado, va en backend)
   - `Public Key` (puede estar en frontend)
4. Configurar webhook URL: `https://api.prodeplus.com/payments/webhook`
5. Activar acreditación a 14 días para reducir comisiones

### Flujo de pago (Checkout Pro)

#### Crear preferencia

```typescript
// payments.service.ts
import { MercadoPagoConfig, Preference } from 'mercadopago';

const client = new MercadoPagoConfig({ 
  accessToken: process.env.MP_ACCESS_TOKEN 
});

async function createPaymentPreference(userId: string) {
  // Crear registro local de payment con status PENDING
  const payment = await prisma.payment.create({
    data: {
      userId,
      amount: 5000,
      method: 'MERCADOPAGO',
      status: 'PENDING',
    },
  });
  
  const preference = new Preference(client);
  
  const result = await preference.create({
    body: {
      items: [{
        id: payment.id,
        title: 'Inscripción Prode Mundial 2026 — Tiro Federal',
        quantity: 1,
        unit_price: 5000,
        currency_id: 'ARS',
      }],
      payer: {
        // datos opcionales del pagador
      },
      external_reference: payment.id,  // para identificar en el webhook
      back_urls: {
        success: `${process.env.FRONTEND_URL}/inscripcion/success`,
        failure: `${process.env.FRONTEND_URL}/inscripcion/failure`,
        pending: `${process.env.FRONTEND_URL}/inscripcion/pending`,
      },
      auto_return: 'approved',
      notification_url: `${process.env.API_URL}/payments/webhook`,
      statement_descriptor: 'PRODE TIRO FEDERAL',
    },
  });
  
  // Guardar preferenceId
  await prisma.payment.update({
    where: { id: payment.id },
    data: { mpPreferenceId: result.id },
  });
  
  return { 
    paymentId: payment.id, 
    initPoint: result.init_point,
  };
}
```

#### Webhook handler

```typescript
// payments.controller.ts
@Post('webhook')
async handleWebhook(
  @Body() body: any,
  @Headers('x-signature') signature: string,
  @Headers('x-request-id') requestId: string,
) {
  // 1. Validar firma (importante por seguridad)
  this.validateMercadoPagoSignature(signature, body, requestId);
  
  // 2. MP envía notificaciones de varios tipos. Solo nos importan los de tipo "payment"
  if (body.type !== 'payment') return { received: true };
  
  // 3. Buscar el pago en MP por id
  const mpPayment = await this.mpService.getPayment(body.data.id);
  
  // 4. Buscar nuestro registro de payment
  const payment = await prisma.payment.findFirst({
    where: { mpPreferenceId: mpPayment.preferenceId },
  });
  
  if (!payment) {
    // log error pero responder 200 para que MP no reintente
    this.logger.error(`Payment not found for MP id ${body.data.id}`);
    return { received: true };
  }
  
  // 5. Actualizar estado según el estado de MP
  const statusMap = {
    'approved': 'APPROVED',
    'rejected': 'REJECTED',
    'refunded': 'REFUNDED',
    'pending': 'PENDING',
    'in_process': 'PENDING',
    'cancelled': 'REJECTED',
  };
  
  await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: statusMap[mpPayment.status] || 'PENDING',
        mpPaymentId: String(mpPayment.id),
        mpRawData: mpPayment,
        paidAt: mpPayment.status === 'approved' ? new Date() : null,
      },
    });
    
    // Si fue aprobado, marcar al usuario
    if (mpPayment.status === 'approved') {
      await tx.user.update({
        where: { id: payment.userId },
        data: {
          isPaid: true,
          paidAt: new Date(),
          paidMethod: 'MERCADOPAGO',
          paidAmount: payment.amount,
        },
      });
      
      // Disparar notificación
      await this.notificationsService.sendPaymentConfirmation(payment.userId);
    }
  });
  
  return { received: true };
}
```

### Validación de firma

MP envía un header `x-signature` que se debe validar para confirmar que el webhook viene realmente de ellos:

```typescript
import * as crypto from 'crypto';

function validateMercadoPagoSignature(signature: string, body: any, requestId: string): void {
  // El formato de signature es: ts=TIMESTAMP,v1=HASH
  const parts = signature.split(',');
  const ts = parts.find(p => p.startsWith('ts=')).split('=')[1];
  const hash = parts.find(p => p.startsWith('v1=')).split('=')[1];
  
  const dataId = body.data?.id;
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  
  const expectedHash = crypto
    .createHmac('sha256', process.env.MP_WEBHOOK_SECRET)
    .update(manifest)
    .digest('hex');
  
  if (hash !== expectedHash) {
    throw new UnauthorizedException('Invalid MP signature');
  }
}
```

### Casos especiales

- **Pagos duplicados**: posible si el webhook se reintenta. Idempotente por `mpPaymentId` único.
- **Pagos pendientes** (efectivo en Pago Fácil): el usuario completa el pago en una sucursal, MP confirma horas después. Mientras tanto, estado `PENDING`.
- **Refunds**: si se refundea desde MP, el webhook llega con tipo `payment` y status `refunded`. El sistema debe revertir `isPaid = false`.
- **Disputa / contracargo**: MP envía notificación. Debe revisarse manualmente por admin.

---

## WhatsApp (whatsapp-web.js)

Aprovechamos tu backend existente.

### Endpoint que ya tenés

Asumimos que ya existe un endpoint tipo:
```
POST https://tu-whatsapp-backend.com/send
Authorization: Bearer <token>

{
  "to": "5492914xxxxxxx",
  "message": "..."
}
```

Si no es así, hay que adaptarlo.

### Wrapper en el backend del Prode

```typescript
// notifications/whatsapp.service.ts
@Injectable()
export class WhatsappService {
  async send(to: string, message: string): Promise<void> {
    const response = await fetch(`${process.env.WHATSAPP_API_URL}/send`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.WHATSAPP_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to, message }),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to send WhatsApp: ${response.statusText}`);
    }
  }
}
```

### Sistema de notificaciones

El módulo `notifications` no envía directamente. Crea registros en la tabla `notifications` y un job los procesa.

```typescript
// notifications/notifications.service.ts
async sendPaymentConfirmation(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  
  const message = `✅ ¡Listo ${user.firstName}! Tu pago fue confirmado. Ya podés cargar tus pronósticos en ${process.env.FRONTEND_URL}`;
  
  await prisma.notification.create({
    data: {
      userId,
      type: 'payment_confirmed',
      title: 'Pago confirmado',
      message,
      channel: 'whatsapp',
      status: 'pending',
    },
  });
}
```

### Job de envío

Un cron job (con Bull o `@nestjs/schedule`) procesa las notificaciones pendientes:

```typescript
@Cron('*/30 * * * * *') // cada 30s
async processNotifications() {
  const pending = await prisma.notification.findMany({
    where: { 
      status: 'pending',
      channel: 'whatsapp',
    },
    include: { user: true },
    take: 10, // procesar de a 10 para no saturar
  });
  
  for (const notif of pending) {
    if (!notif.user.whatsappOptIn) {
      await prisma.notification.update({
        where: { id: notif.id },
        data: { status: 'sent', sentAt: new Date(), metadata: { skipped: 'opted_out' } },
      });
      continue;
    }
    
    try {
      await this.whatsappService.send(notif.user.whatsapp, notif.message);
      await prisma.notification.update({
        where: { id: notif.id },
        data: { status: 'sent', sentAt: new Date() },
      });
    } catch (err) {
      await prisma.notification.update({
        where: { id: notif.id },
        data: { 
          status: 'failed', 
          metadata: { error: err.message },
        },
      });
    }
  }
}
```

### Recordatorios pre-partido

Otro cron que detecta partidos próximos y notifica a usuarios sin predicción:

```typescript
@Cron('0 */15 * * * *') // cada 15 min
async sendMatchReminders() {
  const inTwoHours = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const matchesNeedingReminders = await prisma.match.findMany({
    where: {
      kickoffAt: {
        gte: new Date(),
        lte: inTwoHours,
      },
      status: 'SCHEDULED',
    },
  });
  
  for (const match of matchesNeedingReminders) {
    const usersWithoutPrediction = await prisma.user.findMany({
      where: {
        isPaid: true,
        whatsappOptIn: true,
        predictions: {
          none: { matchId: match.id },
        },
      },
    });
    
    for (const user of usersWithoutPrediction) {
      // crear notification (deduplicada)
    }
  }
}
```

---

## API de fixtures (opcional)

Si se quiere automatizar la carga de resultados, hay APIs disponibles:

### Football-Data.org

- Plan free: 10 requests/min, suficiente para uso bajo
- Endpoint: `https://api.football-data.org/v4/competitions/WC/matches`
- Tiene resultados oficiales del Mundial

### API-Football

- Plan free: 100 requests/día
- Más completa: jugadores, eventos del partido (goles, tarjetas)
- Útil para identificar el goleador del torneo

### Estrategia recomendada

**Para el MVP**: carga 100% manual. El admin carga el resultado en cuanto termina el partido.

**Como mejora post-MVP**: cron job cada 5 minutos durante días de partido que:
1. Consulta API
2. Si encuentra un partido `FINISHED` que no esté cargado en nuestra BD, lo carga
3. Notifica al admin para que valide
4. Si el admin confirma, dispara cálculo de puntos

Esto evita el overhead operativo de cargar 104 resultados a mano.

---

## Backblaze B2 (backups)

Aprovechando tu setup existente con Dokploy + B2:

### Qué respaldar

- Dump diario de PostgreSQL
- Logs de aplicación (rotados)
- Archivos de configuración (.env, docker-compose.yml)

### Configuración

Reusar el setup S3-compatible que ya tenés. Bucket separado para este proyecto:
- `prodeplus-backups`
- Lifecycle: borrar backups > 90 días
- Cifrado del lado servidor activado

### Script de backup

```bash
#!/bin/bash
# /opt/prode-backup.sh

DATE=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="/tmp/prode-db-$DATE.sql.gz"

# Dump
docker exec prode-postgres pg_dump -U prodeuser prode | gzip > $BACKUP_FILE

# Upload to B2 (vía rclone o aws-cli)
aws s3 cp $BACKUP_FILE s3://prodeplus-backups/db/ \
  --endpoint-url=https://s3.us-west-002.backblazeb2.com

# Limpiar local
rm $BACKUP_FILE
```

Cron: `0 3 * * *` (diario a las 3 AM Argentina)

---

## Sentry (errores)

### Backend

```typescript
// main.ts
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
});
```

Filtro global que captura excepciones no controladas.

### Frontend

```typescript
// instrumentation.ts (Next.js 15)
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0.1,
});
```

### Alertas

Configurar alertas por:
- Errores en endpoints de pagos (cualquier error es crítico)
- Errores en webhook de MP
- Errores en cálculo de puntos
- Throughput inusual (posible ataque DDoS)

---

## Resumen de servicios externos

| Servicio | Para qué | Costo aprox. |
|----------|----------|--------------|
| MercadoPago | Cobros online | 3.49% por transacción (acreditación 14d) |
| WhatsApp (tu backend) | Notificaciones | $0 (ya lo tenés) |
| Backblaze B2 | Backups | < $1/mes para este volumen |
| Sentry | Monitoreo de errores | Gratis hasta 5k eventos/mes |
| Dominio | DNS | ~$15-30/año |
| VPS (Dokploy) | Hosting | Lo que ya pagás |
| Football-Data API (opcional) | Resultados automáticos | Gratis hasta 10 req/min |

**Total estimado de costos operativos**: < $50/mes adicionales a lo que ya tenés.
