import Workbench from '@/components/editor/workbench';
import { requireChatGPTUser, chatGPTSignOutPath } from '@/app/chatgpt-auth';
import { authorAccess } from '@/lib/storage/access';

export const dynamic = 'force-dynamic';
async function AuthorStudio() {
  const user = await requireChatGPTUser('/');
  let author = false, unavailable = false;
  try { author = await authorAccess(user); } catch { unavailable = true; console.error('Morimundus author access unavailable'); }
  if (!author) return <main className="access-gate"><h1>{unavailable ? 'Мастерская временно недоступна' : 'Мастерская доступна только автору'}</h1><p>{unavailable ? 'Не удалось проверить доступ. Попробуй открыть мастерскую снова.' : 'Для прохождения открой страницу игры.'}</p><a href="/play">Открыть игру</a>{unavailable && <a href="/">Повторить</a>}<a href={chatGPTSignOutPath('/')} target="_top">Сменить аккаунт</a></main>;
  return <Workbench accountName={user.displayName} signOutHref={chatGPTSignOutPath('/play')} />;
}
export default function Home() { return <AuthorStudio />; }
