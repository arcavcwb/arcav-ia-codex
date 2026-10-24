import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const root = path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname),'..');
const cli = path.join(root,'bin/cli.js');
const prd = path.join(root,'docs/examples/prd.example.md');
const units = path.join(root,'docs/examples/atomization.units.json');
const call = args => spawnSync(process.execPath,[cli,...args],{cwd:root,encoding:'utf8'});
test('CLI V2 genera JSON con unidades y cobertura; V1 se conserva',()=>{
  let r=call(['backlog','plan-v2',prd]);
  assert.equal(r.status,0,r.stderr);
  let b=JSON.parse(r.stdout);
  assert.equal(b.tasks.length,3);
  assert.deepEqual(b.tasks[0].requirement_refs,['US-001:AC-001','US-001:AC-002']);
  r=call(['backlog','plan-v2',prd,'--units',units,'--json']);
  assert.equal(r.status,0,r.stderr);
  const report=JSON.parse(r.stdout);
  assert.equal(report.stats.tasks,4);
  assert.equal(report.coverage.length,4);
  assert.deepEqual(report.backlog.tasks[2].dependencies,['TASK-002']);
  r=call(['backlog','plan',prd]);
  assert.equal(r.status,0,r.stderr);
  assert.equal(JSON.parse(r.stdout).tasks.length,8);
});
test('CLI V2 no sobrescribe y deja un backlog validable',()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'arcav-v2-'));
  try {
    const out=path.join(tmp,'backlog.json');
    let r=call(['backlog','plan-v2',prd,'--units',units,'--out',out]);
    assert.equal(r.status,0,r.stderr);
    const original=fs.readFileSync(out,'utf8');
    r=call(['backlog','validate','--file',out]);
    assert.equal(r.status,0,r.stderr);
    r=call(['backlog','plan-v2',prd,'--units',units,'--out',out]);
    assert.equal(r.status,1);
    assert.equal(fs.readFileSync(out,'utf8'),original);
  } finally { fs.rmSync(tmp,{recursive:true,force:true}); }
});
test('--units está limitado a plan-v2 y rechaza rutas incorrectas',()=>{
  let r=call(['backlog','plan',prd,'--units',units]);
  assert.equal(r.status,1);
  r=call(['backlog','plan-v2',prd,'--units','/unavailable/units.json']);
  assert.equal(r.status,1);
});
