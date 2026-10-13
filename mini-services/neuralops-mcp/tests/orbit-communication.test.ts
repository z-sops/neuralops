import { test } from 'bun:test'
import assert from 'node:assert/strict'
import process from 'node:process'
import { runInThisContext } from 'node:vm'
const AbortController=runInThisContext('AbortController')
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { store } from '../src/state/store.js'
import { callTool } from '../src/mcp/tools.js'
import type { Agent } from '../src/state/types.js'
// Opt-in cross-repository proof; no source is copied between the products.
const run = process.env.ORBIT_SOURCE_DIR ? test : test.skip
run('actual Orbit outbox and real NeuralOps registry reconcile dropped commit, receiver ACK and answer', async () => {
 const require=createRequire(join(process.env.ORBIT_SOURCE_DIR!, 'package.json'))
 const {Home}=require('./lib/home'),{createJobRuns}=require('./lib/job-runs'),remote=require('./lib/remote-communication')
 const root=mkdtempSync(join(tmpdir(),'orbit-nops-protocol-')),home=new Home(root).ensure(),runs=createJobRuns(),controllers:any[]=[]
 try {
  store.reset();for(const id of ['agent.alex','agent.bob'])store.agents.set(id,{id,workspaceId:'ws',name:id,model:'Custom',role:'test',reportsTo:null,authority:[],status:'online',subscriptions:[],createdAt:new Date().toISOString()} as Agent)
  for(const name of ['Alex','Bob'])home.createAgent({name})
  const caller=(actor:string)=>({agentId:'agent.'+actor,via:'token' as const,isAdmin:false})
  assert.equal(callTool('neuralops_create_task',{id:'task_fixture',title:'Communication',objective:'Verify'},caller('alex')).ok,true)
  assert.equal(callTool('neuralops_claim',{taskId:'task_fixture'},caller('alex')).ok,true)
  const c={id:'nops',name:'NeuralOps',catalogId:'neuralops',url:'http://fixture.invalid/mcp',enabled:true,neuralopsIdentities:{alex:'agent.alex',bob:'agent.bob'},tools:['neuralops_question','neuralops_ack','neuralops_answer','neuralops_inbox','neuralops_get_original_context']}
  let dropped=true,sends=0
  const gateway={connectors:{list:()=>[c],visibleTo:()=>true,levelOf:()=> 'free'},hub:{authorize:async()=>({ok:true})},up:(_c:unknown,actor:string)=>({callTool:async(name:string,args:Record<string,unknown>)=>{const r=callTool(name,args,caller(actor));if(name==='neuralops_question'){sends++;if(dropped&&r.ok)throw Error('lost after real commit')}return r.ok?{content:[{type:'text',text:JSON.stringify(r.result)}]}:{isError:true,content:[{type:'text',text:r.errorCode+': '+r.error}]}}})}
  // Runs use the actual host AbortController exported from the process global.
  const make=(actor:string)=>{const j=home.createJob(actor,'Communicate'),ctl=new AbortController();controllers.push(ctl);const r=runs.begin(actor,j.id,ctl.signal);home.updateJob(actor,j.id,{status:'running',runId:r.runId,guidance:{connectorId:'nops',upstreamActor:'agent.'+actor,taskId:'task_fixture',runId:r.runId}});return r}
  const alex=make('alex'),bob=make('bob'),service=remote.create({home,runs,gateway})
  await assert.rejects(service.send(alex,{to:'bob',kind:'question',text:'Review status?',key:'q1'}),/lost/)
  const entry=home.findJob(alex.jobId).remoteCommunication[0];dropped=false
  const recovered=await service.recover(alex,entry.actId);assert.equal(recovered.replayed,false);assert.equal(sends,1)
  const ack=await service.ack(bob,entry.actId);assert.equal(ack.receipt.meaning,'receiver_ack_only_no_acceptance');assert.equal(store.acts.get(ack.receipt.actId)!.payload.actId,entry.actId)
  const inbox=await service.inbox(bob),question=inbox.inbox.questions[0]
  const answer=await service.answer(bob,question.id,'Review is pending');assert.equal(answer.receipt.delivery,'ledger_recorded');assert.equal(store.questions.get(question.id)!.answeredBy,'agent.bob');assert.equal(store.approvals.size,0);assert.equal(home.findJob(alex.jobId).status,'running')
 } finally {for(const ctl of controllers)ctl.abort();rmSync(root,{recursive:true,force:true})}
})
