import express, { type Request, type Response } from "express";
import {NextFunction} from "connect";

const REMOTE_VERSIONS_JSON = "https://downloads.gtnewhorizons.com/versions.json";

type AnyRecord = Record<string, any>;

const CACHE_TTL_MS = 60 * 60 * 1000; // 1h

let cachedVersions: AnyRecord | null = null;
let cacheFetchedAt = 0;

async function fetchVersions(): Promise<AnyRecord> {
    const res = await fetch(REMOTE_VERSIONS_JSON);

    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(
            `Failed to fetch versions.json (${res.status}): ${body.slice(0, 200)}`,
        );
    }

    const versions = (await res.json()) as AnyRecord;
    if (!versions || typeof versions !== "object") {
        throw new Error("Invalid versions.json format (expected object).");
    }
    return versions;
}

async function getVersionsCached(): Promise<AnyRecord> {
    const now = Date.now();
    if (cachedVersions && now - cacheFetchedAt < CACHE_TTL_MS) return cachedVersions;

    const versions = await fetchVersions();
    cachedVersions = versions;
    cacheFetchedAt = now;
    return versions;
}

function getVersionEntries(versionsObj: AnyRecord): Array<[string, AnyRecord]> {
    return Object.entries(versionsObj ?? {}).filter(([_, val]) => {
        const hasServer = val && typeof val === "object" && (val as AnyRecord).server;
        return hasServer;
    }) as Array<[string, AnyRecord]>;
}

function getStableVersionEntries(versionsObj: AnyRecord): Array<[string, AnyRecord]> {
    return Object.entries(versionsObj ?? {}).filter(([key, val]) => {
        const isStable = /^\d+\.\d+\.\d+$/.test(key);
        const hasServer = val && typeof val === "object" && (val as AnyRecord).server;
        return isStable && hasServer;
    }) as Array<[string, AnyRecord]>;
}

function extractServerUrls(versionsObj: AnyRecord, stable = false): string[] {
    const entries = stable ? getStableVersionEntries(versionsObj) : getVersionEntries(versionsObj);

    const urls: string[] = [];
    for (const [, v] of entries) {
        const server = (v?.server ?? {}) as AnyRecord;

        const candidates = [
            server.java17_2XUrl,
            server.java17Url,
            server.java8Url,
            server.java8,
        ].filter(
            (u): u is string =>
                typeof u === "string" && u.includes("/ServerPacks/") && u.endsWith(".zip"),
        );

        urls.push(...candidates);
    }

    return Array.from(new Set(urls));
}

async function main() {
    const app = express();

    // logs
    app.use((req: Request, res: Response, next: NextFunction) => {
        const start = Date.now();

        res.on("finish", () => {
            const duration = Date.now() - start;
            console.log(`${new Date().toISOString()} ${req.ip} ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
        });

        next();
    });

    app.get("/", (_req: Request, res: Response) => {
        res.json("GTNH version extractor - ok");
    });

    app.get("/versions", async (_req: Request, res: Response) => {
        try {
            const versions = await getVersionsCached();
            res.json(versions);
        } catch (e: any) {
            res.status(502).json({ error: String(e?.message ?? e) });
        }
    });

    app.get("/serverfiles", async (_req: Request, res: Response) => {
        try {
            const versions = await getVersionsCached();
            const serverfiles = extractServerUrls(versions, false);
            res.type("text/plain").send(serverfiles.join("\n") + "\n");
        } catch (e: any) {
            res.status(502).type("text/plain").send(`error: ${String(e?.message ?? e)}\n`);
        }
    });

    app.get("/serverfiles/stable", async (_req: Request, res: Response) => {
        try {
            const versions = await getVersionsCached();
            const serverfilesStable = extractServerUrls(versions, true);
            res.type("text/plain").send(serverfilesStable.join("\n") + "\n");
        } catch (e: any) {
            res.status(502).type("text/plain").send(`error: ${String(e?.message ?? e)}\n`);
        }
    });

    app.get("/health", (_req: Request, res: Response) => {
        res.type("text/plain").send("ok\n");
    });

    const port = process.env.PORT ? Number(process.env.PORT) : 3000;
    app.listen(port, () => console.log(`listening on :${port}`));
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
