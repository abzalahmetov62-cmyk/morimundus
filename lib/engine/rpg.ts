import type { Check, Project, ScriptChoice } from './project';
import type { GameState } from './game-state';
import { conditionResult, effectiveTraitValue, evaluateCondition, objectIsPresent } from './conditions';

export function checkAvailability(project: Project, state: GameState, checkId: string) {
  const check = project.checks.find(c => c.id === checkId);
  if (!check) return { allowed: false, reason: 'Проверка не найдена' };
  const previous = state.checks[checkId];
  if (previous?.succeeded) return { allowed: false, reason: 'Проверка уже успешно пройдена.' };
  if (check.maxAttempts !== null && (previous?.attempts ?? 0) >= check.maxAttempts) return { allowed: false, reason: 'Все разрешённые попытки использованы.' };
  if (!previous?.attempts) return { allowed: true, reason: '' };
  if (!check.repeatable) return { allowed: false, reason: 'Повторная попытка не разрешена.' };
  const growth = check.retryGrowth;
  if (growth && (growth.reference === 'last' || previous.attempts >= growth.attempt)) {
    const number = growth.reference === 'last' ? previous.attempts : growth.attempt;
    const snapshot = growth.reference === 'last' ? previous.lastSkills : previous.attemptSkills?.find(a => a.attempt === number)?.skills;
    const before = snapshot?.[growth.skillId] ?? (number === previous.attempts && growth.skillId === check.skillId ? previous.lastResult?.skillValue : undefined);
    if (before === undefined) return { allowed: false, reason: 'Для этой попытки не сохранено значение навыка.' };
    const current = effectiveTraitValue(project, state, 'skills', growth.skillId) ?? 0;
    if (current <= before) return { allowed: false, reason: (project.character.skills.find(s => s.id === growth.skillId)?.name ?? 'Навык') + ' должен быть выше ' + before + ' (попытка ' + number + '). Сейчас: ' + current + '.' };
  }
  const condition = conditionResult(check.retryWhen, project, state);
  return condition.allowed ? condition : { allowed: false, reason: check.retryReason.trim() || condition.reason };
}
export function checkValues(project: Project, state: GameState, check: Check) {
  return { skillValue: effectiveTraitValue(project, state, 'skills', check.skillId) ?? 0, statValue: check.statId ? effectiveTraitValue(project, state, 'stats', check.statId) ?? 0 : 0 };
}
function rollDie(state: GameState, sides: number) {
  let value = state.randomState;
  value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
  state.randomState = value >>> 0;
  return Math.floor(state.randomState / 0x100000000 * sides) + 1;
}
export function resolveCheck(project: Project, state: GameState, checkId: string, choiceId: string) {
  const available = checkAvailability(project, state, checkId);
  if (!available.allowed) throw new Error(available.reason);
  const check = project.checks.find(c => c.id === checkId)!, point = state.interaction;
  if (!point) throw new Error('Проверке нужна текущая текстовая сцена');
  const formula = check.formula ?? project.settings.checkFormula, values = checkValues(project, state, check);
  const roll = formula.mode === 'dice' ? rollDie(state, formula.dieSides) : null;
  const score = values.skillValue * formula.skillWeight + values.statValue * formula.statWeight + (roll ?? 0);
  const result = { ...formula, ...values, roll, score, difficulty: check.difficulty, succeeded: score >= check.difficulty };
  const retry = !result.succeeded && check.repeatable;
  const previous = state.checks[checkId], attempt = (previous?.attempts ?? 0) + 1;
  const skills = Object.fromEntries([...new Set([check.skillId, ...(check.retryGrowth ? [check.retryGrowth.skillId] : [])])].map(id => [id, effectiveTraitValue(project, state, 'skills', id) ?? 0]));
  const attemptSkills = [...(previous?.attemptSkills ?? []), ...(attempt <= 1000 ? [{ attempt, skills }] : [])];
  state.checks[checkId] = { attemptSkills, lastSkills: skills, attempts: attempt, succeeded: result.succeeded, lastResult: result, resumeScriptId: retry ? point.scriptId : null, resumeNodeId: retry ? point.nodeId : null, resumeChoiceId: retry ? choiceId : null, resumeLocationId: retry ? state.locationId : null, objectId: point.objectId };
  return result;
}
export function retryAvailability(project: Project, state: GameState, checkId: string) {
  const available = checkAvailability(project, state, checkId), saved = state.checks[checkId];
  if (!available.allowed) return available;
  if (!saved?.attempts || !saved.resumeScriptId || !saved.resumeNodeId || !saved.resumeChoiceId) return { allowed: false, reason: 'Нет сохранённой точки повторной попытки.' };
  if (saved.resumeLocationId !== state.locationId) return { allowed: false, reason: 'Вернись в локацию, где выполнялась проверка.' };
  const choice = project.scripts.find(s => s.id === saved.resumeScriptId)?.nodes.find(n => n.id === saved.resumeNodeId)?.choices.find(c => c.id === saved.resumeChoiceId);
  if (!choice || choice.checkId !== checkId) return { allowed: false, reason: 'Точка проверки не найдена.' };
  const condition = conditionResult(choice.condition, project, state);
  if (!condition.allowed) return { allowed: false, reason: choice.unavailableReason.trim() || condition.reason };
  const usage = choiceUsageAvailability(state, choice, saved.resumeScriptId, saved.resumeNodeId);
  if (!usage.allowed) return usage;
  if (saved.objectId) {
    const object = project.objects.find(o => o.id === saved.objectId);
    if (!object || object.locationId !== state.locationId || !objectIsPresent(project, state, object.id) || !evaluateCondition(object.visibleWhen, state, project)) return { allowed: false, reason: 'Источник проверки сейчас недоступен.' };
    const item = state.items['instance-' + object.id];
    if (item && (item.owner.type !== 'world' || item.owner.dropped || item.owner.locationId !== state.locationId)) return { allowed: false, reason: 'Объект проверки уже перемещён.' };
    const gate = conditionResult(object.interaction.condition, project, state);
    if (!gate.allowed) return { allowed: false, reason: object.interaction.unavailableReason.trim() || gate.reason };
    const [x, y, z] = state.player.position, [ox, oy, oz] = object.transform.position, [w, h] = object.transform.scale;
    if (Math.hypot(Math.max(0, Math.abs(x - ox) - w / 2), Math.max(0, oy - y, y - oy - h), Math.max(0, Math.abs(z - oz) - w / 2)) > object.interaction.reach) return { allowed: false, reason: 'Подойди ближе к объекту проверки.' };
  }
  return { allowed: true, reason: '' };
}
export function changeTrait(project: Project, state: GameState, kind: 'stat' | 'skill', traitId: string, mode: 'set' | 'add', value: number) {
  const group = kind === 'stat' ? 'stats' : 'skills', trait = project.character[group].find(t => t.id === traitId);
  if (!trait || !Number.isFinite(value)) throw new Error('Характеристика или значение не найдены');
  const next = mode === 'set' ? value : state.player[group][traitId] + value;
  if (!Number.isFinite(next)) throw new Error('Значение характеристики слишком велико');
  state.player[group][traitId] = Math.min(trait.max, Math.max(trait.min, next));
}

