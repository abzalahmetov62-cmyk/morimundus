'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { GameState } from '@/lib/engine/game-state';
import type { TestSession } from '@/lib/engine/session';
import { containerContents, recipePreparation } from '@/lib/engine/item-interactions';

export function ContainerPanel({ session, state, objectId, onChange, onClose, onPause }: { session: TestSession; state: GameState; objectId: string; onChange: () => void; onClose: () => void; onPause: () => void }) {
  const [error, setError] = useState(''), closeButton = useRef<HTMLButtonElement>(null), panel = useRef<HTMLElement>(null), pauseRef = useRef(onPause);
  pauseRef.current = onPause;
  useEffect(() => {
    closeButton.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Escape') { e.preventDefault(); pauseRef.current(); }
      if (e.code === 'Tab') {
        const buttons = [...(panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
        const first = buttons[0], last = buttons.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  const object = session.project.objects.find(o => o.id === objectId);
  if (!object?.container) return null;
  const contents = containerContents(state, objectId), process = state.cooking[objectId];
  const name = (id: string) => session.project.items.find(d => d.id === state.items[id]?.definitionId)?.name ?? 'Предмет';
  const run = (action: () => void) => { try { action(); setError(''); onChange(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось выполнить действие'); } };
  const selected = state.player.inventory[state.player.activeSlot];
  const recipes = session.project.recipes.filter(r => !r.containerObjectId || r.containerObjectId === objectId);
  return <div className="player-overlay"><section ref={panel} className="player-container-panel" role="dialog" aria-modal="true" aria-labelledby="container-heading"><div className="section-title"><div><span className="section-eyebrow">КОНТЕЙНЕР</span><h2 id="container-heading">{object.name}</h2></div><Button ref={closeButton} variant="outline" onClick={onClose}>Закрыть</Button></div>{object.notes && <p className="container-description">{object.notes}</p>}<p>{contents.length} / {object.container.capacity} вещей</p>{error && <p role="alert" className="scenario-notice">{error}</p>}{process && <p role="status">Идёт приготовление: {session.project.recipes.find(r => r.id === process.recipeId)?.name}. Ингредиенты заняты.</p>}{!process && state.objects[objectId].state.cookingState === 'ready' && <p role="status">Готово. Результат находится в контейнере.</p>}<div className="container-contents">{contents.length ? contents.map(item => <div className="container-item-row" key={item.id}><span>{name(item.id)}</span><Button size="sm" variant="outline" disabled={!!process || !state.player.inventory.includes(null)} onClick={() => run(() => session.takeFromContainer(objectId, item.id))}>Взять</Button></div>) : <p className="field-help">Пусто.</p>}</div>{contents.length > 0 && !state.player.inventory.includes(null) && <p className="field-help">Для извлечения нужна свободная ячейка инвентаря.</p>}<h3>Вещь из инвентаря</h3><div className="container-inventory">{state.player.inventory.map((id, slot) => <button type="button" key={slot} aria-pressed={slot === state.player.activeSlot} className={slot === state.player.activeSlot ? 'container-slot is-selected' : 'container-slot'} onClick={() => run(() => session.selectSlot(slot))}>{slot + 1}. {id ? name(id) : 'Пусто'}</button>)}</div><Button variant="outline" disabled={!selected || !!process} onClick={() => run(() => session.putInContainer(objectId))}>Положить {selected ? name(selected) : 'выбранную вещь'}</Button>{recipes.length > 0 && <><h3>Приготовление</h3>{recipes.map(recipe => { let reason = ''; try { recipePreparation(session.project, state, objectId, recipe.id); } catch (cause) { reason = cause instanceof Error ? cause.message : 'Недоступно'; } return <div className="container-recipe" key={recipe.id}><div><strong>{recipe.name}</strong><p className="field-help">{recipe.ingredientTags.join(' + ')} → {session.project.items.find(i => i.id === recipe.resultItemId)?.name}</p>{reason && <p className="field-help">{reason}</p>}</div><Button size="sm" disabled={!!reason} onClick={() => run(() => session.cook(objectId, recipe.id))}>{recipe.durationSeconds ? 'Начать' : 'Приготовить'}</Button></div>; })}{process && <p className="field-help">Приготовление продолжается во время исследования. Чтение и меню останавливают его.</p>}</>}<div className="player-menu-actions"><Button onClick={onClose}>Продолжить исследование</Button><Button variant="ghost" onClick={onPause}>Пауза</Button></div></section></div>;
}
