"""Tests for neuralops_guard against a live NeuralOps core.

Run by tests/nexus-guard.test.ts, which starts a secure-mode core and passes:
  NEURALOPS_URL, LAYLA_TOKEN (persona), LEAD_TOKEN (human approver), ADMIN_TOKEN
The core has a policy: odoo.write/production -> approver agent.noaman.
"""

import asyncio
import json
import os
import sys
import unittest
import urllib.request

sys.path.insert(0, os.path.dirname(__file__))
from neuralops_guard import NeuralOpsGuard, ToolBlocked  # noqa: E402

URL = os.environ["NEURALOPS_URL"]
LAYLA = os.environ["LAYLA_TOKEN"]
LEAD = os.environ["LEAD_TOKEN"]
ADMIN = os.environ["ADMIN_TOKEN"]


def post(path, body, token):
    req = urllib.request.Request(URL + path, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"}, method="POST")
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.loads(r.read())


def approve(approval_id):
    return post("/api/acts", {"type": "authorize", "payload": {"approvalId": approval_id}}, LEAD)


class GuardTest(unittest.TestCase):
    def guard(self, **kw):
        return NeuralOpsGuard(URL, LAYLA, actions={"create_invoice": "odoo.write"}, **kw)

    def test_ungoverned_tool_runs(self):
        d = self.guard().check("web_search", {"q": "karachi weather"})
        self.assertTrue(d.allowed, d.message)

    def test_neuralops_tools_are_not_gated(self):
        d = NeuralOpsGuard(URL, "bad-token").check("neuralops_inbox", {})
        self.assertTrue(d.allowed)

    def test_process_tool_call_blocks_then_runs_after_approval(self):
        g = self.guard()
        calls = []

        async def call_tool(name, args):
            calls.append((name, args))
            return {"invoice": "INV/001"}

        args = {"partner": "ACME", "amount": 5000}
        out = asyncio.run(g.process_tool_call(None, call_tool, "create_invoice", args))
        self.assertIsInstance(out, str)
        self.assertIn("was NOT run", out)
        self.assertIn("agent.noaman", out)
        self.assertEqual(calls, [])

        approval_id = g.check("create_invoice", args).approval_id
        self.assertTrue(approval_id)
        approve(approval_id)
        out = asyncio.run(g.process_tool_call(None, call_tool, "create_invoice", args))
        self.assertEqual(out, {"invoice": "INV/001"})
        self.assertEqual(len(calls), 1)
        # single use
        out = asyncio.run(g.process_tool_call(None, call_tool, "create_invoice", args))
        self.assertIn("was NOT run", out)

    def test_decorator_sync_and_raise(self):
        g = self.guard()

        @g.guarded("odoo.write", raise_on_block=True)
        def create_invoice(partner: str, amount: int) -> str:
            return f"created {partner} {amount}"

        with self.assertRaises(ToolBlocked) as cm:
            create_invoice("ACME", 10)
        approve(cm.exception.decision.approval_id)
        self.assertEqual(create_invoice("ACME", 10), "created ACME 10")

    def test_fail_closed_and_fail_open(self):
        down = NeuralOpsGuard("http://127.0.0.1:9", LAYLA, timeout=1)
        self.assertFalse(down.check("create_invoice", {}).allowed)
        self.assertTrue(NeuralOpsGuard("http://127.0.0.1:9", LAYLA, timeout=1, fail_open=True).check("x", {}).allowed)

    def test_frozen_workspace_blocks_everything(self):
        post("/api/admin/freeze", {"reason": "python test incident"}, ADMIN)
        try:
            d = self.guard().check("web_search", {})
            self.assertFalse(d.allowed)
            self.assertTrue(d.frozen)
            self.assertIn("frozen", NeuralOpsGuard.blocked_text("web_search", d))
        finally:
            post("/api/admin/unfreeze", {}, ADMIN)

    def test_pydantic_ai_agent_end_to_end(self):
        try:
            from pydantic_ai import Agent
            from pydantic_ai.models.test import TestModel
        except ImportError:
            self.skipTest("pydantic-ai not installed")
        g = self.guard()
        ran = []

        agent = Agent(TestModel())

        @agent.tool_plain
        @g.guarded("odoo.write")
        def create_invoice(partner: str, amount: int) -> str:
            """Create an invoice in Odoo."""
            ran.append((partner, amount))
            return "INV/002"

        result = agent.run_sync("bill ACME")
        self.assertEqual(ran, [], "the tool must not run before approval")
        self.assertIn("was NOT run", str(result.output))


if __name__ == "__main__":
    unittest.main(verbosity=2)
