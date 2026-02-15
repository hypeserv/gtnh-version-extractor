"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const esbuild_1 = require("esbuild");
const REMOTE_CONFIG_TS = "https://raw.githubusercontent.com/GTNewHorizons/GTNewHorizons.github.io/refs/heads/master/src/config.ts";
async function importRemoteConfigOnce() {
    const res = await fetch(REMOTE_CONFIG_TS);
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Failed to fetch config.ts (${res.status}): ${body.slice(0, 200)}`);
    }
    const tsSource = await res.text();
    // Compile TS to ESM JS
    const compiled = await (0, esbuild_1.transform)(tsSource, {
        loader: "ts",
        format: "esm",
        platform: "node",
        target: "node20",
        sourcemap: false,
    });
    const base64 = Buffer.from(compiled.code, "utf8").toString("base64");
    const url = `data:text/javascript;base64,${base64}#${node_crypto_1.default
        .createHash("sha256")
        .update(base64)
        .digest("hex")}`;
    const mod = await import(url);
    const config = (mod?.default ?? mod?.config);
    if (!config)
        throw new Error("Remote module did not export a default config.");
    return config;
}
function getStableVersionEntries(versionsObj) {
    return Object.entries(versionsObj ?? {}).filter(([key, val]) => {
        const isStable = /^\d+\.\d+\.\d+$/.test(key);
        const hasServer = val && typeof val === "object" && val.server;
        return isStable && hasServer;
    });
}
function extractServerUrls(versionsObj) {
    const entries = getStableVersionEntries(versionsObj);
    const urls = [];
    for (const [, v] of entries) {
        const server = (v?.server ?? {});
        const candidates = [
            server.java17_2XUrl,
            server.java17Url,
            server.java8Url,
            server.java8,
        ].filter((u) => typeof u === "string" && u.includes("/ServerPacks/") && u.endsWith(".zip"));
        urls.push(...candidates);
    }
    return Array.from(new Set(urls));
}
async function main() {
    const config = await importRemoteConfigOnce();
    const versions = config.versions ?? {};
    const serverfiles = extractServerUrls(versions);
    const app = (0, express_1.default)();
    app.get("/versions", (_req, res) => {
        res.json(versions);
    });
    app.get("/serverfiles", (_req, res) => {
        res.type("text/plain").send(serverfiles.join("\n") + "\n");
    });
    app.get("/healthz", (_req, res) => {
        res.type("text/plain").send("ok\n");
    });
    const port = process.env.PORT ? Number(process.env.PORT) : 3000;
    app.listen(port, () => {
        // eslint-disable-next-line no-console
        console.log(`listening on :${port}`);
    });
}
main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
});
