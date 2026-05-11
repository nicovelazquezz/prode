# Redis para prode — Application standalone en Dokploy.
#
# Se montea como Application separada (no como Database estándar de
# Dokploy) porque la UI estándar no permite setear los args del comando
# que necesitamos para producción.
#
# Args críticos:
#   --maxmemory 512mb              tope de memoria
#   --maxmemory-policy noeviction  BullMQ lo exige: si Redis evicta keys
#                                  bajo presión de memoria, puede borrar
#                                  jobs en cola y causar pagos/mensajes
#                                  perdidos silenciosamente. `noeviction`
#                                  rechaza writes nuevos al llegar al
#                                  límite (visible y recuperable) en vez
#                                  de descartar datos críticos. El cache
#                                  de Nest usa TTL explícito en todas las
#                                  entradas, así que no depende de LRU.
#   --appendonly yes               AOF activado para persistencia de jobs
#   --appendfsync everysec         balance perf/durabilidad
#
# Volumen persistente: montar /data en Dokploy para sobrevivir restarts.
# Puerto interno: 6379.

FROM redis:7-alpine
CMD ["redis-server", \
     "--maxmemory", "512mb", \
     "--maxmemory-policy", "noeviction", \
     "--appendonly", "yes", \
     "--appendfsync", "everysec"]
