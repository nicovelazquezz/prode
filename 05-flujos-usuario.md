# 05 — Flujos de Usuario

Este documento describe los flujos principales de la plataforma desde la perspectiva del usuario final.

## Flujo 1 — Llegada y registro

### Paso 1: Landing page

Usuario llega a `prodetest.com`. Ve:

- Hero con escudo del club, título "Prode Mundial 2026 — Tiro Federal"
- Pozo acumulado en vivo: "Pozo actual: $XXX.XXX • 87 jugadores"
- Countdown grande al primer partido (México vs Sudáfrica)
- Sección "Cómo funciona" 
- Sección de premios resumidos
- CTA principal: "Registrarme" (o "Ingresar" si ya tiene cuenta) - Registrarme lleva a whatsapp para ingreso y pago manual.
- Footer con reglamento, contacto

### Paso 2: Registro

Click en "Registrarme":

Formulario con:
- DNI (7-8 dígitos, sin puntos)
- Nombre
- Apellido
- WhatsApp (con prefijo +54 9 prellenado)
- Contraseña (mínimo 8 caracteres, al menos 1 número)
- Repetir contraseña
- Checkbox: "Acepto el reglamento" (link al PDF/página)
- Checkbox opcional: "Quiero recibir notificaciones por WhatsApp"

Validaciones en frontend (Zod) y backend:
- DNI con formato válido (7 u 8 dígitos)
- WhatsApp normalizado a formato internacional (`5492914xxxxxx`)
- Contraseñas coinciden
- DNI no registrado previamente

### Paso 3: Bienvenida

Tras registro exitoso:
- Auto-login (JWT emitido)
- Redirect a `/inscripcion` con mensaje "¡Bienvenido [Nombre]! Para participar, completá tu inscripción."

---

## Flujo 2 — Inscripción y pago

### Paso 1: Pantalla de inscripción

Usuario logueado pero no pagado ve:

- Texto explicativo: "Para participar del Prode necesitás abonar la inscripción de $5.000."
- Resumen de qué obtiene: acceso a cargar pronósticos, mini-ligas, premios.
- Dos botones grandes:
  1. **"Pagar con MercadoPago"** (destacado, badge "Recomendado, automático")
  2. **"Pagar al admin del club"** (con texto "Coordina pago en efectivo o transferencia")

### Paso 2A: Pago con MercadoPago

Click en "Pagar con MercadoPago":

1. Backend crea preferencia de pago en MP con:
   - Monto: $5.000
   - Title: "Inscripción Prode Mundial 2026 — Tiro Federal"
   - External reference: `payment_id` interno
   - URLs de retorno (success / failure / pending)
   - Webhook URL configurada
2. Frontend recibe URL de checkout y redirige
3. Usuario completa pago en MP (tarjeta, efectivo, dinero en cuenta)
4. MP redirige de vuelta + envía webhook
5. Backend valida webhook (firma) y actualiza:
   - `payments.status = APPROVED`
   - `users.isPaid = true`
   - `users.paidAt = now()`
   - `users.paidMethod = MERCADOPAGO`
   - `users.paidAmount = 5000`
6. Webhook envía notificación WhatsApp al usuario: "✅ Pago confirmado, ya podés cargar tus pronósticos"
7. Usuario ve pantalla de éxito y puede acceder a la app completa

### Paso 2B: Pago al admin

Click en "Pagar al admin":

1. Se muestra pantalla con:
   - Datos de contacto del admin del club (WhatsApp, teléfono)
   - Datos para transferencia (CBU/Alias del club)
   - Mensaje: "Una vez que coordines el pago, el admin te marcará como pagado en el sistema. Recibirás una notificación por WhatsApp."
2. Estado del usuario queda como `PENDING`
3. Cuando el admin recibe el pago, lo marca manualmente desde el panel:
   - Selecciona usuario
   - Click "Marcar como pagado"
   - Elige método (efectivo / transferencia)
   - Opcional: nota
4. Sistema dispara notificación WhatsApp al usuario
5. Usuario al loguearse ve la app desbloqueada

### Cancelaciones / fallos

- Si el pago falla en MP: usuario vuelve a la pantalla de inscripción con un mensaje y puede reintentar
- Si el pago queda pendiente (efectivo en pago fácil): el usuario ve estado "Pago pendiente, esperando confirmación de MercadoPago"
- Si MP nunca confirma (raro): admin puede forzar manualmente

---

## Flujo 3 — Carga de predicciones especiales

### Cuándo

Disponible **solo antes del 11 de junio de 2026 a las 18hs** (kickoff del partido inaugural).

### Pasos

