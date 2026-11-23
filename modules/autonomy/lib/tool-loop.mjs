/** Bounded real-tool loop. Model output selects an action; only execute supplies observations. */
export async function runToolLoop({ core, decide, initial, context = {}, assertActive = () => {}, budgetMs = 120_000 }) {
  const controller = new AbortController();
  const deadline = Date.now() + Math.min(120_000, Math.max(1, budgetMs));
  const observations = [];
  const bounded = async (run) => {
    const left = deadline - Date.now();
    if (left <= 0) throw new Error('探索已达到120秒时间预算');
    let timer;
    try {
      return await Promise.race([Promise.resolve().then(run), new Promise((_, reject) => {
        timer = setTimeout(() => { const error = new Error('探索时间预算已用完'); controller.abort(error); reject(error); }, left);
      })]);
    } finally { clearTimeout(timer); }
  };
  let next = initial;
  let stopped = 'finished';
  try {
    for (let i = 0; i < 5; i++) {
      assertActive();
      const tools = (await bounded(() => core.capabilities())).filter(x => x.available);
      const available = tools.map(x => x.id);
      if (!next) next = await bounded(() => decide({ available, tools, observations, signal: controller.signal, remainingMs: deadline - Date.now() }));
      assertActive();
      if (!next || ['finish', 'rest', 'think', 'idle'].includes(next.action)) break;
      const id = String(next.tool || next.action || '');
      if (!available.includes(id)) { stopped = 'unavailable'; break; }
      const args = next.args && typeof next.args === 'object' && !Array.isArray(next.args) ? next.args : {};
      if (observations.some(row => !row.ok && row.tool === id && JSON.stringify(row.args) === JSON.stringify(args))) {
        stopped = 'repeated-failure'; break;
      }
      // Never infer content from a success-sounding message. Keep the returned value.
      let result;
      try {
        result = await bounded(() => core.execute(id, args, { ...context, source: 'autonomy', module: 'autonomy', signal: controller.signal }));
      } catch (error) {
        if (controller.signal.aborted) throw error;
        result = { ok: false, status: 'error', message: error.message, value: null };
      }
      observations.push({ tool: id, args, ok: result?.ok === true && !result?.dryRun && !result?.simulated && result?.status !== 'deferred',
        status: result?.status || 'unknown', message: String(result?.message || ''), value: result?.value ?? null, experienceId: result?.experienceId });
      next = null;
      if (i === 4) stopped = 'call-limit';
    }
  } catch (error) {
    stopped = controller.signal.aborted ? 'timeout' : 'error';
    return { ok: observations.some(x => x.ok), status: stopped, message: error.message, observations };
  } finally { controller.abort(new Error('探索本轮已结束')); }
  return { ok: observations.some(x => x.ok), status: stopped, observations };
}
