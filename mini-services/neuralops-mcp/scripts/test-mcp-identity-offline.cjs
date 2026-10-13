'use strict';
// Real HTTP route, identity resolver and MCP serializer; disposable registry/tool.
// Node 24: node --experimental-vm-modules scripts/test-mcp-identity-offline.cjs
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict'), http = require('node:http');
const { stripTypeScriptTypes } = require('node:module');
const root = path.resolve(__dirname, '../src');
const agents = new Map([
  ['agent.broker', {id:'agent.broker',access:'broker',revokedAt:null}],
  ['agent.alex', {id:'agent.alex',delegate:'agent.broker',revokedAt:null}],
  ['agent.bob', {id:'agent.bob',delegate:'agent.broker',revokedAt:null}],
  ['agent.foreign', {id:'agent.foreign',delegate:'agent.other',revokedAt:null}],
  ['agent.revoked', {id:'agent.revoked',delegate:'agent.broker',revokedAt:'fixture'}],
  ['agent.normal', {id:'agent.normal',revokedAt:null}],
  ['agent.audit', {id:'agent.audit',access:'audit',revokedAt:null}]
]);
const tokens = new Map([['fixture-broker','agent.broker'],['fixture-normal','agent.normal'],['fixture-audit','agent.audit']]);
let calls = 0;
const special = {
  store: {agents},
  checkToken: token => tokens.has(token) ? {ok:true,agentId:tokens.get(token)} : {ok:false,reason:'unknown'},
  looksLikeJwt: () => false,
  seesEverything: () => false,
  TOOL_DEFS: [{name:'neuralops_whoami',description:'Disposable identity fixture',inputSchema:{properties:{}}}],
  callTool: (name,args,caller) => {
    assert.equal(name,'neuralops_whoami'); calls++;
    return {ok:true,result:{agent:agents.get(caller.agentId),via:caller.via}};
  }
};
const config = {mode:'secure',adminToken:'fixture-admin',adminCanAct:false,agentRead:'involved',rateLimit:null,jwt:null,mcpUrlTokens:false,links:null};
async function build(legacy) {
  const context = vm.createContext({console,Buffer,URL,Date,Map,Set,JSON,structuredClone,setTimeout,clearTimeout});
  const cache = new Map();
  const real = new Set(['server/http.ts','server/identity.ts','mcp/http.ts','errors.ts']);
  function synthetic(id,exports) {
    if (!cache.has(id)) cache.set(id,new vm.SyntheticModule(Object.keys(exports),function(){for(const [k,v] of Object.entries(exports))this.setExport(k,v);},{context,identifier:id}));
    return cache.get(id);
  }
  function source(file) {
    if(cache.has(file))return cache.get(file);
    let text = fs.readFileSync(file,'utf8');
    if(legacy && file === path.join(root,'server/http.ts'))text=text.replace("resolveCaller(config, token, header(req, 'x-agent-id'))","resolveCaller(config, token, token ? null : header(req, 'x-agent-id'))");
    const stripped = stripTypeScriptTypes(text,{mode:'transform'});
    const m = new vm.SourceTextModule(stripped,{context,identifier:file});
    cache.set(file,m); return m;
  }
  const entry = source(path.join(root,'server/http.ts'));
  await entry.link(async (specifier,parent) => {
    if(specifier.startsWith('node:') || specifier.startsWith('@modelcontextprotocol/')) {
      const exports = require(specifier); return synthetic(specifier,{...exports,default:exports});
    }
    const file = path.resolve(path.dirname(parent.identifier),specifier).replace(/\.js$/,'.ts');
    if(real.has(path.relative(root,file)))return source(file);
    // Export exactly imported names; unrelated paths fail loudly if invoked.
    const imported = [...real].flatMap(p=>[...stripTypeScriptTypes(fs.readFileSync(path.join(root,p),'utf8'),{mode:'transform'}).matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)]
      .flatMap(m=>m[1].split(',').map(n=>n.trim()).filter(Boolean)));
    const exports = Object.fromEntries(imported.map(n=>[n,special[n] ?? (()=>{throw Error('Unexpected fixture dependency: '+n);})]));
    return synthetic(file,exports);
  });
  await entry.evaluate(); return entry.namespace.createHttpHandler(config);
}
async function run(legacy) {
  const server = http.createServer(await build(legacy)); await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base = 'http://127.0.0.1:'+server.address().port;
  async function request(token,actor,method='tools/call',route='/mcp') {
    const headers = {'Authorization':'Bearer '+token,'Content-Type':'application/json','Accept':'application/json, text/event-stream'};
    if(actor)headers['X-Agent-Id']=actor;
    const body = {jsonrpc:'2.0',id:1,method,params:method==='initialize'?{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'fixture',version:'1'}}:{name:'neuralops_whoami',arguments:{}}};
    const r = await fetch(base+route,{method:route==='/mcp'?'POST':'GET',headers,...(route==='/mcp'?{body:JSON.stringify(body)}:{})});
    return {status:r.status,body:await r.json()};
  }
  try {
    if(legacy) {
      const r = await request('fixture-broker','agent.alex');
      assert.equal(JSON.parse(r.body.result.content[0].text).agent.id,'agent.broker');
      console.log('PASS reproduced old route dropping authenticated worker header'); return;
    }
    const broker = await request('fixture-broker'); assert.equal(broker.status,200);
    assert.equal(JSON.parse(broker.body.result.content[0].text).agent.id,'agent.broker');
    const results = await Promise.all(['agent.alex','agent.bob'].map(id=>request('fixture-broker',id)));
    for(const [i,r] of results.entries()){
      assert.equal(r.status,200); const data=JSON.parse(r.body.result.content[0].text);
      assert.equal(data.agent.id,['agent.alex','agent.bob'][i]); assert.equal(data.via,'delegated');
      assert.equal(Object.hasOwn(data,'ok'),false);
    }
    for(const [token,actor,status] of [
      ['fixture-broker','agent.foreign',403],['fixture-broker','agent.missing',403],
      ['fixture-broker','agent.revoked',401],['fixture-normal','agent.alex',403],
      ['fixture-admin','agent.alex',403],['fixture-audit',null,403],['invalid',null,401]
    ])for(const method of ['initialize','tools/call'])assert.equal((await request(token,actor,method)).status,status);
    assert.equal((await request('fixture-audit',null,'','/api/whoami')).status,200);
    console.log('PASS real HTTP/auth/MCP: broker, parallel delegates, direct envelope, 14 refusals and audit read');
  } finally {server.closeAllConnections(); await new Promise(r=>server.close(r));}
}
(async()=>{await run(true);await run(false);assert.equal(calls,4);console.log('PASS no registration, grants, rotation, task or production data changes');})().catch(e=>{console.error(e);process.exitCode=1;});