1. Usuario va a sección "Predicciones Especiales"
2. Pantalla con:
   - Card 1: **Campeón** (selector con 48 banderas)
   - Card 2: **Subcampeón** (selector, no permite el mismo que campeón)
   - Card 3: **Tercer puesto** (selector, no permite los anteriores)
   - Card 4: **Goleador del torneo** (input con autocomplete sobre tabla `players`)
   - Card 5: **Total de goles del Mundial** (input numérico, hint: "El último Mundial tuvo 172 goles")
3. Banner claro: "Una vez confirmadas, no podrás modificarlas después del 11 de junio"
4. Botón "Guardar predicciones especiales"
5. Modal de confirmación: "¿Estás seguro? Estas son tus elecciones..."
6. Confirmar → guardado → toast de éxito

### Edición

Hasta el cierre, el usuario puede modificar todas las veces que quiera. Cada cambio se persiste con timestamp.

---

## Flujo 4 — Carga de predicciones de partidos

### Cuándo

Cada partido tiene su `predictionsLockAt` (típicamente 10 minutos antes del kickoff). Hasta ese momento se pueden cargar y modificar predicciones.

### Vista principal "Mis Predicciones"

Tabs por fase:
- Próximos (default, muestra los siguientes 10 partidos sin importar fase)
- Grupos
- 16avos
- Octavos
- Cuartos
- Semis
- Final

Cada partido se muestra como una "card de partido":

```
┌─────────────────────────────────────┐
│  Grupo C  •  15 jun 2026 20:00 ART │
│                                      │
│  🇦🇷 Argentina   [ 2 ] - [ 1 ]  🇲🇽 México │
│                                      │
│  ⏱  Cierra en 3h 24min               │
│  ✓ Predicción guardada               │
└─────────────────────────────────────┘
```

Estados posibles de cada card:
- **Sin cargar**: inputs vacíos, botón "Guardar"
- **Cargado, abierto**: inputs con valores, indicador "Predicción guardada", se puede editar
- **Cerrado, sin resultado**: inputs deshabilitados, "Cierre de predicciones"
- **Finalizado**: muestra resultado real + tu predicción + puntos ganados

### Carga / edición

- Inputs numéricos de 0 a 99
- Auto-save con debounce de 1 segundo
- O botón explícito "Guardar" si se prefiere control manual
- Optimistic update: feedback inmediato, rollback si falla

### Vista "Próximos partidos" (filtro especial)

Muestra los próximos 10 partidos de cualquier fase, ordenados por kickoff. Útil para no perderse de cargar.

---

## Flujo 5 — Visualización post-partido

Cuando un partido termina y el admin carga el resultado:

1. Sistema calcula puntos para todas las predicciones del partido
2. Cada usuario ve en su vista:

```
┌─────────────────────────────────────┐
│  Grupo C  •  15 jun 2026 20:00 ART │
│  RESULTADO FINAL                     │
│                                      │
│  🇦🇷 Argentina   [3] - [1]   🇲🇽 México │
│                                      │
│  Tu predicción: 2 - 1                │
│  ✓ Acertaste el ganador y diferencia │
│  +3 pts (×1 grupos = 3 pts)          │
└─────────────────────────────────────┘
```

3. Notificación opcional por WhatsApp: "🎯 Sumaste 3 pts en Argentina vs México. Posición actual: #12"

---

## Flujo 6 — Tabla de posiciones

### Vista principal

Tabs:
- **Tabla General** (default): top de la tabla acumulada
- **Por Fase**: tabla de cada fase individual
- **Mini-ligas**: si el usuario pertenece a alguna

### Tabla General

```
┌──────────────────────────────────────┐
│  Posición #12 (de 187)               │
│  152 puntos                          │
│  ───────────────────────────────────  │
│   1. María González       287 pts    │
│   2. Juan Pérez           254 pts    │
│   3. Pedro Rodríguez      241 pts    │
│  ...                                 │
│  11. Carlos López         156 pts    │
│ ▶12. Vos                  152 pts ◀ │
│  13. Ana Martínez         149 pts    │
│  ...                                 │
└──────────────────────────────────────┘
```

- Tu posición destacada con scroll automático
- Click en un usuario → ver su perfil público (predicciones de partidos finalizados)
- Refresh automático cada 30s con TanStack Query

### Tabla por fase

Igual que la general pero con puntos solo de esa fase.

---

## Flujo 7 — Mini-ligas

### Crear mini-liga

1. Usuario va a "Mis Mini-Ligas" → "Crear nueva"
2. Formulario:
   - Nombre (ej: "Familia García", "Compañeros de oficina")
   - Descripción opcional
