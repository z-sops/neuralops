'use strict';
// Run the real gate/authority/store regression tests without Bun, packages,
// sockets, journal listeners or emitted transpilation files. Node 24+ required.
const { readFileSync } = require('node:fs');
const { resolve, dirname } = require('node:path');
const { stripTypeScriptTypes } = require('node:module');
const vm = require('node:vm');
const context = vm.createContext({ console, Date, Map, Set, JSON, structuredClone });
const modules = new Map();
function builtin(name) {
  if (modules.has(name)) return modules.get(name);
  const value = require(name === 'bun:test' ? 'node:test' : name);
  const keys = Object.keys(value);
  const mod = new vm.SyntheticModule(['default', ...keys], function () {
    this.setExport('default', value);
    for (const key of keys) this.setExport(key, value[key]);
  }, { context, identifier: name });
  modules.set(name, mod);
  return mod;
}
function source(file) {
  if (modules.has(file)) return modules.get(file);
  const code = stripTypeScriptTypes(readFileSync(file, 'utf8'), { mode: 'transform' });
  const mod = new vm.SourceTextModule(code, { context, identifier: file });
  modules.set(file, mod);
  return mod;
}
(async () => {
  const test = source(resolve(__dirname, '../tests/gate-approval.test.ts'));
  await test.link((specifier, parent) => {
    if (specifier === 'bun:test' || specifier.startsWith('node:')) return builtin(specifier);
    return source(resolve(dirname(parent.identifier), specifier.replace(/\.js$/, '.ts')));
  });
  await test.evaluate();
})().catch(error => { console.error(error); process.exitCode = 1; });
