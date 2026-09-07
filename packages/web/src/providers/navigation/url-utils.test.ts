import type { Agent, Skill } from '@shared/types/data';
import type { SkillOptimizationArm } from '@shared/types/data/skill-optimization-arm';
import type { SkillOptimizationCluster } from '@shared/types/data/skill-optimization-cluster';
import {
  getAgentByName,
  getArmByName,
  getClusterByName,
  getSkillByName,
  sanitizeName,
} from '@web/providers/navigation/url-utils';
import { describe, expect, it } from 'vitest';

describe('url-utils', () => {
  describe('sanitizeName', () => {
    it('removes HTML tags from string', () => {
      expect(sanitizeName('<script>alert("xss")</script>')).toBe(
        'alert("xss")',
      );
    });

    it('removes multiple HTML tags', () => {
      expect(sanitizeName('<b>Bold</b> and <i>italic</i>')).toBe(
        'Bold and italic',
      );
    });

    it('handles nested HTML tags', () => {
      expect(sanitizeName('<div><span>Nested</span></div>')).toBe('Nested');
    });

    it('preserves text without HTML tags', () => {
      expect(sanitizeName('Plain text')).toBe('Plain text');
    });

    it('preserves spacing', () => {
      expect(sanitizeName('  Multiple   Spaces  ')).toBe('Multiple   Spaces');
    });

    it('preserves case', () => {
      expect(sanitizeName('CamelCase AND UPPERCASE')).toBe(
        'CamelCase AND UPPERCASE',
      );
    });

    it('handles empty string', () => {
      expect(sanitizeName('')).toBe('');
    });

    it('handles string with only HTML tags', () => {
      expect(sanitizeName('<div></div>')).toBe('');
    });

    it('handles self-closing tags', () => {
      expect(sanitizeName('Before<br/>After')).toBe('BeforeAfter');
    });

    it('handles malformed HTML', () => {
      expect(sanitizeName('<div>Unclosed')).toBe('Unclosed');
    });

    it('removes nested/crafted tags that reveal new tags after removal', () => {
      // Crafted inputs where removing inner tag could reveal outer tag
      // The key security property is that no <tagname patterns remain
      // Trailing > characters are harmless plain text

      // These should not contain any < (start of potential tags)
      expect(sanitizeName('<scrip<script>inner</script>t>')).not.toContain('<');
      expect(sanitizeName('<<script>script>')).not.toContain('<');
      expect(sanitizeName('<s<>cript>')).not.toContain('<');
      expect(sanitizeName('<scr<x>ipt>')).not.toContain('<');

      // Verify the loop removes all tag patterns
      expect(sanitizeName('<<<div>>>')).not.toContain('<');
    });

    it('handles angle brackets that look like HTML tags', () => {
      // The regex /<[^>]*>/g treats < b > as a tag and removes it
      // This is the expected behavior for security - be aggressive about removing potential tags
      expect(sanitizeName('a < b > c')).toBe('a  c');
    });

    it('handles special characters', () => {
      expect(sanitizeName('Agent & Skill')).toBe('Agent & Skill');
      expect(sanitizeName('Test "quoted"')).toBe('Test "quoted"');
    });
  });

  describe('getAgentByName', () => {
    const mockAgents: Agent[] = [
      {
        id: 'agent-1',
        name: 'Customer Support',
        description: 'Customer support agent',
        metadata: {},
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        auto_create_skills: true,
        skill_match_threshold: 0.8,
        max_auto_created_skills: 10,
        skill_arbiter_model_id: null,
        skill_arbiter_timeout_ms: null,
        reviewer_agent_id: null,
        review_fail_closed: false,
        review_expose_reason: false,
      },
      {
        id: 'agent-2',
        name: 'Sales Assistant',
        description: 'Sales assistant agent',
        metadata: {},
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        auto_create_skills: true,
        skill_match_threshold: 0.8,
        max_auto_created_skills: 10,
        skill_arbiter_model_id: null,
        skill_arbiter_timeout_ms: null,
        reviewer_agent_id: null,
        review_fail_closed: false,
        review_expose_reason: false,
      },
      {
        id: 'agent-3',
        name: 'Test Agent',
        description: 'Test agent',
        metadata: {},
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        auto_create_skills: true,
        skill_match_threshold: 0.8,
        max_auto_created_skills: 10,
        skill_arbiter_model_id: null,
        skill_arbiter_timeout_ms: null,
        reviewer_agent_id: null,
        review_fail_closed: false,
        review_expose_reason: false,
      },
    ];

    it('finds agent by exact name', () => {
      const result = getAgentByName(mockAgents, 'Customer Support');
      expect(result?.id).toBe('agent-1');
    });

    it('finds agent by URL-encoded name', () => {
      const result = getAgentByName(mockAgents, 'Customer%20Support');
      expect(result?.id).toBe('agent-1');
    });

    it('finds agent by double-encoded name', () => {
      const result = getAgentByName(mockAgents, 'Customer%2520Support');
      // Single decode gives 'Customer%20Support', which doesn't match
      // This tests the current behavior
      expect(result).toBeUndefined();
    });

    it('returns undefined when agent not found', () => {
      const result = getAgentByName(mockAgents, 'Nonexistent Agent');
      expect(result).toBeUndefined();
    });

    it('returns undefined for empty agents array', () => {
      const result = getAgentByName([], 'Test Agent');
      expect(result).toBeUndefined();
    });

    it('sanitizes HTML from search name', () => {
      const result = getAgentByName(mockAgents, '<b>Test Agent</b>');
      expect(result?.id).toBe('agent-3');
    });

    it('handles special characters in name', () => {
      const agentsWithSpecialChars: Agent[] = [
        {
          id: 'agent-special',
          name: 'Agent & Helper',
          description: 'Special agent',
          metadata: {},
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          auto_create_skills: true,
          skill_match_threshold: 0.8,
          max_auto_created_skills: 10,
          skill_arbiter_model_id: null,
          skill_arbiter_timeout_ms: null,
          reviewer_agent_id: null,
          review_fail_closed: false,
          review_expose_reason: false,
        },
      ];
      const result = getAgentByName(agentsWithSpecialChars, 'Agent & Helper');
      expect(result?.id).toBe('agent-special');
    });

    it('handles malformed URI encoding gracefully', () => {
      // %ZZ is not valid percent encoding
      const result = getAgentByName(mockAgents, '%ZZInvalid');
      // Should not throw, returns undefined since no match
      expect(result).toBeUndefined();
    });
  });

  describe('getSkillByName', () => {
    const mockSkills: Skill[] = [
      {
        id: 'skill-1',
        agent_id: 'agent-1',
        name: 'Email Response',
        description: 'Handles email responses',
        metadata: {},
        optimize: false,
        configuration_count: 10,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        clustering_interval: 0,
        reflection_min_requests_per_arm: 0,
        exploration_temperature: 1.0,
        last_clustering_at: null,
        last_clustering_log_start_time: null,
        evaluations_regenerated_at: null,
        evaluation_lock_acquired_at: null,
        total_requests: 0,
        allowed_template_variables: [],
        auto_created: false,
        seed_system_prompt: null,
      },
      {
        id: 'skill-2',
        agent_id: 'agent-1',
        name: 'Chat Support',
        description: 'Live chat support',
        metadata: {},
        optimize: true,
        configuration_count: 15,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        clustering_interval: 15,
        reflection_min_requests_per_arm: 3,
        exploration_temperature: 1.0,
        last_clustering_at: null,
        last_clustering_log_start_time: null,
        evaluations_regenerated_at: null,
        evaluation_lock_acquired_at: null,
        total_requests: 0,
        allowed_template_variables: [],
        auto_created: false,
        seed_system_prompt: null,
      },
    ];

    it('finds skill by exact name', () => {
      const result = getSkillByName(mockSkills, 'Email Response');
      expect(result?.id).toBe('skill-1');
    });

    it('finds skill by URL-encoded name', () => {
      const result = getSkillByName(mockSkills, 'Chat%20Support');
      expect(result?.id).toBe('skill-2');
    });

    it('returns undefined when skill not found', () => {
      const result = getSkillByName(mockSkills, 'Nonexistent Skill');
      expect(result).toBeUndefined();
    });

    it('returns undefined for empty skills array', () => {
      const result = getSkillByName([], 'Email Response');
      expect(result).toBeUndefined();
    });

    it('sanitizes HTML from search name', () => {
      const result = getSkillByName(
        mockSkills,
        '<script>Chat Support</script>',
      );
      expect(result?.id).toBe('skill-2');
    });
  });

  describe('getClusterByName', () => {
    const mockClusters: SkillOptimizationCluster[] = [
      {
        id: 'cluster-1',
        agent_id: 'agent-1',
        skill_id: 'skill-1',
        name: 'General Queries',
        total_steps: 100,
        observability_total_requests: 50,
        centroid: [0.1, 0.2, 0.3],
        embedding_model_id: null,
        reflection_lock_acquired_at: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
      {
        id: 'cluster-2',
        agent_id: 'agent-1',
        skill_id: 'skill-1',
        name: 'Technical Issues',
        total_steps: 50,
        observability_total_requests: 25,
        centroid: [0.4, 0.5, 0.6],
        embedding_model_id: null,
        reflection_lock_acquired_at: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ];

    it('finds cluster by exact name', () => {
      const result = getClusterByName(mockClusters, 'General Queries');
      expect(result?.id).toBe('cluster-1');
    });

    it('finds cluster by URL-encoded name', () => {
      const result = getClusterByName(mockClusters, 'Technical%20Issues');
      expect(result?.id).toBe('cluster-2');
    });

    it('returns undefined when cluster not found', () => {
      const result = getClusterByName(mockClusters, 'Nonexistent Cluster');
      expect(result).toBeUndefined();
    });

    it('returns undefined for empty clusters array', () => {
      const result = getClusterByName([], 'General Queries');
      expect(result).toBeUndefined();
    });

    it('sanitizes HTML from search name', () => {
      const result = getClusterByName(
        mockClusters,
        '<div>General Queries</div>',
      );
      expect(result?.id).toBe('cluster-1');
    });
  });

  describe('getArmByName', () => {
    const mockArms: SkillOptimizationArm[] = [
      {
        id: 'arm-1',
        agent_id: 'agent-1',
        skill_id: 'skill-1',
        cluster_id: 'cluster-1',
        name: 'Default Configuration',
        params: {
          model_id: 'model-1',
          system_prompt: 'You are a helpful assistant.',
          temperature_min: 0,
          temperature_max: 1,
          top_p_min: 0,
          top_p_max: 1,
          top_k_min: 0,
          top_k_max: 1,
          frequency_penalty_min: 0,
          frequency_penalty_max: 1,
          presence_penalty_min: 0,
          presence_penalty_max: 1,
          thinking_min: 0,
          thinking_max: 1,
        },
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
      {
        id: 'arm-2',
        agent_id: 'agent-1',
        skill_id: 'skill-1',
        cluster_id: 'cluster-1',
        name: 'Formal Tone',
        params: {
          model_id: 'model-2',
          system_prompt: 'You are a formal assistant.',
          temperature_min: 0,
          temperature_max: 1,
          top_p_min: 0,
          top_p_max: 1,
          top_k_min: 0,
          top_k_max: 1,
          frequency_penalty_min: 0,
          frequency_penalty_max: 1,
          presence_penalty_min: 0,
          presence_penalty_max: 1,
          thinking_min: 0,
          thinking_max: 1,
        },
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ];

    it('finds arm by exact name', () => {
      const result = getArmByName(mockArms, 'Default Configuration');
      expect(result?.id).toBe('arm-1');
    });

    it('finds arm by URL-encoded name', () => {
      const result = getArmByName(mockArms, 'Formal%20Tone');
      expect(result?.id).toBe('arm-2');
    });

    it('returns undefined when arm not found', () => {
      const result = getArmByName(mockArms, 'Nonexistent Arm');
      expect(result).toBeUndefined();
    });

    it('returns undefined for empty arms array', () => {
      const result = getArmByName([], 'Default Configuration');
      expect(result).toBeUndefined();
    });

    it('sanitizes HTML from search name', () => {
      const result = getArmByName(mockArms, '<b>Formal Tone</b>');
      expect(result?.id).toBe('arm-2');
    });
  });

  describe('edge cases', () => {
    it('handles empty search string', () => {
      const mockAgents: Agent[] = [
        {
          id: 'agent-1',
          name: '',
          description: 'Empty name agent',
          metadata: {},
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          auto_create_skills: true,
          skill_match_threshold: 0.8,
          max_auto_created_skills: 10,
          skill_arbiter_model_id: null,
          skill_arbiter_timeout_ms: null,
          reviewer_agent_id: null,
          review_fail_closed: false,
          review_expose_reason: false,
        },
      ];
      const result = getAgentByName(mockAgents, '');
      expect(result?.id).toBe('agent-1');
    });

    it('handles unicode characters in names', () => {
      const mockAgents: Agent[] = [
        {
          id: 'agent-unicode',
          name: 'Agente Español 日本語',
          description: 'Unicode agent',
          metadata: {},
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          auto_create_skills: true,
          skill_match_threshold: 0.8,
          max_auto_created_skills: 10,
          skill_arbiter_model_id: null,
          skill_arbiter_timeout_ms: null,
          reviewer_agent_id: null,
          review_fail_closed: false,
          review_expose_reason: false,
        },
      ];
      const result = getAgentByName(mockAgents, 'Agente Español 日本語');
      expect(result?.id).toBe('agent-unicode');
    });

    it('handles URL-encoded unicode characters', () => {
      const mockAgents: Agent[] = [
        {
          id: 'agent-unicode',
          name: 'Test Agent',
          description: 'Test agent',
          metadata: {},
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          auto_create_skills: true,
          skill_match_threshold: 0.8,
          max_auto_created_skills: 10,
          skill_arbiter_model_id: null,
          skill_arbiter_timeout_ms: null,
          reviewer_agent_id: null,
          review_fail_closed: false,
          review_expose_reason: false,
        },
      ];
      // URL-encoded 'Test Agent'
      const result = getAgentByName(mockAgents, 'Test%20Agent');
      expect(result?.id).toBe('agent-unicode');
    });

    it('is case-sensitive', () => {
      const mockAgents: Agent[] = [
        {
          id: 'agent-1',
          name: 'Test Agent',
          description: 'Test agent',
          metadata: {},
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          auto_create_skills: true,
          skill_match_threshold: 0.8,
          max_auto_created_skills: 10,
          skill_arbiter_model_id: null,
          skill_arbiter_timeout_ms: null,
          reviewer_agent_id: null,
          review_fail_closed: false,
          review_expose_reason: false,
        },
      ];
      const result = getAgentByName(mockAgents, 'test agent');
      expect(result).toBeUndefined();
    });
  });
});
