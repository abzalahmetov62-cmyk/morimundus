import { objectEffects } from './object-effects';
import { parseProject, type Project, type Scalar } from './project';
import { parseGameState, type GameState, type PauseReason } from './game-state';
import { droppedObjects, dropItem, equipItem, unequipItem, takeDroppedItem, type EquipmentSlot } from './inventory';
import { conditionResult, evaluateCondition, objectIsPresent } from './conditions';
import { assertArrival, presentObjects } from './spatial';
import { applyActions, choiceAvailability, chooseResponse, currentNode, finishScene, moveStateTo, nextParagraph, openScene, runRules, runItemRule, runTimerRule } from './scenarios';
import { advanceClock } from './time';
import { emitAudio } from './audio-state';
import { retryAvailability, changeTrait } from './rpg';
import { accessibleContainer, putItemInContainer, takeContainerItem, startRecipe } from './item-interactions';

export type { GameState } from './game-state';
export type InteractionResult = 'scene' | 'travel' | 'door' | 'inspect' | 'container' | 'applied';
type SessionOptions = { startScriptId?: string | null; snapshot?: unknown };
export type PreparedTransition = { state: GameState; revision: number };

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
  return value;
}

export class TestSession {
  readonly project: Project;
  private current: GameState;
  private changes = 0;
  private started = false;
  private startupScript: string | null;

