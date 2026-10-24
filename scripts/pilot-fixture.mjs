import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const CLI_TASK='TASK-901';
const write=(target,content)=>{
  fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.writeFileSync(target,content,{flag:'wx',encoding:'utf8',mode:0o600});
};
const git=(root,...args)=>execFileSync('git',args,{
  cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:1024*1024,
}).trim();

/**
 * Generates a fresh, synthetic, intentionally RED repository and separate
 * config files. Does not authenticate, invoke Codex or change the host repo.
 */
export function createPilotFixture({directory}={}) {
  const base=directory===undefined
    ?fs.mkdtempSync(path.join(os.tmpdir(),'arcav-codex-pilot-'))
    :path.resolve(directory);
  if(directory!==undefined)fs.mkdirSync(base,{recursive:false,mode:0o700});
  const repo=path.join(base,'repo'),config=path.join(base,'config');
  fs.mkdirSync(repo,{mode:0o700});fs.mkdirSync(config,{mode:0o700});
  const files={
    'package.json': JSON.stringify({
      name:'arcav-codex-disposable-pilot',private:true,version:'0.0.0',
      type:'module',scripts:{test:'node --test'}
    },null,2)+'\n',
    'AGENTS.md': [
      '# Disposable Codex pilot rules',
      '',
      'Work exclusively on TASK-901 in this disposable repository.',
      'Edit only src/customer.js. Do not modify test files or project settings.',
      'Do not access the network, other repositories, credentials or external services.',
      'Do not commit, push, merge, delete files or change branches.',
      'Run npm test and report actual verification evidence.',
      ''
    ].join('\n'),
    'README.md':[
      '# Disposable validation pilot',
      '',
      'This repository is generated solely for a Codex CLI smoke test.',
      'The initial source intentionally fails the unit tests (TDD RED).',
      'No customer data, credentials or real business projects are included.',
      ''
    ].join('\n'),
    'src/customer.js':[
      '/** A deliberately incomplete implementation for the pilot. */',
      'export function isValidCustomerName(name) {',
      '  return typeof name === "string";',
      '}',
      ''
    ].join('\n'),
    'test/customer.test.js':[
      "import test from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import {isValidCustomerName} from '../src/customer.js';",
      '',
      "test('accepts names containing at least two non-space characters',()=>{",
      "  assert.equal(isValidCustomerName('Ana'),true);",
      "  assert.equal(isValidCustomerName(' Ana '),true);",
      '});',
      "test('rejects blank and single-character names',()=>{",
      "  for(const name of ['', '   ', 'A', ' A ', null, 7]) {",
      '    assert.equal(isValidCustomerName(name),false);',
      '  }',
      '});',
      ''
    ].join('\n'),
  };
  for(const [name,source] of Object.entries(files))write(path.join(repo,name),source);
  git(repo,'init','-b','main');
  git(repo,'config','user.name','ARCAV Pilot Fixture');
  git(repo,'config','user.email','pilot@localhost.invalid');
  git(repo,'add','--','AGENTS.md','README.md','package.json','src/customer.js','test/customer.test.js');
  git(repo,'commit','-m','test: create disposable RED pilot repository');
  const backlog={schema_version:1,
    epics:[{id:'EP-901',title:'Prueba aislada de ejecución Codex'}],
    stories:[{id:'US-901',epic_id:'EP-901',title:'Validar nombres sintéticos',
      acceptance_criteria:['Un nombre válido tiene al menos dos caracteres no vacíos tras trim']}],
    tasks:[{
      id:CLI_TASK,story_id:'US-901',title:'Corregir validación de nombre sintético',
      description:'Corregir únicamente src/customer.js; no cambiar test/customer.test.js, package.json ni otros archivos.',
      acceptance_criteria:[
        'Nombres string de longitud al menos 2 después de trim son válidos',
        'Vacíos, espacios, un solo carácter y valores no string son inválidos',
        'La suite npm test pasa sin cambiar las pruebas',
      ],
      dependencies:[],status:'ready',story_points:1,risk:'low',priority:2,
      complexity:{scope:0,ambiguity:0,integration:0,impact:0,verification:1},
      context_files:['src/customer.js','test/customer.test.js','package.json'],
      test_plan:[
        'RED: ejecutar npm test antes del cambio y observar un fallo',
        'GREEN: modificar solo src/customer.js y ejecutar npm test',
        'REFACTOR: comprobar que todos los tests siguen verdes',
      ]
    }]
  };
  const policy={schema_version:1,provider:'codex',window_hours:24,
    token_budget:10000,threshold_pct:40,max_in_flight:1};
  const modelProfiles={luna:'',sol:'',astra:''};
  write(path.join(config,'backlog.json'),JSON.stringify(backlog,null,2)+'\n');
  write(path.join(config,'budget-policy.json'),JSON.stringify(policy,null,2)+'\n');
  write(path.join(config,'models.local.json'),JSON.stringify(modelProfiles,null,2)+'\n');
  return {
    task_id:CLI_TASK,base_dir:base,repo_dir:repo,config_dir:config,
    backlog_file:path.join(config,'backlog.json'),
    models_file:path.join(config,'models.local.json'),
    policy_file:path.join(config,'budget-policy.json'),
    main_sha:git(repo,'rev-parse','HEAD'),
    baseline_tests:'intentionally failing until src/customer.js is fixed',
    authentication_checked:false,codex_executed:false,
    next_step:'Review docs/walkthroughs/real-codex-smoke-pilot.md before running --execute.'
  };
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    if(process.argv.length!==2 && !(process.argv.length===3 && process.argv[2]==='--json')) {
      throw new Error('Uso: node scripts/pilot-fixture.mjs [--json]');
    }
    const fixture=createPilotFixture();
    if(process.argv.includes('--json'))console.log(JSON.stringify(fixture,null,2));
    else{
      console.log('Piloto de Codex preparado SIN invocar IA.');
      console.log('Directorio: '+fixture.base_dir);
      console.log('Repositorio: '+fixture.repo_dir);
      console.log('Configuración: '+fixture.config_dir);
      console.log('Leer docs/walkthroughs/real-codex-smoke-pilot.md antes de usar --execute.');
    }
  }catch(error){console.error(error.message);process.exitCode=1;}
}
