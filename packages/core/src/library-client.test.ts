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
