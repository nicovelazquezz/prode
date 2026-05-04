# 02 — Sistema de Puntos y Premios

## Estructura del Mundial 2026

## TODOS LOS SISTEMAS DE PUNTOS DEBEN SER FLEXIBLES PARA PODER CAMBIARLOS FACILMENTE DESDE EL ADMIN PERO YA ESTARAN POR DEFECTO COMO EN ESTE .MD

El formato es nuevo respecto a Mundiales anteriores. Tiene **una fase eliminatoria adicional** (16avos / Round of 32):

| Fase | Partidos | Fechas |
|------|----------|--------|
| Fase de Grupos | 72 | 11 al 26 de junio |
| 16avos de Final (Round of 32) | 16 | 28 de junio al 3 de julio |
| Octavos de Final | 8 | 4 al 7 de julio |
| Cuartos de Final | 4 | 9 al 10 de julio |
| Semifinales | 2 | 14 y 15 de julio |
| Tercer Puesto | 1 | 18 de julio |
| Final | 1 | 19 de julio |
| **Total** | **104** | |

**Nota importante**: el Mundial 2026 introduce los 16avos, que no existían en formatos anteriores. Esta fase está incluida en el sistema de puntuación.

## Sistema de puntos por partido

Cada predicción de partido se evalúa contra el resultado final (90 minutos + tiempo extra si lo hubiera, **antes** de penales — los penales no cuentan para el resultado del Prode).

### Puntos base

| Tipo de acierto | Puntos base |
|-----------------|-------------|
| Resultado exacto (ej: predijo 2-1 y fue 2-1) | **5 pts** |
| Ganador correcto + diferencia exacta de gol (ej: predijo 2-1 y fue 3-2) | **3 pts** |
| Ganador correcto sin diferencia exacta (ej: predijo 2-1 y fue 4-1) | **1 pt** |
| Empate acertado pero marcador distinto (ej: predijo 1-1 y fue 2-2) | **2 pts** |
| Sin acierto | **0 pts** |

### Multiplicador por fase

Los puntos base se multiplican según la fase:

| Fase | Multiplicador |
|------|---------------|
| Fase de Grupos | x1 |
| 16avos de Final | x1.5 |
| Octavos de Final | x2 |
| Cuartos de Final | x3 |
| Semifinales | x4 |
| Tercer Puesto | x4 |
| Final | x5 |

**Ejemplo**: si un usuario acierta el resultado exacto de la final, gana 5 × 5 = **25 puntos**.

### Casos especiales

- **Si no carga predicción**: 0 puntos para ese partido
- **Si carga después del cierre** (no debería pasar por validación, pero por las dudas): 0 puntos
- **Si el resultado se modifica oficialmente post-partido** (ej: por sanción FIFA): admin recalcula manualmente

## Predicciones especiales

Se cargan **una sola vez antes del 11 de junio** (kickoff del Mundial) y se evalúan al final del torneo.

| Predicción | Puntos si acierta |
|------------|-------------------|
| Campeón | 25 pts |
| Subcampeón | 12 pts |
| Tercer puesto | 8 pts |
| Goleador del torneo | 15 pts |
| Total de goles del Mundial (exacto) | 10 pts |
| Total de goles del Mundial (±5) | 5 pts |

**Total máximo posible en especiales**: 70 pts si acierta todo.

### Notas sobre predicciones especiales

- **Goleador**: se considera el máximo goleador oficial según FIFA. En caso de empate, gana el de menos partidos jugados (criterio FIFA estándar).
- **Total de goles**: cuenta solo los 90 min + tiempo extra. Penales no suman.
- **Campeón / subcampeón / tercero**: deben ser tres selecciones diferentes (validación en frontend y backend).

## Cálculo del puntaje total

```
Puntaje_Total_Usuario = 
    Σ (Puntos_Base_Partido × Multiplicador_Fase)  
    + Puntos_Predicciones_Especiales
```

Este es el puntaje que aparece en la tabla general final.

Para los premios por fase, se considera solo:
```
Puntaje_Fase = Σ (Puntos_Base_Partido × Multiplicador_Fase)  para los partidos de esa fase
```

