export interface AppSettings {
  mcpServerName: string;
  cmApiKey: string;
}

export function loadSettings(): AppSettings {
  return {
    mcpServerName: process.env.MCP_SERVER_NAME || "capmonster-mcp",
    cmApiKey: process.env.CM_API_KEY || "",
  };
}
