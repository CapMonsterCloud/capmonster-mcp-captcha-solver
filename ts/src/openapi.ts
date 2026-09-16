export const OPENAPI_URL = "https://api.capmonster.cloud/docs/swagger-ui/spec.js";

const OPENAPI_SPEC_JS_RE = /window\.openApiSpec\s*=\s*(\{[\s\S]*\});?\s*$/;

let cachedSpec: any | null = null;

export async function loadOpenApiSpec(): Promise<any> {
  if (cachedSpec) return cachedSpec;

  const response = await fetch(OPENAPI_URL);
  const text = await response.text();
  const match = OPENAPI_SPEC_JS_RE.exec(text);
  if (!match) {
    throw new Error(`Could not find openApiSpec assignment in ${OPENAPI_URL}`);
  }
  cachedSpec = JSON.parse(match[1]);
  return cachedSpec;
}

export function clearOpenApiSpecCache(): void {
  cachedSpec = null;
}

/** Follow a $ref like '#/components/schemas/Foo' */
export function resolveRef(spec: any, ref: string): any {
  const parts = ref.replace(/^#\//, "").split("/");
  let node = spec;
  for (const part of parts) {
    node = node[part];
  }
  return node;
}

export interface CollectedProperties {
  properties: Record<string, any>;
  required: Set<string>;
}

/** Recursively merge properties from allOf/oneOf, resolving $refs. */
export function collectProperties(
  spec: any,
  schema: any,
  visited: Set<string> = new Set(),
): CollectedProperties {
  const properties: Record<string, any> = {};
  const required = new Set<string>();

  if (schema.$ref) {
    const ref = schema.$ref;
    if (visited.has(ref)) {
      return { properties, required };
    }
    visited.add(ref);
    schema = resolveRef(spec, ref);
  }

  for (const sub of schema.allOf ?? []) {
    const { properties: subProps, required: subReq } = collectProperties(spec, sub, visited);
    Object.assign(properties, subProps);
    for (const r of subReq) required.add(r);
  }

  for (const [name, rawPropSchema] of Object.entries<any>(schema.properties ?? {})) {
    let propSchema = rawPropSchema;
    if (propSchema.$ref) {
      propSchema = resolveRef(spec, propSchema.$ref);
    }

    if (propSchema.type === "object" && propSchema.properties) {
      const nestedProps: Record<string, any> = {};
      const nestedRequired = new Set<string>(propSchema.required ?? []);
      for (const [nestedName, rawNestedSchema] of Object.entries<any>(propSchema.properties)) {
        let nestedSchema = rawNestedSchema;
        if (nestedSchema.$ref) {
          nestedSchema = resolveRef(spec, nestedSchema.$ref);
        }
        nestedProps[nestedName] = {
          description: nestedSchema.description ?? "",
          type: nestedSchema.type ?? "",
          required: nestedRequired.has(nestedName),
        };
      }
      properties[name] = {
        description: propSchema.description ?? "",
        type: "object",
        properties: nestedProps,
      };
    } else {
      properties[name] = {
        description: propSchema.description ?? "",
        type: propSchema.type ?? "",
      };
    }
  }

  for (const r of schema.required ?? []) {
    required.add(r);
  }

  return { properties, required };
}