## Premios

### Estructura de premios

| Premio | Cálculo |
|--------|---------|
| 🥇 Mejor de Fase de Grupos | Más puntos sumados en los 72 partidos de grupos |
| 🥇 Mejor de 16avos | Más puntos sumados en los 16 partidos de 16avos |
| 🥇 Mejor de Octavos | Más puntos sumados en los 8 partidos de octavos |
| 🥇 Mejor de Cuartos | Más puntos sumados en los 4 partidos de cuartos |
| 🥇 Mejor de Semis | Más puntos sumados en los 2 partidos de semis |
| 🥇 Mejor de la Final | Más puntos en final + tercer puesto |
| 🏆 **1er puesto general** | Mayor puntaje total acumulado al cierre |
| 🥈 **2do puesto general** | Segundo mayor puntaje total |
| 🥉 **3er puesto general** | Tercer mayor puntaje total |

**Nota importante**: los puntos ganados en cada fase también suman para la tabla general. Un mismo usuario puede llevarse varios premios.

### Desempates

En caso de empate de puntos (tanto en premios por fase como en la general), aplican estos criterios en orden:

1. Mayor cantidad de resultados exactos acertados
2. Mayor cantidad de ganadores acertados
3. Predicción de campeón correcta
4. Sorteo público (si llega hasta acá, hacer un live por Instagram del club)

## Distribución del pozo

### Configuración base sugerida

Sobre el total recaudado, se distribuye así:

| Concepto | Porcentaje | Notas |
|----------|------------|-------|
| **Premios generales** (top 3) | 45% | 25% / 12% / 8% |
| **Premios por fase** (6 premios) | 30% | 5% cada uno |
| **Para el club** (Tiro Federal) | 20% | Objetivo principal del Prode |
| **Reserva operativa** | 5% | MercadoPago fees (~3%), gastos varios |

### Variantes posibles

Esta distribución es ajustable. Algunas alternativas:

**Más para el club** (recaudación máxima):
- Premios: 50% (35% top 3 + 15% por fase)
- Club: 45%
- Reserva: 5%

**Más para los participantes** (más atractivo):
- Premios: 80% (50% top 3 + 30% por fase)
- Club: 15%
- Reserva: 5%

**Equilibrado** (sugerido):
- Premios: 75% (45% + 30%)
- Club: 20%
- Reserva: 5%

### Comisiones de MercadoPago

MercadoPago Argentina cobra aproximadamente:
- **Checkout Pro**: 4.99% + IVA = ~6.04% del valor de la transacción
- **Acreditación inmediata**: incluida en ese costo
- **Acreditación en 14 días**: ~3.49% (más barato pero el dinero tarda)

Para 100 inscripciones de $5.000 = $500.000 brutos, con acreditación inmediata las fees rondan los $30.000. Si el club acepta esperar 14 días, se ahorran ~$12.500.

**Recomendación**: configurar acreditación a 14 días dado que los premios se entregan al final del Mundial (40+ días después del primer pago).

## Simulador de recaudación

Esta tabla muestra escenarios completos asumiendo:
- Distribución equilibrada (45% top 3 / 30% por fase / 20% club / 5% reserva)
- Comisión MP acreditación 14 días: 3.49%
- 70% de pagos por MP, 30% manual (sin comisión)

| Inscripciones | Precio | Bruto | Fees MP (70%) | Neto | Top 3 (45%) | 1er puesto (25%) | Por fase × 6 (5% c/u) | **Para el club (20%)** |
|---------------|--------|-------|---------------|------|-------------|------------------|----------------------|------------------------|
| 50 | $3.000 | $150.000 | $3.665 | $146.335 | $65.851 | $36.584 | $7.317 | **$29.267** |
| 50 | $5.000 | $250.000 | $6.108 | $243.892 | $109.751 | $60.973 | $12.195 | **$48.778** |
| 100 | $3.000 | $300.000 | $7.329 | $292.671 | $131.702 | $73.168 | $14.634 | **$58.534** |
| 100 | $5.000 | $500.000 | $12.215 | $487.785 | $219.503 | $121.946 | $24.389 | **$97.557** |
| 100 | $8.000 | $800.000 | $19.544 | $780.456 | $351.205 | $195.114 | $39.023 | **$156.091** |
| 200 | $5.000 | $1.000.000 | $24.430 | $975.570 | $439.007 | $243.893 | $48.779 | **$195.114** |
| 200 | $8.000 | $1.600.000 | $39.088 | $1.560.912 | $702.410 | $390.228 | $78.046 | **$312.182** |
| 300 | $5.000 | $1.500.000 | $36.645 | $1.463.355 | $658.510 | $365.839 | $73.168 | **$292.671** |
| 500 | $5.000 | $2.500.000 | $61.075 | $2.438.925 | $1.097.516 | $609.731 | $121.946 | **$487.785** |

