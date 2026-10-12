import { afterEach, describe, expect, it, vi } from "vitest";
import { LibraryError, createLibraryClient } from "./library.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("library client deletePhoto", () => {
  it("issues DELETE against the encoded photo URL", async () => {
    const fetch = vi.fn(async () => jsonResponse({ deleted: true }));
    vi.stubGlobal("fetch", fetch);
    const result = await createLibraryClient().deletePhoto("photo 9/x");
    expect(result).toEqual({ deleted: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [input, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(input).toBe("/api/photos/photo%209%2Fx");
    expect(init?.method).toBe("DELETE");
  });

  it("surfaces the server error message on failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "Photo not found." }, 404)));
    const failure = await createLibraryClient().deletePhoto("missing").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(LibraryError);
    expect((failure as LibraryError).status).toBe(404);
    expect((failure as LibraryError).message).toBe("Photo not found.");
  });

  it("reports an unreachable server as status 0", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    const failure = await createLibraryClient().deletePhoto("photo-1").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(LibraryError);
    expect((failure as LibraryError).status).toBe(0);
  });
});

describe("library client semantic search", () => {
  it("searches, labels, and manages labels against the semantic endpoints", async () => {
    const fetch = vi.fn(async (input: string) => {
      if (input === "/api/semantic-search/search") {
        return jsonResponse({ mode: "semantic", matched: ["beach"], results: [{ photoId: "p1", score: 0.3, labelMatch: true }] });
      }
      if (input === "/api/semantic-search/label") {
        return jsonResponse({ albumId: "a1", labeled: ["p1"], alreadyLabeled: [], skipped: [], failed: [] });
      }
      return jsonResponse({ photo: { id: "p1" } });
    });
    vi.stubGlobal("fetch", fetch);
    const client = createLibraryClient();
    const search = await client.semanticSearch("beach");
    expect(search.mode).toBe("semantic");
    expect(search.results).toHaveLength(1);
    const [, searchInit] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(searchInit?.method).toBe("POST");
    expect(searchInit?.body).toContain("beach");
    const report = await client.labelAlbum("a1");
    expect(report.labeled).toEqual(["p1"]);
    await client.updateLabels("p1", { add: ["sunset"], remove: ["beach"] });
    const [labelInput, labelInit] = fetch.mock.calls[2] as unknown as [string, RequestInit];
    expect(labelInput).toBe("/api/photos/p1/labels");
    expect(labelInit?.method).toBe("PATCH");
  });

  it("culls an album against the cull-assist endpoint", async () => {
    const report = {
      albumId: "a1", assessed: ["p1"], alreadyAssessed: [], labeled: ["p1"], alreadyLabeled: [],
      blurry: [], keepers: ["p1"], groups: [], skipped: [], failed: [],
    };
    const fetch = vi.fn(async () => jsonResponse(report));
    vi.stubGlobal("fetch", fetch);
    const client = createLibraryClient();
    expect(await client.cullAlbum("a1")).toEqual(report);
    const [input, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(input).toBe("/api/cull-assist/cull");
    expect(init?.method).toBe("POST");
    expect(init?.body).toContain("a1");
  });

  it("reads semantic health and kicks warmup", async () => {
    const health = { ok: true, ready: false, weightsReady: false };
    const fetch = vi.fn(async () => jsonResponse(health));
    vi.stubGlobal("fetch", fetch);
    const client = createLibraryClient();
    expect(await client.semanticHealth()).toEqual(health);
    expect(await client.semanticWarmup()).toEqual(health);
    const [warmInput, warmInit] = fetch.mock.calls[1] as unknown as [string, RequestInit];
    expect(warmInput).toBe("/api/semantic-search/warmup");
    expect(warmInit?.method).toBe("POST");
  });
});
