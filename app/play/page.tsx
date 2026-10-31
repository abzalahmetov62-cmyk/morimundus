import { getChatGPTUser, chatGPTSignInPath, chatGPTSignOutPath } from '@/app/chatgpt-auth';
import { authorAccess } from '@/lib/storage/access';
import { GamePortal } from '@/components/player/game-portal';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Morimundus · игра' };
export default async function Play() {
  const user = await getChatGPTUser();
  let author = false;
  try { author = await authorAccess(user); } catch { console.error('Morimundus author access unavailable'); }
  return <main className="game-page"><header className="game-account"><span>{user ? user.displayName : 'Гостевое прохождение'}</span><nav aria-label="Аккаунт">{author && <a href="/">Мастерская</a>}{user ? <a href={chatGPTSignOutPath('/play')} target="_top">Выйти</a> : <a href={chatGPTSignInPath('/play')} target="_top">Войти через ChatGPT</a>}</nav></header><GamePortal accountId={user?.userId ?? null} author={author} /></main>;
}