### Cómo leer la tabla

- **Bruto**: Inscripciones × Precio
- **Fees MP (70%)**: comisión solo sobre el 70% que pagó por MP, calculado al 3.49%
- **Neto**: lo que queda para repartir
- **Top 3 (45%)**: pozo total para los tres primeros (reparto interno: 25/12/8)
- **1er puesto**: lo que se lleva el ganador absoluto (25% del neto)
- **Por fase**: cada uno de los 6 ganadores de fase se lleva 5%
- **Para el club**: la recaudación neta para Tiro Federal

### Recomendación de precio

Para Bahía Blanca y considerando que es para el club:
- **Precio sugerido: $5.000 a $8.000** (a mayo 2026, ajustar según inflación)
- **Meta razonable**: 150-300 inscriptos
- **Recaudación esperada para el club**: $150.000 a $470.000

### Notas finales sobre premios

- Premios pueden ser en efectivo (transferencia) o productos del club (entradas, indumentaria, abono).
- Considerar un premio "extra" no monetario para el ganador absoluto: por ejemplo, una camiseta firmada o entrada a un evento del club.
- Comunicar TODA la estructura de premios desde el día 1 de inscripciones, sin cambios posteriores.
- El reglamento debe estar publicado y aceptado al registrarse.

## Implementación técnica del cálculo

### Servicio de evaluación

```typescript
// services/scoring.service.ts (pseudocódigo)

interface MatchResult {
  scoreHome: number;
  scoreAway: number;
}

interface Prediction {
  scoreHome: number;
  scoreAway: number;
}

const PHASE_MULTIPLIERS = {
  GROUPS: 1,
  ROUND_32: 1.5,
  ROUND_16: 2,
  QUARTERS: 3,
  SEMIS: 4,
  THIRD_PLACE: 4,
  FINAL: 5,
};

function calculatePoints(
  prediction: Prediction,
  result: MatchResult,
  phase: Phase
): number {
  let basePoints = 0;
  
  // Resultado exacto
  if (prediction.scoreHome === result.scoreHome && 
      prediction.scoreAway === result.scoreAway) {
    basePoints = 5;
  }
  // Empate acertado pero marcador distinto
  else if (prediction.scoreHome === prediction.scoreAway && 
           result.scoreHome === result.scoreAway) {
    basePoints = 2;
  }
  else {
    const predDiff = prediction.scoreHome - prediction.scoreAway;
    const resultDiff = result.scoreHome - result.scoreAway;
    
    // Mismo ganador
    if (Math.sign(predDiff) === Math.sign(resultDiff)) {
      // Misma diferencia exacta
      if (predDiff === resultDiff) {
        basePoints = 3;
      } else {
        basePoints = 1;
      }
    }
  }
  
  return basePoints * PHASE_MULTIPLIERS[phase];
}
```

### Cuándo se ejecuta el cálculo

- Cuando el admin marca un partido como `FINISHED` y carga el resultado
- Trigger: recalcular puntos de todas las predicciones de ese partido
- Persistir `points_earned` en cada `Prediction`
- Invalidar cache de leaderboard
- Opcional: recalcular ranking y enviar notificaciones a quienes cambiaron significativamente

### Cuándo se calculan las predicciones especiales

- Al cierre del Mundial (después de la final), un job manual del admin las evalúa todas
- O bien, evaluación incremental: campeón/subcampeón/tercero se sabe el día de la final, goleador y total de goles también
