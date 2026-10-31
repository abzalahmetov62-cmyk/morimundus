import type { GameState } from '@/lib/engine/game-state';
export function CheckResult({ name, result }: { name: string; result: NonNullable<GameState['checks'][string]['lastResult']> }) {
  return <div className={result.succeeded ? 'check-result is-success' : 'check-result is-failure'}><strong>{name}: {result.succeeded ? 'успех' : 'провал'}</strong><p>Навык {result.skillValue} × {result.skillWeight}{result.statValue || result.statWeight !== 1 ? ' + характеристика ' + result.statValue + ' × ' + result.statWeight : ''}{result.roll !== null ? ' + кость ' + result.roll + '/' + result.dieSides : ''} = {Number(result.score.toFixed(4))}. Сложность: {result.difficulty}.</p></div>;
}
