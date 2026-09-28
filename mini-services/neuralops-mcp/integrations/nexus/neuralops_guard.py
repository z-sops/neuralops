"""NeuralOps guard for NeuralOps Nexus (nexus-ai) — gate every MCP tool call.

Before a persona's tool call reaches a real system (Odoo, a database, email,
payments, a shell), the guard asks the NeuralOps core with the `perform` act:

  * allowed   -> the tool runs, and the call is in the signed ledger
  * pending   -> the tool does NOT run; the model gets a short message naming
                 the approval id and the human who must approve it
  * frozen    -> the tool does NOT run (kill switch / incident mode)
  * core down -> fail closed by default (fail_open=True to let calls through)

Standard library only (urllib), so it drops into nexus-ai without new deps.

pydantic-ai (MCP toolsets / MCP servers accept ``process_tool_call``)::

    from neuralops_guard import NeuralOpsGuard

    guard = NeuralOpsGuard(
        url="http://<host-ip>:3031",          # the core, reachable from the container
        token=persona_neuralops_token,         # one token per persona
        actions={"create_invoice": "odoo.write", "delete_partner": "odoo.delete"},
    )
    toolset = MCPToolset(client, process_tool_call=guard.process_tool_call)   # pydantic-ai 2.x
    # older pydantic-ai: MCPServerStreamableHTTP(url, process_tool_call=guard.process_tool_call)

Plain Python tools::

    @guard.guarded("email.send")
    async def send_email(to: str, subject: str, body: str) -> str: ...

Env defaults: NEURALOPS_URL, NEURALOPS_TOKEN, NEURALOPS_SCOPE (default "production").
"""

from __future__ import annotations

import asyncio
import functools
import inspect
import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Mapping

__all__ = ["NeuralOpsGuard", "Decision", "ToolBlocked"]
__version__ = "0.1.4"


@dataclass(frozen=True)
class Decision:
    allowed: bool
    message: str
    approval_id: str | None = None
    approver: str | None = None
    act_id: str | None = None
    frozen: bool = False


class ToolBlocked(Exception):
    """Raised by guarded plain-Python tools when ``raise_on_block=True``."""

    def __init__(self, decision: Decision):
        super().__init__(decision.message)
        self.decision = decision


