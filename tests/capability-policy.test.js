import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {validateCapabilityPolicy,planCapabilityRoute} from '../src/capabilities/policy.js';

const policy=JSON.parse(fs.readFileSync(new URL('../docs/examples/capability-policy.json',import.meta.url),'utf8'));
const backlog=JSON.parse(fs.readFileSync(new URL('../docs/examples/backlog.example.json',import.meta.url),'utf8'));
const candidate=(role)=>planCapabilityRoute(backlog,'TASK-002',role,policy);
test('la política v1 se valida y no contiene IDs de modelo ni credenciales inventados',()=>{
  assert.equal(validateCapabilityPolicy(policy),policy);
  const asJSON=JSON.stringify(policy);
  assert.ok(!asJSON.includes('api_key'));
  for(const entry of Object.values(policy.roles)) {
    assert.equal(Object.hasOwn(entry.preferred,'model_id'),false);
    assert.equal(Object.hasOwn(entry.independent_review,'model_id'),false);
    assert.ok(entry.escalation.every(c=>!Object.hasOwn(c,'model_id')));
  }
  assert.equal(policy.rules.no_automatic_fallback,true);
  assert.equal(policy.rules.require_human_merge,true);
});
test('frontend prefiere Antigravity con Claude Sonnet y escala a Opus',()=>{
  const route=candidate('frontend');
  assert.equal(route.execution,'dry-run');
  assert.equal(route.preferred.executor,'antigravity');
  assert.equal(route.preferred.model_family,'claude-sonnet');
  assert.equal(route.preferred.model_id,null);
  assert.equal(route.preferred.adapter_implemented,true);
  assert.equal(route.escalation[0].trigger,'verified_quality_failure');
  assert.equal(route.escalation[0].model_family,'claude-opus');
  assert.equal(route.escalation[1].executor,'codex');
  assert.equal(route.independent_review.executor,'codex');
  assert.equal(route.dispatch_ready,false,'sin modelo real validado jamás habilita dispatch');
});
test('backend, SDK y arquitectura preservan Codex como ejecutor principal',()=>{
  for(const role of ['backend','sdk','architect']){
    const p=candidate(role);
    assert.equal(p.preferred.executor,'codex');
    assert.equal(p.preferred.model_family,'codex');
    assert.equal(p.preferred.model_id,null);
    assert.equal(p.dispatch_ready,false);
  }
});
test('QA prefiere Antigravity Gemini y mantiene revisor independiente Codex',()=>{
  const p=candidate('qa');
  assert.equal(p.preferred.executor,'antigravity');
  assert.equal(p.preferred.model_family,'gemini');
  assert.equal(p.independent_review.executor,'codex');
  assert.equal(p.guarantees.require_deterministic_tests,true);
});
test('ni riesgo crítico ni estado DONE habilitan ejecución desde el selector',()=>{
  const completed=planCapabilityRoute(backlog,'TASK-001','frontend',policy);
  assert.deepEqual(completed.reason,['task_not_ready']);
  const critical=structuredClone(backlog);
  critical.tasks[1].risk='critical';
  assert.deepEqual(planCapabilityRoute(critical,'TASK-002','frontend',policy).reason,
    ['critical_requires_human_authorization']);
});
test('no infiere rol de texto de tarea ni inventa rutas alternativas',()=>{
  assert.throws(()=>planCapabilityRoute(backlog,'TASK-002',undefined,policy),/rol desconocido/);
  assert.throws(()=>planCapabilityRoute(backlog,'TASK-002','designer',policy),/rol desconocido/);
  assert.throws(()=>planCapabilityRoute(backlog,'TASK-999','frontend',policy),/tarea inexistente/);
  const tampered=structuredClone(policy);
  tampered.roles.frontend.preferred.model_family='claude-random';
  assert.throws(()=>validateCapabilityPolicy(tampered),/familia permitidos|incompatible/);
  const bypass=structuredClone(policy);
  bypass.rules.no_automatic_fallback=false;
  assert.throws(()=>validateCapabilityPolicy(bypass),/no pueden desactivarse/);
});
test('rechaza políticas con combinaciones de CLI y modelo incompatibles',()=>{
  const p=structuredClone(policy);
  p.roles.frontend.preferred.executor='codex';
  assert.throws(()=>validateCapabilityPolicy(p),/incompatible/);
  p.roles.frontend.preferred.executor='opencode';
  assert.throws(()=>validateCapabilityPolicy(p),/locally-configured/);
});
test('CLI capability route es dry-run e impide --execute y argumentos ambiguos',()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'arcav-capability-cli-'));
  try{
    const file=path.join(tmp,'backlog.json'),settings=path.join(tmp,'policy.json');
    fs.writeFileSync(file,JSON.stringify(backlog));fs.writeFileSync(settings,JSON.stringify(policy));
    const cli=path.resolve('bin/cli.js');
    const invoke=(...args)=>spawnSync(process.execPath,[cli,'capability',...args],{
      cwd:tmp,encoding:'utf8',shell:false,
    });
    const base=['route','TASK-002','--file',file,'--role','frontend','--policy',settings];
    const result=invoke(...base,'--json');
    assert.equal(result.status,0,result.stderr);
    const r=JSON.parse(result.stdout);
    assert.equal(r.preferred.model_family,'claude-sonnet');
    assert.equal(r.execution,'dry-run');
    assert.equal(r.dispatch_ready,false);
    assert.equal(invoke(...base,'--execute').status,1);
    assert.equal(invoke(...base,'--role','backend').status,1);
    assert.equal(invoke('route','TASK-002','--file',file,'--policy',settings).status,1);
    assert.deepEqual(fs.readdirSync(tmp).sort(),['backlog.json','policy.json']);
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
