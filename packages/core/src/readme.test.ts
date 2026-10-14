import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const README = readFileSync(join(ROOT, "README.md"), "utf8");

function resolveFromRoot(relative: string): string {
  return join(ROOT, relative);
}

describe("README", () => {
  it("stays light and points deep content at docs files", () => {
    expect(README.split("\n").length).toBeLessThan(150);
    // Deep dives live in docs, not in the README.
    expect(README).not.toMatch(/F8_ML_EP/);
    expect(README).not.toMatch(/vite-plugin-singlefile/);
    expect(README).toContain("docs/architecture.md");
    expect(README).toContain("docs/features.md");
    expect(README).toContain("docs/development.md");
  });

  it("every referenced docs file exists", () => {
    const refs = new Set<string>();
    for (const match of README.matchAll(/docs\/[A-Za-z0-9/_.-]+\.md/g)) {
      refs.add(match[0]);
    }
    expect(refs.size).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(existsSync(resolveFromRoot(ref)), `missing ${ref}`).toBe(true);
    }
  });

  it("credits the designers in italics", () => {
    expect(README).toContain("*GPT 6 Astra*");
    expect(README).toContain("*Muse Spark 1.3*");
  });

  it("documents how to start the app", () => {
    expect(README).toContain("yarn install");
    expect(README).toContain("yarn setup");
    expect(README).toContain("yarn dev");
    expect(README).toMatch(/localhost:5173/);
  });

  it("lists all app functions", () => {
    const required = [
      "album",
      "preset",
      "histogram",
      "enhance",
      "denoise",
      "undo",
      "compare",
      "zoom",
      "crop",
      "repair",
      "clone",
      "import",
      "export",
      "RAW",
      "search",
      "rating",
    ];
    for (const word of required) {
      expect(README.toLowerCase(), `missing function: ${word}`).toContain(word.toLowerCase());
    }
  });

  it("embeds a screenshot that exists", () => {
    const images = [...README.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)]
      .map((m) => m[1])
      .filter((src): src is string => src !== undefined);
    expect(images.length).toBeGreaterThan(0);
    for (const src of images) {
      expect(existsSync(resolveFromRoot(src)), `missing screenshot ${src}`).toBe(true);
    }
  });
});

describe("extracted docs", () => {
  it("architecture doc holds the project map, build, and server notes", () => {
    const doc = readFileSync(resolveFromRoot("docs/architecture.md"), "utf8");
    expect(doc).toMatch(/@f8\/server/);
    expect(doc).toMatch(/F8_ML_EP/);
    expect(doc).toMatch(/vite-plugin-singlefile/);
  });

  it("features doc holds the full catalogue and shortcuts", () => {
    const doc = readFileSync(resolveFromRoot("docs/features.md"), "utf8");
    expect(doc).toMatch(/Shortcuts/);
    expect(doc).toMatch(/Boundaries/);
    expect(doc).toMatch(/super-resolution/);
  });

  it("development doc holds extension and verification steps", () => {
    const doc = readFileSync(resolveFromRoot("docs/development.md"), "utf8");
    expect(doc).toMatch(/Add an adjustment/);
    expect(doc).toMatch(/Verification/);
  });
});
