import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {prepareTaskPacket} from '../execution/packet.js';
import {planTaskExecution,executeTaskPlan} from '../execution/runner.js';
import {inspectTaskWorktree} from '../worktree/manager.js';
import {previewBudgetReservation,reserveBudget,settleBudget} from '../budget/manager.js';

/**
 * MVP12: one opt-in Codex implementer dispatch. No background scheduler,
 * retries, review execution, automatic worktree creation, or merges.
 */
function inspect(input) {
  const {repoRoot,backlog,taskId,models,policy,runId,maxTotalTokens,timeoutSeconds}=input;
  if (typeof repoRoot !== 'string' || !repoRoot) throw new Error('scheduler: --repo obligatorio.');
  const root=fs.realpathSync(repoRoot);
  const branch=execFileSync('git',['symbolic-ref','--quiet','--short','HEAD'],{
    cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],
  }).trim();
  if(branch!=='main') throw new Error('scheduler: --repo debe ser el checkout principal en main.');
  const wt=inspectTaskWorktree(root,taskId);
  if(!wt.exists) throw new Error('scheduler: crea primero el worktree con worktree create --execute.');
  if(!wt.clean) throw new Error('scheduler: worktree tiene cambios pendientes; no se despacha Codex.');
  if(wt.head_sha!==wt.base_sha) {
    throw new Error('scheduler: worktree no coincide con main; sincronizar y revisar commits antes de despachar.');
  }
  // prepareTaskPacket validates the whole DAG, status READY and dependencies DONE.
  const packet=prepareTaskPacket(backlog,taskId,{repoRoot:wt.target,models});
  const executionPlan=planTaskExecution(packet,{maxTotalTokens,timeoutSeconds});
  const admission=previewBudgetReservation(root,policy,{
    runId,taskId,tokens:executionPlan.max_total_tokens,kind:'implementation',
  });
  if (!admission.allowed) throw new Error('scheduler: bloqueado por budget: '+admission.reason+'.');
  const publicPlan={
    execution:'dry-run',provider:'codex',task_id:taskId,run_id:runId,
    worktree:wt.target,branch:wt.branch,head_sha:wt.head_sha,
    model_id:executionPlan.model_id,prompt_bytes:executionPlan.prompt_bytes,
    timeout_seconds:executionPlan.timeout_seconds,max_total_tokens:executionPlan.max_total_tokens,
    admission:{allowed:admission.allowed,remaining_tokens:admission.remaining_tokens,
      reserved_tokens:admission.reserved_tokens,active_runs:admission.active_runs,
      max_in_flight:admission.max_in_flight},
    token_limit_is_hard:false,run_requires_execute:true,human_review_required:true,
  };
  return {root,worktree:wt,executionPlan,publicPlan};
}

export function planScheduledDispatch(input) {
  return inspect(input).publicPlan;
}

/**
 * The budget reserve happens BEFORE starting Codex.
 * Every normally-returning path settles once. A hard process crash retains
 * the reservation and fails closed until investigated.
 */
export async function executeScheduledDispatch(input,{
  executeTask=executeTaskPlan,reserve=reserveBudget,settle=settleBudget,
}={}) {
  const prepared=inspect(input);
  const {root,worktree,executionPlan,publicPlan}=prepared;
  const {policy,runId,taskId}=input;
  // Atomic admission. If another process reserved meanwhile, this throws
  // BEFORE any agent process is started.
  reserve(root,policy,{runId,taskId,tokens:executionPlan.max_total_tokens,kind:'implementation'});
  let run;
  try {
    run=await executeTask(executionPlan,{repoRoot:worktree.target});
  } catch(error) {
    run={task_id:taskId,status:'runner_failed',error_code:error.code??'RUNNER',
      usage:null,telemetry_complete:false};
  }
  // Incomplete/missing telemetry is never counted as zero: charge reservation.
  // The total may exceed the requested amount when the CLI reports more.
  const complete=run?.telemetry_complete===true &&
    Number.isSafeInteger(run.usage?.input_tokens) &&
    Number.isSafeInteger(run.usage?.output_tokens) &&
    (run.usage.input_tokens+run.usage.output_tokens)>0;
  let settlement;
  try {
    settlement=settle(root,{runId,usage:complete?run.usage:null});
  } catch(error) {
    // Retained reservation blocks new work. No automatic retry or rollback.
    throw new Error('scheduler: error al contabilizar consumo; reserva conservada para '+runId+
      '. No reintentar sin investigar. '+error.message);
  }
  return {
    execution:'executed',provider:'codex',task_id:taskId,run_id:runId,
    worktree:publicPlan.worktree,branch:publicPlan.branch,model_id:publicPlan.model_id,
    status:run?.status??'runner_failed',
    error_code:run?.error_code??null,
    usage:complete?run.usage:null,
    settlement:{source:settlement.source,accounted_tokens:settlement.accounted_tokens,
      over_reservation:settlement.over_reservation},
    token_limit_is_hard:false,human_review_required:true,merge_approved:false,
  };
}
