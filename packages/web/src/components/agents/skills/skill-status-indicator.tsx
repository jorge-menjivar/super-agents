import type { SkillSummary } from '@shared/types/data';
import { Badge } from '@web/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@web/components/ui/tooltip';
import { useSkillValidation } from '@web/hooks/use-skill-validation';
import { AlertCircle } from 'lucide-react';
import type { ReactElement } from 'react';

interface SkillStatusIndicatorProps {
  skill: SkillSummary;
  /** The size of the icon */
  size?: 'sm' | 'md' | 'lg';
  /** Which side the tooltip should appear on */
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
  /** Whether to show as a badge or just an icon */
  variant?: 'icon' | 'badge';
}

/**
 * Displays an indicator when a skill is not ready (missing models or evaluations).
 * Shows nothing when the skill is ready or loading.
 */
export function SkillStatusIndicator({
  skill,
  size = 'sm',
  tooltipSide = 'right',
  variant = 'icon',
}: SkillStatusIndicatorProps): ReactElement | null {
  const { isReady, missingRequirements, isLoading } = useSkillValidation(skill);

  if (isLoading || isReady) return null;

  const iconSizeClass = {
    sm: 'size-3',
    md: 'size-3.5',
    lg: 'size-4',
  }[size];

  if (variant === 'badge') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge className="gap-1.5 bg-orange-100 dark:bg-orange-950 text-orange-800 dark:text-orange-200 hover:bg-orange-200 dark:hover:bg-orange-900 border-orange-200 dark:border-orange-800">
            <AlertCircle className={iconSizeClass} />
            Not Ready
          </Badge>
        </TooltipTrigger>
        <TooltipContent side={tooltipSide} className="max-w-xs py-2">
          <SkillStatusTooltipContent
            missingRequirements={missingRequirements}
          />
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex shrink-0">
          <AlertCircle
            className={`${iconSizeClass} text-orange-800 dark:text-orange-200`}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide} className="max-w-xs py-2">
        <SkillStatusTooltipContent missingRequirements={missingRequirements} />
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Reusable tooltip content for skill status indicators
 */
function SkillStatusTooltipContent({
  missingRequirements,
}: {
  missingRequirements: string[];
}): ReactElement {
  return (
    <div className="space-y-1.5">
      <p className="font-semibold m-0">Skill not ready</p>
      <ul className="text-xs list-disc pl-4 space-y-0.5">
        {missingRequirements.map((req) => (
          <li key={req}>{req}</li>
        ))}
      </ul>
    </div>
  );
}
