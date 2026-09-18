'use client';

import { createLazyFileRoute } from '@tanstack/react-router';
import { SkillsView } from '@web/components/agents/skills/skills-view';

export const Route = createLazyFileRoute('/_main/agents/$agentName/skills/')({
  component: SkillsView,
});
