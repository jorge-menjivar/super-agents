'use client';

import { useLocation, useNavigate, useParams } from '@tanstack/react-router';
import type { ReactElement, ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  removeSelectedAgentName,
  saveSelectedAgentName,
} from './storage-utils';
import type {
  BreadcrumbSegment,
  NavigateFn,
  NavigationContextType,
  NavigationState,
} from './types';
import { useNavigationRoutes } from './use-navigation-routes';

const NavigationContext = createContext<NavigationContextType | undefined>(
  undefined,
);

export function useNavigation(): NavigationContextType {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error('useNavigation must be used within NavigationProvider');
  }
  return context;
}

interface NavigationProviderProps {
  children: ReactNode;
}

export function NavigationProvider({
  children,
}: NavigationProviderProps): ReactElement {
  // Cast navigate to permissive type during migration
  const tanstackNavigate = useNavigate();
  const navigate = tanstackNavigate as unknown as NavigateFn;
  const location = useLocation();
  const pathname = location.pathname;
  const params = useParams({ strict: false }) as Record<
    string,
    string | undefined
  >;

  const [navigationState, setNavigationState] = useState<NavigationState>({
    section: 'agents',
    currentView: 'agents-list',
    breadcrumbs: [{ label: 'Agents', path: '/agents' }],
  });

  const [isLoadingFromStorage, setIsLoadingFromStorage] = useState(true);

  // Use extracted navigation routes hook
  const navigationRoutes = useNavigationRoutes(navigate);

  // Parse current URL and determine view
  const parseCurrentView = useCallback((): NavigationState['currentView'] => {
    const pathSegments = pathname.split('/').filter(Boolean);

    if (pathSegments[0] !== 'agents') {
      return 'agent-view';
    }

    const agentName = params.agentName;
    const skillName = params.skillName;
    const logId = params.logId;
    const evalId = params.evaluationId;
    const datasetId = params.datasetId;
    const clusterName = params.clusterId;
    const configName = params.armId;

    // Determine view based on URL structure
    if (pathSegments.length === 1) return 'agents-list'; // /agents
    if (pathSegments.length === 2 && agentName) return 'agent-view'; // /agents/[agentName]
    if (pathSegments.length === 3 && agentName && pathSegments[2] === 'edit')
      return 'edit-agent'; // /agents/[agentName]/edit
    if (pathSegments.length === 3 && agentName && pathSegments[2] === 'logs')
      return 'agent-logs'; // /agents/[agentName]/logs
    if (
      pathSegments.length === 4 &&
      agentName &&
      pathSegments[2] === 'logs' &&
      logId
    )
      return 'log-detail'; // /agents/[agentName]/logs/[logId]
    if (pathSegments.length === 3 && agentName && pathSegments[2] === 'skills')
      return 'skills-list'; // /agents/[agentName]/skills
    if (
      pathSegments.length === 4 &&
      agentName &&
      pathSegments[2] === 'skills' &&
      pathSegments[3] === 'create'
    )
      return 'create-skill'; // /agents/[agentName]/skills/create
    if (
      pathSegments.length === 4 &&
      agentName &&
      skillName &&
      pathSegments[2] === 'skills'
    )
      return 'skill-dashboard'; // /agents/[agentName]/skills/[skillName]

    const subPath = pathSegments[4]; // Now at index 4 because of /skills/ in path
    if (subPath === 'evaluations') {
      if (pathSegments[5] === 'create') return 'create-evaluation';
      if (evalId && pathSegments[6] === 'edit') return 'edit-evaluation';
      if (evalId) return 'evaluation-detail';
      return 'evaluations';
    }
    if (subPath === 'datasets') {
      if (pathSegments[5] === 'create') return 'create-dataset';
      if (datasetId) return 'dataset-detail';
      return 'datasets';
    }
    if (subPath === 'configurations') {
      if (pathSegments[5] === 'create') return 'create-configuration';
      if (pathSegments[5] && pathSegments[5] !== 'create')
        return 'edit-configuration';
      return 'configurations';
    }
    if (subPath === 'models') {
      return 'models';
    }
    if (subPath === 'events') {
      return 'skill-events';
    }
    if (subPath === 'clusters') {
      // Check if it's /clusters/[clusterName]/configurations/[configName]
      if (clusterName && pathSegments[6] === 'configurations' && configName) {
        return 'arm-detail';
      }
      // Check if it's /clusters/[clusterName]/configurations
      if (clusterName && pathSegments[6] === 'configurations') {
        return 'cluster-arms';
      }
      return 'clusters';
    }
    if (subPath === 'edit') {
      return 'edit-skill';
    }

    return 'agent-view';
  }, [pathname, params]);

  const setSection = useCallback(
    (section: NavigationState['section']) => {
      navigate({ to: `/${section}` });
    },
    [navigate],
  );

  const navigateBack = useCallback(
    (targetSegmentIndex: number) => {
      const targetSegment = navigationState.breadcrumbs[targetSegmentIndex];
      if (targetSegment) {
        navigate({ to: targetSegment.path });
      }
    },
    [navigationState.breadcrumbs, navigate],
  );

  const updateBreadcrumbs = useCallback((segments: BreadcrumbSegment[]) => {
    setNavigationState((prev) => ({
      ...prev,
      breadcrumbs: segments,
    }));
  }, []);

  // Sync navigation state with URL
  useEffect(() => {
    const currentView = parseCurrentView();
    const agentName = params.agentName;
    const skillName = params.skillName;
    const clusterName = params.clusterId;
    const configName = params.armId;
    const logId = params.logId;
    const evalId = params.evaluationId;
    const datasetId = params.datasetId;

    setNavigationState((prev) => {
      const newState: NavigationState = {
        ...prev,
        currentView,
      } as NavigationState;

      // Store selected names from URL
      if (agentName) {
        // Decode and store agent name
        const decodedAgentName = decodeURIComponent(agentName);
        newState.selectedAgentName = decodedAgentName;
        // Save to localStorage for /agents page
        try {
          saveSelectedAgentName(decodedAgentName);
        } catch {
          // no-op
        }
      } else if (!agentName && currentView !== 'agents-list') {
        // No agent in URL and NOT on /agents page - clear everything
        newState.selectedAgentName = undefined;
        newState.selectedSkillName = undefined;
        // Clear from storage when navigating away from agents
        try {
          removeSelectedAgentName();
        } catch {
          // no-op
        }
      }

      // Store selected skill name from URL
      if (skillName) {
        newState.selectedSkillName = decodeURIComponent(skillName);
      } else {
        newState.selectedSkillName = undefined;
      }

      // Store selected cluster name from URL
      if (clusterName) {
        newState.selectedClusterName = decodeURIComponent(clusterName);
      } else {
        newState.selectedClusterName = undefined;
      }

      // Store selected arm name from URL
      if (configName) {
        newState.selectedArmName = decodeURIComponent(configName);
      } else {
        newState.selectedArmName = undefined;
      }

      // Store IDs for detail views
      if (logId) newState.logId = logId;
      if (evalId) {
        newState.evalId = evalId;
        // For edit-evaluation view, also store as selectedEvaluationId
        if (currentView === 'edit-evaluation') {
          newState.selectedEvaluationId = evalId;
        }
      }
      if (datasetId) newState.datasetId = datasetId;

      // Build breadcrumbs based on current path
      const breadcrumbs: BreadcrumbSegment[] = [];

      // Check if we're on an agent-related route
      const isOnAgentRoute = pathname.startsWith('/agents');

      // Show "Agents" as root breadcrumb for all agent routes
      if (isOnAgentRoute) {
        breadcrumbs.push({
          label: 'Agents',
          path: '/agents',
        });

        // If agent is selected, show it as a dropdown
        if (currentView !== 'agents-list' && newState.selectedAgentName) {
          breadcrumbs.push({
            label: newState.selectedAgentName,
            path: `/agents/${encodeURIComponent(newState.selectedAgentName)}`,
            isAgentDropdown: true,
          });
        }
      }

      // The agent-wide logs page, and every log's detail, sit directly
      // under the agent
      if (
        newState.selectedAgentName &&
        (currentView === 'agent-logs' || currentView === 'log-detail')
      ) {
        breadcrumbs.push({
          label: 'Logs',
          path: `/agents/${encodeURIComponent(newState.selectedAgentName)}/logs`,
        });
      }

      // The skills page, and everything that sits under it: a skill is
      // reached through that page now, so the path says so and the page is a
      // click away from any skill.
      if (
        newState.selectedAgentName &&
        (currentView === 'skills-list' ||
          currentView === 'create-skill' ||
          newState.selectedSkillName)
      ) {
        breadcrumbs.push({
          label: 'Skills',
          path: `/agents/${encodeURIComponent(newState.selectedAgentName)}/skills`,
        });
      }

      if (newState.selectedAgentName && newState.selectedSkillName) {
        breadcrumbs.push({
          label: newState.selectedSkillName,
          path: `/agents/${encodeURIComponent(newState.selectedAgentName)}/skills/${encodeURIComponent(newState.selectedSkillName)}`,
          isSkillDropdown: true,
        });

        if (
          currentView === 'evaluations' ||
          currentView === 'evaluation-detail' ||
          currentView === 'create-evaluation'
        ) {
          breadcrumbs.push({
            label: 'Evaluations',
            path: `/agents/${encodeURIComponent(newState.selectedAgentName)}/skills/${encodeURIComponent(newState.selectedSkillName)}/evaluations`,
          });
        } else if (
          currentView === 'datasets' ||
          currentView === 'dataset-detail' ||
          currentView === 'create-dataset'
        ) {
          breadcrumbs.push({
            label: 'Datasets',
            path: `/agents/${encodeURIComponent(newState.selectedAgentName)}/skills/${encodeURIComponent(newState.selectedSkillName)}/datasets`,
          });
        } else if (currentView === 'models') {
          breadcrumbs.push({
            label: 'Models',
            path: `/agents/${encodeURIComponent(newState.selectedAgentName)}/skills/${encodeURIComponent(newState.selectedSkillName)}/models`,
          });
        } else if (currentView === 'skill-events') {
          breadcrumbs.push({
            label: 'Events',
            path: `/agents/${encodeURIComponent(newState.selectedAgentName)}/skills/${encodeURIComponent(newState.selectedSkillName)}/events`,
          });
        } else if (
          currentView === 'cluster-arms' ||
          currentView === 'arm-detail'
        ) {
          if (newState.selectedClusterName) {
            breadcrumbs.push({
              label: newState.selectedClusterName,
              path: `/agents/${encodeURIComponent(newState.selectedAgentName)}/skills/${encodeURIComponent(newState.selectedSkillName)}/clusters/${encodeURIComponent(newState.selectedClusterName)}/configurations`,
              isClusterDropdown: true,
            });
          }
          if (newState.selectedArmName) {
            breadcrumbs.push({
              label: newState.selectedArmName,
              path: `/agents/${encodeURIComponent(newState.selectedAgentName)}/skills/${encodeURIComponent(newState.selectedSkillName)}/clusters/${encodeURIComponent(newState.selectedClusterName!)}/configurations/${encodeURIComponent(newState.selectedArmName)}`,
              isArmDropdown: true,
            });
          }
        }
      }

      // Handle non-agent routes
      if (pathname.startsWith('/ai-providers')) {
        breadcrumbs.push({
          label: 'AI Providers',
          path: '/ai-providers',
        });
      }

      newState.breadcrumbs = breadcrumbs;

      // Avoid unnecessary renders by shallow-comparing relevant fields
      const sameSelectedNames =
        prev.selectedAgentName === newState.selectedAgentName &&
        prev.selectedSkillName === newState.selectedSkillName &&
        prev.selectedClusterName === newState.selectedClusterName &&
        prev.selectedArmName === newState.selectedArmName;
      const sameIds =
        prev.logId === newState.logId &&
        prev.evalId === newState.evalId &&
        prev.datasetId === newState.datasetId;
      const sameView = prev.currentView === newState.currentView;
      const sameBreadcrumbs =
        prev.breadcrumbs.length === newState.breadcrumbs.length &&
        prev.breadcrumbs.every((b, i) => {
          const nb = newState.breadcrumbs[i];
          return (
            b.label === nb.label &&
            b.path === nb.path &&
            b.isAgentDropdown === nb.isAgentDropdown &&
            b.isSkillDropdown === nb.isSkillDropdown
          );
        });

      if (sameSelectedNames && sameIds && sameView && sameBreadcrumbs) {
        return prev;
      }
      return newState;
    });
  }, [params, parseCurrentView, pathname]);

  // Mark storage as loaded after initial render
  const hasLoadedFromStorageRef = useRef(false);
  useEffect(() => {
    if (!hasLoadedFromStorageRef.current) {
      setIsLoadingFromStorage(false);
      hasLoadedFromStorageRef.current = true;
    }
  }, []);

  return (
    <NavigationContext.Provider
      value={{
        navigationState,
        isLoadingFromStorage,
        navigate,
        setSection,
        ...navigationRoutes,
        navigateBack,
        updateBreadcrumbs,
      }}
    >
      {children}
    </NavigationContext.Provider>
  );
}

// Re-export types for backward compatibility
export type { BreadcrumbSegment, NavigationState } from './types';
