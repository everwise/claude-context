import * as fs from "fs";
import * as path from "path";
import { envManager } from "./env-manager";
import { VERSION } from "../version";

let logFilePath: string | null = null;

// Initialize log file path once
const initLogFile = () => {
    if (logFilePath !== null) return;

    const logFileConfig = envManager.get("LOG_FILE");
    if (logFileConfig) {
        logFilePath = logFileConfig.startsWith("~")
            ? path.join(process.env.HOME || "", logFileConfig.slice(2))
            : logFileConfig;

        const logDir = path.dirname(logFilePath);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
    }
};

export function logJson(level: string, message: string): void {
    initLogFile();

    const logEntry =
        JSON.stringify({
            timestamp: new Date().toISOString(),
            level,
            message,
            pid: process.pid,
            version: VERSION
        }) + "\n";

    // Always write to stderr for MCP protocol compliance
    process.stderr.write(logEntry);

    // Write to file if configured
    if (logFilePath) {
        try {
            fs.appendFileSync(logFilePath, logEntry, "utf-8");
        } catch {
            // Ignore file write errors
        }
    }
}
