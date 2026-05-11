/**
 * Convierte el `fullName` que devuelve el backend (formato flashscore:
 * "Apellido Nombre", ej "Messi Lionel") al formato más natural en
 * español "Nombre Apellido" (ej "Lionel Messi").
 *
 * Heurística: el ÚLTIMO token es el nombre, todo lo anterior es el
 * apellido (puede ser compuesto). Casos:
 *
 *   "Messi Lionel"             → "Lionel Messi"
 *   "Romero Cristian"          → "Cristian Romero"
 *   "Martinez Quarta Lisandro" → "Lisandro Martinez Quarta"  (apellido compuesto)
 *   "Pelé"                     → "Pelé"                       (un solo token)
 *
 * Si recibe vacío o inválido, devuelve el string original.
 */
export function formatPlayerName(fullName: string | null | undefined): string {
  if (!fullName) return "";
  const tokens = fullName.trim().split(/\s+/);
  if (tokens.length <= 1) return fullName.trim();
  const given = tokens[tokens.length - 1];
  const surname = tokens.slice(0, -1).join(" ");
  return `${given} ${surname}`;
}
