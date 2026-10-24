import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {prepareTaskPacket} from '../src/execution/packet.js';
import {planAntigravityExecution,executeAntigravityPlan,verifyInstalledAntigravityModel} from '../src/execution/antigravity.js';
import {planAntigravityDispatch,executeAntigravityDispatch} from '../src/scheduler/antigravity.js';
import {createTaskWorktree} from '../src/worktree/manager.js';
import {budgetStatus,reserveBudget} from '../src/budget/manager.js';

const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const cap=JSON.parse(fs.readFileSync(new URL('../docs/examples/capability-policy.json',import.meta.url),'utf8'));
const budget={schema_version:1,provider:'antigravity',window_hours:24,
  token_budget:10000,threshold_pct:40,max_in_flight:1};
const codexBudget={...budget,provider:'codex'};
const task={id:'TASK-001',story_id:'US-001',title:'Implementar header responsive',
  description:'Implementar un header accesible y adaptable en móvil',
  acceptance_criteria:['Header visible para usuarios con teclado'],
  dependencies:[],status:'ready',story_points:2,risk:'low',
  complexity:{scope:0,ambiguity:1,integration:0,impact:0,verification:1},
  test_plan:['npm test']};
const backlog={schema_version:1,epics:[{id:'EP-001',title:'UI'}],
  stories:[{id:'US-001',epic_id:'EP-001',title:'Header',
    acceptance_criteria:['Header visible para usuarios con teclado']}],tasks:[task]};
const slug='claude-sonnet-local-test';
function fixture(fn,{worktree=true}={}){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'arcav-agy-')),repo=path.join(temp,'repo');
  fs.mkdirSync(repo);git(repo,'init','-b','main');
  git(repo,'config','user.name','QA');git(repo,'config','user.email','qa@example.invalid');
  fs.writeFileSync(path.join(repo,'README.md'),'fixture\n');git(repo,'add','.');git(repo,'commit','-m','base');
  const wt=worktree?createTaskWorktree(repo,'TASK-001').target:null;
  const input={repoRoot:repo,backlog,taskId:'TASK-001',capabilities:cap,budgetPolicy:budget,
    modelSlug:slug,runId:'agy-001',maxTotalTokens:2200,timeoutSeconds:30};
  try{
    const r=fn({repo,wt,input,temp});
    if(r&&typeof r.then==='function')return r.finally(()=>fs.rmSync(temp,{recursive:true,force:true}));
    fs.rmSync(temp,{recursive:true,force:true});return r;
  }catch(e){fs.rmSync(temp,{recursive:true,force:true});throw e;}
}
function childFor(events,{exit=0}={}){
  const c=new EventEmitter();
  c.stdout=new PassThrough();c.stderr=new PassThrough();
  c.kill=()=>true;
  let inputText='';
  c.stdin={on(){return c.stdin;},end(data){inputText+=data;
    process.nextTick(()=>{
      for(const event of events)c.stdout.write(JSON.stringify(event)+'\n');
      c.stdout.end();c.emit('close',exit,null);
    });
  }};
  c.getInput=()=>inputText;
  return c;
}
const terminal=(usage={input_tokens:1200,output_tokens:300,cache_read_tokens:200,total_tokens:1500},status='SUCCESS')=>
  ({event:'result',result:{status,usage,response:'do not expose secret details'}});
