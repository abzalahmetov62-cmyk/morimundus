'use client';

import dynamic from 'next/dynamic';
import { LoaderCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { Project } from '@/lib/engine/project';
import type { GameState } from '@/lib/engine/game-state';

const FirstPerson = dynamic(() => import('@/components/player/player-launcher'), { ssr: false, loading: () => <div className="player-opening"><LoaderCircle className="animate-spin" /><span>Открываю проигрыватель…</span></div> });

export function TestPanel({ project, revision, startLocationId, startScriptId, authorSnapshot, authorMode, savesDisabledReason, onClose }: { project: Project; revision: number; startLocationId?: string; startScriptId?: string; authorSnapshot?: GameState; authorMode?: boolean; savesDisabledReason?: string; onClose: () => void }) {
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="first-person-dialog" showCloseButton={false} onEscapeKeyDown={event => event.preventDefault()} onPointerDownOutside={event => event.preventDefault()}>
    <DialogTitle className="sr-only">Проверка комнаты от первого лица</DialogTitle><DialogDescription className="sr-only">WASD — движение, мышь — обзор, E или щелчок — взаимодействовать, F — взять. Escape освобождает курсор и открывает паузу.</DialogDescription><FirstPerson project={project} revision={revision} startLocationId={startLocationId} startScriptId={startScriptId} authorSnapshot={authorSnapshot} authorMode={authorMode} savesDisabledReason={savesDisabledReason} onClose={onClose} />
  </DialogContent></Dialog>;
}
