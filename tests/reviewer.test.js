import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {planIndependentReview, parseReviewResult, executeIndependentReview} from '../src/execution/reviewer.js';

const diff='diff --git a/src/x.js b/src/x.js\n+const x=2;\n';
const digest=createHash('sha256').update(diff).digest('hex');
const task={id:'TASK-001',title:'Validación',risk:'low',acceptance_criteria:['OK']};
const handoff={execution:'review-handoff-only',status:'ready_for_independent_review',task,
  reviewer:{tier:'sol',model_id:'review-test-model'},
  review_contract:{independent_review_completed:false,merge_approved:false,implementer_conversation_included:false},
  qa:{branch:'feat/example',head_sha:'a'.repeat(40),base_sha:'b'.repeat(40),diff_sha256:digest,
    checks:{diff_present:true,no_untracked_files:true,whitespace_clean:true,tests_passed:true},tests:{executed:true,exit_code:0}},
  diff:{included:true,sha256:digest,content:diff}};
const output={verdict:'needs_changes',summary:'Falta validación de tipos',findings:[{severity:'medium',file:'src/x.js',line:1,message:'Agregar tipo de entrada'}]};
const event=(obj)=>JSON.stringify(obj)+'\n';
function fakeGit(dir, {changed=false,untracked=false}={}) {
  return (bin,args)=>{
    assert.equal(bin,'git');
    const cmd=args.join(' ');
    if(cmd==='rev-parse --show-toplevel') return dir+'\n';
    if(cmd==='branch --show-current') return 'feat/example\n';
    if(cmd==='rev-parse HEAD') return 'a'.repeat(40)+'\n';
    if(cmd==='merge-base HEAD main') return 'b'.repeat(40)+'\n';
    if(cmd==='diff --no-ext-diff --binary '+ 'b'.repeat(40)+' --') return Buffer.from(changed?'DIFFERENT':diff);
    if(cmd==='ls-files --others --exclude-standard') return untracked?'secret.txt\n':'';
    throw new Error('unexpected '+cmd);
  };
}
function fakeSpawn(events,{exit=0,onSpawn=()=>{},after=()=>{}}={}) {
  return (exe,args,opts)=>{
    onSpawn(exe,args,opts);
    const child=new EventEmitter();
    child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{child.killed=true;};
    queueMicrotask(()=>{for(const item of events) child.stdout.write(event(item));child.stdout.end();after();child.emit('close',exit,null);});
    return child;
  };
}
function withDir(callback) {const d=fs.mkdtempSync(path.join(os.tmpdir(),'mvp8-'));try {return callback(d)} finally {fs.rmSync(d,{recursive:true,force:true});}}

const completed={type:'turn.completed',usage:{input_tokens:20,output_tokens:30,cached_input_tokens:5}};
const message={type:'item.completed',item:{type:'agent_message',text:JSON.stringify(output)}};

