'use client';

import type { SkillOptimizationEvaluation } from '@shared/types/data';
import {
  type EvaluationMethodDetails,
  type EvaluationMethodName,
  evaluationMethodAppliesTo,
} from '@shared/types/evaluations';
import { getEvaluationMethods } from '@web/api/v1/super-agents/skills';
import { Button } from '@web/components/ui/button';
import { Card, CardContent } from '@web/components/ui/card';
import { Checkbox } from '@web/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@web/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@web/components/ui/dropdown-menu';
import { Input } from '@web/components/ui/input';
import { Label } from '@web/components/ui/label';
import { PageHeader } from '@web/components/ui/page-header';
import { Skeleton } from '@web/components/ui/skeleton';
import { useSmartBack } from '@web/hooks/use-smart-back';
import { useToast } from '@web/hooks/use-toast';
import { useAgents } from '@web/providers/agents';
import { useNavigation } from '@web/providers/navigation';
import { useSkillOptimizationEvaluations } from '@web/providers/skill-optimization-evaluations';
import { useSkills } from '@web/providers/skills';
import {
  Edit,
  Loader2,
  MoreVertical,
  PlusIcon,
  RefreshCwIcon,
  Trash2,
} from 'lucide-react';
import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';

export function EvaluationsListView(): ReactElement {
  const { selectedAgent } = useAgents();
  const { selectedSkill } = useSkills();
  const { navigateToEditEvaluation } = useNavigation();
  const goBack = useSmartBack();
  const { toast } = useToast();

  const {
    evaluations,
    isLoading,
    error,
    refetch,
    setSkillId,
    createEvaluation,
    updateEvaluation,
    deleteEvaluation,
    isCreating,
  } = useSkillOptimizationEvaluations();

  const [sortedEvaluations, setSortedEvaluations] = useState<
    SkillOptimizationEvaluation[]
  >([]);
  const [editingWeightId, setEditingWeightId] = useState<string | null>(null);
  const [tempWeight, setTempWeight] = useState<string>('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [selectedMethodsToAdd, setSelectedMethodsToAdd] = useState<
    EvaluationMethodName[]
  >([]);
  const [evaluationMethods, setEvaluationMethods] = useState<
    EvaluationMethodDetails[]
  >([]);
  const [isLoadingMethods, setIsLoadingMethods] = useState(true);
  const [methodsError, setMethodsError] = useState<Error | null>(null);
  const [evaluationToDelete, setEvaluationToDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // Fetch evaluation methods from server
  useEffect(() => {
    const fetchMethods = async () => {
      try {
        setIsLoadingMethods(true);
        const methods = await getEvaluationMethods();
        setEvaluationMethods(methods);
        setMethodsError(null);
      } catch (error) {
        console.error('Failed to fetch evaluation methods:', error);
        setMethodsError(
          error instanceof Error ? error : new Error('Unknown error'),
        );
      } finally {
        setIsLoadingMethods(false);
      }
    };

    fetchMethods();
  }, []);

  // Set skill ID when skill changes
  useEffect(() => {
    if (!selectedSkill) {
      setSkillId(null);
      return;
    }
    setSkillId(selectedSkill.id);
  }, [selectedSkill, setSkillId]);

  // Sort evaluations by weight (descending) when they change
  useEffect(() => {
    const sorted = [...evaluations].sort((a, b) => b.weight - a.weight);
    setSortedEvaluations(sorted);
  }, [evaluations]);

  // Early return if no skill or agent selected
  if (!selectedSkill || !selectedAgent) {
    return (
      <>
        <PageHeader
          title="Evaluation Methods"
          description="No skill selected. Please select a skill to manage its evaluation methods."
        />
        <div className="p-6">
          <div className="text-center text-muted-foreground">
            No skill selected. Please select a skill to manage its evaluation
            methods.
          </div>
        </div>
      </>
    );
  }

  const handleWeightClick = (evaluation: SkillOptimizationEvaluation) => {
    setEditingWeightId(evaluation.id);
    setTempWeight(evaluation.weight.toString());
  };

  const handleWeightChange = (value: string) => {
    // Allow empty, numbers, and decimals
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setTempWeight(value);
    }
  };

  const handleWeightSave = async (evaluationId: string) => {
    // Prevent saving if already updating or no changes
    if (isUpdating || !selectedSkill || tempWeight === '') {
      setEditingWeightId(null);
      return;
    }

    const numericWeight = Number.parseFloat(tempWeight);

    // Validate weight is positive
    if (Number.isNaN(numericWeight) || numericWeight <= 0) {
      toast({
        title: 'Invalid weight',
        description: 'Weight must be a positive number.',
        variant: 'destructive',
      });
      setEditingWeightId(null);
      return;
    }

    // Find the current evaluation to check if weight actually changed
    const currentEvaluation = sortedEvaluations.find(
      (e) => e.id === evaluationId,
    );
    if (currentEvaluation && currentEvaluation.weight === numericWeight) {
      // No change, just close the editor
      setEditingWeightId(null);
      return;
    }

    setIsUpdating(true);
    try {
      await updateEvaluation(selectedSkill.id, evaluationId, {
        weight: numericWeight,
      });

      toast({
        title: 'Weight updated',
        description: 'The evaluation weight has been updated.',
      });
    } catch (error) {
      console.error('Failed to update weight:', error);
      toast({
        title: 'Failed to update weight',
        description: 'Please try again.',
        variant: 'destructive',
      });
      refetch();
    } finally {
      setIsUpdating(false);
      setEditingWeightId(null);
    }
  };

  const handleWeightKeyDown = (
    e: React.KeyboardEvent,
    evaluationId: string,
  ) => {
    if (e.key === 'Enter') {
      e.preventDefault(); // Prevent form submission if inside a form
      handleWeightSave(evaluationId);
    } else if (e.key === 'Escape') {
      setEditingWeightId(null);
    }
  };

  const confirmDelete = async () => {
    if (!selectedSkill || !evaluationToDelete) return;

    try {
      await deleteEvaluation(selectedSkill.id, evaluationToDelete.id);
      toast({
        title: 'Evaluation method removed',
        description: 'The evaluation method has been removed from this skill.',
      });
      setEvaluationToDelete(null);
    } catch (error) {
      console.error('Failed to delete evaluation:', error);
      toast({
        title: 'Failed to remove evaluation',
        description: 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  const handleToggleMethodToAdd = (method: EvaluationMethodName) => {
    setSelectedMethodsToAdd((prev) =>
      prev.includes(method)
        ? prev.filter((m) => m !== method)
        : [...prev, method],
    );
  };

  const handleAddMethods = async () => {
    if (!selectedSkill || selectedMethodsToAdd.length === 0) return;

    try {
      await createEvaluation(selectedSkill.id, selectedMethodsToAdd);
      toast({
        title: 'Evaluation methods added',
        description: `Added ${selectedMethodsToAdd.length} evaluation method(s).`,
      });
      setIsAddDialogOpen(false);
      setSelectedMethodsToAdd([]);
    } catch (error) {
      console.error('Failed to add evaluation methods:', error);
      toast({
        title: 'Failed to add methods',
        description: 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  // Create a map of method -> details for easy lookup
  const methodsMap = new Map(
    evaluationMethods.map((method) => [method.method, method]),
  );

  // Get already added evaluation methods
  const addedMethods = new Set(evaluations.map((e) => e.evaluation_method));

  // Get available methods that haven't been added yet, of those that can
  // judge this agent's skills
  const availableMethods = evaluationMethods.filter(
    (method) =>
      !addedMethods.has(method.method) &&
      evaluationMethodAppliesTo(method, selectedAgent.agent_type),
  );

  if (isLoading || isLoadingMethods) {
    return (
      <>
        <PageHeader
          title="Evaluation Methods"
          description="Loading evaluation methods..."
          showBackButton={true}
          onBack={goBack}
        />
        <div className="p-6 space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </>
    );
  }

  if (error || methodsError) {
    return (
      <>
        <PageHeader
          title="Evaluation Methods"
          description="Failed to load evaluation methods"
          showBackButton={true}
          onBack={goBack}
        />
        <div className="p-6">
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-destructive mb-4">
                Failed to load evaluation methods:{' '}
                {error?.message || methodsError?.message}
              </p>
              <Button variant="outline" onClick={() => refetch()}>
                <RefreshCwIcon className="h-4 w-4 mr-2" />
                Retry
              </Button>
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Evaluation Methods"
        description={`Manage and prioritize evaluation methods for ${selectedSkill.name}`}
        showBackButton={true}
        onBack={goBack}
        actions={
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => setIsAddDialogOpen(true)}
              disabled={availableMethods.length === 0}
            >
              <PlusIcon className="h-4 w-4 mr-2" />
              Add Method
            </Button>
          </div>
        }
      />

      <div className="p-6 space-y-6">
        {/* Evaluations List */}
        {sortedEvaluations.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-muted-foreground mb-4">
                No evaluation methods configured for this skill.
              </p>
              <Button onClick={() => setIsAddDialogOpen(true)}>
                <PlusIcon className="h-4 w-4 mr-2" />
                Add Your First Method
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {sortedEvaluations.map((evaluation, index) => {
              const metadata = methodsMap.get(evaluation.evaluation_method);
              const isEditing = editingWeightId === evaluation.id;

              return (
                <Card
                  key={evaluation.id}
                  className={`transition-all ${isUpdating ? 'pointer-events-none opacity-70' : ''}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center gap-4">
                      {/* Rank Badge */}
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-muted text-muted-foreground font-bold text-sm">
                        {index + 1}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-base">
                            {metadata?.name || evaluation.evaluation_method}
                          </h3>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {metadata?.description || 'No description available'}
                        </p>
                      </div>

                      {/* Weight Input */}
                      <div className="flex items-center gap-2">
                        <Label
                          htmlFor={`weight-${evaluation.id}`}
                          className="text-sm text-muted-foreground whitespace-nowrap"
                        >
                          Weight:
                        </Label>
                        {isEditing ? (
                          <Input
                            id={`weight-${evaluation.id}`}
                            type="text"
                            value={tempWeight}
                            onChange={(e) => handleWeightChange(e.target.value)}
                            onBlur={() => handleWeightSave(evaluation.id)}
                            onKeyDown={(e) =>
                              handleWeightKeyDown(e, evaluation.id)
                            }
                            className="w-20 h-8 text-sm"
                            autoFocus
                            disabled={isUpdating}
                          />
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleWeightClick(evaluation)}
                            disabled={isUpdating}
                            className="h-8 px-3 font-mono"
                          >
                            {evaluation.weight.toFixed(2)}
                          </Button>
                        )}
                      </div>

                      {/* Actions */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={isUpdating}
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() =>
                              selectedAgent &&
                              selectedSkill &&
                              navigateToEditEvaluation(
                                selectedAgent.name,
                                selectedSkill.name,
                                evaluation.id,
                              )
                            }
                          >
                            <Edit className="h-4 w-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() =>
                              setEvaluationToDelete({
                                id: evaluation.id,
                                name:
                                  metadata?.name ||
                                  evaluation.evaluation_method,
                              })
                            }
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Add Evaluation Methods Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Evaluation Methods</DialogTitle>
            <DialogDescription>
              Select evaluation methods to add to this skill. Each method will
              be assigned a default weight of 1.0 which you can adjust by
              clicking on the weight value.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 border rounded-md p-3 max-h-[400px] overflow-y-auto">
            {availableMethods.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                All available evaluation methods have been added.
              </div>
            ) : (
              availableMethods.map((method) => {
                const isSelected = selectedMethodsToAdd.includes(
                  method.method as EvaluationMethodName,
                );
                return (
                  <Card
                    key={method.method}
                    className={`cursor-pointer transition-all ${
                      isSelected
                        ? 'border-primary bg-primary/5'
                        : 'hover:border-primary/50'
                    }`}
                    onClick={() =>
                      handleToggleMethodToAdd(
                        method.method as EvaluationMethodName,
                      )
                    }
                  >
                    <CardContent className="p-4">
                      <div className="flex gap-3">
                        <div className="pt-0.5">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() =>
                              handleToggleMethodToAdd(
                                method.method as EvaluationMethodName,
                              )
                            }
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                        <div className="flex-1">
                          <Label className="text-base font-medium cursor-pointer">
                            {method.name}
                          </Label>
                          <p className="text-sm text-muted-foreground mt-1">
                            {method.description}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsAddDialogOpen(false);
                setSelectedMethodsToAdd([]);
              }}
              disabled={isCreating}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddMethods}
              disabled={selectedMethodsToAdd.length === 0 || isCreating}
            >
              {isCreating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Adding...
                </>
              ) : (
                `Add ${selectedMethodsToAdd.length > 0 ? selectedMethodsToAdd.length : ''} Method${selectedMethodsToAdd.length !== 1 ? 's' : ''}`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={!!evaluationToDelete}
        onOpenChange={(open) => !open && setEvaluationToDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Evaluation Method</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove{' '}
              <span className="font-semibold">{evaluationToDelete?.name}</span>{' '}
              from this skill? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEvaluationToDelete(null)}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
