import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = process.cwd(), output = path.join(root, '.sites-runtime', 'voice-check-' + process.pid), compiled = new Set();
let passed = 0;
async function check(name, run) { await run(); passed++; console.log('PASS ' + name); }
async function compile(module) {
  if (compiled.has(module)) return;
  compiled.add(module);
  let source; for (const extension of ['.ts', '.tsx']) { try { source = await fs.readFile(path.join(root, module + extension), 'utf8'); break; } catch (e) { if (e.code !== 'ENOENT') throw e; } }
  if (!source) throw new Error('Missing test module ' + module);
  const dependencies = [];
  const text = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/from (['"])(@\/[^'"]+|\.[^'"]+)\1/g, (_, q, name) => {
    const dependency = name.startsWith('@/') ? name.slice(2) : path.normalize(path.join(path.dirname(module), name)); dependencies.push(dependency);
    const relative = path.relative(path.dirname(module), dependency); return 'from ' + q + (relative.startsWith('.') ? relative : './' + relative) + '.mjs' + q;
  });
  const file = path.join(output, module + '.mjs'); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, text);
  for (const dependency of dependencies) await compile(dependency);
}
const load = async module => { await compile(module); return import(pathToFileURL(path.join(output, module + '.mjs')).href); };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const originalFetch = globalThis.fetch;
try {
  const { createSampleProject } = await load('lib/engine/sample-project'), { parseProject } = await load('lib/engine/project'), { TestSession } = await load('lib/engine/session');
  const { builtinVoices, builtinVoiceDefinitions, voiceDefinitions, voiceProfiles, findVoice, hasGameAudio } = await load('lib/engine/voices');
  const { CharacterVoice, VoiceCadence } = await load('lib/player/character-voice'), { GameAudio } = await load('lib/player/audio');
  const { assetUses, replaceAsset, removeAsset } = await load('lib/editor/asset-operations');
  const { checksum, projectFingerprint, createSavedGame, restoreSavedGame } = await load('lib/engine/save-game');
  const { VoiceResources, VoiceForm } = await load('components/editor/voice-resources'), { ParagraphEditor } = await load('components/editor/paragraph-editor');
  const paragraph = { spans: [{ text: 'СУПЕР-ЭГО: Ты уже здесь. Почему?', marks: ['bold'] }], audioAssetId: null, voiceId: 'super-ego', audioLoop: false, audioVolume: .5 };
  const base = builtinVoices[0];
  function fixture() { const p = createSampleProject(); p.settings.startScriptId = 'talk'; p.scripts = [{ id: 'talk', name: 'Голос', entryNodeId: 'start', nodes: [{ id: 'start', paragraphs: [structuredClone(paragraph)], choices: [] }] }]; return parseProject(p); }
  await check('Old projects retain their exact fingerprint and gain no implicit voice fields', async () => { const p = createSampleProject(), before = structuredClone(p); assert.deepEqual(parseProject(p), before); assert.equal(Object.hasOwn(p, 'voices'), false); assert.equal(await projectFingerprint(p), await checksum(before)); });
  await check('Built-in voice assignments round-trip and saved transcripts restore without changing game state', async () => { const p = fixture(); assert.deepEqual(parseProject(JSON.parse(JSON.stringify(p))), p); const s = new TestSession(p, 1); s.start(); const before = s.snapshot(), packet = await createSavedGame(p, 1, before); assert.deepEqual(await restoreSavedGame(packet.save, packet.checksum, p, 1), before); assert.equal(before.audio.interactionTrackId, null); assert.ok(hasGameAudio(p)); });
  const metadata = id => ({ id, name: id, kind: 'audio', mime: 'audio/wav', bytes: 100, sha256: 'a'.repeat(64) });
  const npc = { id: 'npc-voice', name: 'Сторож', imageAssetId: null, samples: [{ assetId: 'sample-a' }, { assetId: 'sample-b' }], rate: .85, pitchVariation: .4, volumeVariation: .1, intervalSeconds: .12 };
  await check('NPC voices use ordinary sample assets, survive round trips and protect resource replacement/deletion', () => {
    const p = fixture(); p.assets = [metadata('sample-a'), metadata('sample-b')]; p.voices = [npc]; p.scripts[0].nodes[0].paragraphs[0].voiceId = npc.id;
    assert.deepEqual(parseProject(p), p); assert.equal(findVoice(p, npc.id).samples[0].url, '/api/assets/sample-a'); assert.equal(voiceProfiles(p).length, 4); assert.equal(assetUses(p, 'sample-a').length, 1); assert.throws(() => removeAsset(p, 'sample-a'));
    const changed = replaceAsset(p, 'sample-a', metadata('replacement')); assert.equal(changed.voices[0].samples[0].assetId, 'replacement'); assert.equal(assetUses(changed, 'sample-a').length, 0);
  });
  await check('Unknown voices, mixed ordinary audio, loops, missing samples and image-as-audio references are rejected', () => {
    for (const change of [p => p.scripts[0].nodes[0].paragraphs[0].voiceId = 'missing', p => { p.assets = [metadata('sample-a')]; p.scripts[0].nodes[0].paragraphs[0].audioAssetId = 'sample-a'; }, p => p.scripts[0].nodes[0].paragraphs[0].audioLoop = true, p => p.voices = [npc], p => { p.assets = [{ ...metadata('sample-a'), kind: 'image' }, metadata('sample-b')]; p.voices = [npc]; }, p => p.voices = [{ ...builtinVoiceDefinitions[0], samples: [{ builtinSampleId: 'unknown' }] }], p => p.voices = [{ ...builtinVoiceDefinitions[0], samples: [{ builtinSampleId: 'super-ego-01' }, { builtinSampleId: 'super-ego-01' }] }], p => p.voices = [{ ...builtinVoiceDefinitions[0], samples: [{ url: 'https://untrusted.invalid/a.wav' }] }]]) { const p = fixture(); change(p); assert.throws(() => parseProject(p)); }
  });
  await check('Resources expose all three inner voices alongside NPC creation; paragraph audio offers each voice', () => {
    const p = fixture(), html = renderToStaticMarkup(createElement(VoiceResources, { project: p, edit() {}, busy: false }));
    assert.ok(html.includes('СУПЕР-ЭГО')); assert.ok(html.includes('8 сэмплов')); assert.ok(html.includes('>ЭГО</strong>')); assert.ok(html.includes('5 сэмплов')); assert.ok(html.includes('>ОНО</strong>')); assert.ok(html.includes('4 сэмплов')); assert.ok(html.includes('Послушать голос')); assert.ok(html.includes('Добавить голос NPC'));
    const editor = renderToStaticMarkup(createElement(ParagraphEditor, { project: p, value: paragraph, id: 'test', onChange() {} })); assert.ok(editor.includes('Аудио абзаца')); assert.ok(editor.includes('Голос · СУПЕР-ЭГО')); assert.ok(editor.includes('Громкость голоса'));
    const egoEditor = renderToStaticMarkup(createElement(ParagraphEditor, { project: p, value: { ...paragraph, voiceId: 'ego' }, id: 'ego-test', onChange() {} })); assert.ok(egoEditor.includes('Голос · ЭГО'));
    const onoEditor = renderToStaticMarkup(createElement(ParagraphEditor, { project: p, value: { ...paragraph, voiceId: 'ono' }, id: 'ono-test', onChange() {} })); assert.ok(onoEditor.includes('Голос · ОНО'));
  });
  await check('Editing Super-Ego replaces its single card, retains paragraph IDs and survives backup round trips', async () => {
    const p = fixture(), original = structuredClone(builtinVoiceDefinitions[0]);
    p.voices = [{ ...original, name: 'Мой Супер-Эго', rate: 1.35, pitchVariation: 1.2, volumeVariation: .22, intervalSeconds: .18, samples: original.samples.slice(0, 3) }];
    const restored = parseProject(JSON.parse(JSON.stringify(p))), profile = findVoice(restored, 'super-ego');
    assert.equal(voiceProfiles(restored).length, 3); assert.equal(profile.name, 'Мой Супер-Эго'); assert.equal(profile.rate, 1.35); assert.equal(profile.samples.length, 3); assert.equal(restored.scripts[0].nodes[0].paragraphs[0].voiceId, 'super-ego');
    const { createBackup, backupBlob, parseBackup, restoreBackup } = await load('lib/storage/backup');
    const backup = await createBackup(restored), packet = await parseBackup(new File([backupBlob(backup)], 'backup.json'));
    assert.deepEqual(await restoreBackup(packet), restored); assert.deepEqual(builtinVoiceDefinitions[0], original);
    const reset = parseProject({ ...restored, voices: [] }); assert.equal(findVoice(reset, 'super-ego').samples.length, 8); assert.equal(reset.scripts[0].nodes[0].paragraphs[0].voiceId, 'super-ego');
  });
  await check('Mixed built-in and uploaded samples protect assets and edit every existing card without duplicates', () => {
    const p = fixture(); p.assets = [metadata('sample-a'), metadata('sample-b')];
    p.voices = [{ ...builtinVoiceDefinitions[0], samples: [{ builtinSampleId: 'super-ego-01' }, { assetId: 'sample-a' }] }, npc];
    assert.equal(voiceDefinitions(parseProject(p)).length, 4); assert.equal(assetUses(p, 'sample-a').length, 2); assert.throws(() => removeAsset(p, 'sample-a'));
    const changed = replaceAsset(p, 'sample-a', metadata('replacement')); assert.equal(changed.voices[0].samples[0].builtinSampleId, 'super-ego-01'); assert.equal(changed.voices[0].samples[1].assetId, 'replacement');
    const html = renderToStaticMarkup(createElement(VoiceResources, { project: p, edit() {}, busy: false })); assert.equal((html.match(/>Редактировать</g) ?? []).length, 4); assert.ok(html.includes('Сбросить голос'));
    const form = renderToStaticMarkup(createElement(VoiceForm, { project: p, initial: p.voices[0], onSave() {}, onCancel() {} }));
    assert.equal((form.match(/checked=""/g) ?? []).length, 2); for (const label of ['Имя персонажа', 'Иконка голоса', 'Высота / скорость голоса', 'Разброс высоты', 'Разброс громкости', 'Пауза между слогами', 'Послушать голос', 'Сохранить голос', 'Отмена']) assert.ok(form.includes(label), label);
    const busy = renderToStaticMarkup(createElement(VoiceForm, { project: p, initial: p.voices[0], onSave() {}, onCancel() {}, busy: true })); assert.ok(busy.includes('class="voice-form" disabled=""'));
  });
  await check('Ego uses exactly the five supplied recordings and remains editable without replacing Super-Ego', async () => {
    const p = fixture(), ego = builtinVoiceDefinitions.find(voice => voice.id === 'ego'); assert.ok(ego); assert.equal(ego.samples.length, 5);
    p.scripts[0].nodes[0].paragraphs[0].voiceId = 'ego'; p.voices = [{ ...builtinVoiceDefinitions[0], name: 'Мой Супер-Эго', rate: .9 }, { ...ego, name: 'Моё Эго', rate: 1.15, samples: ego.samples.slice(0, 4) }];
    const restored = parseProject(JSON.parse(JSON.stringify(p))); assert.equal(findVoice(restored, 'ego').name, 'Моё Эго'); assert.equal(findVoice(restored, 'ego').rate, 1.15); assert.equal(findVoice(restored, 'ego').samples.length, 4); assert.equal(findVoice(restored, 'super-ego').name, 'Мой Супер-Эго'); assert.equal(voiceProfiles(restored).length, 3);
    const form = renderToStaticMarkup(createElement(VoiceForm, { project: restored, initial: restored.voices[1], onSave() {}, onCancel() {} })); assert.equal((form.match(/checked=""/g) ?? []).length, 4); assert.ok(form.includes('ЭГО · сэмпл 5'));
    const reset = parseProject({ ...restored, voices: restored.voices.filter(voice => voice.id !== 'ego') }); assert.equal(findVoice(reset, 'ego').samples.length, 5); assert.equal(findVoice(reset, 'super-ego').rate, .9); assert.equal(reset.scripts[0].nodes[0].paragraphs[0].voiceId, 'ego');
    const sources = JSON.parse(await fs.readFile(path.join(root, 'public/voices/ego/sources.json'), 'utf8')); assert.deepEqual(sources.map(source => source.source), ['Эго1.m4a', 'Эго2.m4a', 'Эго3.m4a', 'Эго4.m4a', 'Эго5.m4a']); assert.equal(new Set(sources.map(source => source.source_sha256)).size, 5); assert.deepEqual(builtinVoices.find(voice => voice.id === 'ego').samples.map(sample => sample.url), sources.map(source => '/voices/ego/' + source.file));
  });
  await check('Ono uses all four supplied recordings, survives backup and resets independently of the other voices', async () => {
    const p = fixture(), ono = builtinVoiceDefinitions.find(voice => voice.id === 'ono'); assert.ok(ono); assert.equal(ono.samples.length, 4);
    p.scripts[0].nodes[0].paragraphs[0].voiceId = 'ono'; p.voices = [{ ...builtinVoiceDefinitions[0], rate: .9 }, { ...builtinVoiceDefinitions[1], rate: 1.1 }, { ...ono, name: 'Моё ОНО', rate: .85, samples: ono.samples.slice(0, 2) }];
    const restored = parseProject(JSON.parse(JSON.stringify(p))); assert.equal(voiceProfiles(restored).length, 3); assert.equal(findVoice(restored, 'ono').name, 'Моё ОНО'); assert.equal(findVoice(restored, 'ono').samples.length, 2);
    const form = renderToStaticMarkup(createElement(VoiceForm, { project: restored, initial: restored.voices[2], onSave() {}, onCancel() {} })); assert.equal((form.match(/checked=""/g) ?? []).length, 2); assert.ok(form.includes('ОНО · сэмпл 4'));
    const { createBackup, backupBlob, parseBackup, restoreBackup } = await load('lib/storage/backup'); const backup = await createBackup(restored), packet = await parseBackup(new File([backupBlob(backup)], 'backup.json')); assert.deepEqual(await restoreBackup(packet), restored);
    const reset = parseProject({ ...restored, voices: restored.voices.filter(voice => voice.id !== 'ono') }); assert.equal(findVoice(reset, 'ono').samples.length, 4); assert.equal(findVoice(reset, 'super-ego').rate, .9); assert.equal(findVoice(reset, 'ego').rate, 1.1); assert.equal(reset.scripts[0].nodes[0].paragraphs[0].voiceId, 'ono');
    const sources = JSON.parse(await fs.readFile(path.join(root, 'public/voices/ono/sources.json'), 'utf8')); assert.deepEqual(sources.map(source => source.source), ['оно1.m4a', 'оно2.m4a', 'оно3.m4a', 'оно4.m4a']); assert.equal(new Set(sources.map(source => source.source_sha256)).size, 4); assert.deepEqual(builtinVoices.find(voice => voice.id === 'ono').samples.map(sample => sample.url), sources.map(source => '/voices/ono/' + source.file));
  });
  await check('All seventeen actual WAV grains are small mono PCM clips with nonzero signal and silent edges', async () => {
    let total = 0;
    for (const sample of builtinVoices.flatMap(voice => voice.samples)) {
      const bytes = await fs.readFile(path.join(root, 'public', sample.url)); assert.equal(bytes.toString('ascii',0,4), 'RIFF'); assert.equal(bytes.toString('ascii',8,12), 'WAVE'); assert.equal(bytes.readUInt16LE(20), 1); assert.equal(bytes.readUInt16LE(22), 1); assert.equal(bytes.readUInt32LE(24), 32000); assert.equal(bytes.readUInt16LE(34), 16);
      const count = bytes.readUInt32LE(40)/2, duration = count/32000; assert.ok(duration >= .14 && duration <= .22); assert.equal(bytes.readInt16LE(44), 0); assert.equal(bytes.readInt16LE(bytes.length-2), 0); let peak = 0; for (let i = 44; i < bytes.length; i += 2) peak = Math.max(peak, Math.abs(bytes.readInt16LE(i))); assert.ok(peak > 1000 && peak < 22000); total += bytes.length;
    }
    assert.ok(total < 220000);
  });
  await check('Syllable cadence ignores spaces, respects short and sentence pauses and has no catch-up burst', () => {
    const cadence = new VoiceCadence(); assert.equal(cadence.pulse('А',0,.1), true); assert.equal(cadence.pulse('Б',.03,.1), false); assert.equal(cadence.pulse(' ',.11,.1), false); assert.equal(cadence.pulse(',',.12,.1), false); assert.equal(cadence.pulse('В',.2,.1), false); assert.equal(cadence.pulse('Г',.25,.1), true); assert.equal(cadence.pulse('!',.3,.1), false); assert.equal(cadence.pulse('Д',.5,.1), false); assert.equal(cadence.pulse('Е',.55,.1), true); assert.equal(cadence.pulse('Ж',100,.1), true); assert.equal(cadence.pulse('З',100,.1), false); cadence.reset(); assert.equal(cadence.pulse('И',100,.1), true);
  });
  class Context {
    state = 'running'; currentTime = 0; destination = {}; sources = []; gains = []; onstatechange = null;
    createGain() { const events = [], parameter = { value: 1, setValueAtTime(value, at) { events.push(['set',value,at]); this.value=value; }, linearRampToValueAtTime(value,at) { events.push(['ramp',value,at]); this.value=value; }, cancelScheduledValues(at) { events.push(['cancel',at]); } }; const gain = { gain: parameter, events, disconnected: false, connect() {}, disconnect() { this.disconnected=true; } }; this.gains.push(gain); return gain; }
    createBufferSource() { const source = { buffer: null, playbackRate: { value: 1 }, loop: false, onended: null, stopped: false, disconnected: false, connect() {}, disconnect() { this.disconnected=true; }, start(when,offset,duration) { this.when=when; this.offset=offset; this.duration=duration; }, stop(at) { this.stopped=true; this.stopAt=at; } }; this.sources.push(source); return source; }
    async resume() { this.state='running'; this.onstatechange?.(); } async close() { this.state='closed'; } async decodeAudioData() { return buffer('decoded'); }
  }
  const buffer = id => ({ duration: .2, length: 6400, numberOfChannels: 1, id });
  await check('Voice preparation deduplicates requests, limits parallel decoding and remains silent until a typing pulse', async () => {
    const context = new Context(); let active=0, maximum=0, requests=0;
    const voice = new CharacterVoice(context, context.destination, { load: async (_,id) => { requests++; active++; maximum=Math.max(maximum,active); await new Promise(resolve => setTimeout(resolve, 1)); active--; return buffer(id); } });
    assert.equal(await voice.prepare(base), true); await voice.prepare(base); assert.equal(requests, 8); assert.ok(maximum <= 2); assert.equal(context.sources.length, 0); voice.dispose();
  });
  await check('A profile edited under the same ID updates pitch and sample set without retaining old playback', async () => {
    const context = new Context(); let requests = 0;
    const voice = new CharacterVoice(context, context.destination, { random: () => .5, load: async (_, id) => { requests++; return buffer(id); } });
    await voice.prepare(base); await voice.prepare(structuredClone(base)); assert.equal(requests, 8); voice.pulse('а', .5); const old = context.sources.at(-1);
    const edited = { ...base, rate: 1.6, pitchVariation: 0, samples: [{ key: 'new', url: '/new.wav' }] }; await voice.prepare(edited); assert.ok(old.disconnected); voice.pulse('б', .5); assert.equal(context.sources.at(-1).playbackRate.value, 1.6); assert.equal(context.sources.at(-1).buffer.id, '/new.wav'); assert.equal(requests, 9); voice.dispose();
  });
  await check('Random syllables avoid adjacent repeats, vary pitch/gain within bounds and cap overlap at two', async () => {
    const context = new Context(); let random=0; const voice = new CharacterVoice(context, context.destination, { random: () => (random++ % 7)/7, load: async (_,id) => buffer(id) }); await voice.prepare(base);
    let last;
    for (let i=0;i<30;i++) { context.currentTime=i*.11; voice.pulse('а',.6); const source=context.sources.at(-1); assert.notEqual(source.buffer.id,last); last=source.buffer.id; assert.ok(source.playbackRate.value >= 2**(-.8/12) && source.playbackRate.value <= 2**(.8/12)); assert.ok(source.duration/source.playbackRate.value <= .22); assert.ok(context.sources.filter(source=>!source.stopped).length <= 2); }
    assert.ok(new Set(context.sources.map(source=>source.playbackRate.value)).size > 1); assert.ok(context.gains.every(gain=>gain.events.filter(event=>event.length===3).every(event=>event[1]>=0 && event[1]<=1))); voice.dispose(); assert.ok(context.sources.every(source=>source.disconnected));
  });
  await check('Zero volume, punctuation and suspended contexts cannot emit new voice sources', async () => {
    const context = new Context(), voice = new CharacterVoice(context,context.destination,{load:async(_,id)=>buffer(id)}); await voice.prepare(base); voice.pulse('а',0); voice.pulse(' ',1); voice.pulse('...',1); context.currentTime=.5; context.state='suspended'; voice.pulse('а',1); assert.equal(context.sources.length,0); voice.dispose();
  });
  await check('Pause/skip gently stop the active voice, and switching speaker releases the old profile', async () => {
    const context = new Context(), voice = new CharacterVoice(context,context.destination,{load:async(_,id)=>buffer(id)}); await voice.prepare(base); voice.pulse('а',.5); voice.stop(); assert.ok(context.sources[0].stopAt <= .011); assert.ok(context.gains[0].events.some(event=>event[0]==='ramp' && event[1]===0));
    await voice.prepare({...base,id:'other',samples:[{key:'other',url:'/other.wav'}]}); assert.ok(context.sources[0].disconnected); voice.pulse('б',.5); assert.equal(context.sources.at(-1).buffer.id,'/other.wav'); voice.dispose();
  });
  await check('Disposal aborts pending samples and a late load cannot resurrect the old speaker', async () => {
    const context=new Context(); let resolve; const voice=new CharacterVoice(context,context.destination,{load:()=>new Promise(yes=>{resolve=yes;})}); const ready=voice.prepare({...base,samples:base.samples.slice(0,1)}); await flush(); voice.dispose(); resolve(buffer('late')); assert.equal(await ready,false); voice.pulse('а',1); assert.equal(context.sources.length,0);
  });
  await check('Failed samples retry explicitly; a corrupt sample does not prevent other valid syllables', async () => {
    const context=new Context(); let fail=true,errors=0; const voice=new CharacterVoice(context,context.destination,{load:async(_,id)=>{if(fail)throw new Error('offline');return buffer(id);},onError:()=>errors++}); assert.equal(await voice.prepare(base),false); assert.equal(errors,1); fail=false; voice.retry(); await flush(); await voice.prepare(base); voice.pulse('а',1); assert.equal(context.sources.length,1); voice.dispose();
    const partial=new CharacterVoice(context,context.destination,{load:async(_,id)=>{if(id===base.samples[0].url)throw new Error('bad');return buffer(id);}}); assert.equal(await partial.prepare(base),true); partial.pulse('а',.5); assert.notEqual(context.sources.at(-1).buffer.id,base.samples[0].url); partial.dispose();
  });
  await check('GameAudio routes voice through the master, respects mute/menu/hidden, and preserves background music', async () => {
    globalThis.fetch=async()=>new Response(new Uint8Array([1,2,3])); const p=fixture(); p.assets=[metadata('music')]; p.locations[0].audio.musicAssetId='music'; const s=new TestSession(p,1);s.start();const context=new Context(),audio=new GameAudio(p,s.audioSnapshot(),()=>{},{contextFactory:()=>context,load:async(_,id)=>buffer(id)});
    audio.prepareVoice('super-ego'); audio.sync({...s.audioSnapshot(),pausedBy:[]},{reading:true,hidden:false,effectsPaused:false});await audio.unlock(); await flush(); await audio.characterVoice.prepare(base); audio.voicePulse('а',.5); const music=context.sources.find(source=>source.buffer.id==='music'), syllable=context.sources.at(-1); assert.ok(music); assert.notEqual(music,syllable); audio.stopTyping(); assert.equal(music.stopped,false); assert.equal(syllable.stopped,true);
    context.currentTime=.5; audio.prepareVoice('ono'); await audio.characterVoice.prepare(findVoice(p, 'ono')); audio.voicePulse('а', .5); assert.equal(context.sources.at(-1).buffer.id, 'decoded'); assert.ok(music && !music.stopped); audio.stopTyping();
    context.currentTime=1; const count=context.sources.length; audio.setMuted(true);audio.voicePulse('а',1);audio.setMuted(false);audio.sync(s.audioSnapshot(),{reading:true,hidden:true,effectsPaused:false});audio.voicePulse('б',1);audio.sync(s.audioSnapshot(),{reading:false,hidden:false,effectsPaused:false});audio.voicePulse('в',1);audio.sync(s.audioSnapshot(),{reading:true,hidden:false,effectsPaused:true});audio.voicePulse('г',1);assert.equal(context.sources.length,count);audio.dispose();assert.equal(context.state,'closed');
  });
  console.log('Character voice checks passed: '+passed);
} finally { globalThis.fetch=originalFetch; await fs.rm(output,{recursive:true,force:true}); }
