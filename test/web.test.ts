import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { type Browser, type BrowserContext, chromium, type Page } from "playwright-core";
import index from "../web/index.html";

setDefaultTimeout(15000);

let server: ReturnType<typeof Bun.serve>;
let browser: Browser;
let context: BrowserContext;
let page: Page;

beforeAll(async () => {
  server = Bun.serve({ port: 0, routes: { "/": index }, development: false });
  browser = await chromium.launch({ channel: "chrome" });
});

afterAll(async () => {
  await browser.close();
  server.stop();
});

async function open(store: Record<string, string> = {}) {
  await context?.close();
  context = await browser.newContext({
    viewport: { width: 1200, height: 700 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  page = await context.newPage();
  page.on("pageerror", (e) => {
    throw e;
  });
  await page.goto(server.url.href);
  await page.evaluate(`(${setStore})(${JSON.stringify(store)})`);
  await page.reload();
  await page.waitForSelector(".mid");
}

function setStore(store: Record<string, string>) {
  const ls = (globalThis as unknown as { localStorage: Storage }).localStorage;
  ls.clear();
  for (const [k, v] of Object.entries(store)) ls.setItem(k, v);
}

const stored = (key: string) =>
  page.evaluate(`localStorage.getItem(${JSON.stringify(key)})`) as Promise<string | null>;

async function expectStored(expected: string | null, key = "mid:source") {
  const check = `localStorage.getItem(${JSON.stringify(key)}) === ${JSON.stringify(expected)}`;
  await page.waitForFunction(check, undefined, { timeout: 2000 }).catch(() => {});
  expect(await stored(key)).toBe(expected);
}

const press = (...keys: string[]) =>
  keys.reduce((p, k) => p.then(() => page.keyboard.press(k)), Promise.resolve());
const type = (text: string) => page.keyboard.type(text);
const bullet = (text: string) => page.locator(".mid-btext", { hasText: new RegExp(`^${text}$`) });
const bullets = () => page.locator(".mid-btext").allTextContents();
const cells = () => page.locator(".mid-tcell").allTextContents();
const selection = () => page.evaluate("getSelection().toString()") as Promise<string>;

async function editorKind() {
  if (await page.locator(".mid-btext").count()) return "bullets";
  if (await page.locator(".mid-tcell").count()) return "table";
  return "text";
}

describe("outline editor", () => {
  test("an empty document starts as one bullet in Graph mode", async () => {
    await open({ "mid:source": "" });
    expect(await bullets()).toEqual([""]);
    expect(await page.locator(".mid-kind").textContent()).toBe("Graph");
    expect(await page.locator(".mid-bullet-dot").allTextContents()).toEqual(["•"]);
  });

  test("Enter, Tab and Shift+Tab build nested bullets", async () => {
    await open({ "mid:source": "" });
    await page.locator(".mid-btext").first().click();
    await type("request");
    await press("Enter", "Tab");
    await type("cache hit");
    await press("Enter");
    await type("fetch");
    await press("Enter", "Tab");
    await type("ok");
    await press("Enter", "Shift+Tab", "Shift+Tab");
    await type("done");
    await expectStored("- request\n  - cache hit\n  - fetch\n    - ok\n- done\n");
    expect(await page.locator(".mid-bullet-dot").allTextContents()).toEqual(Array(5).fill("•"));
  });

  test("arrow keys move between bullets", async () => {
    await open({ "mid:source": "- one\n- two\n" });
    await bullet("one").click();
    await press("End", "ArrowRight");
    await type("A");
    await press("ArrowUp", "End");
    await type("B");
    await press("ArrowDown", "Home", "ArrowLeft");
    await type("C");
    await expectStored("- oneBC\n- Atwo\n");
  });

  test("pasting bullets keeps their nesting", async () => {
    await open({ "mid:source": "- a\n" });
    await bullet("a").click();
    await press("End");
    await page.evaluate(`navigator.clipboard.writeText("- x\\n  - y\\n- z")`);
    await press("Control+V");
    await expectStored("- ax\n  - y\n- z\n");
  });

  test("Shift+Enter types \\n in a bullet", async () => {
    await open({ "mid:source": "- request\n" });
    await bullet("request").click();
    await press("End", "Shift+Enter");
    await type("again");
    await expectStored("- request\\nagain\n");
    expect(await page.locator(".mid-svg-node tspan").allTextContents()).toEqual([
      "request",
      "again",
    ]);
  });

  test("the Text button edits the raw Markdown and Bullets goes back", async () => {
    await open({ "mid:source": "- a\n  - b\n" });
    await page.locator(".mid-swap").click();
    expect(await editorKind()).toBe("text");
    expect(await page.locator("textarea.mid-input").inputValue()).toBe("- a\n  - b\n");
    expect(await page.locator(".mid-swap").textContent()).toBe("Bullets");
    await page.locator(".mid-swap").click();
    expect(await bullets()).toEqual(["a", "b"]);
  });
});

describe("table editor", () => {
  const table = "| Client | Server |\n| ------ | ------ |\n| hi     | ->>    |\n";

  test("a sequence table opens as a table in Diagram mode", async () => {
    await open({ "mid:source": table });
    expect(await cells()).toEqual(["Client", "Server", "hi", "->>"]);
    expect(await page.locator(".mid-kind").textContent()).toBe("Diagram");
  });

  test("Tab past the last cell adds a row", async () => {
    await open({ "mid:source": table });
    await page.locator(".mid-tcell", { hasText: "->>" }).click();
    await press("End", "Tab");
    await type("-->>");
    await press("Tab");
    await type("ok");
    await expectStored(
      "| Client | Server |\n| ------ | ------ |\n| hi     | ->>    |\n| -->>   | ok     |\n",
    );
  });

  test("Shift+Enter types \\n in a cell with text, and nothing in an empty one", async () => {
    await open({ "mid:source": "| Client | Server |\n| ------ | ------ |\n| hi     |        |\n" });
    await page.locator(".mid-tcell").nth(3).click();
    await press("Shift+Enter");
    await type("->>");
    await press("Shift+Tab", "End", "Shift+Enter");
    await type("there");
    await expectStored("| Client    | Server |\n| --------- | ------ |\n| hi\\nthere | ->>    |\n");
    expect(await page.locator(".mid-svg-message tspan").allTextContents()).toEqual(["hi", "there"]);
  });

  test("arrow keys move between cells", async () => {
    await open({ "mid:source": table });
    await page.locator(".mid-tcell", { hasText: "hi" }).click();
    await press("End", "ArrowRight", "ArrowRight");
    await type("!");
    await press("ArrowUp");
    await type("?");
    await press("Home", "ArrowLeft");
    await type("<");
    await expectStored("| Client< | Server? |\n| ------- | ------- |\n| hi      | -!>>    |\n");
  });

  test("participants can be added and deleted", async () => {
    await open({ "mid:source": table });
    await page.locator(".mid-table-frame").hover();
    await page.locator(".mid-grow-col").click();
    await type("Database");
    expect(await cells()).toEqual(["Client", "Server", "Database", "hi", "->>", ""]);
    await page.locator("th").nth(2).hover();
    await page.locator(".mid-handle-column").nth(2).click();
    await page.locator(".mid-menu-item").click();
    expect(await cells()).toEqual(["Client", "Server", "hi", "->>"]);
  });
});

describe("switching modes", () => {
  test("Backspace never switches modes", async () => {
    await open({ "mid:source": "" });
    await page.locator(".mid-btext").first().click();
    await press("Backspace");
    expect(await editorKind()).toBe("bullets");
    await page.locator(".mid-kind").click();
    await press("Backspace", "Backspace");
    expect(await editorKind()).toBe("table");
  });

  test("the Graph/Diagram button saves each mode and restores it after a reload", async () => {
    await open({ "mid:source": "- request\n  - fetch\n" });
    await page.locator(".mid-kind").click();
    expect(await page.locator(".mid-kind").textContent()).toBe("Diagram");
    expect(await selection()).toBe("Participant 1");
    await expectStored("- request\n  - fetch\n", "mid:graph");
    await type("Client");
    await press("Tab", "Control+A");
    await type("Server");
    await press("Tab");
    await type("hi");
    await press("Tab");
    await type("->>");
    await page.locator(".mid-kind").click();
    expect(await bullets()).toEqual(["request", "fetch"]);
    await expectStored("- request\n  - fetch\n");
    await page.reload();
    await page.locator(".mid-kind").click();
    expect(await cells()).toEqual(["Client", "Server", "hi", "->>"]);
  });
});

describe("syntax conversion", () => {
  test("Mid bullets convert to Mermaid and back", async () => {
    await open({ "mid:source": "- a\n  - b: go\n" });
    await page.getByText("Mermaid", { exact: true }).click();
    expect(await editorKind()).toBe("text");
    await expectStored("graph TD\n  n0[a]\n  n1[b]\n  n0 -->|go| n1\n");
    await page.getByText("Mid", { exact: true }).click();
    expect(await bullets()).toEqual(["a", "b: go"]);
  });

  test("lines that aren't understood show as warnings", async () => {
    await open({ "mid:source": "sequenceDiagram\n  A->>B: hi\n  Note over A: x\n" });
    expect(await page.locator(".mid-status").textContent()).toBe(
      "Line 3: not understood: Note over A: x",
    );
  });
});

describe("autocomplete", () => {
  const ghost = () =>
    page.evaluate(`document.activeElement?.dataset.ghost ?? null`) as Promise<string | null>;

  test("a node name shows the rest in grey and Tab accepts it", async () => {
    await open({ "mid:source": "- request\n  - fetch user\n" });
    await bullet("fetch user").click();
    await press("End", "Enter");
    await type("fe");
    expect(await ghost()).toBe("tch user");
    await press("Tab");
    expect(await ghost()).toBeNull();
    await expectStored("- request\n  - fetch user\n  - fetch user\n");
  });

  test("Tab still indents when nothing is suggested, and Esc dismisses", async () => {
    await open({ "mid:source": "- request\n- fetch\n" });
    await bullet("fetch").click();
    await press("End", "Tab");
    await expectStored("- request\n  - fetch\n");
    await press("Enter");
    await type("req");
    expect(await ghost()).toBe("uest");
    await press("Escape");
    expect(await ghost()).toBeNull();
    await press("Shift+Tab");
    await expectStored("- request\n  - fetch\n- req\n");
  });

  test("a dash in a table cell completes to an arrow, then Tab moves on", async () => {
    await open({ "mid:source": "| A | B |\n| - | - |\n| hi |  |\n" });
    await page.locator(".mid-tcell").nth(3).click();
    await type("-");
    expect(await ghost()).toBe(">>");
    await press("Tab");
    await press("Tab");
    await type("next");
    await expectStored("| A    | B   |\n| ---- | --- |\n| hi   | ->> |\n| next |     |\n");
  });
});

describe("output pane", () => {
  test("clicking a node selects it in the outline", async () => {
    await open({ "mid:source": "- request\n  - respond: cache hit\n  - fetch\n" });
    await page.locator('[data-node="respond"]').click();
    expect(await selection()).toBe("respond");
  });

  test("clicking a message selects its text in the table", async () => {
    await open({ "mid:source": "| A | B |\n| - | - |\n| hi | ->> |\n" });
    await page.locator('[data-message="0"] text').click();
    expect(await selection()).toBe("hi");
  });

  test("the caret highlights the node under it", async () => {
    await open({ "mid:source": "- request\n  - fetch\n" });
    await bullet("fetch").click();
    await page.waitForSelector('[data-node="fetch"].mid-hl');
    expect(await page.locator(".mid-hl").count()).toBe(1);
  });

  test("ASCII view shows the text rendering", async () => {
    await open({ "mid:source": "- a\n" });
    await page.getByText("ASCII", { exact: true }).click();
    expect(await page.locator(".mid-text").textContent()).toContain("│ a │");
  });
});
