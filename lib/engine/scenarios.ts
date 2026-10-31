import type { Action, Project, ScriptChoice, ScriptNode } from './project';
import type { GameState } from './game-state';
import { conditionResult, evaluateCondition } from './conditions';
import { assertArrival, presentObjects, type Vector3 } from './spatial';
import { consumeUsedItem, replaceUsedItem, putItemInContainer, startRecipe, usedInventoryItem, type ItemUseContext } from './item-interactions';
import { changeTrait, checkAvailability, resolveCheck, retryAvailability, choiceUsageAvailability, recordChoiceUse } from './rpg';
import { advanceClock, startTimer } from './time';
import { emitAudio, narrativeAudio } from './audio-state';

export function currentNode(project: Project, state: GameState): ScriptNode | null {
  const interaction = state.interaction;
  if (!interaction) return null;
  return project.scripts.find(s => s.id === interaction.scriptId)?.nodes.find(n => n.id === interaction.nodeId) ?? null;
}

function appendParagraph(project: Project, state: GameState) {
  const interaction = state.interaction, node = currentNode(project, state);
  if (!interaction || !node || interaction.paragraph >= node.paragraphs.length) return;
  if (interaction.transcript.length >= 2000) throw new Error('Разговор слишком длинный. Завершите его.');
  const paragraph = node.paragraphs[interaction.paragraph];
  interaction.transcript.push({ type: 'paragraph', scriptId: interaction.scriptId, nodeId: node.id, index: interaction.paragraph });
  interaction.history.push(paragraph.spans.map(s => s.text).join(''));
  interaction.paragraph++;
  if (paragraph.audioStop) narrativeAudio(state, null);
  else if (paragraph.audioAssetId) {
    if (paragraph.audioAssetId === state.audio.interactionTrackId && !paragraph.audioRestart) {
      state.audio.interactionLoop = paragraph.audioLoop; state.audio.interactionVolume = paragraph.audioVolume;
    } else narrativeAudio(state, paragraph.audioAssetId, paragraph.audioLoop, paragraph.audioVolume);
  }
}

export function openScene(project: Project, state: GameState, scriptId: string, nodeId?: string, carryHistory = false, objectId: string | null = null) {
  const script = project.scripts.find(s => s.id === scriptId);
  // Explicit reply/check transitions bypass entry selection. Evaluate afresh on every scene opening.
  const candidates = nodeId === undefined ? script?.nodes.filter(n => n.entryCondition != null && evaluateCondition(n.entryCondition, state, project)) : [];
  const selected = candidates?.reduce<ScriptNode | undefined>((best, n) => !best || (n.entryPriority ?? 0) > (best.entryPriority ?? 0) ? n : best, undefined);
  const node = script?.nodes.find(n => n.id === (nodeId ?? selected?.id ?? script.entryNodeId));
  if (!script || !node) throw new Error('Текстовая сцена не найдена');
  const previous = carryHistory ? state.interaction : null;
  state.interaction = { scriptId, nodeId: node.id, objectId: objectId ?? previous?.objectId ?? null, paragraph: 0, history: previous ? [...previous.history] : [], transcript: previous ? [...previous.transcript] : [] };
  if (!state.clock.pausedBy.includes('interaction')) state.clock.pausedBy.push('interaction');
  appendParagraph(project, state);
}

export function nextParagraph(project: Project, state: GameState) {
  const node = currentNode(project, state);
  if (!state.interaction || !node || state.interaction.paragraph >= node.paragraphs.length) throw new Error('Весь текст фрагмента уже показан');
  appendParagraph(project, state);
}

export function finishScene(state: GameState) {
  state.interaction = null;
  state.clock.pausedBy = state.clock.pausedBy.filter(p => p !== 'interaction');
}

export function moveStateTo(project: Project, state: GameState, locationId: string, position?: Vector3, yaw?: number) {
  const location = project.locations.find(l => l.id === locationId);
  if (!location) throw new Error('Локация назначения не найдена');
  const arrival = position ?? location.spawn.position;
  assertArrival(location, presentObjects(project.objects, state, locationId, project), arrival);
  finishScene(state);
  state.locationId = locationId; state.player.position = [...arrival];
  state.player.yaw = yaw ?? location.spawn.yaw; state.player.pitch = position ? 0 : location.spawn.pitch;
  state.audio.locationTrackId = location.audio.musicAssetId; state.audio.offset = 0;
  state.audio.ambienceTrackId = location.audio.ambienceAssetId; state.audio.ambienceOffset = 0;
}

