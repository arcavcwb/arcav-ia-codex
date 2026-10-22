import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

// Límites comunes a cualquier sesión `codex exec --json`.
// stdout no se guarda: se cuentan sus bytes y solo se retiene la línea en curso.
const MAX_STDOUT_BYTES = 256 * 1024 * 1024;
// Codex 0.163.0 mete la salida de cada comando (hasta 1 MiB) en una sola línea
// item.completed. En el peor caso el escapado JSON la multiplica por 6 (cada byte de
// control pasa a ser \u00XX), así que 8 MiB cubre 6 MiB más el resto del evento.
const MAX_LINE_BYTES = 8 * 1024 * 1024;
const MAX_STDERR_BYTES = 1_000_000;
const KILL_GRACE_MS = 2000;

/** Precedencia común de estados; cada llamador puede renombrar invalid_stream y completed. */
function statusOf({ errorCode, timedOut, invalid, overBudget, exitCode, observed }) {
  if (errorCode) return 'spawn_error';
  if (timedOut) return 'timeout';
  if (invalid) return 'invalid_stream';
  if (overBudget) return 'budget_exceeded';
  if (exitCode !== 0) return 'codex_failed';
  if (!observed) return 'telemetry_missing';
  return 'completed';
}

/**
 * Lanza `codex` sin shell, envía el prompt por stdin y lee eventos JSONL de stdout.
 * No guarda stdout ni stderr: solo cuenta bytes, suma tokens de turn.completed y detecta streams inválidos.
 * onEvent(evento) recibe cada evento; si devuelve false (o lanza), el stream se marca inválido.
 * Con failOnTurnFailed, un evento turn.failed también invalida el stream. Los eventos
 * "error" no: Codex los emite en reintentos (p. ej. "Reconnecting... 1/5") con el turno
 * en marcha, y un error definitivo ya hace que Codex salga con un código no cero.
 * La promesa nunca se rechaza. spawn_threw indica que spawnImpl lanzó y no hubo proceso.
 */
export function runCodexJsonl({
  argv,
  prompt,
  cwd,
  timeoutSeconds,
  maxTotalTokens,
  spawnImpl = spawn,
  onEvent = () => true,
  failOnTurnFailed = false,
}) {
  return new Promise(resolve => {
    let child;
    try {
      child = spawnImpl('codex', argv, { cwd, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ status: 'spawn_error', spawn_threw: true, error_code: error?.code ?? 'SPAWN' });
      return;
    }

    const usage = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, total_tokens: 0 };
    const decoder = new StringDecoder('utf8');
    let pending = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let observed = false;
    let invalid = false;
    let overBudget = false;
    let timedOut = false;
    let finished = false;
    let killTimer = null;

    // SIGTERM y, si el proceso sigue vivo 2 s después, SIGKILL.
    function stop() {
      if (finished || killTimer) return;
      try {
        child.kill('SIGTERM');
      } catch {
        // El proceso ya terminó.
      }
      killTimer = setTimeout(() => {
        if (finished) return;
        try {
          child.kill('SIGKILL');
        } catch {
          // El proceso ya terminó.
        }
      }, KILL_GRACE_MS);
      killTimer.unref?.();
    }

    function invalidate() {
      invalid = true;
      stop();
    }

    // Solo input_tokens y output_tokens son obligatorios; el presupuesto se comprueba tras cada turno.
    function addUsage(reported) {
      const valid = Boolean(reported) &&
        ['input_tokens', 'output_tokens'].every(key => Number.isSafeInteger(reported[key]) && reported[key] >= 0);
      if (!valid) return false;
      observed = true;
      usage.input_tokens += reported.input_tokens;
      usage.output_tokens += reported.output_tokens;
      usage.cached_input_tokens += Number.isSafeInteger(reported.cached_input_tokens) ? reported.cached_input_tokens : 0;
      usage.total_tokens += reported.input_tokens + reported.output_tokens;
      if (usage.total_tokens > maxTotalTokens) {
        overBudget = true;
        stop();
      }
      return true;
    }

    // Una vez inválido, el stream deja de interpretarse (fallo cerrado).
    function handleLine(line) {
      if (invalid || !line.trim()) return;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        invalidate();
        return;
      }
      // Codex emite un objeto JSON por línea; cualquier otro valor es un stream inesperado.
      if (!event || typeof event !== 'object' || Array.isArray(event)) {
        invalidate();
        return;
      }
      if (failOnTurnFailed && event.type === 'turn.failed') {
        invalidate();
        return;
      }
      if (event.type === 'turn.completed' && !addUsage(event.usage)) {
        invalidate();
        return;
      }
      let accepted;
      try {
        accepted = onEvent(event);
      } catch {
        accepted = false;
      }
      if (accepted === false) invalidate();
    }

    child.stdout?.on('data', chunk => {
      if (invalid) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        invalidate();
        return;
      }
      pending += decoder.write(chunk);
      let newline = pending.indexOf('\n');
      while (newline >= 0 && !invalid) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
          invalidate();
          return;
        }
        handleLine(line);
        newline = pending.indexOf('\n');
      }
      // Una línea pendiente sin salto tampoco puede superar el límite.
      if (Buffer.byteLength(pending, 'utf8') > MAX_LINE_BYTES) invalidate();
    });

    child.stderr?.on('data', chunk => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_STDERR_BYTES) invalidate();
    });

    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutSeconds * 1000);
    // El proceso hijo ya mantiene vivo el event loop; los temporizadores no deben hacerlo.
    timer.unref?.();

    function finish(exitCode, signal, errorCode = null) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      pending += decoder.end();
      handleLine(pending);
      resolve({
        status: statusOf({ errorCode, timedOut, invalid, overBudget, exitCode, observed }),
        spawn_threw: false,
        exit_code: exitCode,
        signal,
        error_code: errorCode,
        usage: observed ? usage : null,
        stream_invalid: invalid,
      });
    }

    child.on('error', error => finish(null, null, error?.code ?? 'SPAWN'));
    child.on('close', (exitCode, signal) => finish(exitCode, signal));
    child.stdin?.on('error', () => {});
    child.stdin?.end(prompt);
  });
}
