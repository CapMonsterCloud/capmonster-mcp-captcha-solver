export const API_KEY_ENV = "CAPMONSTER_API_KEY";
export const LEGACY_API_KEY_ENV = "CM_API_KEY";

export const LEGACY_KEY_WARNING =
  `${LEGACY_API_KEY_ENV} is deprecated: rename it to ${API_KEY_ENV}. ` +
  `${LEGACY_API_KEY_ENV} still works for now but will be removed in a future release.`;

export interface AppSettings {
  mcpServerName: string;
  apiKey: string;
  /** true when the key came from the deprecated CM_API_KEY */
  usesLegacyApiKey: boolean;
}

export function loadSettings(env: NodeJS.ProcessEnv = process.env): AppSettings {
  const primary = env[API_KEY_ENV] || "";
  const legacy = env[LEGACY_API_KEY_ENV] || "";
  return {
    mcpServerName: env.MCP_SERVER_NAME || "capmonster-mcp",
    apiKey: primary || legacy,
    usesLegacyApiKey: !primary && Boolean(legacy),
  };
}
