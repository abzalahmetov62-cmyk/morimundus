import { parseProject, type Project } from './project';

export function createSampleProject(): Project {
  const base = { notes: '', tags: [], billboard: 'vertical', collision: { solid: false, radius: 0.25 }, imageAssetId: null, initialState: {}, visibleWhen: null, container: null, transition: null };
  return parseProject({
    formatVersion: 1, id: 'morimundus',
    meta: { title: 'Morimundus', author: '', description: 'История одного человека в мире Летописи тысячи зим.', createdAt: new Date().toISOString(), language: 'ru' },
    settings: { paperColor: '#e8e1d7', startLocationId: 'apartment', startScriptId: null, baseInventorySlots: 3, worldSecondsPerRealSecond: 1, startWorldSeconds: 7 * 3600, pauseOnInteraction: true, pauseOnMenu: true, pauseWhenHidden: true, elapsedWhileClosed: false, equipmentSlots: ['head', 'torso', 'legs', 'feet', 'accessory'] },
    assets: [],
    locations: [{ id: 'apartment', name: 'Квартира', notes: 'Первая локация. Пробуждение, исследование вещей, уборка и приготовление еды.', rooms: [{ id: 'room-main', origin: [0, 0, 0], width: 6, depth: 5, height: 2.8, floorAssetId: null, wallAssetId: null, ceilingAssetId: null }], spawn: { position: [3, 1.65, 3.5], yaw: 0, pitch: 0 }, audio: { musicAssetId: null, ambienceAssetId: null, volume: 0.7 } }],
    objects: [
      { ...base, id: 'door', name: 'Дверь', kind: 'prop', locationId: 'apartment', transform: { position: [5.6, 0, 2.5], rotation: [0, 0, 0], scale: [1, 2, 1] }, interaction: { scriptId: null, itemDefinitionId: null, canTake: false, reach: 2, audioAssetId: null } },
      { ...base, id: 'pot', name: 'Кастрюля', kind: 'container', locationId: 'apartment', transform: { position: [1.2, 0, 1], rotation: [0, 0, 0], scale: [0.5, 0.5, 0.5] }, container: { capacity: 8, acceptedTags: ['food'] }, interaction: { scriptId: null, itemDefinitionId: null, canTake: false, reach: 2, audioAssetId: null } },
      { ...base, id: 'paper', name: 'Смятая бумага', kind: 'item', locationId: 'apartment', transform: { position: [2.6, 0, 2.6], rotation: [0, 0, 0], scale: [0.3, 0.3, 0.3] }, tags: ['trash'], interaction: { scriptId: null, itemDefinitionId: 'paper-item', canTake: true, reach: 2, audioAssetId: null } },
    ],
    items: [{ id: 'paper-item', name: 'Смятая бумага', description: 'Заглушка предмета для проверки состояния мира.', tags: ['trash'], imageAssetId: null, equipmentSlot: null, capacityBonus: 0, modifiers: {} }],
    character: { name: 'Герой', stats: [], skills: [], statuses: [] }, flags: { awakened: false },
    scripts: [], rules: [], checks: [], quests: [], recipes: [], schedules: [],
  });
}
