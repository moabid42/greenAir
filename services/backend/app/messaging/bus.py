"""Pluggable outbox destination. Delivery is at-least-once with stable event IDs."""

from dataclasses import dataclass
from typing import Any, Protocol


@dataclass(frozen=True)
class Event:
    event_id: str
    topic: str
    payload: dict[str, Any]


class Bus(Protocol):
    def publish(self, event: Event) -> None: ...


class MemoryBus:
    """Test destination that models consumer deduplication by durable event ID."""

    def __init__(self):
        self.events: dict[str, Event] = {}

    def publish(self, event: Event) -> None:
        self.events.setdefault(event.event_id, event)
