"""Live test: Nexus' ToolApprovalGate + NeuralOpsToolGate against a real NeuralOps core.

Needs a checkout of NeuralOps Nexus with the patch applied (NEXUS_DIR) and a
secure-mode core (started by tests/nexus-gate.test.ts), which passes:
  NEURALOPS_URL, BROKER_TOKEN, NOAMAN_TOKEN, ADMIN_TOKEN
The core has a policy: odoo.write/production -> human.noaman.
"""

import asyncio
import json
import os
import sys
import unittest
import urllib.request
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.environ["NEXUS_DIR"], "modules", "nexus-ai"))

from pydantic_ai.exceptions import SkipToolExecution  # noqa: E402

from apps.managers.approvals import ApprovalOutcome  # noqa: E402  (Nexus' own module)
from apps.managers.neuralops_gate import NeuralOpsToolGate, guard_for_persona  # noqa: E402

URL = os.environ["NEURALOPS_URL"]
BROKER = os.environ["BROKER_TOKEN"]
NOAMAN = os.environ["NOAMAN_TOKEN"]
ADMIN = os.environ["ADMIN_TOKEN"]
CTX = SimpleNamespace(tool_call_approved=False)
PERSONA = SimpleNamespace(id="layla-1", name="Layla")
ACTIONS = {"create_invoice": "odoo.write"}


def http(method, path, body=None, token=ADMIN):
    req = urllib.request.Request(URL + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return json.loads(e.read() or b"{}")


def tool_def(name, cap):
    return SimpleNamespace(name=name, capability_id=cap, metadata={})


def call(name, cid="c1"):
    return SimpleNamespace(tool_name=name, tool_call_id=cid)


class Asker:
    def __init__(self, *outcomes):
        self.outcomes, self.asked = list(outcomes), []

    async def __call__(self, request):
        self.asked.append(request)
        return self.outcomes.pop(0)


def ledger_for(actor):
    return [e for e in http("GET", "/api/ledger?limit=200") if e["actor"] == actor]


class LiveGate(unittest.IsolatedAsyncioTestCase):
    async def gate(self, *, interactive=True, asker=None, levels=None):
        guard = await guard_for_persona(PERSONA, url=URL, token=BROKER, actions=ACTIONS)
        return NeuralOpsToolGate(levels=levels or {}, ask=asker or Asker(), interactive=interactive, guard=guard,
                                 wait_seconds=10, poll_seconds=0.05)

    async def test_1_persona_identity_is_created_and_delegated_to_the_worker(self):
        await self.gate()
        me = http("GET", "/api/whoami", token=BROKER)
        self.assertEqual(me["agent"]["access"], "broker")
        agents = {a["id"]: a for a in http("GET", "/api/agents")}
        self.assertEqual(agents["agent.persona-layla-1"]["delegate"], "agent.nexus-worker")

    async def test_2_governed_call_waits_for_the_named_approver_then_runs(self):
        gate = await self.gate(levels={"mcp:odoo": "auto"})
        args = {"partner": "ACME", "amount": 5000}
        task = asyncio.create_task(gate.before_tool_execute(CTX, call=call("create_invoice"), tool_def=tool_def("create_invoice", "mcp:odoo"), args=args))
        pending = None
        for _ in range(100):
            await asyncio.sleep(0.05)
            pending = [a for a in http("GET", "/api/approvals") if a["status"] == "pending" and a["requestedBy"] == "agent.persona-layla-1"]
            if pending:
                break
        self.assertTrue(pending, "an approval should be waiting for human.noaman")
        self.assertEqual(pending[0]["approver"], "human.noaman")
        self.assertIn("ACME", pending[0]["detail"])
        r = http("POST", "/api/acts", {"type": "authorize", "payload": {"approvalId": pending[0]["id"], "reason": "checked"}}, token=NOAMAN)
        self.assertTrue(r.get("ok"), r)
        self.assertIs(await task, args)
        vias = [e["via"] for e in ledger_for("agent.persona-layla-1") if e["actType"] == "perform"]
        self.assertIn("delegated", vias)

    async def test_3_denial_reaches_the_model_with_the_reason(self):
        gate = await self.gate()
        task = asyncio.create_task(gate.before_tool_execute(CTX, call=call("create_invoice", "c3"), tool_def=tool_def("create_invoice", "mcp:odoo"), args={"x": 1}))
        for _ in range(100):
            await asyncio.sleep(0.05)
            pending = [a for a in http("GET", "/api/approvals") if a["status"] == "pending" and a["requestedBy"] == "agent.persona-layla-1"]
            if pending:
                break
        http("POST", "/api/acts", {"type": "deny", "payload": {"approvalId": pending[0]["id"], "reason": "wrong customer"}}, token=NOAMAN)
        with self.assertRaises(SkipToolExecution) as cm:
            await task
        self.assertIn("declined create_invoice (wrong customer)", cm.exception.result)

    async def test_4_unattended_run_uses_a_standing_approval_then_leaves_a_request(self):
        r = http("POST", "/api/acts", {"type": "grant_approval", "payload": {"to": "agent.persona-layla-1", "action": "odoo.write", "uses": 1, "reason": "nightly run"}}, token=NOAMAN)
        self.assertTrue(r.get("ok"), r)
        gate = await self.gate(interactive=False)
        self.assertEqual(await gate.before_tool_execute(CTX, call=call("create_invoice", "c4"), tool_def=tool_def("create_invoice", "mcp:odoo"), args={}), {})
        with self.assertRaises(SkipToolExecution) as cm:
            await gate.before_tool_execute(CTX, call=call("create_invoice", "c5"), tool_def=tool_def("create_invoice", "mcp:odoo"), args={})
        self.assertIn("from human.noaman", cm.exception.result)

    async def test_5_ungoverned_tools_keep_nexus_levels_and_are_recorded(self):
        asker = Asker(ApprovalOutcome("allow"))
        gate = await self.gate(asker=asker)
        await gate.before_tool_execute(CTX, call=call("run_command", "c6"), tool_def=tool_def("run_command", "shell"), args={"command": "ls"})
        self.assertEqual(len(asker.asked), 1)
        targets = [e["after"].get("target") for e in ledger_for("agent.persona-layla-1") if e["actType"] == "perform"]
        self.assertIn("shell/run_command", targets)

    async def test_6_frozen_workspace_stops_the_persona(self):
        http("POST", "/api/admin/freeze", {"reason": "live test incident"})
        try:
            gate = await self.gate(levels={"shell": "auto"})
            with self.assertRaises(SkipToolExecution) as cm:
                await gate.before_tool_execute(CTX, call=call("run_command", "c7"), tool_def=tool_def("run_command", "shell"), args={})
            self.assertIn("frozen", cm.exception.result)
        finally:
            http("POST", "/api/admin/unfreeze", {})


if __name__ == "__main__":
    unittest.main(verbosity=2)
