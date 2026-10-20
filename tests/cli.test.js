import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const cli=path.resolve('bin/cli.js');
const task={
  id:'TASK-001',story_id:'US-001',title:'CLI',description:'Probar CLI',
  acceptance_criteria:['Se ejecuta'],dependencies:[],status:'ready',story_points:1,
  risk:'low',complexity:{scope:0,ambiguity:0,integration:0,impact:0,verification:0},test_plan:['node --test']
};
const data={schema_version:1,epics:[{id:'EP-001',title:'CLI'}],stories:[{id:'US-001',epic_id:'EP-001',title:'CLI',acceptance_criteria:['Responde correctamente']}],tasks:[task]};
function inTemp(callback){
  const dir=mkdtempSync(path.join(tmpdir(),'arcav-backlog-'));
  try{return callback(dir)}finally{rmSync(dir,{recursive:true,force:true})}
}
function run(dir,...args){return spawnSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});}

test('backlog validate --file da 0 con un JSON correcto y 1 con errores',()=>inTemp(dir=>{
  const file=path.join(dir,'tasks.json');writeFileSync(file,JSON.stringify(data));
  const ok=run(dir,'backlog','validate','--file',file);
  assert.equal(ok.status,0,ok.stderr);assert.match(ok.stdout,/válido/);
  writeFileSync(file,'{}');const bad=run(dir,'backlog','validate','--file',file);
  assert.equal(bad.status,1);assert.match(bad.stderr,/schema_version/);
}));
test('route --json produce resultado parseable sin banner ni invocar modelos',()=>inTemp(dir=>{
  const file=path.join(dir,'tasks.json');writeFileSync(file,JSON.stringify(data));
  const r=run(dir,'route','TASK-001','--file',file,'--json');
  assert.equal(r.status,0,r.stderr);
  const parsed=JSON.parse(r.stdout);
  assert.equal(parsed.implementer.tier,'luna');assert.equal(parsed.task_id,'TASK-001');
}));
test('route rechaza ID no encontrado y backlog inválido',()=>inTemp(dir=>{
  const file=path.join(dir,'tasks.json');writeFileSync(file,JSON.stringify(data));
  assert.equal(run(dir,'route','TASK-X','--file',file).status,1);
  const broken={...data,tasks:[{...task,dependencies:['TASK-X']}]};
  writeFileSync(file,JSON.stringify(broken));
  assert.equal(run(dir,'route','TASK-001','--file',file).status,1);
}));
test('route soporta archivo de modelos local explícito',()=>inTemp(dir=>{
  const file=path.join(dir,'tasks.json');writeFileSync(file,JSON.stringify(data));
  const models=path.join(dir,'models.json');writeFileSync(models,JSON.stringify({luna:'codex-small',sol:'codex-medium',astra:'codex-strong'}));
  const r=run(dir,'route','TASK-001','--file',file,'--models',models,'--json');
  assert.equal(r.status,0,r.stderr);
  assert.equal(JSON.parse(r.stdout).implementer.model_id,'codex-small');
}));
test('comandos clásicos --help y --version siguen disponibles',()=>inTemp(dir=>{
  const help=run(dir,'--help');
  assert.equal(help.status,0,help.stderr);
  assert.match(help.stdout,/init/);
  assert.match(help.stdout,/--doctor/);
  assert.match(help.stdout,/backlog validate/);
  const version=run(dir,'--version');
  assert.equal(version.status,0,version.stderr);
  assert.match(version.stdout,/@arcav-ia\/codex v1\.1\.0/);
}));

test('backlog plan crea borrador de PRD y éste valida sin ejecutar modelos',()=>inTemp(dir=>{
  const prd=path.join(dir,'PRD.md');
  const output=path.join(dir,'backlog','tasks.json');
  writeFileSync(prd,'# PRD\n## Épica: Órdenes\n### Historia: Registrar\n- Se guarda el cliente\n');
  const r=run(dir,'backlog','plan',prd,'--out',output);
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/2 tareas/);
  assert.equal(run(dir,'backlog','validate','--file',output).status,0);
  const result=JSON.parse(readFileSync(output,'utf8'));
  assert.deepEqual(result.tasks.map(t=>t.status),['draft','draft']);
  assert.deepEqual(result.tasks[1].dependencies,['TASK-001']);
}));

test('backlog plan sin --out imprime JSON puro y no sobrescribe archivos',()=>inTemp(dir=>{
  const prd=path.join(dir,'PRD.md');
  const out=path.join(dir,'tasks.json');
  writeFileSync(prd,'## Épica: E\n### Historia: H\n- Crit 1\n');
  const run1=run(dir,'backlog','plan',prd);
  assert.equal(run1.status,0,run1.stderr);
  assert.equal(JSON.parse(run1.stdout).tasks.length,2);
  writeFileSync(out,'SIN TOCAR');
  const run2=run(dir,'backlog','plan',prd,'--out',out);
  assert.equal(run2.status,1);
  assert.equal(readFileSync(out,'utf8'),'SIN TOCAR');
}));

test('backlog plan informa errores y no crea salida si PRD inválido',()=>inTemp(dir=>{
  const prd=path.join(dir,'bad.md');const out=path.join(dir,'tasks.json');
  writeFileSync(prd,'## Épica: E\n### Historia: H\n');
  const r=run(dir,'backlog','plan',prd,'--out',out);
  assert.equal(r.status,1);
  assert.match(r.stderr,/sin criterios/i);
  assert.equal(existsSync(out),false);
}));

test('sprint plan --json respeta capacidad y devuelve selección y ruta sin invocar modelos',()=>inTemp(dir=>{
  const file=path.join(dir,'tasks.json');
  writeFileSync(file,JSON.stringify({...data,tasks:[task,{...task,id:'TASK-002',priority:1,story_points:2,status:'ready'}]}));
  const r=run(dir,'sprint','plan','--file',file,'--capacity','2','--json');
  assert.equal(r.status,0,r.stderr);
  const plan=JSON.parse(r.stdout);
  assert.equal(plan.execution,'dry-run');
  assert.deepEqual(plan.selected.map(t=>t.id),['TASK-002']);
  assert.deepEqual(plan.deferred.map(t=>t.id),['TASK-001']);
}));

test('sprint plan en modo texto informa bloqueos y no sobrescribe datos',()=>inTemp(dir=>{
  const file=path.join(dir,'tasks.json');
  const source=JSON.stringify({...data,tasks:[{...task,status:'draft'}, {...task,id:'TASK-002',risk:'critical'}]});
  writeFileSync(file,source);
  const r=run(dir,'sprint','plan','--file',file,'--capacity','3');
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/BLOCKED TASK-001/);
  assert.match(r.stdout,/BLOCKED TASK-002/);
  assert.equal(readFileSync(file,'utf8'),source);
}));

test('sprint plan exige capacidad válida y no admite salida que escriba',()=>inTemp(dir=>{
  const file=path.join(dir,'tasks.json');writeFileSync(file,JSON.stringify(data));
  assert.equal(run(dir,'sprint','plan','--file',file).status,1);
  assert.equal(run(dir,'sprint','plan','--capacity','-1','--file',file).status,1);
  assert.equal(run(dir,'sprint','plan','--capacity','0','--file',file).status,1);
  assert.equal(run(dir,'sprint','plan','--capacity','2','--out','plan.json','--file',file).status,1);
  assert.equal(existsSync(path.join(dir,'plan.json')),false);
  assert.equal(run(dir,'backlog','validate','--file',file,'--capacity','3').status,1);
}));
