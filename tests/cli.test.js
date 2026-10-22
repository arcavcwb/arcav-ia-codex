import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const cli=path.resolve('bin/cli.js');
// La versión esperada sale de package.json para no fijarla en el test.
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const task={
  id:'TASK-001',story_id:'US-001',title:'CLI',description:'Probar CLI',
  acceptance_criteria:['Se ejecuta'],dependencies:[],status:'ready',story_points:1,
  risk:'low',complexity:{scope:0,ambiguity:0,integration:0,impact:0,verification:0},test_plan:['node --test']
};
const data={schema_version:1,epics:[{id:'EP-001',title:'CLI'}],stories:[{id:'US-001',epic_id:'EP-001',title:'CLI',acceptance_criteria:['Responde correctamente']}],tasks:[task]};
const modelIds = { luna: 'codex-small', sol: 'codex-medium', astra: 'codex-strong' };
const gitUser = ['-c', 'user.name=Arcav Test', '-c', 'user.email=arcav@example.test'];
function inTemp(callback){
  const dir=mkdtempSync(path.join(tmpdir(),'arcav-backlog-'));
  try{return callback(dir)}finally{rmSync(dir,{recursive:true,force:true})}
}
function run(dir,...args){return spawnSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});}
// Salida completa del proceso para los mensajes de las aserciones.
function output(result) {
  return `${result.stdout}\n${result.stderr}`;
}
// JSON de stdout; si no lo es, el fallo muestra la salida completa.
function parseStdout(result) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    assert.fail(`stdout no es JSON:\n${output(result)}`);
  }
}
function plainHelp(dir) {
  return run(dir, '--help').stdout.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Repositorio en dir: main → develop (añade b.js) → feat/base (modifica a.js sin confirmar).
 * tasks.json, models.json y package.json, con el script de test dado, quedan versionados en main.
 */
function baseRepo(dir, testScript = 'node -e "process.exit(0)"') {
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q', '-b', 'main');
  writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify(data));
  writeFileSync(path.join(dir, 'models.json'), JSON.stringify(modelIds));
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: testScript } }));
  writeFileSync(path.join(dir, 'a.js'), 'export const a = 1;\n');
  git('add', '.');
  git(...gitUser, 'commit', '-q', '-m', 'baseline');
  // develop avanza respecto a main; la rama de feature sale de develop.
  git('switch', '-q', '-c', 'develop');
  writeFileSync(path.join(dir, 'b.js'), 'export const b = 1;\n');
  git('add', 'b.js');
  git(...gitUser, 'commit', '-q', '-m', 'develop');
  git('switch', '-q', '-c', 'feat/base');
  writeFileSync(path.join(dir, 'a.js'), 'export const a = 2;\n');
  return git;
}

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
test('comandos clásicos --help y --version siguen disponibles', () => inTemp(dir => {
  const help = run(dir, '--help');
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /init/);
  assert.match(help.stdout, /--doctor/);
  assert.match(help.stdout, /backlog validate/);
  const version = run(dir, '--version');
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), `${pkg.name} v${pkg.version}`);
}));

test('--help lista todos los comandos de planificación y la opción --base', () => inTemp(dir => {
  const help = run(dir, '--help');
  assert.equal(help.status, 0, help.stderr);
  const commands = ['backlog plan', 'backlog validate', 'route', 'sprint plan', 'task prepare', 'task run', 'task verify', 'task review', 'task review-run'];
  for (const command of commands) {
    assert.match(help.stdout, new RegExp(`^  ${command} `, 'm'), command);
  }
  assert.match(help.stdout, /^  --base ref /m);
}));

