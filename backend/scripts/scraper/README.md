# Scraper Mundial 2026 (flashscore → Prisma seeds)

Script one-shot que scrapea fixture, selecciones y plantillas del Mundial 2026
desde `flashscore.com.ar` y escribe los JSON que consumen los seeds de Prisma.

## Setup

```bash
cd backend/scripts/scraper
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
scrapling install --force   # descarga browsers de Playwright para StealthyFetcher
```

## Uso

```bash
# Dry-run: imprime diff vs JSON existente, no escribe nada
python scrape.py --target all --dry-run

# Ejecutar: pisa prisma/data/{matches,teams,players}.json
python scrape.py --target all

# Por target individual
python scrape.py --target matches
python scrape.py --target teams
python scrape.py --target players

# Forzar refetch (ignorar .cache/)
python scrape.py --target all --no-cache
```

Después correr los seeds en orden:

```bash
cd ../..
npx tsx prisma/seed-teams.ts
npx tsx prisma/seed-matches.ts
npx tsx prisma/seed-players.ts
```

## Caveats

- **Cache de 12h:** HTML cacheado en `.cache/` (gitignored). Usar `--no-cache`
  si flashscore actualizó algo.
- **Mapeo ES→FIFA en `lib/normalize.py`:** si flashscore muestra una selección
  cuyo nombre en español no está en el dict, el script falla con `KeyError`.
  Agregar el mapeo y re-correr.
- **Bracket no resuelto:** si flashscore aún muestra "Ganador R32 1" en
  cuartos, el JSON conserva ese placeholder. No se inventa rival.
- **Venue/city/country:** NO se sobreescriben. Vienen de
  `prisma/data/generate-matches.mjs` y se mergean por `matchNumber`.
- **Validación bloqueante:** si el parser devuelve <104 matches o <48 teams,
  el script aborta antes de escribir. El JSON viejo queda intacto.
