import type { Project } from '../engine/project';

export function scenarioDependencies(project: Project, initialScripts: string[], initialRules: string[], expandScenes: boolean, targetedChecks = false) {
  const scripts = new Set(initialScripts), rules = new Set(initialRules), timers = new Set<string>();
  let previous = -1;
  while (previous !== scripts.size + rules.size + timers.size) {
    previous = scripts.size + rules.size + timers.size;
    const scenes = project.scripts.filter(s => scripts.has(s.id));
    const checks = new Set(scenes.flatMap(s => s.nodes.flatMap(n => n.choices.flatMap(c => c.checkId ? [c.checkId] : []))));
    for (const rule of project.rules) if (rule.checkId && checks.has(rule.checkId) && (targetedChecks || !rule.targetObjectId)) rules.add(rule.id);
    const actions = [...scenes.flatMap(s => s.nodes.flatMap(n => n.choices.flatMap(c => [...c.actions, ...c.failureActions]))), ...project.rules.filter(r => rules.has(r.id)).flatMap(r => r.actions)];
    for (const action of actions) {
      if (expandScenes && action.type === 'openScript') scripts.add(action.scriptId);
      if ('timerId' in action) timers.add(action.timerId);
    }
    for (const timer of project.timers) {
      if (timer.ruleId && rules.has(timer.ruleId)) timers.add(timer.id);
      if (timers.has(timer.id) && timer.ruleId) rules.add(timer.ruleId);
    }
  }
  return { scriptIds: scripts, rules: project.rules.filter(r => rules.has(r.id)), timers: project.timers.filter(t => timers.has(t.id)) };
}
