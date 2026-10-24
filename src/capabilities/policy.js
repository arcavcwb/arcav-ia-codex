import fs from 'node:fs';
import path from 'node:path';
import {validateBacklog} from '../backlog/validate.js';

const ROLES=Object.freeze(['frontend','backend','sdk','architect','qa']);
const EXECUTORS=new Set(['codex','antigravity','opencode']);
const FAMILIES=new Set(['claude-sonnet','claude-opus','gemini','codex','codex-advanced','locally-configured']);
const TRIGGERS=new Set(['verified_quality_failure','provider_unavailable']);
const isRecord=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);

function validCandidate(c,label) {
  if(!isRecord(c)||Object.keys(c).some(k=>!['executor','model_family'].includes(k))||
    !EXECUTORS.has(c.executor)||!FAMILIES.has(c.model_family)) {
    throw new Error('capability: '+label+' debe contener ejecutor y familia permitidos.');
  }
  if(c.executor==='codex' && !['codex','codex-advanced'].includes(c.model_family)) {
    throw new Error('capability: '+label+' combina Codex con una familia incompatible.');
  }
  if(c.executor==='antigravity' && !['claude-sonnet','claude-opus','gemini'].includes(c.model_family)) {
    throw new Error('capability: '+label+' combina Antigravity con familia incompatible.');
  }
  if(c.executor==='opencode' && c.model_family!=='locally-configured') {
    throw new Error('capability: '+label+' requiere familia locally-configured.');
  }
}
export function validateCapabilityPolicy(policy) {
  if(!isRecord(policy)||policy.schema_version!==1||
    policy.intent!=='capability-routing-plan-only'||
    !isRecord(policy.roles)||!isRecord(policy.rules)||
    Object.keys(policy).some(k=>!['schema_version','intent','roles','rules'].includes(k))) {
    throw new Error('capability: política v1 no válida.');
  }
  if(ROLES.some(r=>!policy.roles[r]) || Object.keys(policy.roles).some(r=>!ROLES.includes(r))) {
    throw new Error('capability: se requieren roles frontend, backend, sdk, architect y qa.');
  }
  for(const role of ROLES) {
    const row=policy.roles[role];
    if(!isRecord(row)||Object.keys(row).some(k=>!['preferred','escalation','independent_review'].includes(k))) {
      throw new Error('capability: configuración de '+role+' inválida.');
    }
    validCandidate(row.preferred,role+'.preferred');
    validCandidate(row.independent_review,role+'.independent_review');
    if(!Array.isArray(row.escalation)||row.escalation.length>3)throw new Error('capability: escalamiento inválido para '+role+'.');
    const triggers=new Set();
    for(const [i,next] of row.escalation.entries()){
      if(!isRecord(next)||!TRIGGERS.has(next.trigger)||triggers.has(next.trigger)||
        Object.keys(next).some(k=>!['trigger','executor','model_family'].includes(k))) {
        throw new Error('capability: escalamiento o trigger duplicado en '+role+'.');
      }
      triggers.add(next.trigger);
      validCandidate({executor:next.executor,model_family:next.model_family},role+'.escalation['+i+']');
    }
  }
  const keys=['no_automatic_fallback','require_explicit_model_id','require_provider_auth_check',
    'require_atomic_budget_admission','require_deterministic_tests','require_human_merge'];
  if(keys.some(k=>policy.rules[k]!==true)||Object.keys(policy.rules).some(k=>!keys.includes(k))) {
    throw new Error('capability: garantías de seguridad no pueden desactivarse.');
  }
  return policy;
}
export function loadCapabilityPolicy(filename) {
  if(typeof filename!=='string'||!filename.trim())throw new Error('capability: archivo de política obligatorio.');
  const source=fs.readFileSync(path.resolve(filename),'utf8');
  if(Buffer.byteLength(source,'utf8')>32*1024)throw new Error('capability: política demasiado grande.');
  return validateCapabilityPolicy(JSON.parse(source));
}
/** Planning only: no model invocation, no credentials, no changes to backlog or Git. */
export function planCapabilityRoute(backlog,taskId,role,policy) {
  validateCapabilityPolicy(policy);
  if(!ROLES.includes(role))throw new Error('capability: rol desconocido '+String(role));
  const valid=validateBacklog(backlog);
  if(!valid.valid)throw new Error('capability: backlog inválido: '+valid.errors.join('; '));
  const task=backlog.tasks.find(t=>t.id===taskId);
  if(!task)throw new Error('capability: tarea inexistente '+String(taskId));
  const byId=new Map(backlog.tasks.map(t=>[t.id,t]));
  const unmet=task.dependencies.filter(dep=>byId.get(dep)?.status!=='done');
  const reasons=[];
  if(task.status!=='ready')reasons.push('task_not_ready');
  if(task.risk==='critical')reasons.push('critical_requires_human_authorization');
  if(unmet.length)reasons.push('dependencies_incomplete');
  const selected=policy.roles[role];
  const candidate=c=>({...c,model_id:null,model_id_verified:false,credentials_verified:false,
    adapter_implemented:c.executor==='codex'||
      (role==='frontend'&&c.executor==='antigravity'&&c.model_family==='claude-sonnet')});
  return {
    execution:'dry-run',task_id:task.id,role,risk:task.risk,
    dispatch_ready:false,reason:reasons.length?reasons:['provider_and_model_require_validation'],
    unmet_dependencies:unmet,
    preferred:candidate(selected.preferred),
    escalation:selected.escalation.map(c=>({trigger:c.trigger,...candidate(c)})),
    independent_review:candidate(selected.independent_review),
    guarantees:{...policy.rules},
    note:'Plan consultivo: adapter AGY frontend disponible vía antigravity dispatch (separado del scheduler Codex). Ningún modelo se invoca con capability route.'
  };
}
