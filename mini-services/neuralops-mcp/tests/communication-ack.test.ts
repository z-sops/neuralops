import { beforeEach, test } from 'bun:test'
import assert from 'node:assert/strict'
import { store } from '../src/state/store.js'
import { processAct } from '../src/engines/task-manager.js'
import { callTool, TOOL_DEFS } from '../src/mcp/tools.js'
import type { Agent } from '../src/state/types.js'
const caller = (agentId:string) => ({agentId,via:'token' as const,isAdmin:false})
beforeEach(() => {
 store.reset()
 for(const id of ['agent.alex','agent.bob','agent.other'])store.agents.set(id,{id,workspaceId:'ws',name:id,model:'Custom',role:'test',reportsTo:null,authority:[],status:'online',subscriptions:[],createdAt:new Date().toISOString()} as Agent)
 assert.equal(processAct({id:'question_act',type:'question',from:'agent.alex',payload:{to:'agent.bob',about:'Review status',ttlSeconds:604800}}).ok,true)
})
test('MCP ACK target and idempotency key remain distinct and duplicate cannot repeat a ledger effect',()=>{
 const schema=TOOL_DEFS.find(t=>t.name==='neuralops_ack')!.inputSchema as {properties:Record<string,unknown>;required:string[]}
 assert.ok(schema.properties.operationId);assert.ok(schema.properties.actId);assert.ok(schema.required.includes('actId'))
 const r=callTool('neuralops_ack',{actId:'question_act',operationId:'ack_operation'},caller('agent.bob'));assert.equal(r.ok,true)
 const act=store.acts.get('ack_operation')!;assert.equal(act.type,'ack');assert.equal(act.payload.actId,'question_act');assert.equal(act.from,'agent.bob')
 const size=store.ledger.length;assert.equal(callTool('neuralops_ack',{actId:'question_act',operationId:'ack_operation'},caller('agent.bob')).ok,false);assert.equal(store.ledger.length,size)
})
test('sender, unrelated agent, wrong target and malformed operation key cannot forge receiver ACK',()=>{
 for(const [who,args] of [['agent.alex',{actId:'question_act',operationId:'sender_ack'}],['agent.other',{actId:'question_act',operationId:'other_ack'}],['agent.bob',{actId:'missing',operationId:'missing_ack'}],['agent.bob',{actId:'question_act',operationId:123}]] as const){const before=JSON.stringify(store.exportData());assert.equal(callTool('neuralops_ack',args,caller(who)).ok,false);assert.equal(JSON.stringify(store.exportData()),before)}
})
test('non-ACK actId retains existing idempotency contract and ACK without operation key preserves the target',()=>{
 assert.equal(callTool('neuralops_question',{actId:'another_question',to:'agent.bob',about:'Second'},caller('agent.alex')).ok,true);assert.ok(store.acts.has('another_question'))
 assert.equal(callTool('neuralops_ack',{actId:'another_question'},caller('agent.bob')).ok,true);const ack=[...store.acts.values()].find(a=>a.type==='ack')!;assert.equal(ack.payload.actId,'another_question');assert.notEqual(ack.id,'another_question')
})
