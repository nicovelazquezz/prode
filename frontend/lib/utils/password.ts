/**
 * Generador de password "facil de pasar por WhatsApp" (spec §6.11).
 *
 * Algoritmo: 4 letras random + 4 numeros random, shuffleados.
 * Letras restringidas a un alphabet sin caracteres ambiguos
 * (sin l, I, 1, O, 0) para que sean dictables sin errores.
 */
const LETTERS = "abcdefghjkmnpqrstuvwxyz";
const NUMBERS = "23456789";

function pickRandom(charset: string, count: number): string {
  const cryptoApi =
    typeof globalThis !== "undefined" &&
    "crypto" in globalThis &&
    typeof globalThis.crypto?.getRandomValues === "function"
      ? globalThis.crypto
      : null;
  let result = "";
  if (cryptoApi) {
    const buf = new Uint32Array(count);
    cryptoApi.getRandomValues(buf);
    for (let i = 0; i < count; i++) {
      const idx = buf[i]! % charset.length;
      result += charset.charAt(idx);
    }
    return result;
  }
  // Fallback (no crypto disponible — improbable en browsers modernos).
  for (let i = 0; i < count; i++) {
    result += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return result;
}

function shuffle(input: string): string {
  const arr = input.split("");
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr.join("");
}

export function generatePassword(): string {
  return shuffle(pickRandom(LETTERS, 4) + pickRandom(NUMBERS, 4));
}

/**
 * Copia un string al clipboard. Usa `navigator.clipboard.writeText`
 * si esta disponible; fallback a `document.execCommand("copy")`
 * para browsers antiguos. Devuelve true si hubo exito.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // continua al fallback
    }
  }
  if (typeof document === "undefined") return false;
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "absolute";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