test('plan de revisión es de solo lectura, sesión efímera y sin historial del implementador',()=>{
  const p=planIndependentReview(handoff);
  assert.equal(p.execution,'dry-run');assert.equal(p.model_id,'review-test-model');
  assert.ok(p.argv.includes('read-only'));assert.ok(p.argv.includes('--ephemeral'));
  assert.ok(!p.argv.includes('workspace-write'));assert.ok(!p.argv.includes('resume'));
  assert.equal(p.max_total_tokens,8000);assert.equal(p.token_limit_is_hard,false);
  assert.equal(p.prompt.includes('historial del implementador'),false);
  assert.deepEqual(p.argv.slice(0,3),['--ask-for-approval','never','exec']);
});
test('falla cerrado con QA incompleto, diff adulterado, riesgo crítico o modelo desconocido',()=>{
  const values=[
    {...handoff,status:'blocked_awaiting_qa'},
    {...handoff,qa:{...handoff.qa,checks:{...handoff.qa.checks,tests_passed:false}}},
    {...handoff,diff:{...handoff.diff,content:'other'}},
    {...handoff,task:{...task,risk:'critical'}},
    {...handoff,reviewer:{model_id:null}},
    {...handoff,review_contract:{...handoff.review_contract,merge_approved:true}},
  ];
  for(const x of values) assert.throws(()=>planIndependentReview(x));
  assert.throws(()=>planIndependentReview(handoff,{timeoutSeconds:2}));
  assert.throws(()=>planIndependentReview(handoff,{maxTotalTokens:100001}));
});
test('rechaza salidas JSON inválidas, campos inválidos o pass con hallazgo alto',()=>{
  assert.throws(()=>parseReviewResult('NO JSON'));
  assert.throws(()=>parseReviewResult(JSON.stringify({...output,verdict:'maybe'})));
  assert.throws(()=>parseReviewResult(JSON.stringify({...output,findings:[{...output.findings[0],line:-1}]})));
  assert.throws(()=>parseReviewResult(JSON.stringify({...output,verdict:'pass',findings:[{...output.findings[0],severity:'high'}]})));
  assert.equal(parseReviewResult(JSON.stringify(output)).verdict,'needs_changes');
});
test('ejecuta revisión simulada y nunca autoriza merge',async()=>{
  const d=fs.mkdtempSync(path.join(os.tmpdir(),'mvp8-exec-'));
  try {
    let call;
    const res=await executeIndependentReview(planIndependentReview(handoff),{repoRoot:d,git:fakeGit(d),
      spawnImpl:fakeSpawn([message,completed],{onSpawn:(...args)=>call=args})});
    assert.equal(res.status,'completed_needs_human_review');
    assert.equal(res.review_completed,true);assert.equal(res.verdict,'needs_changes');
    assert.equal(res.findings.length,1);assert.equal(res.usage.total_tokens,50);
    assert.equal(res.merge_approved,false);assert.equal(res.human_review_required,true);
    assert.equal(call[0],'codex');assert.equal(call[2].shell,false);
  }finally{fs.rmSync(d,{recursive:true,force:true})}
});
test('bloquea cambio de diff antes de iniciar o presencia de untracked',async()=>withDir(async d=>{
  assert.throws(()=>executeIndependentReview(planIndependentReview(handoff),{repoRoot:d,git:fakeGit(d,{changed:true})}),/cambió/);
  assert.throws(()=>executeIndependentReview(planIndependentReview(handoff),{repoRoot:d,git:fakeGit(d,{untracked:true})}),/cambió/);
}));
test('salida sin telemetría o revisión inválida no es aprobación',async()=>{
  const d=fs.mkdtempSync(path.join(os.tmpdir(),'mvp8-failed-'));
  try{
    let r=await executeIndependentReview(planIndependentReview(handoff),{repoRoot:d,git:fakeGit(d),spawnImpl:fakeSpawn([message])});
    assert.equal(r.status,'telemetry_missing');assert.equal(r.merge_approved,false);
    r=await executeIndependentReview(planIndependentReview(handoff),{repoRoot:d,git:fakeGit(d),spawnImpl:fakeSpawn([
      {type:'item.completed',item:{type:'agent_message',text:'not json'}},completed])});
    assert.equal(r.status,'review_invalid');
  }finally {fs.rmSync(d,{recursive:true,force:true})}
});
test('exceso de presupuesto se informa sin alegar un corte duro',async()=>{
  const d=fs.mkdtempSync(path.join(os.tmpdir(),'mvp8-budget-'));
  try{
    const p=planIndependentReview(handoff,{maxTotalTokens:100});
    const r=await executeIndependentReview(p,{repoRoot:d,git:fakeGit(d),spawnImpl:fakeSpawn([message,
      {type:'turn.completed',usage:{input_tokens:150,output_tokens:30}}])});
    assert.equal(r.status,'budget_exceeded');assert.equal(r.merge_approved,false);
  }finally{fs.rmSync(d,{recursive:true,force:true})}
});
test('detecta cambios inesperados durante revisión',async()=>{
  const d=fs.mkdtempSync(path.join(os.tmpdir(),'mvp8-change-'));
  try{
    let count=0;
    const git=(...args)=>fakeGit(d,{changed:count++>=5})(...args);
    const r=await executeIndependentReview(planIndependentReview(handoff),{repoRoot:d,git,spawnImpl:fakeSpawn([message,completed])});
    assert.equal(r.status,'workspace_changed');assert.equal(r.review_completed,false);
  }finally{fs.rmSync(d,{recursive:true,force:true})}
});


// Regression: numeric CLI flags were mistakenly parsed with a literal \\d regexp.
import { spawnSync } from 'node:child_process';
const commandModule = new URL('../src/backlog/command.js', import.meta.url).href;
test('review-run acepta límites numéricos válidos antes de validar el backlog', () => withDir(dir => {
  const modelsFile = path.join(dir,'models.json');
  const invalidBacklog = path.join(dir,'backlog.json');
  fs.writeFileSync(modelsFile, JSON.stringify({luna:'model-1',sol:'model-2',astra:'model-3'}));
  fs.writeFileSync(invalidBacklog, '{}');
  const code = `import {runPlanningCommand} from ${JSON.stringify(commandModule)}; process.exit(await runPlanningCommand(process.argv.slice(1)));`;
  for (const additionalArgs of [
    ['--max-total-tokens','4000','--timeout-seconds','120'],
    ['--max-total-tokens','4000','--timeout-seconds','120','--test-timeout-seconds','60','--max-review-bytes','32768'],
  ]) {
    const res = spawnSync(process.execPath,['--input-type=module','-e',code,'task','review-run','TASK-001',
      '--file',invalidBacklog,'--repo',dir,'--models',modelsFile,
      '--run-tests','--include-diff','--execute',...additionalArgs],{cwd:dir,encoding:'utf8'});
    assert.equal(res.status,1);
    assert.match(res.stderr,/Backlog inválido/);
    assert.doesNotMatch(res.stderr,/requiere un entero positivo/);
  }
}));
