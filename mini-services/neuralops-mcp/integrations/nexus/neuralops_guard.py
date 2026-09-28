"""NeuralOps guard — gate tool calls on NeuralOps policies (for NeuralOps Nexus and any Python agent).

Before a tool call reaches a real system (Odoo, a database, email, payments, a
shell), the guard asks the NeuralOps core with the `perform` act:

  * allowed   -> the tool runs, and the call is in the signed ledger
  * pending   -> the tool does NOT run; the model gets a short message naming
                 the approval id and the person who must approve it
  * frozen    -> the tool does NOT run (kill switch / incident mode)
  * core down -> fail closed by default (fail_open=True to let calls through)

Standard library only (urllib), so it drops into any service without new deps.

Identity, two ways:
  * one token per agent:              NeuralOpsGuard(url, token=<that agent's token>)
  * a broker acting for many personas: NeuralOpsGuard(url, token=<broker token>, act_as="agent.persona-layla")
    (the broker may only act for identities that name it as their delegate;
    ``ensure_identity`` creates one on first use)

For NeuralOps Nexus, use ``nexus_gate.NeuralOpsToolGate`` (it wraps Nexus'
own Auto/Ask/Off tool approvals). For any pydantic-ai MCP toolset::

    toolset = MCPToolset(client, process_tool_call=guard.process_tool_call)

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
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable, Mapping

__all__ = ["NeuralOpsGuard", "Decision", "ToolBlocked"]
__version__ = "0.1.6"


@dataclass(frozen=True)
class Decision:
    allowed: bool
    message: str
    approval_id: str | None = None
    approver: str | None = None
    act_id: str | None = None
    frozen: bool = False
    #: why it was allowed: "authority" | "ungoverned" | "approval" (None when not allowed)
    via: str | None = None


class ToolBlocked(Exception):
    """Raised by guarded plain-Python tools when ``raise_on_block=True``."""

    def __init__(self, decision: Decision):
        super().__init__(decision.message)
        self.decision = decision


class CoreUnreachable(Exception):
    pass


class NeuralOpsGuard:
    def __init__(
        self,
        url: str | None = None,
        token: str | None = None,
        *,
        act_as: str | None = None,
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
        self.act_as = act_as
        self.scope = scope or os.environ.get("NEURALOPS_SCOPE") or "production"
        self.actions = dict(actions or {})
        self.default_action = default_action or (lambda tool: f"tool.{tool}")
        # NeuralOps' own tools are the coordination layer itself: never gate them.
        self.skip = skip or (lambda tool: tool.startswith("neuralops_"))
        self.task_id = task_id
        self.fail_open = fail_open
        self.timeout = timeout
        self.max_detail = max_detail

    # ------------------------------------------------------------------ transport
    def action_for(self, tool_name: str) -> str:
        return self.actions.get(tool_name) or self.default_action(tool_name)

    def _request(self, method: str, path: str, body: dict[str, Any] | None = None, *, as_self: bool = False) -> tuple[int, Any]:
        headers = {"Accept": "application/json"}
        if body is not None:
            headers["Content-Type"] = "application/json"
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        if self.act_as and not as_self:
            headers["X-Agent-Id"] = self.act_as
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.url + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                return res.status, json.loads(res.read() or b"{}")
        except urllib.error.HTTPError as e:  # 4xx/5xx still carry a JSON body
            try:
                return e.code, json.loads(e.read() or b"{}")
            except ValueError:
                return e.code, {"ok": False, "error": f"HTTP {e.code}"}
        except (urllib.error.URLError, OSError, ValueError) as e:
            raise CoreUnreachable(f"NeuralOps core unreachable at {self.url} ({e})") from e

    def _post(self, path: str, body: dict[str, Any]) -> tuple[int, Any]:
        return self._request("POST", path, body)

    def _detail(self, args: Mapping[str, Any] | str | None) -> str:
        detail = args if isinstance(args, str) else json.dumps(dict(args or {}), default=str, ensure_ascii=False)
        return detail if len(detail) <= self.max_detail else detail[: self.max_detail] + "…"

    # ------------------------------------------------------------------ perform
    def check(self, tool_name: str, args: Mapping[str, Any] | str | None = None, *, task_id: str | None = None,
              action: str | None = None, scope: str | None = None, target: str | None = None) -> Decision:
        """Ask NeuralOps whether this tool call may run now, and record it (synchronous)."""
        if self.skip(tool_name):
            return Decision(True, "NeuralOps tool (not gated)", via="ungoverned")
        payload: dict[str, Any] = {
            "action": action or self.action_for(tool_name),
            "scope": scope or self.scope,
            "target": (target or tool_name)[:200],
        }
        detail = self._detail(args)
        if detail and detail != "{}":
            payload["detail"] = detail
        if task_id or self.task_id:
            payload["taskId"] = task_id or self.task_id
        try:
            status, data = self._post("/api/tools/neuralops_perform", payload)
        except CoreUnreachable as e:
            if self.fail_open:
                return Decision(True, f"{e} — allowed (fail_open)", via="fail_open")
            return Decision(False, f"{e} — tool call blocked (fail closed).")

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
            via=result.get("via"),
        )

    async def acheck(self, tool_name: str, args: Mapping[str, Any] | str | None = None, **kw: Any) -> Decision:
        return await asyncio.to_thread(self.check, tool_name, args, **kw)

    # ------------------------------------------------------------------ reads (no side effects)
    def policy(self, tool_name: str, *, action: str | None = None, scope: str | None = None, task_id: str | None = None) -> dict[str, Any]:
        """Dry run of perform: governed? approver? authority? usable approval? frozen? Records nothing."""
        body: dict[str, Any] = {"action": action or self.action_for(tool_name), "scope": scope or self.scope}
        if task_id or self.task_id:
            body["taskId"] = task_id or self.task_id
        status, data = self._post("/api/tools/neuralops_perform_check", body)
        if not data.get("ok"):
            raise RuntimeError(str(data.get("error") or f"HTTP {status}"))
        return data["result"]

    async def apolicy(self, tool_name: str, **kw: Any) -> dict[str, Any]:
        return await asyncio.to_thread(self.policy, tool_name, **kw)

    def approval(self, approval_id: str) -> dict[str, Any] | None:
        status, data = self._request("GET", f"/api/approvals/{urllib.parse.quote(approval_id)}")
        return data if status == 200 else None

    async def await_decision(self, approval_id: str, *, timeout: float, poll: float = 1.0) -> tuple[str, dict[str, Any] | None]:
        """Wait until a person decides. Returns ("approved"|"denied"|"timeout", approval)."""
        deadline = time.monotonic() + timeout
        last: dict[str, Any] | None = None
        while True:
            try:
                last = await asyncio.to_thread(self.approval, approval_id)
            except CoreUnreachable:
                last = last  # a hiccup is not a decision
            status = (last or {}).get("status")
            if status in ("approved", "denied"):
                return status, last
            if time.monotonic() >= deadline:
                return "timeout", last
            await asyncio.sleep(poll)

    # ------------------------------------------------------------------ records
    def report_block(self, tool: str, reason: str, *, target: str | None = None, enforcer: str = "guard") -> None:
        """Record in the ledger that a tool call was stopped (best effort)."""
        payload: dict[str, Any] = {"enforcer": enforcer, "tool": tool[:100], "reason": reason[:1000]}
        if target:
            payload["target"] = target[:500]
        try:
            self._post("/api/acts", {"type": "report_block", "payload": payload})
        except CoreUnreachable:
            pass

    async def areport_block(self, tool: str, reason: str, **kw: Any) -> None:
        await asyncio.to_thread(self.report_block, tool, reason, **kw)

    def ensure_identity(self, name: str, *, role: str = "persona", model: str = "Custom") -> str:
        """Broker mode: make sure `act_as` exists (created on first use, delegated to this broker)."""
        if not self.act_as:
            raise ValueError("ensure_identity needs act_as")
        status, _ = self._request("GET", "/api/whoami")
        if status == 200:
            return self.act_as
        status, data = self._request("POST", "/api/agents", {"id": self.act_as, "name": name[:80], "model": model, "role": role}, as_self=True)
        if status not in (200, 201) and "already exists" not in str(data.get("error", "")):
            raise RuntimeError(f"could not register {self.act_as}: {data.get('error') or status}")
        return self.act_as

    # ------------------------------------------------------------------ what the model sees
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
    async def process_tool_call(self, ctx: Any, call_tool: Callable[..., Any], name: str,
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