  constructor(project: Project, revision: number, startLocationId = project.settings.startLocationId, options: SessionOptions = {}) {
    this.project = freeze(parseProject(structuredClone(project)));
    const start = this.project.locations.find(l => l.id === startLocationId);
    if (!start) throw new Error('Начальная локация не найдена');
    this.startupScript = options.startScriptId !== undefined ? options.startScriptId : start.id === project.settings.startLocationId ? project.settings.startScriptId : null;
    if (options.snapshot !== undefined) {
      this.current = parseGameState(options.snapshot, this.project);
      if (this.current.projectRevision !== revision) throw new Error('Сохранение создано для другой версии авторского проекта');
      this.started = true; return;
    }
    this.current = parseGameState({
      formatVersion: 1, id: crypto.randomUUID(), projectId: project.id, projectRevision: revision, locationId: start.id,
      player: { position: [...start.spawn.position], yaw: start.spawn.yaw, pitch: start.spawn.pitch,
        stats: Object.fromEntries(project.character.stats.map(s => [s.id, s.initial])), skills: Object.fromEntries(project.character.skills.map(s => [s.id, s.initial])),
        statuses: project.character.statuses.filter(s => s.initiallyActive).map(s => s.id), inventory: Array(project.settings.baseInventorySlots).fill(null), activeSlot: 0, equipment: Object.fromEntries(project.settings.equipmentSlots.map(s => [s, null])) },
      randomState: crypto.getRandomValues(new Uint32Array(1))[0] || 1, flags: structuredClone(project.flags), objects: Object.fromEntries(project.objects.map(o => [o.id, { present: true, state: structuredClone(o.initialState) }])),
      items: Object.fromEntries(project.objects.filter(o => o.interaction.itemDefinitionId).map(o => { const id = 'instance-' + o.id; return [id, { id, definitionId: o.interaction.itemDefinitionId!, owner: { type: 'world', locationId: o.locationId, position: [...o.transform.position] } }]; })),
      quests: Object.fromEntries(project.quests.map(q => [q.id, { stageId: q.initialStageId, completed: false }])),
      clock: { worldSeconds: project.settings.startWorldSeconds, playedSeconds: 0, pausedBy: [] }, timers: this.project.timers.filter(t => t.initiallyActive).map(t => ({ id: t.id, remainingSeconds: t.durationSeconds, ruleId: t.ruleId })), interaction: null, checks: {},
      audio: { locationTrackId: start.audio.musicAssetId, ambienceTrackId: start.audio.ambienceAssetId, offset: 0, interactionTrackId: null }, appliedRules: [],
    }, this.project);
  }
  static restore(project: Project, revision: number, state: unknown) { return new TestSession(project, revision, project.settings.startLocationId, { snapshot: state }); }
  snapshot(): GameState { return structuredClone(this.current); }
  worldRevision() { return this.changes; }
  locationId() { return this.current.locationId; }
  isPaused() { return this.current.clock.pausedBy.length > 0; }
  pose() { return { position: [...this.current.player.position] as [number, number, number], yaw: this.current.player.yaw, pitch: this.current.player.pitch }; }
  visibleObjects(locationId = this.current.locationId) { return [...presentObjects(this.project.objects, this.current, locationId, this.project), ...droppedObjects(this.project, this.current, locationId)]; }
  effectSources() { return objectEffects(this.project, this.current); }
  worldObject(id: string) { return this.visibleObjects().find(o => o.id === id); }
  selectSlot(slot: number) { if (!Number.isInteger(slot) || slot < 0 || slot >= this.current.player.inventory.length) throw new Error('Ячейка не найдена'); this.current.player.activeSlot = slot; this.changes++; }
  dropItem(id = this.current.player.inventory[this.current.player.activeSlot]) { if (!id) throw new Error('Выбранная ячейка пуста'); this.transact(state => dropItem(this.project, state, id)); }
  equip(id: string, slot: EquipmentSlot) { this.transact(state => equipItem(this.project, state, id, slot)); }
  unequip(slot: EquipmentSlot) { this.transact(state => unequipItem(this.project, state, slot)); }
  openContainer(id: string) { accessibleContainer(this.project, this.current, id); }
  putInContainer(objectId: string, itemId = this.current.player.inventory[this.current.player.activeSlot]) {
    if (!itemId) throw new Error('Выбранная ячейка пуста');
    this.transact(state => putItemInContainer(this.project, state, objectId, itemId));
  }
  takeFromContainer(objectId: string, itemId: string) { this.transact(state => takeContainerItem(this.project, state, objectId, itemId)); }
  cook(objectId: string, recipeId: string) { this.transact(state => startRecipe(this.project, state, objectId, recipeId)); }
  hasInteraction() { return this.current.interaction !== null; }
  private settleEntries(state: GameState, originalLocation: string | null) {
    let previous = originalLocation;
    for (let hop = 0; hop < 16; hop++) {
      if (previous === state.locationId) return;
      previous = state.locationId;
      runRules(this.project, state, 'enter', null);
    }
    throw new Error('Правила входа образуют бесконечную цепочку переходов');
  }
  private prepare(update: (state: GameState) => void, forceEntry = false) {
    const state = structuredClone(this.current), original = state.locationId;
    update(state); this.settleEntries(state, forceEntry ? null : original);
    if (state.locationId !== original || forceEntry) {
      const location = this.project.locations.find(l => l.id === state.locationId)!;
      assertArrival(location, presentObjects(this.project.objects, state, state.locationId, this.project), state.player.position);
    }
    return parseGameState(state, this.project);
  }
  private transact(update: (state: GameState) => void, forceEntry = false) {
    this.current = this.prepare(update, forceEntry); this.changes++;
  }
  start() {
    if (this.started) return;
    this.transact(state => {
      runRules(this.project, state, 'enter', null);
      if (this.startupScript) openScene(this.project, state, this.startupScript);
    });
    this.started = true;
  }
  setPose(position: [number, number, number], yaw: number, pitch: number) {
    if (![...position, yaw, pitch].every(Number.isFinite) || Math.abs(pitch) > Math.PI / 2) throw new Error('Неверное положение камеры');
    if (yaw !== this.current.player.yaw || pitch !== this.current.player.pitch || position.some((n, i) => n !== this.current.player.position[i])) this.changes++;
    this.current.player.position = [...position]; this.current.player.yaw = yaw; this.current.player.pitch = pitch;
  }
  objectPresent(id: string) { return objectIsPresent(this.project, this.current, id); }
  objectAvailability(id: string) {
    if (id.startsWith('drop:')) return this.worldObject(id) ? { allowed: true, reason: '' } : { allowed: false, reason: 'Предмет уже перемещён' };
    const object = this.project.objects.find(o => o.id === id && o.locationId === this.current.locationId);
    if (!object || !this.objectPresent(id) || !evaluateCondition(object.visibleWhen, this.current, this.project)) return { allowed: false, reason: 'Объект недоступен' };
    const item = this.current.items['instance-' + id];
    if (item && (item.owner.type !== 'world' || item.owner.locationId !== this.current.locationId)) return { allowed: false, reason: 'Предмет уже перемещён' };
    const result = conditionResult(object.interaction.condition, this.project, this.current);
    return result.allowed ? result : { allowed: false, reason: object.interaction.unavailableReason.trim() || result.reason };
  }
  setFlag(key: string, value: Scalar) {
    if (!Object.hasOwn(this.project.flags, key)) throw new Error('Флаг не найден');
    this.transact(state => { state.flags[key] = value; });
  }
  giveTestItem(itemDefinitionId: string) {
    if (!this.project.items.some(i => i.id === itemDefinitionId)) throw new Error('Определение предмета не найдено');
    this.transact(state => applyActions(this.project, state, [{ type: 'giveItem', itemDefinitionId }]));
  }
  goToTestLocation(locationId: string) { this.transact(state => moveStateTo(this.project, state, locationId)); }
  setObjectPresence(id: string, present: boolean) {
    if (!Object.hasOwn(this.current.objects, id)) throw new Error('Объект не найден');
    this.current.objects[id].present = present; this.changes++;
  }
  takeObject(id: string) {
    if (id.startsWith('drop:')) { let name = ''; this.transact(state => { name = takeDroppedItem(this.project, state, id); }); return name; }
    const object = this.project.objects.find(o => o.id === id && o.locationId === this.current.locationId);
    if (!object || !object.interaction.canTake || !object.interaction.itemDefinitionId) throw new Error('Этот предмет нельзя взять');
    const available = this.objectAvailability(id); if (!available.allowed) throw new Error(available.reason);
    const slot = this.current.player.inventory.indexOf(null);
    if (slot < 0) throw new Error('В инвентаре нет свободной ячейки');
    let definitionId = '';
    this.transact(state => {
      const instance = state.items['instance-' + id];
      if (!instance) throw new Error('Предмет не найден');
      definitionId = instance.definitionId; instance.owner = { type: 'inventory', slot };
      state.player.inventory[slot] = instance.id; state.objects[id].present = false; emitAudio(state, object.interaction.audioAssetId);
    });
    return this.project.items.find(item => item.id === definitionId)!.name;
  }
  interactObject(id: string, useSelectedItem = true): InteractionResult {
    if (this.hasInteraction()) throw new Error('Сначала завершите разговор');
    const available = this.objectAvailability(id); if (!available.allowed) throw new Error(available.reason);
    const object = this.project.objects.find(o => o.id === id);
    const selected = useSelectedItem ? this.current.player.inventory[this.current.player.activeSlot] : null;
    if (selected) {
      const originalLocation = this.current.locationId;
      let result: InteractionResult = 'applied';
      this.transact(state => {
        const rule = runItemRule(this.project, state, { itemInstanceId: selected, objectId: id });
        if (!rule.applied) {
          if (!rule.matched && object?.container) {
            try { putItemInContainer(this.project, state, id, selected); } catch (cause) { if (cause instanceof Error && cause.message === 'Эта вещь не подходит для контейнера') throw new Error(object.interaction.itemUseReason.trim() || cause.message); throw cause; }
            result = 'container';
          }
          else throw new Error(rule.reason || object?.interaction.itemUseReason.trim() || 'Эта вещь здесь не подходит.');
        }
        emitAudio(state, object?.interaction.audioAssetId ?? null);
      });
      if (this.current.locationId !== originalLocation) return 'travel';
      if (this.hasInteraction()) return 'scene';
      return result;
    }
    if (!object) return 'inspect';
    const originalLocation = this.current.locationId;
    this.transact(state => {
      runRules(this.project, state, 'interact', id);
      if (!state.interaction && state.locationId === originalLocation && object.interaction.scriptId) openScene(this.project, state, object.interaction.scriptId, undefined, false, object.id);
      if (!state.interaction && state.locationId === originalLocation && object.container) accessibleContainer(this.project, state, id);
      emitAudio(state, object.interaction.audioAssetId);
    });
    if (this.current.locationId !== originalLocation) return 'travel';
    if (this.hasInteraction()) return 'scene';
    if (object.container) return 'container';
    return object.transition ? 'door' : 'inspect';
  }
  openScript(id: string) { this.transact(state => openScene(this.project, state, id)); }
  nextParagraph() { this.transact(state => nextParagraph(this.project, state)); }
  choices() {
    const node = currentNode(this.project, this.current);
    if (!node || !this.current.interaction || this.current.interaction.paragraph < node.paragraphs.length) return [];
    return node.choices.map(choice => ({ choice, ...choiceAvailability(this.project, this.current, choice) }));
  }
  retryChecks() { return this.project.checks.filter(c => this.current.checks[c.id]?.attempts && !this.current.checks[c.id].succeeded && c.repeatable).map(check => ({ check, ...retryAvailability(this.project, this.current, check.id) })); }
  retryCheck(id: string) { this.transact(state => { const available = retryAvailability(this.project, state, id); if (!available.allowed) throw new Error(available.reason); const point = state.checks[id]; openScene(this.project, state, point.resumeScriptId!, point.resumeNodeId!, !!state.interaction, point.objectId); }); }
  changeTrait(kind: 'stat' | 'skill', id: string, value: number) { this.transact(state => changeTrait(this.project, state, kind, id, 'set', value)); }
  choose(id: string) { this.transact(state => chooseResponse(this.project, state, id)); }
  finishInteraction() { this.transact(state => {
    const node = currentNode(this.project, state);
    if (state.interaction && (!node || state.interaction.paragraph < node.paragraphs.length || node.choices.length > 0)) throw new Error('Сначала дочитай диалог и выбери ответ.');
    finishScene(state);
  }); }
  destination(objectId: string) {
    const object = this.project.objects.find(o => o.id === objectId && o.locationId === this.current.locationId);
    if (!object?.transition) throw new Error('Переход недоступен');
    const available = this.objectAvailability(objectId); if (!available.allowed) throw new Error('Переход недоступен: ' + available.reason);
    const location = this.project.locations.find(l => l.id === object.transition!.locationId);
    if (!location) throw new Error('Локация назначения не найдена');
    assertArrival(location, this.visibleObjects(location.id), object.transition.position);
    return { location, position: [...object.transition.position] as [number, number, number], yaw: object.transition.yaw };
  }
  prepareTransition(objectId: string): PreparedTransition {
    const destination = this.destination(objectId);
    return { revision: this.changes, state: this.prepare(state => moveStateTo(this.project, state, destination.location.id, destination.position, destination.yaw)) };
  }
  commitTransition(prepared: PreparedTransition) {
    if (prepared.revision !== this.changes) throw new Error('Состояние изменилось во время перехода. Попробуйте ещё раз.');
    const next = parseGameState(prepared.state, this.project);
    next.clock.pausedBy = [...new Set([...this.current.clock.pausedBy.filter(r => r !== 'interaction'), ...(next.interaction ? ['interaction' as const] : [])])];
    this.current = next; this.changes++;
    return this.project.locations.find(l => l.id === next.locationId)!.name;
  }
  transitionThrough(objectId: string) { return this.commitTransition(this.prepareTransition(objectId)); }
  pause(reason: PauseReason) { if (!this.current.clock.pausedBy.includes(reason)) this.current.clock.pausedBy.push(reason); }
  resume(reason: PauseReason) { this.current.clock.pausedBy = this.current.clock.pausedBy.filter(r => r !== reason); }
  advanceTime(seconds: number) { this.transact(state => { const budget = { remaining: 1000 }; advanceClock(this.project, state, seconds, ruleId => runTimerRule(this.project, state, ruleId, budget), { budget }); }); }
  audioSnapshot() { return { locationId: this.current.locationId, audio: structuredClone(this.current.audio), pausedBy: [...this.current.clock.pausedBy] }; }
  setAudioPosition(channel: 'music' | 'ambience' | 'narrative', key: string, offset: number) {
    if (!Number.isFinite(offset) || offset < 0) return;
    if (channel === 'music' && key === this.current.locationId + ':' + this.current.audio.locationTrackId) this.current.audio.offset = offset;
    if (channel === 'ambience' && key === this.current.locationId + ':' + this.current.audio.ambienceTrackId) this.current.audio.ambienceOffset = offset;
    if (channel === 'narrative' && key === String(this.current.audio.interactionSequence)) this.current.audio.interactionOffset = offset;
  }
  tick(seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Неверное время');
    if (this.current.clock.pausedBy.length || seconds === 0) return false;
    const speed = this.project.settings.worldSecondsPerRealSecond, worldSeconds = seconds * speed;
    if (!Number.isFinite(worldSeconds) || this.current.clock.worldSeconds + worldSeconds > Number.MAX_SAFE_INTEGER || this.current.clock.playedSeconds + seconds > Number.MAX_SAFE_INTEGER) throw new Error('Слишком большое время');
    if (this.current.timers.some(t => t.remainingSeconds <= worldSeconds)) {
      this.transact(state => { const budget = { remaining: 1000 }; advanceClock(this.project, state, worldSeconds, ruleId => runTimerRule(this.project, state, ruleId, budget), { stopWhenPaused: true, realSecondsPerWorldSecond: 1 / speed, budget }); });
      return true;
    } else {
      this.current.clock.playedSeconds += seconds; this.current.clock.worldSeconds += worldSeconds;
      for (const timer of this.current.timers) timer.remainingSeconds -= worldSeconds;
      this.changes++;
    }
    return false;
  }
}
