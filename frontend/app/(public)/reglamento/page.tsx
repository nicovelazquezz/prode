import Link from "next/link";

const PRECIO = Number(process.env.NEXT_PUBLIC_INSCRIPCION_PRECIO ?? 10000);
const ADMIN_WHATSAPP = process.env.NEXT_PUBLIC_ADMIN_WHATSAPP ?? "";

function formatARS(value: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value);
}

function buildAdminWhatsApp(): string {
  const text = encodeURIComponent("Hola! Tengo una consulta sobre el reglamento del Prode 2026.");
  const num = ADMIN_WHATSAPP.replace(/\D/g, "");
  return num ? `https://wa.me/${num}?text=${text}` : `https://wa.me/?text=${text}`;
}

/**
 * Página estática /reglamento. Server Component puro — sin estado.
 * Contenido derivado del scoring + premios + fechas clave del Mundial 2026.
 */
export default function ReglamentoPage() {
  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-12 md:py-20">
      <header className="mb-10 md:mb-14">
        <div className="mb-2 font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.22em] text-[var(--color-landing-text-muted)]">
          Las reglas del juego
        </div>
        <h1 className="font-[family-name:var(--font-landing-display)] text-5xl uppercase leading-[0.85] tracking-tight md:text-7xl">
          <span className="inline-block border-b-[6px] border-[var(--color-landing-green)] pb-1">
            Reglamento.
          </span>
        </h1>
        <p className="mt-4 text-base leading-relaxed text-[var(--color-landing-text-muted)] md:text-lg">
          Prode Mundial 2026 · Club Tiro Federal de Bahía Blanca
        </p>
      </header>

      <Section title="1. Inscripción y participación">
        <p>
          La inscripción al Prode tiene un valor único de{" "}
          <strong>{formatARS(PRECIO)}</strong>, abonable por MercadoPago,
          transferencia bancaria o efectivo (en este último caso
          coordinando con el admin del Prode). El pago habilita al
          participante a cargar predicciones para los 104 partidos del
          Mundial 2026 y para las predicciones especiales.
        </p>
        <p>
          Solo pueden participar mayores de 18 años. Una persona puede
          tener una única inscripción (un DNI = una cuenta). El Prode no
          es un juego de azar: requiere conocimiento futbolero y análisis.
        </p>
      </Section>

      <Section title="2. Sistema de puntos por partido">
        <p>
          Para cada partido predicho, el participante suma puntos según el
          tipo de acierto. La <strong>base</strong> de puntos es la
          siguiente:
        </p>
        <ul>
          <li>
            <strong>Resultado exacto (5 pts)</strong>: acierta el marcador
            final tal cual.
          </li>
          <li>
            <strong>Ganador y diferencia (3 pts)</strong>: acierta quién
            gana y por cuántos goles, pero con marcador distinto.
          </li>
          <li>
            <strong>Empate distinto (2 pts)</strong>: predijo empate, se
            cumple el empate, pero con cantidad de goles distinta.
          </li>
          <li>
            <strong>Solo ganador (1 pt)</strong>: acierta quién gana, con
            diferencia distinta.
          </li>
          <li>
            <strong>Sin acierto (0 pts)</strong>: no acertó ni el resultado
            ni el ganador.
          </li>
        </ul>
      </Section>

      <Section title="3. Multiplicadores por fase">
        <p>
          Los puntos base se multiplican según la fase del partido, para
          premiar las predicciones en instancias eliminatorias:
        </p>
        <ul>
          <li>Fase de grupos: x1</li>
          <li>32avos: x1.5</li>
          <li>Octavos de final: x2</li>
          <li>Cuartos de final: x3</li>
          <li>Semifinales / Tercer puesto: x4</li>
          <li>Final: x5</li>
        </ul>
        <p>
          Así un acierto exacto en la final vale 25 pts (5 base x 5
          multiplicador), mientras que el mismo acierto en grupos vale 5
          pts.
        </p>
        <p>
          <strong>Importante:</strong> en los partidos de fase eliminatoria,
          el puntaje se calcula sobre el resultado de los 90 minutos.
          Penales y tiempo extra no se consideran para puntuar — solo
          definen quién avanza en el cuadro.
        </p>
      </Section>

      <Section title="4. Predicciones especiales">
        <p>
          Antes del inicio del Mundial, cada participante define sus
          predicciones especiales: campeón, subcampeón, tercer puesto,
          goleador del torneo y total de goles del Mundial. Una vez
          confirmadas, no se pueden modificar.
        </p>
        <ul>
          <li>Campeón del Mundial: <strong>25 pts</strong></li>
          <li>Subcampeón: <strong>12 pts</strong></li>
          <li>Tercer puesto: <strong>8 pts</strong></li>
          <li>Goleador del torneo: <strong>15 pts</strong></li>
          <li>Total de goles exacto: <strong>10 pts</strong></li>
          <li>Total de goles ±5: <strong>5 pts</strong></li>
        </ul>
        <p>
          <strong>Empate de goleador:</strong> si dos o más jugadores
          terminan el torneo con la misma cantidad de goles, todos son
          considerados goleadores válidos. Cualquier participante que
          haya pickeado a alguno de ellos cobra los puntos del goleador.
        </p>
      </Section>

      <Section title="5. Distribución del pozo">
        <p>
          El 100% de las inscripciones forma el pozo. La distribución
          tentativa es:
        </p>
        <ul>
          <li>1ro de la tabla general: 40%</li>
          <li>2do de la tabla general: 20%</li>
          <li>3ro de la tabla general: 10%</li>
          <li>
            Mejor de cada fase (grupos, octavos, cuartos, semis, final):
            25% repartido entre los ganadores de fase
          </li>
          <li>Premios especiales (campeón, goleador, total goles): 5%</li>
        </ul>
        <p>
          La distribución final se confirma desde el panel admin antes
          del kickoff y se publica acá con los porcentajes definitivos.
        </p>
      </Section>

      <Section title="6. Fechas clave">
        <ul>
          <li><strong>Inicio del Mundial:</strong> jueves 11/06/2026</li>
          <li>
            <strong>Cierre de predicciones especiales:</strong> hasta el
            kickoff del partido inaugural (11/06/2026, 18:00 ART)
          </li>
          <li>
            <strong>Cierre por partido:</strong> cada predicción se cierra
            exactamente al kickoff del partido. Predicciones cargadas
            después no son aceptadas.
          </li>
          <li><strong>Final:</strong> domingo 19/07/2026</li>
          <li>
            <strong>Pago de premios:</strong> dentro de las 72 horas
            posteriores a la final
          </li>
        </ul>
      </Section>

      <Section title="7. Reglas de juego limpio">
        <ul>
          <li>
            Una sola cuenta por persona. Detectar más de una cuenta
            asociada al mismo DNI implica desclasificación sin reembolso.
          </li>
          <li>
            Las predicciones quedan registradas con marca de tiempo. No se
            aceptan reclamos por errores tipográficos después del cierre
            del partido.
          </li>
          <li>
            En caso de partidos suspendidos / cancelados por FIFA, el
            admin define el criterio de cierre (anular el partido o
            mantenerlo) y lo notifica antes de aplicarlo.
          </li>
          <li>
            La administración se reserva el derecho de ajustar el
            reglamento por razones de fuerza mayor; cualquier cambio se
            comunica por el canal oficial de WhatsApp del Prode.
          </li>
        </ul>
      </Section>

      <Section title="8. Contacto">
        <p>
          Para consultas, dudas o problemas con el pago / acceso,
          escribinos por WhatsApp:
        </p>
        <a
          href={buildAdminWhatsApp()}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block rounded-sm bg-[var(--color-landing-red)] px-8 py-[18px] text-xs font-extrabold uppercase tracking-[0.12em] text-[var(--color-landing-text)] transition-colors hover:bg-[var(--color-landing-red-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-landing-gold)]"
        >
          Escribir al admin
        </a>
      </Section>

      <footer className="mt-12 flex items-center justify-between border-t border-[var(--color-landing-line)] pt-6">
        <Link
          href="/"
          className="font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.1em] text-[var(--color-landing-text-muted)] underline-offset-4 transition-colors hover:text-[var(--color-landing-text)] hover:underline"
        >
          ← Volver al inicio
        </Link>
        <Link
          href="/login"
          className="font-[family-name:var(--font-landing-mono)] text-[11px] uppercase tracking-[0.1em] text-[var(--color-landing-text)] underline-offset-4 hover:underline"
        >
          Ingresar →
        </Link>
      </footer>
    </article>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10 md:mb-14">
      <h2 className="mb-4 font-[family-name:var(--font-landing-display)] text-2xl uppercase tracking-tight md:text-3xl">
        {title}
      </h2>
      <div className="space-y-3 text-sm leading-relaxed text-[var(--color-landing-text)] md:text-base [&_strong]:text-[var(--color-landing-gold)] [&_strong]:font-semibold [&_ul]:ml-5 [&_ul]:list-disc [&_ul]:space-y-1.5">
        {children}
      </div>
    </section>
  );
}
