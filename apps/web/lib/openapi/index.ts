import snapshot from "./snapshot.json";

type OpenApiSchema = {
  type?: string;
  title?: string;
  description?: string;
  properties?: Record<string, OpenApiSchema>;
  required?: string[];
  default?: unknown;
  items?: OpenApiSchema;
  $ref?: string;
};

type OpenApiOperation = {
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  parameters?: Array<{
    name: string;
    in: "query" | "path" | "header" | "cookie";
    required?: boolean;
    description?: string;
    schema?: OpenApiSchema;
  }>;
  requestBody?: { content?: Record<string, { schema?: OpenApiSchema }> };
  responses?: Record<string, { description?: string; content?: Record<string, { schema?: OpenApiSchema }> }>;
};

export type OpenApiSnapshot = {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Partial<Record<"get" | "post" | "put" | "patch" | "delete", OpenApiOperation>>>;
  components: { schemas: Record<string, OpenApiSchema>; [key: string]: unknown };
  security?: unknown;
};

export const OPENAPI_SNAPSHOT = snapshot as OpenApiSnapshot;

export const OPENAPI_PROVENANCE = {
  source: "apps/api/pitwall_api/main.py app.openapi() exported as /openapi.json",
  sourceCommit: "ea5d61f9ee63290ae0f993aea119ec7264852d35",
  capturedDate: "2026-09-22",
  sourceSha256: "9405c3f9e21fbdb82b3ce9febae0bedfe95a5ba8abd74610cfd4d9cd534aa77f",
  backendTitle: OPENAPI_SNAPSHOT.info.title,
  backendVersion: OPENAPI_SNAPSHOT.info.version,
  openapiVersion: OPENAPI_SNAPSHOT.openapi,
} as const;

export type OpenApiEndpoint = {
  id: string;
  method: string;
  path: string;
  tag: string;
  operation: OpenApiOperation;
};

export function getOpenApiEndpoints(): OpenApiEndpoint[] {
  return Object.entries(OPENAPI_SNAPSHOT.paths).flatMap(([path, pathItem]) =>
    Object.entries(pathItem).map(([method, operation]) => ({
      id: operation?.operationId ?? `${method}-${path}`,
      method: method.toUpperCase(),
      path,
      tag: operation?.tags?.[0] ?? "Other",
      operation: operation ?? {},
    })),
  );
}

export function getOpenApiTags(): string[] {
  return ["ALL", ...Array.from(new Set(getOpenApiEndpoints().map((endpoint) => endpoint.tag))).sort()];
}

export function getOpenApiSchemas() {
  return Object.entries(OPENAPI_SNAPSHOT.components.schemas).map(([name, schema]) => ({ name, ...schema }));
}

export function generateCurlCommand(endpoint: OpenApiEndpoint, apiUrl: string): string {
  const content = endpoint.operation.requestBody?.content?.["application/json"];
  if (!content) return `curl -X ${endpoint.method} "${apiUrl}${endpoint.path}"`;
  return `curl -X ${endpoint.method} "${apiUrl}${endpoint.path}" -H "Content-Type: application/json"`;
}