test('cada línea de --help, sin códigos ANSI, cabe en 80 columnas', () => inTemp(dir => {
  const help = run(dir, '--help');
  assert.equal(help.status, 0, output(help));
  const plain = help.stdout.replace(/\x1b\[[0-9;]*m/g, '');
  for (const line of plain.split('\n')) {
    // Columnas como puntos de código: '═' o 'ó' ocupan una sola.
    const columns = [...line].length;
    assert.ok(columns <= 80, `${columns} columnas: ${line}`);
  }
}));

test('el banner describe el alcance actual y mantiene la caja alineada', () => inTemp(dir => {
  const help = run(dir, '--help');
  const plain = help.stdout.replace(/\x1b\[[0-9;]*m/g, '');
  const box = plain.split('\n').filter(line => /^[╔║╚]/.test(line));
  assert.equal(box.length, 5);
  for (const line of box) {
    assert.equal([...line].length, [...box[0]].length, line);
  }
  assert.doesNotMatch(plain, /5 Codex Agents/);
}));

test('backlog plan crea borrador de PRD y éste valida sin ejecutar modelos', () => inTemp(dir => {
  const prd = path.join(dir, 'PRD.md');
  const output = path.join(dir, 'backlog', 'tasks.json');
  writeFileSync(prd, '# PRD\n## Épica: Órdenes\n### Historia: Registrar\n- Se guarda el cliente\n');
  const r = run(dir, 'backlog', 'plan', prd, '--out', output);
  assert.equal(r.status, 0, r.stderr);
  // Una sola tarea TDD por criterio: el mensaje va en singular.
  assert.match(r.stdout, /1 tarea\b/);
  assert.equal(run(dir, 'backlog', 'validate', '--file', output).status, 0);
  const result = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(result.tasks.length, 1);
  assert.deepEqual(result.tasks.map(t => t.status), ['draft']);
  assert.deepEqual(result.tasks[0].dependencies, []);
}));

test('backlog plan --out cuenta tareas y advertencias en plural o singular', () => inTemp(dir => {
  const prd = path.join(dir, 'PRD.md');
  const output = path.join(dir, 'tasks.json');
  // Dos criterios distintos y uno duplicado: dos tareas y una advertencia.
  writeFileSync(prd, '## Épica: Clientes\n### Historia: Alta\n- Guardar CLIENTE\n- guardar cliente\n- Borrar cliente\n');
  const r = run(dir, 'backlog', 'plan', prd, '--out', output);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\(2 tareas; 1 advertencia\)/);
}));

test('backlog plan --out --json imprime un resumen JSON; sin --out imprime el backlog', () => inTemp(dir => {
  const prd = path.join(dir, 'PRD.md');
  const file = path.join(dir, 'tasks.json');
  // Dos criterios distintos y uno duplicado: dos tareas y una advertencia.
  writeFileSync(prd, '## Épica: Clientes\n### Historia: Alta\n- Guardar CLIENTE\n- guardar cliente\n- Borrar cliente\n');
  const summary = run(dir, 'backlog', 'plan', prd, '--out', file, '--json');
  assert.equal(summary.status, 0, output(summary));
  assert.deepEqual(JSON.parse(summary.stdout), {
    file,
    tasks: 2,
    warnings: ['Línea 4: criterio duplicado ignorado en US-001.'],
    stats: { epics: 1, stories: 1, criteria: 2, tasks: 2 },
  });
  // Sin --out, --json no cambia nada: la salida es el mismo backlog que se escribió.
  const printed = run(dir, 'backlog', 'plan', prd, '--json');
  assert.equal(printed.status, 0, output(printed));
  assert.equal(printed.stdout, readFileSync(file, 'utf8'));
}));

// sh es necesario: solo una tubería real (FIFO) tiene el búfer de 64 KiB en el que process.exit()
// cortaba la salida. spawnSync conecta stdout a un socket y no reproduce el corte.
test('backlog plan entrega la salida completa por una tubería aunque pase de 64 KiB', { skip: process.platform === 'win32' }, () => inTemp(dir => {
  const prd = path.join(dir, 'PRD.md');
  // Unos 400 KB de JSON: muy por encima de los cortes observados (64 o 128 KiB).
  const criteria = Array.from({ length: 400 }, (_, i) => `- Criterio verificable número ${i + 1}`);
  writeFileSync(prd, `## Épica: Grande\n### Historia: Muchos criterios\n${criteria.join('\n')}\n`);
  const expectedFile = path.join(dir, 'esperado.json');
  const written = run(dir, 'backlog', 'plan', prd, '--out', expectedFile);
  assert.equal(written.status, 0, output(written));
  const expected = readFileSync(expectedFile);
  assert.ok(expected.length > 64 * 1024, `la salida esperada mide ${expected.length} bytes`);
  const piped = path.join(dir, 'salida.json');
  // Las rutas van como parámetros posicionales de sh, nunca interpoladas en el script.
  execFileSync('sh', ['-c', '"$1" "$2" backlog plan "$3" | cat > "$4"', 'sh', process.execPath, cli, prd, piped]);
  const actual = readFileSync(piped);
  assert.equal(actual.length, expected.length, 'bytes recibidos por la tubería');
  assert.ok(actual.equals(expected), 'la tubería recibe el mismo JSON que --out');
}));

test('backlog plan sin --out imprime JSON puro y no sobrescribe archivos',()=>inTemp(dir=>{
  const prd=path.join(dir,'PRD.md');
  const out=path.join(dir,'tasks.json');
  writeFileSync(prd,'## Épica: E\n### Historia: H\n- Crit 1\n');
  const run1=run(dir,'backlog','plan',prd);
  assert.equal(run1.status,0,run1.stderr);
  assert.equal(JSON.parse(run1.stdout).tasks.length, 1);
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


test('task prepare entrega JSON de contexto acotado sin cambiar archivos',()=>inTemp(dir=>{
  const source={...data,tasks:[{...task,context_files:['src/example.js']}]};
  mkdirSync(path.join(dir,'src'));
  const code=path.join(dir,'src','example.js');writeFileSync(code,'export const x = 3;\n');
  const file=path.join(dir,'tasks.json');const before=JSON.stringify(source);writeFileSync(file,before);
  const r=run(dir,'task','prepare','TASK-001','--file',file,'--repo',dir,'--max-context-bytes','4096','--json');
  assert.equal(r.status,0,r.stderr);
  const packet=JSON.parse(r.stdout);
  assert.equal(packet.execution,'dry-run');assert.equal(packet.task.id,'TASK-001');
  assert.equal(packet.context_files[0].content,'export const x = 3;\n');
  assert.equal(packet.packet_bytes,Buffer.byteLength(JSON.stringify(packet),'utf8'));
  assert.equal(readFileSync(file,'utf8'),before);
  assert.equal(readFileSync(code,'utf8'),'export const x = 3;\n');
}));

test('task prepare no admite flags peligrosos y protege rutas',()=>inTemp(dir=>{
  const file=path.join(dir,'tasks.json');writeFileSync(file,JSON.stringify(data));
  assert.equal(run(dir,'task','prepare','TASK-001','--file',file,'--out','x.json').status,1);
  assert.equal(run(dir,'task','prepare','TASK-001','--file',file,'--capacity','2').status,1);
  assert.equal(run(dir,'task','prepare','TASK-001','--file',file,'--max-context-bytes','invalid').status,1);
  assert.equal(run(dir,'task','prepare','TASK-X','--file',file).status,1);
  assert.equal(run(dir,'sprint','plan','--file',file,'--capacity','2','--repo',dir).status,1);
}));

test('task run --run-tests nombra la opción rechazada', () => inTemp(dir => {
  const r = run(dir, 'task', 'run', 'TASK-001', '--run-tests');
  assert.equal(r.status, 1);
  assert.equal(r.stderr.trim(), 'task run no admite --run-tests.');
}));

test('task run exige --models antes de leer archivos y la ayuda lo muestra obligatorio', () => inTemp(dir => {
  // El backlog no existe: si --models no se exigiera primero, fallaría al leerlo.
  const r = run(dir, 'task', 'run', 'TASK-001', '--file', path.join(dir, 'no-existe.json'));
  assert.equal(r.status, 1, output(r));
  assert.equal(r.stderr.trim(), 'task run requiere --models.');
  assert.match(plainHelp(dir), /^  task run TASK-ID --models ruta /m);
}));

test('una opción sin valor indica qué le falta', () => inTemp(dir => {
  const cases = [
    [['sprint', 'plan', '--capacity'], '--capacity requiere un valor.'],
    [['task', 'run', 'TASK-001', '--max-total-tokens', '--execute'], '--max-total-tokens requiere un valor.'],
    [['route', 'TASK-001', '--file'], '--file requiere una ruta.'],
  ];
  for (const [args, message] of cases) {
    const r = run(dir, ...args);
    assert.equal(r.status, 1, args.join(' '));
    assert.equal(r.stderr.trim(), message);
  }
}));

test('los requisitos entre opciones nombran las opciones que faltan', () => inTemp(dir => {
  const cases = [
    [['task', 'run', 'TASK-001', '--models', 'models.json', '--execute'], '--execute exige --max-total-tokens y --timeout-seconds.'],
    [['task', 'review-run', 'TASK-001', '--models', 'models.json'], 'task review-run requiere --run-tests y --include-diff.'],
    [['task', 'verify', 'TASK-001', '--test-timeout-seconds', '30'], '--test-timeout-seconds exige --run-tests.'],
    [['sprint', 'plan', '--file', 'tasks.json'], 'sprint plan requiere --capacity.'],
    [['sprint', 'plan', '--capacity', 'dos'], '--capacity requiere un entero entre 1 y 1000.'],
  ];
  for (const [args, message] of cases) {
    const r = run(dir, ...args);
    assert.equal(r.status, 1, args.join(' '));
    assert.equal(r.stderr.trim(), message);
  }
}));

test('cada entero valida su rango antes de leer archivos y la ayuda lo muestra', () => inTemp(dir => {
  const missing = path.join(dir, 'no-existe.json');
  // [opción, mínimo, máximo, valor por defecto, comando que la admite]. El backlog no existe:
  // un valor fuera de rango debe rechazarse antes de intentar leerlo.
  const cases = [
    ['capacity', 1, 1000, undefined, ['sprint', 'plan']],
    ['max-context-bytes', 4096, 131072, 32768, ['task', 'prepare', 'TASK-001']],
    ['max-total-tokens', 100, 100000, 8000, ['task', 'run', 'TASK-001', '--models', missing]],
    ['timeout-seconds', 10, 3600, 300, ['task', 'run', 'TASK-001', '--models', missing]],
    ['test-timeout-seconds', 10, 600, 120, ['task', 'verify', 'TASK-001', '--run-tests']],
    ['max-review-bytes', 4096, 131072, 65536, ['task', 'review', 'TASK-001', '--include-diff']],
  ];
  const help = plainHelp(dir).split('\n');
  for (const [name, min, max, byDefault, command] of cases) {
    for (const value of [min - 1, max + 1]) {
      const r = run(dir, ...command, '--file', missing, `--${name}`, String(value));
      assert.equal(r.status, 1, `--${name} ${value}: ${output(r)}`);
      assert.equal(r.stderr.trim(), `--${name} requiere un entero entre ${min} y ${max}.`);
    }
    for (const value of [min, max]) {
      const r = run(dir, ...command, '--file', missing, `--${name}`, String(value));
      // El valor se acepta y el comando sigue hasta leer el archivo inexistente.
      assert.match(r.stderr, /^No se pudo leer JSON en /, `--${name} ${value}: ${output(r)}`);
    }
    // La ayuda muestra rango y valor por defecto en la línea siguiente a la opción.
    const at = help.findIndex(line => line.startsWith(`  --${name} N `));
    const range = `Entero entre ${min} y ${max}${byDefault === undefined ? '' : `; por defecto ${byDefault}`}.`;
    assert.equal(help[at + 1]?.trim(), range, name);
  }
}));

test('task review-run rechaza --timeout-seconds fuera de rango antes de ejecutar npm test', () => inTemp(dir => {
  // npm test deja una marca en disco: si aparece, el CLI ejecutó código del proyecto.
  baseRepo(dir, `node -e "require('node:fs').writeFileSync('npm-test-ran', '')"`);
  const marker = path.join(dir, 'npm-test-ran');
  const reviewRun = (...extra) => run(dir, 'task', 'review-run', 'TASK-001', '--file', 'tasks.json', '--repo', dir,
    '--models', 'models.json', '--run-tests', '--include-diff', ...extra);
  const rejected = reviewRun('--timeout-seconds', '5');
  assert.equal(existsSync(marker), false, `npm test no debe ejecutarse con un valor inválido:\n${output(rejected)}`);
  assert.equal(rejected.status, 1, output(rejected));
  assert.equal(rejected.stderr.trim(), '--timeout-seconds requiere un entero entre 10 y 3600.');
  // Control: con un valor válido el mismo comando sí ejecuta npm test.
  const control = reviewRun('--timeout-seconds', '10');
  assert.equal(existsSync(marker), true, output(control));
}));

test('--base solo lo admiten task verify, task review y task review-run', () => inTemp(dir => {
  const route = run(dir, 'route', 'TASK-001', '--base', 'main');
  assert.equal(route.status, 1);
  assert.equal(route.stderr.trim(), 'route no admite --base.');
  const sprint = run(dir, 'sprint', 'plan', '--capacity', '2', '--base', 'main');
  assert.equal(sprint.status, 1);
  assert.equal(sprint.stderr.trim(), 'sprint plan no admite --base.');
}));

test('--base rechaza una referencia que git leería como opción', () => inTemp(dir => {
  const commands = [
    ['task', 'verify', 'TASK-001'],
    ['task', 'review', 'TASK-001'],
    ['task', 'review-run', 'TASK-001', '--models', 'models.json', '--run-tests', '--include-diff'],
  ];
  for (const command of commands) {
    const r = run(dir, ...command, '--base', '-x');
    assert.equal(r.status, 1, command.join(' '));
    assert.equal(r.stderr.trim(), '--base: referencia Git inválida: -x.');
  }
}));

test('task verify --base calcula el diff contra esa rama y la muestra', () => inTemp(dir => {
  const git = baseRepo(dir);
  const verify = (...extra) => run(dir, 'task', 'verify', 'TASK-001', '--file', 'tasks.json', '--repo', dir, ...extra);

  const fromMain = verify('--json');
  assert.equal(fromMain.status, 0, fromMain.stderr);
  assert.equal(JSON.parse(fromMain.stdout).base_ref, 'main');
  assert.deepEqual(JSON.parse(fromMain.stdout).changed_files, ['a.js', 'b.js']);

  const fromDevelop = verify('--base', 'develop', '--json');
  assert.equal(fromDevelop.status, 0, fromDevelop.stderr);
  const report = JSON.parse(fromDevelop.stdout);
  assert.equal(report.base_ref, 'develop');
  assert.equal(report.base_sha, git('rev-parse', 'develop'));
  assert.deepEqual(report.changed_files, ['a.js']);

  const text = verify('--base', 'develop');
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /^Base: develop \(merge-base [0-9a-f]{40}\)\.$/m);
}));

test('task review y task review-run llevan --base hasta QA y el plan, también en texto', () => inTemp(dir => {
  const git = baseRepo(dir);
  const developSha = git('rev-parse', 'develop');
  const common = ['TASK-001', '--file', 'tasks.json', '--repo', dir, '--base', 'develop', '--run-tests', '--include-diff'];

  const review = run(dir, 'task', 'review', ...common, '--json');
  assert.equal(review.status, 0, output(review));
  const handoff = JSON.parse(review.stdout);
  assert.equal(handoff.qa.base_ref, 'develop');
  assert.equal(handoff.qa.base_sha, developSha);
  // Contra main el diff incluiría también b.js, que llegó con develop.
  assert.deepEqual(handoff.qa.changed_files, ['a.js']);

  const plan = run(dir, 'task', 'review-run', ...common, '--models', 'models.json', '--json');
  assert.equal(plan.status, 0, output(plan));
  assert.equal(JSON.parse(plan.stdout).base_ref, 'develop');
  assert.equal(JSON.parse(plan.stdout).base_sha, developSha);

  const text = run(dir, 'task', 'review-run', ...common, '--models', 'models.json');
  assert.equal(text.status, 0, output(text));
  assert.match(text.stdout, /^DRY-RUN revisión de TASK-001: /m);
  assert.match(text.stdout, new RegExp(`^Base: develop \\(merge-base ${developSha}\\)\\.$`, 'm'));
}));

// Un ejecutable "codex" falso (primero en PATH) recibe el prompt por stdin y emite eventos JSONL
// como codex exec --json: dos agent_message y un turn.completed con el uso de tokens.
test('task run --execute guarda el último agent_message y solo muestra su ruta', { skip: process.platform === 'win32' }, t => inTemp(dir => {
  const repo = path.join(dir, 'repo');
  const bin = path.join(dir, 'bin');
  mkdirSync(repo);
  mkdirSync(bin);
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q', '-b', 'main');
  writeFileSync(path.join(repo, 'README.md'), 'repo\n');
  git('add', '.');
  git(...gitUser, 'commit', '-q', '-m', 'baseline');
  git('switch', '-q', '-c', 'feat/run');
  const file = path.join(dir, 'tasks.json');
  const models = path.join(dir, 'models.json');
  const argvFile = path.join(dir, 'codex-argv.json');
  writeFileSync(file, JSON.stringify(data));
  writeFileSync(models, JSON.stringify(modelIds));
  const fakeCodex = [
    `#!${process.execPath}`,
    "const fs = require('node:fs');",
    'const args = process.argv.slice(2);',
    // Sonda del test: solo comprueba que el archivo se puede ejecutar.
    "if (args[0] === '--version') process.exit(0);",
    `fs.writeFileSync(${JSON.stringify(argvFile)}, JSON.stringify(args));`,
    'const emit = event => console.log(JSON.stringify(event));',
    'process.stdin.resume();',
    "process.stdin.on('end', () => {",
    "  emit({ type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'PREAMBULO-DESCARTADO' } });",
    "  emit({ type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: 'CONTENIDO-PRIVADO-DEL-INFORME' } });",
    "  emit({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } });",
    '});',
  ].join('\n');
  const codex = path.join(bin, 'codex');
  writeFileSync(codex, fakeCodex, { mode: 0o755 });
  const probe = spawnSync(codex, ['--version'], { encoding: 'utf8' });
  if (probe.error?.code === 'EACCES') {
    t.skip(`${tmpdir()} no permite ejecutar archivos (¿montado con noexec?): el codex falso no puede arrancar.`);
    return;
  }
  assert.equal(probe.status, 0, `${output(probe)}\n${probe.error?.message ?? ''}`);
  const taskRun = (args, env = {}) => spawnSync(process.execPath, [cli, 'task', 'run', 'TASK-001', '--file', file, '--repo', repo, '--models', models, ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, ...env },
  });
  const execute = ['--max-total-tokens', '1000', '--timeout-seconds', '30', '--execute'];
  const reports = [];
  try {
    // El dry-run y la ejecución usan el mismo argv, sin --output-last-message.
    const expectedArgv = ['exec', '-c', 'approval_policy="never"', '--model', 'codex-small', '--sandbox', 'workspace-write', '--json', '-'];
    const dryRun = taskRun(['--json']);
    assert.equal(dryRun.status, 0, output(dryRun));
    assert.deepEqual(parseStdout(dryRun).argv, expectedArgv);

    const text = taskRun(execute);
    const report = text.stdout.match(/^Informe del implementador: (.+)$/m)?.[1];
    if (report) reports.push(report);
    assert.equal(text.status, 0, output(text));
    assert.match(text.stdout, /^TASK-001: completed_needs_review, 15 tokens observados\./m, output(text));
    assert.deepEqual(JSON.parse(readFileSync(argvFile, 'utf8')), expectedArgv);
    assert.ok(report, output(text));
    assert.equal(readFileSync(report, 'utf8'), 'CONTENIDO-PRIVADO-DEL-INFORME');
    // Ningún mensaje del modelo llega a la salida del CLI.
    assert.doesNotMatch(output(text), /PREAMBULO|CONTENIDO-PRIVADO/, output(text));
    // El informe vive fuera del repositorio: el worktree sigue limpio.
    assert.equal(git('status', '--porcelain'), '');

    const json = taskRun([...execute, '--json']);
    const result = parseStdout(json);
    if (result.report_file) reports.push(result.report_file);
    assert.equal(json.status, 0, output(json));
    assert.equal(result.status, 'completed_needs_review', output(json));
    assert.notEqual(result.report_file, report, output(json));
    assert.equal(readFileSync(result.report_file, 'utf8'), 'CONTENIDO-PRIVADO-DEL-INFORME');
    assert.doesNotMatch(output(json), /PREAMBULO|CONTENIDO-PRIVADO/, output(json));

    // Sin un temporal donde escribir, el modo texto dice por qué no hay informe.
    const unsaved = taskRun(execute, { TMPDIR: path.join(dir, 'no-existe') });
    assert.equal(unsaved.status, 0, output(unsaved));
    assert.doesNotMatch(unsaved.stdout, /Informe del implementador:/, output(unsaved));
    assert.equal(unsaved.stderr.trim(), 'No se pudo guardar el informe del implementador (ENOENT).', output(unsaved));
  } finally {
    // Los informes viven fuera de dir; solo se borra el directorio temporal propio del ejecutor.
    for (const reportFile of reports) {
      const reportDir = path.dirname(reportFile);
      if (path.basename(reportDir).startsWith('arcav-codex-')) rmSync(reportDir, { recursive: true, force: true });
    }
  }
}));

test('si npm test modifica el worktree, verify, review y review-run lo explican en texto', () => inTemp(dir => {
  // El script de test deja un artefacto sin registrar en el repositorio.
  baseRepo(dir, 'node -e "require(\'fs\').writeFileSync(\'reporte.xml\', \'x\')"');
  const artifact = path.join(dir, 'reporte.xml');
  const common = ['--file', 'tasks.json', '--repo', '.', '--base', 'develop', '--run-tests'];

  const verify = run(dir, 'task', 'verify', 'TASK-001', ...common);
  assert.equal(verify.status, 1, output(verify));
  assert.match(verify.stdout, /npm test modificó el worktree: creó archivos sin registrar \(reporte\.xml\)\./);
  assert.match(verify.stdout, /BLOQUEADO/);

  rmSync(artifact);
  const review = run(dir, 'task', 'review', 'TASK-001', ...common);
  assert.equal(review.status, 1, output(review));
  assert.match(review.stdout, /npm test modificó el worktree: creó archivos sin registrar \(reporte\.xml\)\./);

  rmSync(artifact);
  const reviewRun = run(dir, 'task', 'review-run', 'TASK-001', ...common, '--include-diff', '--models', 'models.json');
  assert.equal(reviewRun.status, 1, output(reviewRun));
  assert.match(reviewRun.stderr, /^Review handoff bloqueado: se requiere QA aprobado y diff íntegro\. npm test modificó el worktree/m);
}));

// sh con head: head cierra la tubería tras 100 bytes y el subshell guarda el código de salida del CLI.
test('si quien lee la tubería la cierra antes, el CLI termina con 0 y sin traza (EPIPE)', { skip: process.platform === 'win32' }, () => inTemp(dir => {
  const prd = path.join(dir, 'PRD.md');
  const criteria = Array.from({ length: 400 }, (_, i) => `- Criterio verificable número ${i + 1}`);
  writeFileSync(prd, `## Épica: Grande\n### Historia: Muchos criterios\n${criteria.join('\n')}\n`);
  const stderrFile = path.join(dir, 'stderr.txt');
  const statusFile = path.join(dir, 'status.txt');
  execFileSync('sh', ['-c', '( "$1" "$2" backlog plan "$3" 2> "$4"; echo $? > "$5" ) | head -c 100 > /dev/null',
    'sh', process.execPath, cli, prd, stderrFile, statusFile]);
  const stderr = readFileSync(stderrFile, 'utf8');
  assert.equal(readFileSync(statusFile, 'utf8').trim(), '0', stderr);
  assert.equal(stderr, '');
}));
