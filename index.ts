import express, { type Request, type Response } from "express";
import {NextFunction} from "connect";

const REMOTE_VERSIONS_JSON = "https://downloads.gtnewhorizons.com/versions.json";

type AnyRecord = Record<string, any>;

function logError(context: string, err: unknown): void {
    const e = err as any;
    const msg = String(e?.stack ?? e?.message ?? e);
    console.error(`${new Date().toISOString()} ERROR [${context}] ${msg}`);
}

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

    try {
        const versions = await fetchVersions();
        cachedVersions = versions;
        cacheFetchedAt = now;
        return versions;
    } catch (e) {
        // Upstream broke. Serve stale cache if we have one; only fail on cold cache.
        if (cachedVersions) {
            const ageMin = Math.round((now - cacheFetchedAt) / 60000);
            logError("upstream fetch failed, serving stale cache", e);
            console.warn(
                `${new Date().toISOString()} WARN serving stale versions cache (age ${ageMin}m)`
            );
            return cachedVersions;
        }
        throw e;
    }
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
                typeof u === "string" /*&& u.includes("/ServerPacks/") */ && u.endsWith(".zip"),
        );

        urls.push(...candidates);
    }

    return Array.from(new Set(urls));
}

async function main() {
    const app = express();

    // Log request data to console
    // Real IP + request logging middleware (Traefik / Cloudflare compatible)
    app.use((req: Request, res: Response, next: NextFunction) => {
        const start = Date.now();

        function getRealIp(): string {
            const cf = req.headers["cf-connecting-ip"];
            if (typeof cf === "string" && cf.length > 0) return cf;

            const xff = req.headers["x-forwarded-for"];
            if (typeof xff === "string" && xff.length > 0) {
                return xff.split(",")[0].trim(); // first = original client
            }

            const xri = req.headers["x-real-ip"];
            if (typeof xri === "string" && xri.length > 0) return xri;

            return req.socket.remoteAddress ?? "unknown";
        }

        const realIp = getRealIp();

        function logLine() {
            const duration = Date.now() - start;
            const line = `${new Date().toISOString()} ${realIp} ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`;
            if (res.statusCode >= 500) console.error(line);
            else console.log(line);
        }

        // "finish" = response sent; "close" = client aborted before finish (would otherwise log nothing)
        res.on("finish", logLine);
        res.on("close", () => {
            if (!res.writableEnded) {
                console.error(
                    `${new Date().toISOString()} ${realIp} ${req.method} ${req.originalUrl} ABORTED ${Date.now() - start}ms`
                );
            }
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
            logError("GET /versions", e);
            res.status(502).json({ error: String(e?.message ?? e) });
        }
    });

    app.get("/serverfiles", async (_req: Request, res: Response) => {
        try {
            const versions = await getVersionsCached();
            const serverfiles = extractServerUrls(versions, false);
            res.type("text/plain").send(serverfiles.join("\n") + "\n");
        } catch (e: any) {
            logError("GET /serverfiles", e);
            res.status(502).type("text/plain").send(`error: ${String(e?.message ?? e)}\n`);
        }
    });

    app.get("/serverfiles/stable", async (_req: Request, res: Response) => {
        try {
            const versions = await getVersionsCached();
            const serverfilesStable = extractServerUrls(versions, true);
            res.type("text/plain").send(serverfilesStable.join("\n") + "\n");
        } catch (e: any) {
            logError("GET /serverfiles/stable", e);
            res.status(502).type("text/plain").send(`error: ${String(e?.message ?? e)}\n`);
        }
    });

    app.get("/health", (_req: Request, res: Response) => {
        res.type("text/plain").send("ok\n");
    });

    // Global error handler — catches anything a route's try/catch missed (must be last, 4 args)
    app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
        logError(`${req.method} ${req.originalUrl}`, err);
        if (!res.headersSent) {
            res.status(500).json({ error: "internal server error" });
        }
    });

    const port = process.env.PORT ? Number(process.env.PORT) : 3000;
    app.listen(port, () => console.log(`listening on :${port}`));
}

// Process-level safety net — log instead of dying silently
process.on("unhandledRejection", (reason) => {
    logError("unhandledRejection", reason);
});
process.on("uncaughtException", (err) => {
    logError("uncaughtException", err);
});

main().catch((e) => {
    logError("startup", e);
    process.exit(1);
});