export function choiceUsageKey(scriptId: string, nodeId: string, choiceId: string) { return JSON.stringify([scriptId, nodeId, choiceId]); }
export function choiceUsageAvailability(state: GameState, choice: ScriptChoice, scriptId = state.interaction?.scriptId, nodeId = state.interaction?.nodeId) {
  const limit = choice.usageLimit;
  if (!limit || !scriptId || !nodeId) return { allowed: true, reason: '' };
  const saved = state.choiceUsage?.[choiceUsageKey(scriptId, nodeId, choice.id)], now = state.clock.worldSeconds;
  const count = limit.period === 'ever' ? saved?.total ?? 0 : limit.period === 'day' ? saved?.day === Math.floor(now / 86400) ? saved.dayUses : 0 : saved?.times.filter(t => t > now - limit.seconds).length ?? 0;
  if (count < limit.maxUses) return { allowed: true, reason: '' };
  return { allowed: false, reason: limit.period === 'day' ? 'На эти игровые сутки лимит исчерпан. Ответ снова доступен после полуночи.' : limit.period === 'ever' ? 'Лимит выбора этого ответа исчерпан.' : 'Лимит за последние ' + (limit.seconds / 3600) + ' игровых ч. исчерпан.' };
}
export function recordChoiceUse(state: GameState, scriptId: string, nodeId: string, choiceId: string) {
  const key = choiceUsageKey(scriptId, nodeId, choiceId), saved = state.choiceUsage?.[key], now = state.clock.worldSeconds, day = Math.floor(now / 86400);
  state.choiceUsage ??= {};
  state.choiceUsage[key] = { total: (saved?.total ?? 0) + 1, day, dayUses: (saved?.day === day ? saved.dayUses : 0) + 1, times: [...(saved?.times ?? []), now].slice(-1000) };
}