export function applyActions(project: Project, state: GameState, actions: readonly Action[], context?: ItemUseContext, budget = { remaining: 1000 }, depth = 0) {
  if (depth > 16) throw new Error('Слишком длинная цепочка связанных последствий');
  for (const action of actions) {
    if (--budget.remaining < 0) throw new Error('Слишком много связанных последствий');
    switch (action.type) {
      case 'setFlag': state.flags[action.key] = action.value; break;
      case 'setObjectState': state.objects[action.objectId].state[action.key] = action.value; break;
      case 'setPresence': state.objects[action.objectId].present = action.present; break;
      case 'giveItemOnce':
      case 'giveItem': {
        if (action.type === 'giveItemOnce' && state.claimedRewards.includes(action.rewardId)) break;
        const slot = state.player.inventory.indexOf(null);
        if (slot < 0) throw new Error('В инвентаре нет свободной ячейки');
        const id = 'instance-' + crypto.randomUUID();
        state.items[id] = { id, definitionId: action.itemDefinitionId, owner: { type: 'inventory', slot } };
        state.player.inventory[slot] = id;
        if (action.type === 'giveItemOnce') state.claimedRewards.push(action.rewardId);
        break;
      }
      case 'openScript': openScene(project, state, action.scriptId, undefined, !!state.interaction, context?.objectId && project.objects.some(o => o.id === context.objectId) ? context.objectId : null); break;
      case 'playAudio': emitAudio(state, action.assetId, action.volume); break;
      case 'startTimer': startTimer(project, state, action.timerId); break;
      case 'cancelTimer': state.timers = state.timers.filter(t => t.id !== action.timerId); break;
      case 'advanceTime': advanceClock(project, state, action.seconds, ruleId => runTimerRule(project, state, ruleId, budget, depth + 1), { budget }); break;
      case 'setQuestStage': if (!state.quests[action.questId].completed) state.quests[action.questId].stageId = action.stageId; break;
      case 'completeQuest': {
        const progress = state.quests[action.questId];
        if (progress.completed) break;
        if (!progress.stageId) throw new Error('Сначала начни задание');
        progress.completed = true; progress.rewarded = true;
        applyActions(project, state, project.quests.find(q => q.id === action.questId)!.rewards, context, budget, depth + 1); break;
      }
      case 'changeTrait': changeTrait(project, state, action.kind, action.traitId, action.mode, action.value); break;
      case 'setStatus': state.player.statuses = action.active ? [...new Set([...state.player.statuses, action.statusId])] : state.player.statuses.filter(id => id !== action.statusId); break;
      case 'transition': moveStateTo(project, state, action.locationId); break;
      case 'consumeUsedItem': consumeUsedItem(state, context); break;
      case 'replaceUsedItem': replaceUsedItem(project, state, action.itemDefinitionId, context); break;
      case 'putUsedItem': putItemInContainer(project, state, action.objectId, usedInventoryItem(state, context).id); break;
      case 'startRecipe': startRecipe(project, state, action.objectId, action.recipeId); break;
    }
  }
}

export function runTimerRule(project: Project, state: GameState, ruleId: string, budget = { remaining: 1000 }, depth = 0) {
  const rule = project.rules.find(r => r.id === ruleId && r.trigger === 'timer');
  if (!rule) throw new Error('Реакция таймера не найдена');
  if ((rule.once && state.appliedRules.includes(rule.id)) || !evaluateCondition(rule.condition, state, project)) return;
  if (rule.once) state.appliedRules.push(rule.id);
  const target = project.objects.find(o => o.id === rule.targetObjectId && o.locationId === state.locationId);
  applyActions(project, state, rule.actions, target ? { objectId: target.id, itemInstanceId: '' } : undefined, budget, depth);
}

