import { collectProperties, loadOpenApiSpec, resolveRef } from "./openapi.js";

export async function getSupportedTasks(): Promise<string[]> {
  const spec = await loadOpenApiSpec();
  const schemas = spec.components.schemas;

  const taskMapping = schemas.Task.discriminator.mapping;
  const customMapping = schemas.CustomTask.discriminator.mapping;

  const topLevel = Object.keys(taskMapping).filter((t) => t !== "CustomTask");
  const custom = Object.keys(customMapping);

  return [...topLevel, ...custom];
}

export interface TaskParameters {
  all_parameters: Record<string, any>;
  required: string[];
  description?: string;
  solution?: string;
}

export async function getTaskParameters(taskType: string): Promise<TaskParameters> {
  const spec = await loadOpenApiSpec();
  const schemas = spec.components.schemas;

  const taskMapping = schemas.Task?.discriminator?.mapping ?? {};
  const customMapping = schemas.CustomTask?.discriminator?.mapping ?? {};

  let schema: any;
  if (taskType in taskMapping) {
    schema = resolveRef(spec, taskMapping[taskType]);
  } else if (taskType in customMapping) {
    schema = resolveRef(spec, customMapping[taskType]);
  } else {
    const available = [...Object.keys(taskMapping), ...Object.keys(customMapping)].sort();
    throw new Error(`Unknown task type '${taskType}'. Available: ${available.join(", ")}`);
  }

  const { properties: allProps, required } = collectProperties(spec, schema);
  const result: TaskParameters = {
    all_parameters: allProps,
    required: [...required].sort(),
  };
  // Surface the spec's own per-type note and solution-schema name (both live
  // from the OpenAPI spec, so they never go stale): `description` is where the
  // spec documents mutually-exclusive variants that the flat `required` list
  // can't represent.
  if (schema.description) {
    result.description = schema.description;
  }
  if (schema["x-solution"]) {
    result.solution = schema["x-solution"];
  }
  return result;
}
