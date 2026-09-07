'use client';

import type { Log } from '@shared/types/data';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { LogTagBadge } from '@web/components/agents/log-cells';
import { LogsTableView } from '@web/components/agents/logs-table-view';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@web/components/ui/select';
import { useSmartBack } from '@web/hooks/use-smart-back';
import { useAgents } from '@web/providers/agents';
import { useLogs } from '@web/providers/logs';
import { useNavigation } from '@web/providers/navigation';
import { useSkillOptimizationClusters } from '@web/providers/skill-optimization-clusters';
import { useSkills } from '@web/providers/skills';
import { createSkillAvatar } from '@web/utils/avatars';
import { LayersIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { useEffect } from 'react';

const ALL_SKILLS = 'all';

/**
 * Every request log of the agent in one table, narrowed to one skill by
 * `?skill=<name>` -- a skill's logs have an address without a page of their
 * own. Across skills the table names each log's skill; within one it shows
 * the partition instead, which only means something there.
 */
export function AgentLogsView(): ReactElement {
  const { navigateToLogDetail } = useNavigation();
  const navigate = useNavigate();
  const { skill: skillFilter } = useSearch({
    from: '/_main/agents/$agentName/logs/',
  });
  const smartBack = useSmartBack();
  const { selectedAgent } = useAgents();
  const { skills, setQueryParams: setSkillQueryParams } = useSkills();
  const { clusters, setSkillId: setClustersSkillId } =
    useSkillOptimizationClusters();
  const { setAgentId, setSkillId, setAgentWide } = useLogs();

  const filteredSkill = skillFilter
    ? skills.find((skill) => skill.name === skillFilter)
    : undefined;
  const filteredSkillId = filteredSkill?.id ?? null;

  // The scope: the whole agent, or the one skill named in the URL -- which
  // is then the list the log detail's arrows step through. A named skill
  // not yet resolved leaves the scope unset rather than showing everything.
  useEffect(() => {
    if (!selectedAgent) {
      setAgentId(null);
      setSkillId(null);
      setAgentWide(false);
      return;
    }
    setAgentId(selectedAgent.id);
    setSkillQueryParams({ agent_id: selectedAgent.id, limit: 100 });
    setSkillId(filteredSkillId);
    setAgentWide(!skillFilter);
    setClustersSkillId(filteredSkillId);
  }, [
    selectedAgent,
    skillFilter,
    filteredSkillId,
    setAgentId,
    setSkillId,
    setAgentWide,
    setSkillQueryParams,
    setClustersSkillId,
  ]);

  if (!selectedAgent) {
    return <div>No agent selected</div>;
  }

  const getSkillName = (log: Log): string | null =>
    skills.find((skill) => skill.id === log.skill_id)?.name ?? null;

  // A running row with no skill is one routing has not placed yet.
  const renderSkill = (log: Log) => (
    <LogTagBadge
      value={getSkillName(log)}
      missing={
        log.skill_id === null && log.end_time === null ? 'routing…' : '—'
      }
    />
  );

  const renderPartition = (log: Log) => {
    if (!log.cluster_id) {
      return <LogTagBadge value={null} />;
    }
    const cluster = clusters.find((c) => c.id === log.cluster_id);
    return <LogTagBadge value={cluster?.name} mono missing="Not found" />;
  };

  const selectSkill = (value: string): void => {
    navigate({
      to: '/agents/$agentName/logs',
      params: { agentName: selectedAgent.name },
      search: value === ALL_SKILLS ? {} : { skill: value },
      replace: true,
    });
  };

  return (
    <LogsTableView
      description={
        skillFilter
          ? `Request logs for ${skillFilter}`
          : `Request logs across all skills for ${selectedAgent.name}`
      }
      emptyText={
        skillFilter
          ? 'No logs for this skill yet.'
          : 'No logs available for this agent yet.'
      }
      onBack={() =>
        smartBack(`/agents/${encodeURIComponent(selectedAgent.name)}`)
      }
      onLogClick={(log) => navigateToLogDetail(selectedAgent.name, log.id)}
      extraColumn={
        skillFilter
          ? { header: 'Partition', render: renderPartition }
          : { header: 'Skill', render: renderSkill }
      }
      filters={
        <Select value={skillFilter ?? ALL_SKILLS} onValueChange={selectSkill}>
          <SelectTrigger className="w-[280px]" aria-label="Filter by skill">
            <SelectValue placeholder="Filter by skill" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_SKILLS}>
              <span className="flex items-center gap-2">
                <LayersIcon className="h-4 w-4 text-muted-foreground" />
                All skills
              </span>
            </SelectItem>
            {skills.map((skill) => (
              <SelectItem key={skill.id} value={skill.name}>
                <span className="flex items-center gap-2">
                  <img
                    src={createSkillAvatar(skill.name)}
                    alt=""
                    className="h-4 w-4 rounded-sm"
                  />
                  {skill.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  );
}