export function runItemRule(project: Project, state: GameState, context: ItemUseContext) {
  const item = usedInventoryItem(state, context), definition = project.items.find(d => d.id === item.definitionId)!;
  const candidates = project.rules.map((rule, index) => ({ rule, index, specificity: (rule.targetObjectId ? 4 : 0) + (rule.itemDefinitionId ? 2 : 0) + (rule.itemTag ? 1 : 0) }))
    .filter(({ rule }) => rule.trigger === 'useItem' && (!rule.targetObjectId || rule.targetObjectId === context.objectId) && (!rule.itemDefinitionId || rule.itemDefinitionId === definition.id) && (!rule.itemTag || definition.tags.includes(rule.itemTag)))
    .sort((a, b) => b.specificity - a.specificity || b.rule.priority - a.rule.priority || a.index - b.index);
  let reason = '';
  for (const { rule } of candidates) {
    if (rule.once && state.appliedRules.includes(rule.id)) { reason ||= 'Это действие уже выполнено.'; continue; }
    const condition = conditionResult(rule.condition, project, state);
    if (!condition.allowed) { reason ||= rule.unavailableReason.trim() || condition.reason; continue; }
    applyActions(project, state, rule.actions, context);
    if (rule.once) state.appliedRules.push(rule.id);
    return { applied: true, matched: true, reason: '' };
  }
  return { applied: false, matched: candidates.length > 0, reason };
}

export function runRules(project: Project, state: GameState, trigger: 'interact' | 'enter' | 'checkSuccess' | 'checkFailure', objectId: string | null, checkId: string | null = null) {
  const enteredLocation = state.locationId;
  const rules = project.rules.map((rule, index) => ({ rule, index })).sort((a, b) => b.rule.priority - a.rule.priority || a.index - b.index);
  for (const { rule } of rules) {
    if (rule.trigger !== trigger || rule.itemDefinitionId || rule.itemTag || (rule.checkId && rule.checkId !== checkId)) continue;
    if (rule.targetObjectId && (trigger === 'enter' ? project.objects.find(o => o.id === rule.targetObjectId)?.locationId !== enteredLocation : rule.targetObjectId !== objectId)) continue;
    if (rule.once && state.appliedRules.includes(rule.id)) continue;
    if (!evaluateCondition(rule.condition, state, project)) continue;
    applyActions(project, state, rule.actions, objectId ? { objectId, itemInstanceId: '' } : undefined);
    if (rule.once) state.appliedRules.push(rule.id);
  }
}

export function choiceAvailability(project: Project, state: GameState, choice: ScriptChoice) {
  const result = conditionResult(choice.condition, project, state);
  if (!result.allowed) return { allowed: false, reason: choice.unavailableReason.trim() || result.reason };
  const usage = choiceUsageAvailability(state, choice);
  if (!usage.allowed) return { allowed: false, reason: choice.unavailableReason.trim() || usage.reason };
  if (!choice.checkId) return result;
  return state.checks[choice.checkId]?.resumeScriptId ? retryAvailability(project, state, choice.checkId) : checkAvailability(project, state, choice.checkId);
}

export function chooseResponse(project: Project, state: GameState, choiceId: string) {
  const interaction = state.interaction, node = currentNode(project, state);
  if (!interaction || !node || interaction.paragraph < node.paragraphs.length) throw new Error('Сначала дочитайте фрагмент');
  const choice = node.choices.find(c => c.id === choiceId);
  if (!choice) throw new Error('Ответ не найден в текущем фрагменте');
  const available = choiceAvailability(project, state, choice);
  if (!available.allowed) throw new Error(available.reason);
  if (interaction.transcript.length + (choice.checkId ? 2 : 1) > 2000) throw new Error('Разговор слишком длинный. Завершите его.');
  if (choice.usageLimit) recordChoiceUse(state, interaction.scriptId, interaction.nodeId, choice.id);
  interaction.transcript.push({ type: 'choice', scriptId: interaction.scriptId, nodeId: interaction.nodeId, choiceId, label: choice.label });
  interaction.history.push('> ' + choice.label);
  const result = choice.checkId ? resolveCheck(project, state, choice.checkId, choice.id) : null;
  if (result && choice.checkId) {
    interaction.transcript.push({ type: 'check', scriptId: interaction.scriptId, nodeId: interaction.nodeId, checkId: choice.checkId, result });
    interaction.history.push((result.succeeded ? 'Успех: ' : 'Провал: ') + result.score + ' / ' + result.difficulty);
  }
  applyActions(project, state, result && !result.succeeded ? choice.failureActions : choice.actions);
  if (result) runRules(project, state, result.succeeded ? 'checkSuccess' : 'checkFailure', interaction.objectId, choice.checkId);
  // An explicit open/transition action takes precedence over the ordinary next fragment.
  if (state.interaction !== interaction) return;
  const nextNodeId = result && !result.succeeded ? choice.failureNodeId : choice.nextNodeId;
  if (nextNodeId) openScene(project, state, interaction.scriptId, nextNodeId, true);
  else finishScene(state);
}
