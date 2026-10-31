'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import type { Project } from '@/lib/engine/project';
import { GAME_CYCLE_NAME } from '@/lib/engine/game-cycle';

export function GameCyclePanel({ project, busy, onAdd, onOpenLocation, onOpenScript, onTest }: { project: Project; busy: boolean; onAdd: (startHere: boolean, signal: AbortSignal) => Promise<{ locationId: string; scriptId: string }>; onOpenLocation: (id: string) => void; onOpenScript: (id: string) => void; onTest: (locationId: string, scriptId: string) => void }) {
  const [startHere, setStartHere] = useState(false), [confirm, setConfirm] = useState(false), [adding, setAdding] = useState(false), [error, setError] = useState('');
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => controller.abort(); }, []);
  const copies = project.locations.filter(location => /^cycle\d*-home$/.test(location.id));
  async function add() {
    const controller = lifetime.current; if (!controller) return;
    setConfirm(false); setAdding(true); setError('');
    try { await onAdd(startHere, controller.signal); }
    catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Не удалось добавить сцену'); }
    finally { if (!controller.signal.aborted) setAdding(false); }
  }
  return <section className="game-cycle-workspace"><h2>{GAME_CYCLE_NAME}</h2><p>Квартира и лестничная площадка для проверки полного прохождения. Все объекты, тексты, условия и последствия открываются в обычных разделах мастерской.</p>
    <div className="game-cycle-actions"><Button disabled={busy || adding} onClick={() => setConfirm(true)}>{adding ? 'Добавляю сцену…' : 'Добавить в проект'}</Button><div className="game-cycle-start"><Switch id="cycle-start" checked={startHere} onCheckedChange={setStartHere} disabled={busy || adding} /><Label htmlFor="cycle-start">Сделать началом игры</Label></div></div>
    {error && <p role="alert">{error}</p>}<p className="field-help">Добавятся две локации, 14 объектов, четыре сцены и файл пульса. Тестовые тексты и геометрические заглушки можно заменить своими. Добавление отменяется одной командой; запись в проект и публикация выполняются отдельно.</p>
    <p className="field-help">«Проверить с пробуждения» запускает отдельный мир без записи прогресса. Сохранения проверяй в опубликованной игре. Сцена использует настройки проекта; сосед появляется с 07:00 до 20:00.</p>
    {copies.length > 0 && <div className="game-cycle-copies"><h3>Добавленные сцены</h3>{copies.map(location => { const scriptId = location.id.replace(/-home$/, '-wake'), exists = project.scripts.some(script => script.id === scriptId); return <div className="game-cycle-copy" key={location.id}><strong>{location.name}</strong><div className="game-cycle-actions"><Button variant="outline" disabled={busy || !exists} onClick={() => onTest(location.id, scriptId)}>Проверить с пробуждения</Button><Button variant="ghost" onClick={() => onOpenLocation(location.id)}>Редактировать квартиру</Button>{exists && <Button variant="ghost" onClick={() => onOpenScript(scriptId)}>Редактировать пробуждение</Button>}</div></div>; })}</div>}
    <h3>Маршрут проверки</h3><ol className="game-cycle-route"><li>Дочитай пробуждение и выбери «Встать». Время во время текста стоит, пульс включается кнопкой звука.</li><li>Попробуй взять четыре вещи при трёх ячейках. Надень пальто; его карманы добавят две ячейки. Осмотри настенные и наручные часы.</li><li>Выбери бумагу и бутылку по очереди и примени к ведру. Положи крупу и воду в кастрюлю, запусти кашу и выйди на площадку. В опубликованной игре сохранись во время приготовления.</li><li>Проверь разговор до и после записки. После провала вернись в квартиру, прочти записку, выйди к соседу и повтори проверку через журнал.</li><li>Вернись к готовой каше, забери её и примени к соседу. Проверь завершение задания и единственную награду.</li><li>Сохрани проект, опубликуй редакцию и пройди тот же маршрут по ссылке игры. Проверь продолжение с другого устройства и другой аккаунт.</li></ol>
    <AlertDialog open={confirm} onOpenChange={setConfirm}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Добавить контрольное утро?</AlertDialogTitle><AlertDialogDescription>Появятся отдельные локации с тестовыми предметами, заданием и проверкой навыка. {startHere ? 'Новое прохождение начнётся в контрольной квартире.' : 'Начальная локация проекта сохранится.'} После добавления сохрани проект, если хочешь оставить сцену.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Отмена</AlertDialogCancel><AlertDialogAction disabled={busy || adding} onClick={() => void add()}>Добавить</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}
