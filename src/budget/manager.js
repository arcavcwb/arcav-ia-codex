import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';

const MAX_LEDGER_BYTES = 8 * 1024 * 1024;
const RUN_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;
const TASK_ID = /^TASK-[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (n,min,max,label) => {
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error('budget: '+label+' debe ser entero '+min+'..'+max+'.');
  return n;
};
const nowISO = value => {
  const d = new Date(typeof value === 'function' ? value() : value);
  if (!Number.isFinite(d.getTime())) throw new Error('budget: fecha inválida.');
  return d.toISOString();
};
const dateMS = value => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('budget: fecha del registro inválida.');
  return Date.parse(value);
};

/** This is an internal admission policy, NOT an official provider quota or a billing limit. */
export function validateBudgetPolicy(value) {
  if (!isObject(value) || value.schema_version !== 1 || value.provider !== 'codex') {
    throw new Error('budget: política v1 debe declarar provider=codex.');
  }
  const keys=['schema_version','provider','window_hours','token_budget','threshold_pct','max_in_flight'];
  for(const key of Object.keys(value)) if (!keys.includes(key)) throw new Error('budget: campo desconocido '+key);
  integer(value.window_hours,1,168,'window_hours');
  integer(value.token_budget,100,100000000,'token_budget');
  integer(value.threshold_pct,1,100,'threshold_pct');
  integer(value.max_in_flight,1,16,'max_in_flight');
  return Object.freeze({...value});
}
export function loadBudgetPolicy(filename) {
  if (typeof filename !== 'string' || !filename.trim()) throw new Error('budget: --policy obligatorio.');
  return validateBudgetPolicy(JSON.parse(fs.readFileSync(path.resolve(filename),'utf8')));
}