3. Sistema genera código único (ej: `XK7F2A`)
4. Pantalla con:
   - Código grande visible
   - Botón "Compartir por WhatsApp" (genera mensaje "Únite a mi mini-liga del Prode con el código XK7F2A: [link]")
   - Tabla de miembros (vacía inicialmente, solo el creador)

### Unirse a mini-liga

1. Usuario va a "Mis Mini-Ligas" → "Unirme con código"
2. Ingresa código
3. Confirma
4. Aparece en su lista

### Ver tabla de mini-liga

- Igual UI que tabla general, pero filtrada a los miembros
- Útil para apuestas paralelas entre amigos sin afectar el premio principal

---

## Flujo 8 — Recuperación de contraseña

1. En login, click "Olvidé mi contraseña"
2. Formulario con campo: DNI
3. Sistema busca usuario y verifica que tenga WhatsApp registrado
4. Genera token de reset (random, expira en 30 min)
5. Envía mensaje al WhatsApp del usuario:
   ```
   Hola Juan, recibimos un pedido de cambio de contraseña.
   Si fuiste vos, hacé click acá: https://prodeplus.com/reset?token=abc123
   El link expira en 30 minutos.
   Si no fuiste vos, ignorá este mensaje.
   ```
6. Usuario abre link → formulario de nueva contraseña
7. Confirma → contraseña actualizada → redirect a login

### Casos de error

- DNI no existe: mostrar mensaje genérico ("Si el DNI está registrado, recibirás un mensaje") para no revelar info
- Usuario sin WhatsApp registrado: pedir que contacte al admin del club
- Token expirado: pedir que solicite un nuevo reset

---

## Flujo 9 — Notificaciones por WhatsApp

Usaremos whatsapp web js asique no abusaremos de los mensajes, por ej no podemos mandarle a todos masivamente para que no nos bloqueen. Por eso solo mandaremos mensajes en momentos clave.

Tipos:

### Notificación de inscripción confirmada
> ✅ ¡Listo Juan! Tu pago fue confirmado. Ya podés cargar tus pronósticos en https://prodeplus.com

### Recordatorio de cierre de pronósticos
> ⏰ Faltan 2 horas para Argentina vs Brasil y todavía no cargaste tu pronóstico. Cargalo en https://prodeplus.com

### Resultado y puntos
> 🎯 Sumaste 5 pts en Argentina 3-2 Brasil (resultado exacto x1 grupos). Estás en la posición #8 con 142 pts.

### Cierre de fase y ganador
> 🏆 ¡Felicitaciones! Ganaste el premio de la Fase de Grupos con 47 pts. Te contactaremos para coordinar el premio.

### Resumen periódico
> 📊 Resumen de la semana: 12 pts ganados, subiste 4 puestos al #15. Próximo partido: Italia vs Alemania mañana 18hs.

---

## Flujo 10 — Cierre del Mundial y entrega de premios

1. Final del Mundial (19 de julio)
2. Admin carga resultado de la final
3. Sistema:
   - Calcula puntos finales del partido
   - Evalúa predicciones especiales (campeón, subcampeón, tercero, goleador, total goles)
   - Calcula tabla general final
   - Determina top 3 absoluto
   - Verifica ganadores de cada fase
4. Admin revisa y confirma
5. Notificaciones masivas a ganadores
6. Página pública con resultados finales
7. Coordinación manual de entrega de premios (transferencia bancaria, encuentro en el club, etc.)
8. Una vez entregados, admin marca cada premio como `paid` en el sistema

---

## Estados del usuario (resumen)

```
NO_REGISTRADO → REGISTRADO → PAGO_PENDIENTE → PAGADO_ACTIVO
                                ↓                  ↓
                            (puede cargar pero    (todo desbloqueado)
                             no se cuentan los
                             puntos hasta pagar)
```

**Decisión a tomar**: ¿Permitimos cargar predicciones antes de pagar?

**Opción A** (estricta): solo pagados pueden cargar.
- Pro: simple, claro
- Contra: usuario puede olvidarse y perder cierres

**Opción B** (permisiva): pueden cargar pero sus puntos no se cuentan hasta pagar.
- Pro: el usuario no pierde tiempo y se "engancha"
- Contra: si nunca paga, hay datos basura; si paga tarde, ¿le contamos los puntos retroactivos?

**Recomendación**: Opción A con un grace period suave: usuarios con pago pendiente pueden cargar, pero el sistema les muestra un banner permanente "Tu pago está pendiente, regularizalo para que tus pronósticos cuenten". Si pagan después, todas las predicciones cargadas pasan a ser válidas. Si el primer partido del Mundial empieza y siguen sin pagar, sus predicciones se eliminan automáticamente.
