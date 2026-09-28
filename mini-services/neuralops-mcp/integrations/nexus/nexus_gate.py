"""
NeuralOps policies on top of Nexus' own tool approvals.

Nexus already gives every persona tool a level -- Auto, Ask or Off -- and
holds an Ask tool until a person in the topic decides (apps/managers/approvals.py).
NeuralOpsToolGate keeps all of that and adds what a team running personas
against real systems needs:

  * Policies with a named approver. An action a NeuralOps policy governs
    (say odoo.write in production -> Noaman) waits for THAT person, whatever
    level the tool has in the persona -- an Auto level cannot skip it.
  * Standing approvals for runs nobody watches. A schedule or a swarm refuses
    every Ask tool today; with NeuralOps, an approver can grant "Layla may
    odoo.write 20 times today" in advance, and the unattended run uses it.
  * One signed record. Every acting call -- run, refused or blocked -- lands
    in the NeuralOps ledger (hash-chained, replayable), next to who approved
    it and why.
  * One kill switch. Freezing the workspace stops every persona's acting
    tools at once.

Everything NeuralOps does not govern still follows the persona's levels and
the topic's decision, exactly as before.

Install: copy this file and neuralops_guard.py into apps/managers/ and apply
integrations/nexus/nexus-ai.patch (it builds this gate in the pydantic-ai
runner when NEURALOPS_URL is set).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from pydantic_ai.exceptions import SkipToolExecution

from apps.managers.approvals import ToolApprovalGate, args_preview, level_for

try:  # vendored next to this file in nexus-ai
    from apps.managers.neuralops_guard import NeuralOpsGuard
except ImportError:  # running from the NeuralOps repo
    from neuralops_guard import NeuralOpsGuard  # type: ignore[no-redef]

FROZEN = "{tool} did NOT run: the workspace is frozen (incident mode) by NeuralOps. Nothing changed. Tell the user and do not retry."
NEEDS_APPROVAL_UNATTENDED = (
    "{tool} did NOT run: it needs approval {approval} from {approver} under the team's NeuralOps policy, and nobody "
    "is watching this run. The request is waiting for them; nothing changed. Say what you would have done."
)
DENIED_BY = "{approver} declined {tool}{reason}. It did not run and nothing changed. Say so plainly and do not show any output for it."
TIMED_OUT = "{approver} did not decide on {tool} in time (approval {approval} is still open). It did not run and nothing changed."
UNREACHABLE = "{tool} did NOT run: the NeuralOps policy service could not be reached, so acting tools are held. Nothing changed."


def persona_identity(persona_id: str) -> str:
    """The NeuralOps identity a Nexus persona acts as."""
    slug = re.sub(r"[^a-z0-9_-]+", "-", str(persona_id).lower()).strip("-")[:48] or "persona"
    return f"agent.persona-{slug}"


@dataclass
class NeuralOpsToolGate(ToolApprovalGate):
    """ToolApprovalGate + NeuralOps policies, standing approvals, ledger and kill switch."""

    guard: NeuralOpsGuard | None = None
    wait_seconds: float = 600.0
    poll_seconds: float = 1.0
    # Tools whose level is Auto and that NeuralOps does not govern are reads:
    # they run without a record (set True to log every call).
    record_auto: bool = False
    recorded: list[str] = field(default_factory=list)

    async def before_tool_execute(self, ctx, *, call, tool_def, args):
        guard = self.guard
        if guard is None or getattr(ctx, "tool_call_approved", False):
            return await super().before_tool_execute(ctx, call=call, tool_def=tool_def, args=args)

        tool = call.tool_name
        cap = tool_def.capability_id or ""
        target = f"{cap}/{tool}" if cap else tool
        level = level_for(self.levels, cap, tool, tool_def.metadata)
        preview = args_preview(args)

        try:
            check = await guard.apolicy(tool)
        except Exception:
            # Fail closed for anything that would act; reads keep working.
            if level == "ask" or not guard.fail_open:
                raise SkipToolExecution(UNREACHABLE.format(tool=tool))
            return await super().before_tool_execute(ctx, call=call, tool_def=tool_def, args=args)

        if check.get("frozen"):
            await guard.areport_block(tool, "workspace frozen", target=target)
            raise SkipToolExecution(FROZEN.format(tool=tool))

        # ---- governed by a NeuralOps policy: its approver decides, not the topic ----
        if check.get("governed") and not check.get("authority"):
            d = await guard.acheck(tool, preview, target=target)
            if d.allowed:
                self.recorded.append(call.tool_call_id)
                return args
            if d.frozen:
                raise SkipToolExecution(FROZEN.format(tool=tool))
            if not d.approval_id:
                raise SkipToolExecution(f"{tool} did NOT run: {d.message}")
            if not self.interactive:
                raise SkipToolExecution(NEEDS_APPROVAL_UNATTENDED.format(tool=tool, approval=d.approval_id, approver=d.approver))
            status, approval = await guard.await_decision(d.approval_id, timeout=self.wait_seconds, poll=self.poll_seconds)
            if status == "approved":
                again = await guard.acheck(tool, preview, target=target)
                if again.allowed:
                    self.recorded.append(call.tool_call_id)
                    return args
                raise SkipToolExecution(f"{tool} did NOT run: {again.message}")
            if status == "denied":
                reason = (approval or {}).get("reason")
                raise SkipToolExecution(DENIED_BY.format(approver=d.approver, tool=tool, reason=f" ({reason})" if reason else ""))
            raise SkipToolExecution(TIMED_OUT.format(approver=d.approver, tool=tool, approval=d.approval_id))

        # ---- not governed (or direct authority): Nexus' own levels decide, NeuralOps records ----
        try:
            out = await super().before_tool_execute(ctx, call=call, tool_def=tool_def, args=args)
        except SkipToolExecution as e:
            if level == "ask":
                await guard.areport_block(tool, str(getattr(e, "result", e))[:900], target=target)
            raise
        if level == "ask" or check.get("authority") or self.record_auto:
            await guard.acheck(tool, preview, target=target)
            self.recorded.append(call.tool_call_id)
        return out


_known: set[str] = set()


async def guard_for_persona(persona: Any, *, url: str, token: str, scope: str = "production",
                            actions: dict[str, str] | None = None) -> NeuralOpsGuard:
    """A guard that acts as this persona (broker mode); registers the persona on first use."""
    import asyncio

    guard = NeuralOpsGuard(url, token, act_as=persona_identity(persona.id), scope=scope, actions=actions or {})
    if guard.act_as not in _known:
        await asyncio.to_thread(guard.ensure_identity, getattr(persona, "name", guard.act_as) or guard.act_as)
        _known.add(guard.act_as)
    return guard
