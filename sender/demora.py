"""Demora antes de contestar: el agente espera entre RESP_DEMORA_MIN y RESP_DEMORA_MAX minutos desde el último mensaje
del cliente (como una persona que no está pegada al celular). Si el cliente vuelve a escribir, la cuenta arranca de nuevo,
así contesta todo junto cuando terminó de escribir. Los chats que ya esperaron más que eso se contestan enseguida.
RESP_DEMORA_MIN=0 y RESP_DEMORA_MAX=0 en el .env la apagan."""
import random


class Demora:
    def __init__(self, minimo_min=5.0, maximo_min=10.0, azar=random.uniform):
        self.minimo, self.maximo = max(0.0, minimo_min), max(0.0, maximo_min, minimo_min)
        self.azar, self._seg = azar, {}

    def segundos(self, it):
        """Demora sorteada para este mensaje del cliente (siempre la misma mientras no escriba de nuevo)."""
        k = f"{it['conv']}:{it.get('ult_cliente_ts') or 0}"
        if k not in self._seg:
            self._seg[k] = self.azar(self.minimo, self.maximo) * 60
            if len(self._seg) > 2000: self._seg = dict(list(self._seg.items())[-1000:])
        return self._seg[k]

    def separar(self, lista, ahora_ms):
        """Devuelve (los que ya se pueden contestar, cuántos siguen esperando, segundos hasta el próximo)."""
        listos, faltan = [], []
        for it in lista:
            falta = self.segundos(it) - (ahora_ms - (it.get("ult_cliente_ts") or 0)) / 1000
            if falta > 0: faltan.append(falta)
            else: listos.append(it)
        return listos, len(faltan), (min(faltan) if faltan else 0)
