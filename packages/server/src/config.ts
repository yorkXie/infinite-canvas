import fs from "node:fs";
import path from "node:path";
import { readDiskJson, writeDiskJson } from "./storage/records.js";

export const DEFAULT_PORT = 17371;
export const VERSION = readPackageVersion();
export const AGENT_PROMPT = fs.readFileSync(new URL("../agent-instructions.md", import.meta.url), "utf8");

export type ServerConfig = { url: string; mcp?: { command: string; args: string[]; env?: Record<string, string> } };

/** stdio 和服务使用同一工作区的地址，即使它们的启动目录不同。 */
export async function loadConfig(directory: string): Promise<ServerConfig> {
    const config = await readDiskJson<ServerConfig>(path.join(directory, "canvas-mcp.json"));
    if (!config?.url) throw new Error("MCP_WORKSPACE_UNAVAILABLE");
    return config;
}

export function saveConfig(directory: string, config: ServerConfig) {
    return writeDiskJson(path.join(directory, "canvas-mcp.json"), { url: config.url });
}

/** 从当前包信息中读取 本地服务版本号。 */
function readPackageVersion() {
    try {
        const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
        return pkg.version || "0.0.0";
    } catch {
        return "0.0.0";
    }
}
