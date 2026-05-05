import Link from "next/link";
import { cn } from "@/lib/utils/cn";

const PRECIO = Number(process.env.NEXT_PUBLIC_INSCRIPCION_PRECIO ?? 15000);
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
 * Pagina estatica /reglamento. Server Component puro — sin estado.
 * Contenido derivado de la spec del backend (scoring rules,
 * multipliers, premios especiales) y de la spec del frontend
 * (precio inscripcion, distribucion del pozo, fechas clave).
 *
 * Cuando el cliente confirme cifras finales, ajustar los numeros
 * que apliquen (precio, montos del pozo, % distribucion).
 */
export default function ReglamentoPage() {
  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-10 md:py-16">
      <header className="mb-10 md:mb-14">
        <h1 className="font-display text-5xl md:text-7xl font-black uppercase tracking-tight text-[var(--color-prode-near-black)]">
          Reglamento
        </h1>
        <p className="mt-3 font-sans text-base md:text-lg text-[var(--color-prode-text-secondary)]">
          Prode Mundial 2026 — Club Tiro Federal de Bahia Blanca
        </p>
      </header>

      <Section title="1. Inscripcion y participacion">
        <p>
          La inscripcion al Prode tiene un valor unico de{" "}
          <strong>{formatARS(PRECIO)}</strong>, abonable por
          MercadoPago, transferencia bancaria o efectivo (en este ultimo
          caso coordinando con el admin del Prode). El pago habilita
          al participante a cargar predicciones para los 104 partidos
          del Mundial 2026 y para las predicciones especiales.
        </p>
        <p>
          Solo pueden participar mayores de 18 anos. Una persona puede
          tener una unica inscripcion (un DNI = una cuenta). El Prode no
          es un juego de azar: requiere conocimiento futbolero y
          analisis.
        </p>
      </Section>

      <Section title="2. Sistema de puntos por partido">
        <p>
          Para cada partido predicho, el participante suma puntos
          segun el tipo de acierto. La <strong>base</strong> de puntos
          es la siguiente:
        </p>
        <ul className="mt-2 ml-5 list-disc space-y-1.5">
          <li>
            <strong>Resultado exacto (5 pts)</strong>: acierta el
            marcador final tal cual.
          </li>
          <li>
            <strong>Ganador y diferencia (3 pts)</strong>: acierta
            quien gana y por cuantos goles, pero con marcador distinto.
          </li>
          <li>
            <strong>Empate distinto (2 pts)</strong>: predijo empate, se
            cumple el empate, pero con cantidad de goles distinta.
          </li>
          <li>
            <strong>Solo ganador (1 pt)</strong>: acierta quien gana,
            con diferencia distinta.
          </li>
          <li>
            <strong>Sin acierto (0 pts)</strong>: no acerto ni el
            resultado ni el ganador.
          </li>
        </ul>
      </Section>

      <Section title="3. Multiplicadores por fase">
        <p>
          Los puntos base se multiplican segun la fase del partido,
          para premiar las predicciones en instancias eliminatorias:
        </p>
        <ul className="mt-2 ml-5 list-disc space-y-1.5">
          <li>Fase de grupos: x1</li>
          <li>32avos: x1.5</li>
          <li>Octavos de final: x2</li>
          <li>Cuartos de final: x3</li>
          <li>Semifinales / Tercer puesto: x4</li>
          <li>Final: x5</li>
        </ul>
        <p>
          Asi un acierto exacto en la final vale 25 pts (5 base x 5
          multiplicador), mientras que el mismo acierto en grupos vale
          5 pts.
        </p>
      </Section>

      <Section title="4. Predicciones especiales">
        <p>
          Antes del inicio del Mundial, cada participante define sus
          predicciones especiales: campeon, subcampeon, tercer puesto,
          goleador del torneo y total de goles del Mundial. Una vez
          confirmadas, no se pueden modificar.
        </p>
        <ul className="mt-2 ml-5 list-disc space-y-1.5">
          <li>Campeon del Mundial: <strong>25 pts</strong></li>
          <li>Subcampeon: <strong>12 pts</strong></li>
          <li>Tercer puesto: <strong>8 pts</strong></li>
          <li>Goleador del torneo: <strong>15 pts</strong></li>
          <li>Total de goles exacto: <strong>10 pts</strong></li>
          <li>Total de goles ±5: <strong>5 pts</strong></li>
        </ul>
      </Section>

      <Section title="5. Distribucion del pozo">
        <p>
          El 100% de las inscripciones forma el pozo. La distribucion
          tentativa es:
        </p>
        <ul className="mt-2 ml-5 list-disc space-y-1.5">
          <li>1ro de la tabla general: 40%</li>
          <li>2do de la tabla general: 20%</li>
          <li>3ro de la tabla general: 10%</li>
          <li>
            Mejor de cada fase (grupos, octavos, cuartos, semis, final):
            25% repartido entre los ganadores de fase
          </li>
          <li>
            Premios especiales (campeon, goleador, total goles): 5%
          </li>
        </ul>
        <p>
          La distribucion final se confirma desde el panel admin antes
          del kickoff y se publica aca con los porcentajes definitivos.
        </p>
      </Section>

      <Section title="6. Fechas clave">
        <ul className="mt-2 ml-5 list-disc space-y-1.5">
          <li>
            <strong>Inicio del Mundial:</strong> jueves 11/06/2026
          </li>
          <li>
            <strong>Cierre de predicciones especiales:</strong> hasta el
            kickoff del partido inaugural (11/06/2026, 18:00 ART)
          </li>
          <li>
            <strong>Cierre por partido:</strong> cada prediccion se
            cierra exactamente al kickoff del partido. Predicciones
            cargadas despues no son aceptadas.
          </li>
          <li>
            <strong>Final:</strong> domingo 19/07/2026
          </li>
          <li>
            <strong>Pago de premios:</strong> dentro de las 72 horas
            posteriores a la final
          </li>
        </ul>
      </Section>

      <Section title="7. Reglas de juego limpio">
        <ul className="mt-2 ml-5 list-disc space-y-1.5">
          <li>
            Una sola cuenta por persona. Detectar mas de una cuenta
            asociada al mismo DNI implica desclasificacion sin
            reembolso.
          </li>
          <li>
            Las predicciones quedan registradas con marca de tiempo.
            No se aceptan reclamos por errores tipograficos despues del
            cierre del partido.
          </li>
          <li>
            En caso de partidos suspendidos / cancelados por FIFA, el
            admin define el criterio de cierre (anular el partido o
            mantenerlo) y lo notifica antes de aplicarlo.
          </li>
          <li>
            La administracion se reserva el derecho de ajustar el
            reglamento por razones de fuerza mayor; cualquier cambio
            se comunica por el canal oficial de WhatsApp del Prode.
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
          className={cn(
            "mt-3 inline-flex h-12 items-center justify-center rounded-2xl px-8",
            "bg-[var(--color-prode-near-black)] text-white text-sm font-medium font-sans",
            "hover:opacity-90",
          )}
        >
          Escribir al admin
        </a>
      </Section>

      <footer className="mt-12 border-t border-[var(--color-prode-border)] pt-6 flex items-center justify-between">
        <Link
          href="/"
          className="font-sans text-sm text-[var(--color-prode-text-secondary)] hover:text-[var(--color-prode-near-black)]"
        >
          ← Volver al inicio
        </Link>
        <Link
          href="/login"
          className="font-sans text-sm font-medium text-[var(--color-prode-near-black)] underline-offset-4 hover:underline"
        >
          Ingresar
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
    <section className="mb-8 md:mb-12">
      <h2 className="font-display text-2xl md:text-3xl font-black uppercase tracking-wide text-[var(--color-prode-near-black)] mb-3">
        {title}
      </h2>
      <div className="font-sans text-sm md:text-base leading-relaxed text-[var(--color-prode-text-secondary)] space-y-3">
        {children}
      </div>
    </section>
  );
}