test('modelo se verifica con agy models sin modelo ni shell',()=>{
  const requested=[];
  const out=verifyInstalledAntigravityModel(slug,{cwd:'/tmp',spawnCheck:(cmd,args,opts)=>{
    requested.push({cmd,args,opts});
    return {status:0,stdout:'gemini-flash-fast Gemini Fast\n'+slug+' Claude Sonnet\n'};
  }});
  assert.equal(out.model_checked,true);
  assert.deepEqual(requested[0].args,['models']);
  assert.equal(requested[0].opts.shell,false);
  assert.throws(()=>verifyInstalledAntigravityModel('claude-opus-unknown',{
    spawnCheck:()=>({status:0,stdout:slug+' Claude'})}),/no listado/);
  assert.throws(()=>verifyInstalledAntigravityModel('--dangerously-skip-permissions'),/modelo inválido/);
});
test('plan de AGY no contiene flags de permisos peligrosos ni conversación anterior',()=>fixture(({wt,input})=>{
  const packet=prepareTaskPacket(backlog,'TASK-001',{repoRoot:wt});
  const plan=planAntigravityExecution(packet,{modelSlug:slug,maxTotalTokens:2200,timeoutSeconds:30});
  assert.equal(plan.command,'agy');assert.equal(plan.execution,'dry-run');
  assert.equal(plan.argv.includes('--sandbox'),true);
  assert.equal(plan.argv.includes('--dangerously-skip-permissions'),false);
  assert.equal(plan.argv.includes('--continue'),false);
  assert.equal(plan.argv.includes('--model'),true);
  assert.equal(plan.permissions_bypass,false);
  assert.equal(JSON.parse(plan.prompt).role,'frontend implementer');
}));
test('parser usa únicamente result.usage, nunca acumula step_update. No expone respuesta',()=>fixture(async ({wt})=>{
  const plan=planAntigravityExecution(prepareTaskPacket(backlog,'TASK-001',{repoRoot:wt}),
    {modelSlug:slug,maxTotalTokens:2200,timeoutSeconds:30});
  const child=childFor([
    {event:'init',init:{cwd:wt,permission_mode:'request-review'}},
    {event:'step_update',step_update:{usage:{input_tokens:4000,output_tokens:4000,total_tokens:8000}}},
    terminal()
  ]);
  const result=await executeAntigravityPlan(plan,{repoRoot:wt,spawnImpl:(cmd,args,opts)=>{
    assert.equal(cmd,'agy');assert.equal(opts.cwd,wt);assert.equal(opts.shell,false);
    assert.deepEqual(args,plan.argv);return child;
  }});
  assert.equal(result.status,'completed_needs_review');
  assert.equal(result.usage.total_tokens,1500);
  assert.equal(result.usage.cached_input_tokens,200);
  assert.equal(result.response,undefined);
  const sent=JSON.parse(child.getInput().trim());
  assert.equal(sent.event,'user');
  assert.equal(sent.message.content,plan.prompt);
}));
test('ERROR y uso ausente no se consideran éxito',()=>fixture(async ({wt})=>{
  const plan=planAntigravityExecution(prepareTaskPacket(backlog,'TASK-001',{repoRoot:wt}),
    {modelSlug:slug,maxTotalTokens:2200,timeoutSeconds:30});
  const error=await executeAntigravityPlan(plan,{repoRoot:wt,
    spawnImpl:()=>childFor([terminal({input_tokens:15,output_tokens:15,total_tokens:30},'ERROR')],{exit:1})});
  assert.equal(error.status,'antigravity_failed');
  const missing=await executeAntigravityPlan(plan,{repoRoot:wt,spawnImpl:()=>childFor([
    {event:'init',init:{permission_mode:'request-review'}},
    {event:'result',result:{status:'SUCCESS',usage:null}}
  ])});
  assert.equal(missing.status,'telemetry_missing');
}));
test('budget que supera reserva se informa como best effort',()=>fixture(async ({wt})=>{
  const plan=planAntigravityExecution(prepareTaskPacket(backlog,'TASK-001',{repoRoot:wt}),
    {modelSlug:slug,maxTotalTokens:2200,timeoutSeconds:30});
  const result=await executeAntigravityPlan(plan,{repoRoot:wt,
    spawnImpl:()=>childFor([terminal({input_tokens:2500,output_tokens:200,cache_read_tokens:0,total_tokens:2700})])});
  assert.equal(result.status,'budget_exceeded');
  assert.equal(result.usage.total_tokens,2700);
}));
test('dry-run frontend respeta modelo, backlog y worktree sin llamar a agy',()=>fixture(({repo,input,wt})=>{
  const p=planAntigravityDispatch(input);
  assert.equal(p.execution,'dry-run');assert.equal(p.worktree,wt);
  assert.equal(p.model_checked,false);assert.equal(p.credentials_verified,false);
  assert.equal(p.admission.allowed,true);
  assert.equal(fs.existsSync(path.join(repo,'.git','arcav-budget')),false);
  assert.throws(()=>planAntigravityDispatch({...input,modelSlug:'claude-opus-test'}),/Claude Sonnet/);
  assert.throws(()=>planAntigravityDispatch({...input,budgetPolicy:codexBudget}),/provider=antigravity/);
}));
test('dispatch atómico reserva antes de spawn y liquida uso de AGY',async()=>fixture(async ({repo,wt,input})=>{
  let calls=0;
  const r=await executeAntigravityDispatch(input,{
    checkModel:()=>({model_checked:true}),
    runAgent:async (_plan,{repoRoot})=>{
      calls++;assert.equal(repoRoot,wt);
      assert.equal(budgetStatus(repo,budget).active_runs,1);
      return {status:'completed_needs_review',telemetry_complete:true,
        usage:{input_tokens:800,output_tokens:300,cached_input_tokens:0,total_tokens:1100}};
    }
  });
  assert.equal(calls,1);
  assert.equal(r.status,'completed_needs_review');assert.equal(r.merge_approved,false);
  assert.equal(r.settlement.accounted_tokens,1100);
  assert.equal(budgetStatus(repo,budget).used_tokens,1100);
  assert.equal(budgetStatus(repo,codexBudget).used_tokens,0);
}));
test('Codex activo bloquea AGY, y AGY activo bloquea Codex por concurrencia global',async()=>fixture(async ({repo,input})=>{
  reserveBudget(repo,codexBudget,{runId:'codex-1',taskId:'TASK-001',tokens:900});
  let invoked=false;
  await assert.rejects(()=>executeAntigravityDispatch(input,{checkModel:()=>true,
    runAgent:async()=>{invoked=true;return null;}}),/budget/);
  assert.equal(invoked,false);
  assert.equal(budgetStatus(repo,budget).active_runs,1);
}));
test('sin telemetría o error de runner, imputa estimación y conserva revisión humana',async()=>fixture(async ({repo,input})=>{
  const r=await executeAntigravityDispatch(input,{
    checkModel:()=>true,runAgent:async()=>{throw new Error('network error');}
  });
  assert.equal(r.status,'runner_failed');assert.equal(r.settlement.source,'estimated');
  assert.equal(r.settlement.accounted_tokens,2200);
  assert.equal(budgetStatus(repo,budget).estimated_runs_in_window,1);
  assert.equal(r.human_review_required,true);
}));
test('no model check impide reservar tokens y ejecutar agente',async()=>fixture(async ({repo,input})=>{
  let invoked=false;
  await assert.rejects(()=>executeAntigravityDispatch(input,{
    checkModel:()=>{throw new Error('Model not installed');},
    runAgent:async()=>{invoked=true;return null;}
  }),/Model not installed/);
  assert.equal(invoked,false);
  assert.equal(budgetStatus(repo,budget).active_runs,0);
}));
