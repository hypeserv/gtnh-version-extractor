import express, { type Request, type Response } from "express";
import crypto from "node:crypto";
import { transform } from "esbuild";

const REMOTE_CONFIG_TS = "https://raw.githubusercontent.com/GTNewHorizons/GTNewHorizons.github.io/refs/heads/master/src/config.ts";

type AnyRecord = Record<string, any>;

async function importRemoteConfigOnce(): Promise<AnyRecord> {
    const res = await fetch(REMOTE_CONFIG_TS);
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Failed to fetch config.ts (${res.status}): ${body.slice(0, 200)}`);
    }

    const tsSource = await res.text();

    // Compile TS to ESM JS
    const compiled = await transform(tsSource, {
        loader: "ts",
        format: "esm",
        platform: "node",
        target: "node20",
        sourcemap: false,
    });

    const base64 = Buffer.from(compiled.code, "utf8").toString("base64");
    const url = `data:text/javascript;base64,${base64}#${crypto
        .createHash("sha256")
        .update(base64)
        .digest("hex")}`;

    const mod: any = await import(url);
    const config = (mod?.default ?? mod?.config) as AnyRecord | undefined;
    if (!config) throw new Error("Remote module did not export a default config.");

    return config;
}

function getVersionEntries(versionsObj: AnyRecord): Array<[string, AnyRecord]> {
    return Object.entries(versionsObj ?? {}).filter(([key, val]) => {
        // return all versions for now, make this an extra endpoint
        //const isStable = /^\d+\.\d+\.\d+$/.test(key);
        const hasServer = val && typeof val === "object" && (val as AnyRecord).server;
        return /*isStable &&*/ hasServer;
    }) as Array<[string, AnyRecord]>;
}

function getStableVersionEntries(versionsObj: AnyRecord): Array<[string, AnyRecord]> {
    return Object.entries(versionsObj ?? {}).filter(([key, val]) => {
        const isStable = /^\d+\.\d+\.\d+$/.test(key);
        const hasServer = val && typeof val === "object" && (val as AnyRecord).server;
        return isStable && hasServer;
    }) as Array<[string, AnyRecord]>;
}

function extractServerUrls(versionsObj: AnyRecord, stable: boolean = false): string[] {
    const entries = (stable)?getStableVersionEntries(versionsObj):getVersionEntries(versionsObj);

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
    const config = await importRemoteConfigOnce();
    const versions: AnyRecord = config.versions ?? {};
    const serverfiles: string[] = extractServerUrls(versions);
    const serverfilesStable: string[] = extractServerUrls(versions, true);

    const app = express();

    app.get("/", (_req: Request, res: Response) => {
        res.json("GTNH config version extractor - ok");
    });

    app.get("/versions", (_req: Request, res: Response) => {
        res.json(versions);
    });

    app.get("/serverfiles", (_req: Request, res: Response) => {
        res.type("text/plain").send(serverfiles.join("\n") + "\n");
    });
    app.get("/serverfiles/stable", (_req: Request, res: Response) => {
        res.type("text/plain").send(serverfilesStable.join("\n") + "\n");
    });


    app.get("/health", (_req: Request, res: Response) => {
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
