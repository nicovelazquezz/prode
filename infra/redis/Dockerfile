# Redis para prode — Application standalone en Dokploy.
#
# Se montea como Application separada (no como Database estándar de
# Dokploy) porque la UI estándar no permite setear los args del comando
# que necesitamos para producción.
#
# Args críticos:
#   --maxmemory 512mb           tope de memoria; cuando llega, evicta
#   --maxmemory-policy allkeys-lru  evicta keys menos recientes (cache + queue)
#   --appendonly yes            AOF activado para persistencia de jobs
#   --appendfsync everysec      balance perf/durabilidad
#
# Volumen persistente: montar /data en Dokploy para sobrevivir restarts.
# Puerto interno: 6379.

FROM redis:7-alpine
CMD ["redis-server", \
     "--maxmemory", "512mb", \
     "--maxmemory-policy", "allkeys-lru", \
     "--appendonly", "yes", \
     "--appendfsync", "everysec"]
