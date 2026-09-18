"""
WebSocket connection manager.
Broadcasts live incident events to all connected dashboard clients.
"""
from typing import List
from fastapi import WebSocket
import json, logging

logger = logging.getLogger("ws_manager")


class ConnectionManager:
    def __init__(self):
        self.active: List[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)
        logger.info(f"WS connected. Total: {len(self.active)}")

    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)
        logger.info(f"WS disconnected. Total: {len(self.active)}")

    async def broadcast(self, event: str, payload: dict):
        message = json.dumps({"event": event, "data": payload})
        dead = []
        for ws in self.active:
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

    async def send_personal(self, ws: WebSocket, event: str, payload: dict):
        try:
            await ws.send_text(json.dumps({"event": event, "data": payload}))
        except Exception:
            self.disconnect(ws)


manager = ConnectionManager()
