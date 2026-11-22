export enum ReasoningEffort {
  /**
   * No reasoning at all. OpenAI's newer models take it, and Ollama's
   * OpenAI-compatible endpoint maps it to turning thinking off.
   */
  NONE = 'none',
  /**
   * Not a level Ollama has: it thinks at full length on it, so the Ollama
   * provider sends `low` instead (`ollamaEffort`).
   */
  MINIMAL = 'minimal',
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

export enum ReasoningSummary {
  AUTO = 'auto',
  CONCISE = 'concise',
  DETAILED = 'detailed',
}
