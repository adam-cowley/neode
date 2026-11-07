export interface NodeConfig {
  labels?: string[]
  /**
  Free-text explanation of the model for LLM-agent-facing ontology
  emission (NTS-445): surfaced by `ontology()` / `ontologyMarkdown()`.
  */
  description?: string
}
