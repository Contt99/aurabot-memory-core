export function prepareAutonomyContext(core, { query = '', allowLegacy = false } = {}, warn = () => {}) {
  if (!core && !allowLegacy) throw Error('life-core 不可用，自主生活自动生成已暂停');
  if (typeof core?.contextManaged !== 'function') {
    warn('自主生活：统一记忆编译器不可用，沿用原有经历查询');
    return { text:'', run:fn=>fn(), check:()=>{} };
  }
  if (!core.contextManaged('autonomy')) { if (allowLegacy) { warn('自主生活：统一记忆不可用，手动操作沿用原路径'); return {text:'',run:fn=>fn(),check:()=>{}} } throw Error('统一记忆编译器不可用，自主生活未执行'); }
  if (!core.buildContext || !core.runWithContext || !core.assertContextCurrent || !core.validateDraft) throw Error('统一记忆接口不完整，自主生活未执行');
  // The public/self snapshot never uses an originating private chat as a scope.
  const snapshot=core.buildContext({purpose:'autonomy',chatId:'',query,consumer:'autonomy'});
  if (!snapshot?.id || typeof snapshot.text !== 'string') throw Error('自主生活上下文不可用');
  core.assertContextCurrent(snapshot);
  return { text:snapshot.text, run:fn=>core.runWithContext(snapshot,fn), check(text) {
    if (!core.contextManaged('autonomy')) throw Error('统一记忆服务不可用，自主生活未执行');
    core.assertContextCurrent(snapshot);
    const result=core.validateDraft(text,snapshot,{purpose:'autonomy',chatId:''});
    if (!result?.ok) throw Error(result?.message || '自主生活决策核验未通过');
  }};
}

export async function checkedDecision(context, generate) { const text = await context.run(generate); context.check(text); return text }
