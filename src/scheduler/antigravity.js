import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {inspectTaskWorktree} from '../worktree/manager.js';
import {prepareTaskPacket} from '../execution/packet.js';
import {planCapabilityRoute} from '../capabilities/policy.js';
import {previewBudgetReservation,reserveBudget,settleBudget} from '../budget/manager.js';
import {planAntigravityExecution,executeAntigravityPlan,verifyInstalledAntigravityModel} from '../execution/antigravity.js';

/** One frontend worktree, one pinned Antigravity model, no automatic escalation. */
function inspect(input){
  const {repoRoot,backlog,taskId,capabilities,budgetPolicy,modelSlug,runId,maxTotalTokens,timeoutSeconds}=input;
  const root=fs.realpathSync(repoRoot);
  const branch=execFileSync('git',['symbolic-ref','--quiet','--short','HEAD'],{
    cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']
  }).trim();
  if(branch!=='main')throw new Error('antigravity: --repo debe apuntar al checkout principal main.');
  const route=planCapabilityRoute(backlog,taskId,'frontend',capabilities);
  if(route.preferred.executor!=='antigravity'||route.preferred.model_family!=='claude-sonnet'){
    throw new Error('antigravity: política frontend no apunta a Claude Sonnet.');
  }
  if(route.reason.some(r=>r!=='provider_and_model_require_validation')){
    throw new Error('antigravity: tarea no apta: '+route.reason.join(', '));
  }
  if(typeof modelSlug!=='string'||!/^(?:claude.*sonnet|sonnet.*claude)$/i.test(modelSlug)){
    throw new Error('antigravity: slug frontend debe ser Claude Sonnet de agy models.');
  }
  if(budgetPolicy?.provider!=='antigravity')throw new Error('antigravity: se requiere budget provider=antigravity.');
  const wt=inspectTaskWorktree(root,taskId);
  if(!wt.exists||!wt.clean||wt.head_sha!==wt.base_sha){
    throw new Error('antigravity: worktree ausente, sucio o divergente de main.');
  }
  const packet=prepareTaskPacket(backlog,taskId,{repoRoot:wt.target});
  const plan=planAntigravityExecution(packet,{modelSlug,maxTotalTokens,timeoutSeconds});
  const admission=previewBudgetReservation(root,budgetPolicy,{
    runId,taskId,tokens:plan.max_total_tokens,kind:'implementation'
  });
  if(!admission.allowed)throw new Error('antigravity: budget bloqueado: '+admission.reason);
  return {root,wt,plan,summary:{
    execution:'dry-run',provider:'antigravity',task_id:taskId,run_id:runId,
    role:'frontend',model_family:'claude-sonnet',model_id:modelSlug,
    worktree:wt.target,branch:wt.branch,head_sha:wt.head_sha,
    prompt_bytes:plan.prompt_bytes,timeout_seconds:timeoutSeconds,
    max_total_tokens:plan.max_total_tokens,
    admission:{allowed:admission.allowed,remaining_tokens:admission.remaining_tokens,
      active_runs:admission.active_runs,max_in_flight:admission.max_in_flight},
    model_checked:false,credentials_verified:false,requires_execute:true,
    token_limit_is_hard:false,human_review_required:true
  }};
}
export function planAntigravityDispatch(input){
  return inspect(input).summary;
}
export async function executeAntigravityDispatch(input,{
  checkModel=verifyInstalledAntigravityModel,
  reserve=reserveBudget,runAgent=executeAntigravityPlan,settle=settleBudget
}={}){
  const {root,wt,plan,summary}=inspect(input);
  // Non-generative CLI inspection, before reserving tokens.
  checkModel(plan.model_id,{cwd:wt.target});
  // The lock enforces admission atomically (including Codex active runs).
  reserve(root,input.budgetPolicy,{
    runId:input.runId,taskId:input.taskId,tokens:plan.max_total_tokens,kind:'implementation'
  });
  let result;
  try{result=await runAgent(plan,{repoRoot:wt.target});}
  catch(e){
    result={status:'runner_failed',error_code:e.code??'RUNNER',usage:null,telemetry_complete:false};
  }
  // No terminal telemetry: charge the full reserved estimate, never zero.
  const usage=result?.telemetry_complete===true?result.usage:null;
  let settled;
  try{settled=settle(root,{runId:input.runId,usage});}
  catch(e){throw new Error('antigravity: fallo del ledger; reserva retenida, inspeccionar antes de reintentar. '+e.message);}
  return {execution:'executed',provider:'antigravity',task_id:input.taskId,run_id:input.runId,
    role:'frontend',model_id:plan.model_id,branch:summary.branch,worktree:wt.target,
    status:result?.status??'runner_failed',error_code:result?.error_code??null,
    usage:usage??null,settlement:{source:settled.source,accounted_tokens:settled.accounted_tokens,
      over_reservation:settled.over_reservation},human_review_required:true,
    merge_approved:false,token_limit_is_hard:false};
}
