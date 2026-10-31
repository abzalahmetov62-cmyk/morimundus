import { env } from 'cloudflare:workers';
import { getChatGPTUser, type ChatGPTUser } from '@/app/chatgpt-auth';
import { db, StorageError } from './server';

export async function authorAccess(user: ChatGPTUser | null): Promise<boolean> {
  if (!user) return false;
  const row = await db().prepare('SELECT user_id FROM author_accounts WHERE project_id = ?').bind('morimundus').first<{ user_id: string }>();
  if (row) return row.user_id === user.userId;
  const expected = env.MORIMUNDUS_AUTHOR_EMAIL?.trim().toLowerCase();
  if (!expected || user.email.trim().toLowerCase() !== expected) return false;
  await db().prepare('INSERT INTO author_accounts (project_id, user_id) VALUES (?, ?) ON CONFLICT(project_id) DO NOTHING').bind('morimundus', user.userId).run();
  const bound = await db().prepare('SELECT user_id FROM author_accounts WHERE project_id = ?').bind('morimundus').first<{ user_id: string }>();
  return bound?.user_id === user.userId;
}

export async function requireIdentity() {
  const user = await getChatGPTUser();
  if (!user) throw new StorageError('Войди через ChatGPT, чтобы открыть сохранения аккаунта.', 401);
  return user;
}
export async function requireAuthor() {
  const user = await requireIdentity();
  if (!await authorAccess(user)) throw new StorageError('Редактирование доступно только автору игры.', 403);
  return user;
}
export async function requirePlayer(request: Request) {
  const user = await requireIdentity();
  if (request.headers.get('x-morimundus-account') !== user.userId) throw new StorageError('Аккаунт изменился. Обнови страницу игры; открытое прохождение не записано в другой аккаунт.', 409);
  return user;
}
