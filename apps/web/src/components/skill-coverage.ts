'use client';
import { useQuery } from '@tanstack/react-query';
import { useWorkspace } from '@/components/workspace';
import { api } from '@/lib/api';
import type { SkillCoverage } from '@/lib/quality';

/** Required skills and certified people per machine (decision 062); empty without `quality.skill.read`. */
export function useSkillCoverage() {
  const ws = useWorkspace();
  const q = useQuery({ queryKey: ['skill-coverage', ws.entityId], queryFn: () => api<SkillCoverage[]>('/quality/skill-coverage', { scope: ws.scope }), enabled: !!ws.entityId && ws.can('quality.skill.read') });
  return new Map((q.data ?? []).map((c) => [c.machineId, c]));
}

/** "2 certified" for a machine that requires skills; null when it requires none. */
export function certifiedLabel(c: SkillCoverage | undefined) {
  if (!c || c.certified === null) return null;
  return `${c.certified} certified`;
}