/** Every linked Git worktree has the same git-common-dir, hence the same ledger. */
export function budgetPaths(repoRoot) {
  const root=fs.realpathSync(repoRoot);
  const call=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  if (fs.realpathSync(call('rev-parse','--show-toplevel'))!==root) {
    throw new Error('budget: --repo debe apuntar a la raíz del repositorio o worktree.');
  }
  const common=fs.realpathSync(path.resolve(root,call('rev-parse','--git-common-dir')));
  if (!fs.statSync(common).isDirectory()) throw new Error('budget: directorio Git inválido.');
  const dir=path.join(common,'arcav-budget');
  return {root,dir,file:path.join(dir,'ledger.json'),lock:path.join(dir,'ledger.lock')};
}
function requireSafeDirectory(dir,{create=false}={}) {
  let stat;
  try {stat=fs.lstatSync(dir);}
  catch(error) {
    if(error.code!=='ENOENT') throw error;
    if (!create) return false;
    try {fs.mkdirSync(dir,{mode:0o700});}
    catch(err) {if(err.code!=='EEXIST')throw err;}
    stat=fs.lstatSync(dir);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('budget: directorio de estado inseguro.');
  return true;
}
function readLedger(paths) {
  if (!requireSafeDirectory(paths.dir)) return {schema_version:1,entries:[]};
  let stat;
  try {stat=fs.lstatSync(paths.file);}
  catch(error) {if(error.code==='ENOENT') return {schema_version:1,entries:[]};throw error;}
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size>MAX_LEDGER_BYTES) throw new Error('budget: ledger no es un archivo regular válido.');
  const ledger=JSON.parse(fs.readFileSync(paths.file,'utf8'));
  if (!isObject(ledger) || ledger.schema_version!==1 || !Array.isArray(ledger.entries) || ledger.entries.length>20000) {
    throw new Error('budget: estructura ledger inválida; se bloquean nuevas reservas.');
  }
  const seen=new Set();
  for(const row of ledger.entries) {
    if (!isObject(row) || !RUN_ID.test(row.run_id??'') || seen.has(row.run_id) ||
        !TASK_ID.test(row.task_id??'') || row.provider!=='codex' ||
        !['implementation','review'].includes(row.kind) ||
        !['reserved','settled'].includes(row.status)) {
      throw new Error('budget: registro inválido o duplicado; se bloquean nuevas reservas.');
    }
    seen.add(row.run_id);
    integer(row.reserved_tokens,100,100000,'reserved_tokens');
    dateMS(row.created_at);
    if (row.status==='settled') {
      dateMS(row.settled_at);
      integer(row.accounted_tokens,1,100000000,'accounted_tokens');
      if (!['reported','estimated'].includes(row.source)) throw new Error('budget: fuente de uso inválida.');
    }
  }
  return ledger;
}
function persist(paths,ledger) {
  const tmp=path.join(paths.dir,'ledger.tmp-'+process.pid+'-'+randomBytes(8).toString('hex'));
  try {
    fs.writeFileSync(tmp,JSON.stringify(ledger,null,2)+'\n',{flag:'wx',mode:0o600});
    fs.renameSync(tmp,paths.file);
  } finally {
    try {fs.unlinkSync(tmp);}catch(error){if(error.code!=='ENOENT')throw error;}
  }
}
/** Exclusive OS-level create; contention/stale locks FAIL CLOSED, never silently bypass. */
function mutate(paths,transform) {
  requireSafeDirectory(paths.dir,{create:true});
  let fd;
  try {fd=fs.openSync(paths.lock,'wx',0o600);}
  catch(error) {
    if(error.code==='EEXIST') throw new Error('budget: ledger bloqueado; revisar lock antes de reintentar.');
    throw error;
  }
  try {
    const ledger=readLedger(paths);
    const output=transform(ledger);
    persist(paths,ledger);
    return output;
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(paths.lock);
  }
}
function summarize(ledger,policy,time) {
  const cutoff=Date.parse(time)-policy.window_hours*3600000;
  let used=0,reserved=0,active=0,estimated=0;
  for(const entry of ledger.entries) {
    if (entry.status==='reserved') {reserved+=entry.reserved_tokens;active++;continue;}
    if(dateMS(entry.settled_at)>=cutoff) {
      used+=entry.accounted_tokens;
      if(entry.source==='estimated') estimated++;
    }
  }
  const cap=Math.floor(policy.token_budget*policy.threshold_pct/100);
  return {provider:'codex',window_hours:policy.window_hours,token_budget:policy.token_budget,
    threshold_pct:policy.threshold_pct,cap_tokens:cap,used_tokens:used,
    reserved_tokens:reserved,active_runs:active,max_in_flight:policy.max_in_flight,
    remaining_tokens:Math.max(0,cap-used-reserved),estimated_runs_in_window:estimated,
    total_runs_recorded:ledger.entries.length,token_limit_is_hard:false,
    official_quota_known:false,cost_usd:null};
}
function ensureRequest(runId,taskId,tokens,kind) {
  if (typeof runId!=='string' || !RUN_ID.test(runId)) throw new Error('budget: run_id inválido.');
  if (typeof taskId!=='string' || !TASK_ID.test(taskId)) throw new Error('budget: task_id inválido.');
  integer(tokens,100,100000,'tokens estimados');
  if (!['implementation','review'].includes(kind)) throw new Error('budget: kind inválido.');
}
function admission(ledger,policy,runId,tokens,time) {
  if(ledger.entries.some(e=>e.run_id===runId)) throw new Error('budget: run_id ya registrado (sin reintentos implícitos).');
  const snapshot=summarize(ledger,policy,time);
  let reason=null;
  if(snapshot.active_runs>=policy.max_in_flight)reason='concurrencia máxima alcanzada';
  else if(tokens>snapshot.remaining_tokens)reason='presupuesto disponible insuficiente';
  return {...snapshot,allowed:reason===null,reason,requested_tokens:tokens};
}
export function budgetStatus(repoRoot,policy,{now=()=>new Date()}={}) {
  validateBudgetPolicy(policy);
  return summarize(readLedger(budgetPaths(repoRoot)),policy,nowISO(now));
}
export function previewBudgetReservation(repoRoot,policy,{runId,taskId,tokens,kind='implementation',now=()=>new Date()}) {
  validateBudgetPolicy(policy);
  ensureRequest(runId,taskId,tokens,kind);
  return {execution:'dry-run',...admission(readLedger(budgetPaths(repoRoot)),policy,runId,tokens,nowISO(now))};
}
export function reserveBudget(repoRoot,policy,{runId,taskId,tokens,kind='implementation',now=()=>new Date()}) {
  validateBudgetPolicy(policy);
  ensureRequest(runId,taskId,tokens,kind);
  const paths=budgetPaths(repoRoot);
  return mutate(paths,ledger=>{
    const time=nowISO(now),check=admission(ledger,policy,runId,tokens,time);
    if (!check.allowed) throw new Error('budget: reserva denegada: '+check.reason+'.');
    ledger.entries.push({run_id:runId,task_id:taskId,provider:'codex',kind,
      reserved_tokens:tokens,status:'reserved',created_at:time});
    return {execution:'executed',run_id:runId,task_id:taskId,...summarize(ledger,policy,time)};
  });
}
function checkedUsage(usage) {
  if (usage===null) return null;
  if(!isObject(usage)) throw new Error('budget: usage inválido.');
  const input=integer(usage.input_tokens,0,100000000,'input_tokens');
  const output=integer(usage.output_tokens,0,100000000,'output_tokens');
  const cached=integer(usage.cached_input_tokens??0,0,100000000,'cached_input_tokens');
  const reasoning=integer(usage.reasoning_output_tokens??0,0,100000000,'reasoning_output_tokens');
  if (!input && !output) throw new Error('budget: telemetría sin consumo; use estimación explícita.');
  if(cached>input || reasoning>output) throw new Error('budget: desglose de tokens incoherente.');
  return {input_tokens:input,output_tokens:output,cached_input_tokens:cached,
    reasoning_output_tokens:reasoning,total_tokens:input+output};
}
export function previewBudgetSettlement(repoRoot,runId) {
  if(typeof runId!=='string'||!RUN_ID.test(runId))throw new Error('budget: run_id inválido.');
  const row=readLedger(budgetPaths(repoRoot)).entries.find(x=>x.run_id===runId);
  if(!row || row.status!=='reserved') throw new Error('budget: reserva inexistente o ya liquidada.');
  return {execution:'dry-run',run_id:runId,task_id:row.task_id,reserved_tokens:row.reserved_tokens};
}
export function settleBudget(repoRoot,{runId,usage=null,now=()=>new Date()}) {
  if(typeof runId!=='string'||!RUN_ID.test(runId))throw new Error('budget: run_id inválido.');
  const observed=checkedUsage(usage);
  return mutate(budgetPaths(repoRoot),ledger=>{
    const row=ledger.entries.find(x=>x.run_id===runId);
    if(!row || row.status!=='reserved') throw new Error('budget: reserva inexistente o ya liquidada.');
    row.status='settled';row.settled_at=nowISO(now);
    row.source=observed?'reported':'estimated';
    row.accounted_tokens=observed?.total_tokens??row.reserved_tokens;
    if(observed) row.usage=observed;
    return {execution:'executed',run_id:runId,task_id:row.task_id,source:row.source,
      reserved_tokens:row.reserved_tokens,accounted_tokens:row.accounted_tokens,
      over_reservation:row.accounted_tokens>row.reserved_tokens,
      token_limit_is_hard:false,cost_usd:null};
  });
}
