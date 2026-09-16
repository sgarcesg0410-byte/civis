import os
import json
import asyncio
import time
from typing import Optional, Callable
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(dotenv_path=BASE_DIR / ".env")

REDIS_URL = os.getenv("REDIS_URL", "").strip()

# Caché local en memoria para cuando Redis no esté configurado (desarrollo offline)
_LOCAL_CACHE = {}

# Cliente Redis asíncrono
_redis_async_client = None
_redis_sync_client = None
_is_connected = False
_broadcast_callback: Optional[Callable] = None


def is_redis_active() -> bool:
    return _is_connected


def get_sync_redis():
    """Retorna un cliente Redis síncrono si está disponible."""
    global _redis_sync_client, _is_connected
    if not REDIS_URL:
        return None
    if _redis_sync_client is None:
        try:
            import redis
            _redis_sync_client = redis.Redis.from_url(REDIS_URL, decode_responses=True)
            _redis_sync_client.ping()
            _is_connected = True
        except Exception as e:
            print(f"⚠️ [Civis Redis] No se pudo conectar a Redis síncrono ({e}). Operando en memoria local.")
            _is_connected = False
            _redis_sync_client = None
    return _redis_sync_client


async def get_async_redis():
    """Retorna un cliente Redis asíncrono si está disponible."""
    global _redis_async_client, _is_connected
    if not REDIS_URL:
        return None
    if _redis_async_client is None:
        try:
            import redis.asyncio as aioredis
            _redis_async_client = aioredis.from_url(REDIS_URL, decode_responses=True)
            await _redis_async_client.ping()
            _is_connected = True
            print("⚡ [Civis Redis] Conexión activa a Redis (Pub/Sub & Cache distribuidos).")
        except Exception as e:
            print(f"⚠️ [Civis Redis] No se pudo conectar a Redis asíncrono ({e}). Operando en memoria local.")
            _is_connected = False
            _redis_async_client = None
    return _redis_async_client


# ==============================================================================
# PUB / SUB DISTRIBUIDO PARA WEBSOCKETS
# ==============================================================================
CHANNEL_BROADCAST = "civis:superadmin:broadcast"


async def publicar_evento(evento: dict):
    """
    Publica un evento para todos los Superadministradores.
    Si Redis está activo, lo publica en el canal distribuido para que todas las
    instancias de Railway lo reciban. Si no, lo entrega localmente.
    """
    client = await get_async_redis()
    if client:
        try:
            payload = json.dumps(evento, default=str)
            await client.publish(CHANNEL_BROADCAST, payload)
            return
        except Exception as e:
            print(f"⚠️ [Civis Redis] Error publicando evento ({e}), usando fallback local.")

    # Fallback local: invocar directamente el callback si existe
    if _broadcast_callback:
        await _broadcast_callback(evento)


async def iniciar_escucha_redis(callback_entrega: Callable):
    """
    Inicia una tarea de fondo en FastAPI que escucha los eventos publicados en Redis
    y los entrega a los WebSockets de esta instancia.
    """
    global _broadcast_callback
    _broadcast_callback = callback_entrega

    if not REDIS_URL:
        print("ℹ️ [Civis Redis] REDIS_URL no definida. Operando WebSockets en modo local.")
        return

    client = await get_async_redis()
    if not client:
        return

    async def _listener_loop():
        while True:
            try:
                pubsub = client.pubsub()
                await pubsub.subscribe(CHANNEL_BROADCAST)
                print(f"📡 [Civis Redis] Suscrito a canal distribuido: {CHANNEL_BROADCAST}")
                async for mensaje in pubsub.listen():
                    if mensaje and mensaje.get("type") == "message":
                        try:
                            data = json.loads(mensaje["data"])
                            if _broadcast_callback:
                                await _broadcast_callback(data)
                        except Exception as err:
                            print(f"⚠️ [Civis Redis] Error parseando mensaje ({err})")
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"⚠️ [Civis Redis] Desconexión en listener PubSub ({e}). Reintentando en 3s...")
                await asyncio.sleep(3)

    asyncio.create_task(_listener_loop())


# ==============================================================================
# CACHÉ DE ALTA VELOCIDAD (CENSO RNEC Y CONSULTAS FRECUENTES)
# ==============================================================================
def cache_get(key: str) -> Optional[dict]:
    """Obtiene un valor en caché (Redis o local)."""
    client = get_sync_redis()
    if client:
        try:
            val = client.get(key)
            if val:
                return json.loads(val)
            return None
        except Exception:
            pass

    # Fallback local
    item = _LOCAL_CACHE.get(key)
    if item:
        expira, val = item
        if time.time() < expira:
            return val
        else:
            del _LOCAL_CACHE[key]
    return None


def cache_set(key: str, value: dict, ttl_seconds: int = 3600):
    """Guarda un valor en caché con tiempo de expiración (por defecto 1 hora)."""
    client = get_sync_redis()
    if client:
        try:
            client.setex(key, ttl_seconds, json.dumps(value, default=str))
            return
        except Exception:
            pass

    # Fallback local
    _LOCAL_CACHE[key] = (time.time() + ttl_seconds, value)
