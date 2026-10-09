'use strict';
// Real processAct + schemas + store; Node 24, Zod already installed. No Bun,
// sockets, live services or emitted build files. NODE_PATH may point to Zod.
const { readFileSync } = require('node:fs');
const { resolve, dirname } = require('node:path');
const { stripTypeScriptTypes } = require('node:module');
const vm = require('node:vm');
const context = vm.createContext({ console, Date, Map, Set, JSON, structuredClone });
const modules = new Map();
function builtin(name) {
  if (modules.has(name)) return modules.get(name);
  const value = require(name === 'bun:test' ? 'node:test' : name), keys = Object.keys(value).filter(key => key !== 'default');
  const mod = new vm.SyntheticModule(['default', ...keys], function () {
    this.setExport('default', value); for (const key of keys) this.setExport(key, value[key]);
  }, { context, identifier: name }); modules.set(name, mod); return mod;
}
function source(file) {
  if (modules.has(file)) return modules.get(file);
  const mod = new vm.SourceTextModule(stripTypeScriptTypes(readFileSync(file, 'utf8'), { mode: 'transform' }), { context, identifier: file });
  modules.set(file, mod); return mod;
}
(async () => {
  const test = source(resolve(__dirname, '../tests', process.argv[2] || 'managed-action.test.ts'));
  await test.link((specifier, parent) => {
    if (specifier === 'bun:test' || specifier === 'zod' || specifier.startsWith('node:')) return builtin(specifier);
    return source(resolve(dirname(parent.identifier), specifier.replace(/\.js$/, '.ts')));
  }); await test.evaluate();
})().catch(error => { console.error(error); process.exitCode = 1; });