class NeuralOpsGuard:
    def __init__(
        self,
        url: str | None = None,
        token: str | None = None,
        *,
        scope: str | None = None,
        actions: Mapping[str, str] | None = None,
        default_action: Callable[[str], str] | None = None,
        skip: Callable[[str], bool] | None = None,
        task_id: str | None = None,
        fail_open: bool = False,
        timeout: float = 5.0,
        max_detail: int = 900,
    ) -> None:
        self.url = (url or os.environ.get("NEURALOPS_URL") or "http://127.0.0.1:3031").rstrip("/")
        self.token = token if token is not None else os.environ.get("NEURALOPS_TOKEN", "")
        self.scope = scope or os.environ.get("NEURALOPS_SCOPE") or "production"
        self.actions = dict(actions or {})
        self.default_action = default_action or (lambda tool: f"tool.{tool}")
        # NeuralOps' own tools are the coordination layer itself: never gate them.
        self.skip = skip or (lambda tool: tool.startswith("neuralops_"))
        self.task_id = task_id
        self.fail_open = fail_open
        self.timeout = timeout
        self.max_detail = max_detail

    # ------------------------------------------------------------------ core call
    def action_for(self, tool_name: str) -> str:
        return self.actions.get(tool_name) or self.default_action(tool_name)

    def _post(self, path: str, body: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        req = urllib.request.Request(self.url + path, data=json.dumps(body).encode(), headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                return res.status, json.loads(res.read() or b"{}")
        except urllib.error.HTTPError as e:  # 4xx/5xx still carry a JSON body
            try:
                return e.code, json.loads(e.read() or b"{}")
            except ValueError:
                return e.code, {"ok": False, "error": f"HTTP {e.code}"}

    def check(self, tool_name: str, args: Mapping[str, Any] | None = None, *, task_id: str | None = None,
              action: str | None = None, scope: str | None = None) -> Decision:
        """Ask NeuralOps whether this tool call may run now (synchronous)."""
        if self.skip(tool_name):
            return Decision(True, "NeuralOps tool (not gated)")
        detail = json.dumps(dict(args or {}), default=str, ensure_ascii=False)
        if len(detail) > self.max_detail:
            detail = detail[: self.max_detail] + "…"
        payload: dict[str, Any] = {
            "action": action or self.action_for(tool_name),
            "scope": scope or self.scope,
            "target": tool_name[:200],
            "detail": detail,
        }
        if task_id or self.task_id:
            payload["taskId"] = task_id or self.task_id
        try:
            status, data = self._post("/api/tools/neuralops_perform", payload)
        except (urllib.error.URLError, OSError, ValueError) as e:
            msg = f"NeuralOps core unreachable at {self.url} ({e})"
            if self.fail_open:
                return Decision(True, msg + " — allowed (fail_open)")
            return Decision(False, msg + " — tool call blocked (fail closed).")

        if not data.get("ok"):
            err = str(data.get("error") or f"HTTP {status}")
            return Decision(False, f"NeuralOps blocked {tool_name}: {err}", frozen="FROZEN" in err)

        result = data.get("result") or {}
        approval = result.get("approval") or {}
        return Decision(
            allowed=bool(result.get("allowed")),
            message=str(result.get("message") or ""),
            approval_id=approval.get("id"),
            approver=approval.get("approver"),
            act_id=result.get("actId"),
        )

    async def acheck(self, tool_name: str, args: Mapping[str, Any] | None = None, **kw: Any) -> Decision:
        return await asyncio.to_thread(self.check, tool_name, args, **kw)

    @staticmethod
    def blocked_text(tool_name: str, d: Decision) -> str:
        """What the model sees instead of the tool result. Written so it reports, not retries."""
        if d.frozen:
            return f"[NeuralOps] {tool_name} was NOT run: the workspace is frozen (incident mode). {d.message} Tell the user; do not retry."
        if d.approval_id:
            return (f"[NeuralOps] {tool_name} was NOT run: it needs approval {d.approval_id} from {d.approver}. "
                    f"Tell the user it is waiting for approval; run it again only after it is approved.")
        return f"[NeuralOps] {tool_name} was NOT run: {d.message}"

    # ------------------------------------------------------------------ pydantic-ai hook
    async def process_tool_call(self, ctx: Any, call_tool: Callable[..., Awaitable[Any]], name: str,
                                tool_args: dict[str, Any]) -> Any:
        """pydantic-ai ``process_tool_call`` callback for MCP toolsets/servers."""
        d = await self.acheck(name, tool_args)
        if not d.allowed:
            return self.blocked_text(name, d)
        return await call_tool(name, tool_args)

    # ------------------------------------------------------------------ plain functions
    def guarded(self, action: str | None = None, *, raise_on_block: bool = False):
        """Decorator for plain Python tools (sync or async). Keeps the signature for schema generation."""

        def wrap(fn: Callable[..., Any]):
            name = fn.__name__
            if action:
                self.actions.setdefault(name, action)
            sig = inspect.signature(fn)

            def bound_args(*a: Any, **k: Any) -> dict[str, Any]:
                try:
                    b = sig.bind_partial(*a, **k)
                    return {n: v for n, v in b.arguments.items() if n not in ("ctx", "self")}
                except TypeError:
                    return dict(k)

            def on_block(d: Decision) -> Any:
                if raise_on_block:
                    raise ToolBlocked(d)
                return self.blocked_text(name, d)

            if inspect.iscoroutinefunction(fn):
                @functools.wraps(fn)
                async def aw(*a: Any, **k: Any) -> Any:
                    d = await self.acheck(name, bound_args(*a, **k))
                    return await fn(*a, **k) if d.allowed else on_block(d)
                return aw

            @functools.wraps(fn)
            def w(*a: Any, **k: Any) -> Any:
                d = self.check(name, bound_args(*a, **k))
                return fn(*a, **k) if d.allowed else on_block(d)
            return w

        return wrap
