'use client';
import { AssetImage } from './asset-image';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { parsePublishedGame, type PublishedGame } from '@/lib/engine/publication';
import { saveTransport } from '@/lib/storage/saves-client';
import { guestSaveTransport } from '@/lib/storage/guest-saves';
import { responseData } from '@/lib/storage/client';

const PlayerLauncher = dynamic(() => import('./player-launcher'), { ssr: false, loading: () => <p role="status">Открываю игру…</p> });
export function GamePortal({ accountId, author }: { accountId: string | null; author: boolean }) {
  const [game, setGame] = useState<PublishedGame | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0), [playing, setPlaying] = useState(false);
  useEffect(() => {
    const lifetime = new AbortController(); setLoading(true); setError('');
    void fetch('/api/game', { cache: 'no-store', signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(15000)]) }).then(async response => {
      const body = await responseData(response, 'Не удалось открыть игру');
      if (!lifetime.signal.aborted) setGame(parsePublishedGame(body));
    }).catch(cause => { if (!lifetime.signal.aborted) setError(cause instanceof Error ? cause.message : 'Не удалось открыть игру'); }).finally(() => { if (!lifetime.signal.aborted) setLoading(false); });
    return () => lifetime.abort();
  }, [refresh]);
  const transport = useMemo(() => game ? (signal: AbortSignal) => accountId ? saveTransport(signal, '/api/player/saves', accountId) : guestSaveTransport(game.project, game.revision, signal) : undefined, [game, accountId]);
  const storageLabel = accountId ? 'Сохранения привязаны к твоему аккаунту ChatGPT и доступны после входа на другом устройстве.' : 'Гостевые сохранения остаются в этом браузере. Очистка данных сайта удалит их.';
  if (playing && game) return <PlayerLauncher project={game.project} revision={game.revision} transport={transport} gameMode storageLabel={storageLabel} exitLabel="В меню игры" onClose={() => { setPlaying(false); setRefresh(value => value + 1); }} />;
  return <section className="game-start" aria-label="Главное меню Morimundus"><div className="game-start-layout">
    <div className="game-start-hero">
      <h1 className="game-start-title"><span className="sr-only">{game?.title ?? 'Morimundus'}</span><AssetImage src="/landing/title.webp" width={2048} height={682} alt="" fetchPriority="high" draggable={false} /></h1>
      <button type="button" className="game-start-play" aria-label="Играть" disabled={loading || !!error || !game} onClick={() => setPlaying(true)}><AssetImage src="/landing/play.webp" width={2048} height={682} alt="" draggable={false} /></button>
      <div className="game-start-status" aria-live="polite">
        {loading ? <p role="status"><LoaderCircle className="animate-spin" size={18} />Открываю игру…</p> : error ? <><p role="alert">{error}</p><Button variant="outline" onClick={() => setRefresh(value => value + 1)}>Попробовать снова</Button>{author && <a href="/">Открыть мастерскую</a>}</> : null}
      </div>
    </div>
    <aside className="game-start-card game-start-controls" aria-labelledby="game-start-controls-heading"><div className="game-start-card-copy" tabIndex={0}>
      <h2 id="game-start-controls-heading">Управление</h2>
      <p><strong>На компьютере</strong><br />WASD — движение, мышь — обзор.<br />E — действие, F — взять.<br />Tab / I — инвентарь, Esc — меню.</p>
      <p><strong>На телефоне</strong><br />Джойстик — движение, пальцем — обзор. Кнопка справа — действие.</p>
    </div></aside>
    <aside className="game-start-card game-start-description" aria-labelledby="game-start-description-heading"><div className="game-start-card-copy" tabIndex={0}>
      <h2 id="game-start-description-heading">О прохождении</h2>
      {game?.project.meta.description && <p>{game.project.meta.description}</p>}
      <p>{storageLabel}</p>
      {!accountId && <p>После входа используются отдельные сохранения аккаунта. Гостевые останутся здесь.</p>}
      {game && <p className="game-start-edition">Редакция {game.revision}</p>}
    </div></aside>
  </div></section>;
}
