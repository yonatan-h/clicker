import { browser } from "wxt/browser";
import { getBody, stringifyTree, type TreeNode } from "./tree";
import { ID_ATTR } from "../../utils/shared";
import type { Loop } from "../Loop";
import type { Interactor } from "../Interactor";
type LoadingState = {
  pendingRequests: number;
  readyState: Document["readyState"];
};

export class Node {
  constructor(
    public _treeNode: TreeNode,
    private page: Page,
    private loop: Loop,
    private interactor: Interactor,
  ) {}

  text() {
    return this._treeNode.text;
  }
  tag() {
    return this._treeNode.tag.toLowerCase();
  }

  naturalDescription(): string {
    return `${this._treeNode.tag} ${this._treeNode.text ? `(${this._treeNode.text})` : ""}`;
  }

  async click() {
    await this.page._awaitPage();
    await this.loop.syncUI({
      thought: `Clicking on ${this.naturalDescription()}`,
    });
    await this.loop.sleep(300);
    await this.loop.syncUI({ targetId: this._treeNode.id, awaitedAnimMs: 300 });
    await this.page._run(
      [this._treeNode.id, ID_ATTR] as [number, string],
      (targetId, idAttr) => {
        const el = document.querySelector(`[${idAttr}="${targetId}"]`);
        if (!(el instanceof HTMLElement)) {
          throw new Error(`Element with id=${targetId} not found`);
        }
        el.click();
      },
    );

    this.interactor.addToHistory({
      isUser: true,
      pageStats: await this.page._getStats(),
      userText: `Clicked on ${this.naturalDescription()}`,
    });
    await this.loop.sleep(300);
  }

  async type(
    text: string,
    pressEnter: boolean,
    clearBeforeTyping: boolean,
  ): Promise<void> {
    await this.page._awaitPage();
    await this.loop.syncUI({
      thought: `Typing "${text}" into ${this.naturalDescription()}`,
    });
    await this.loop.sleep(300);
    await this.loop.syncUI({ targetId: this._treeNode.id, awaitedAnimMs: 300 });
    await this.page._run(
      [this._treeNode.id, text, ID_ATTR, pressEnter, clearBeforeTyping],
      async (
        targetId: number,
        text: string,
        idAttr: string,
        pressEnter: boolean,
        clearBeforeTyping: boolean,
      ) => {
        const el = document.querySelector(`[${idAttr}="${targetId}"]`);
        if (!(el instanceof HTMLElement)) {
          throw new Error(`Element with id=${targetId} not found`);
        }

        if (
          !(el instanceof HTMLInputElement) &&
          !(el instanceof HTMLTextAreaElement)
        ) {
          throw new Error(
            `Element with id=${targetId} is not an input, but a ${el.tagName.toLowerCase()}`,
          );
        }

        el.focus();
        if (clearBeforeTyping) {
          el.value = "";
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }

        const chunks = text.length > 10 ? text.split(/(\s+)/) : text.split("");
        for (const chunk of chunks) {
          el.value += chunk;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          await new Promise((r) => setTimeout(r, 50));
        }
        el.dispatchEvent(new Event("change", { bubbles: true }));

        if (pressEnter) {
          el.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
          );
          el.dispatchEvent(
            new KeyboardEvent("keyup", { key: "Enter", bubbles: true }),
          );
        }
      },
    );

    this.interactor.addToHistory({
      isUser: true,
      pageStats: await this.page._getStats(),
      userText: `Typed "${text}" into ${this.naturalDescription()}`,
    });
    await this.loop.sleep(300);
  }

  async _token(): Promise<string> {
    const str = stringifyTree(this._treeNode, 0, false);
    const tokens = str.match(/\w+/g)?.length || 0;
    return `${tokens}`;
  }

  static describe() {
    return `Node: Wraps an html element for direct interaction.
  node.click() - Clicks this element.
  node.type(text: string) - Types text into this input/textarea element.
  node.text() - Returns the text of the element.
  node.tag() - Returns the lowercase tag name of the element.
`;
  }
}

export class Page {
  constructor(
    public tabId: number,
    private print: Function,
    private loop: Loop,
    private interactor: Interactor,
  ) {}

  //dont use. only for testing scripts.
  async _testPrint(...thing: any[]): Promise<void> {
    const res = await this._run(thing, (...thing) =>
      console.log(...thing, "(test print)"),
    );
    this.loop.syncUI({ thought: `Printed '${thing}'` });
    return res;
  }

  async navigate(url: string): Promise<void> {
    await this._awaitPage();
    await this.loop.syncUI({ thought: "navigating to " + url });
    await this.loop.sleep(300);
    const dest = url.includes("://") ? url : `https://${url}`;
    await browser.tabs.update(this.tabId, { url: dest });
    await this.loop.sleep(3000);
    await this._awaitPage();
    this.interactor.addToHistory({
      isUser: true,
      pageStats: await this._getStats(),
      userText: `Navigated to ${url}`,
    });
  }

  async _getTree(): Promise<TreeNode> {
    return (await this.body())._treeNode;
  }

  async print_tree(node?: Node): Promise<string> {
    const root = (await this.body())._treeNode;
    const strigified = stringifyTree(node?._treeNode || root, 0, false);
    this.print(strigified);
    this.loop.syncUI({ thought: `Printed ${node?.tag() || "root"}` });
    return strigified;
  }

  static describe() {
    return `Page: Controls the browser tab.
  page.navigate(url: string) - Navigates to the given URL.
  page.print_tree(node?: Node) - Prints the interactive DOM tree (or a subtree from a Node).
  page.body(): Node - Returns the root Element of the current page.
  page.find_by_id(id: int): Node | None - Returns the Node with the specified ID.
`;
  }

  async find_by_id(id: number): Promise<Node | null> {
    const rootNode = await this.body();
    const walk = (node: TreeNode): TreeNode | null => {
      if (node.id === id) return node;
      for (const child of node.children) {
        const found = walk(child);
        if (found) return found;
      }
      return null;
    };

    const foundNode = walk(rootNode._treeNode);
    return foundNode
      ? new Node(foundNode, this, this.loop, this.interactor)
      : null;
  }

  async body(): Promise<Node> {
    const root = await this._run([ID_ATTR], getBody);
    return new Node(root, this, this.loop, this.interactor);
  }

  async _getStats(): Promise<string> {
    //count of each node type, page title, page url, count of tokens
    const tree = await this.body();

    const tagCounts: Record<string, number> = {};
    let totalNodes = 0;
    let totalTextChars = 0;

    const walk = (node: TreeNode) => {
      totalNodes++;
      tagCounts[node.tag] = (tagCounts[node.tag] || 0) + 1;
      if (node.text) totalTextChars += node.text.length;
      for (const child of node.children) {
        walk(child);
      }
    };
    walk(tree._treeNode);

    const tab = await browser.tabs.get(this.tabId);
    const title = tab.title || "(no title)";
    const url = tab.url || "(no url)";

    const tagSummary = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([tag, count]) => `${tag}: ${count}`)
      .join(", ");

    return [
      `url: ${url}`,
      `title: ${title}`,
      `nodes: ${totalNodes}`,
      `~tokens: ${await tree._token()}`,
      `tags: ${tagSummary}`,
    ].join(" | ");
  }

  async _getLoadingState(): Promise<LoadingState> {
    return await this._run([], () => {
      type PageGlobals = typeof globalThis & {
        __awaitPagePatched?: boolean;
        __pendingRequests: number;
      };
      const g = globalThis as PageGlobals;

      if (!g.__awaitPagePatched) {
        g.__awaitPagePatched = true;
        g.__pendingRequests = 0;

        const origFetch = g.fetch.bind(g);
        g.fetch = (...args: Parameters<typeof fetch>) => {
          g.__pendingRequests++;
          return origFetch(...args).finally(() => {
            g.__pendingRequests--;
          });
        };
      }

      return {
        pendingRequests: g.__pendingRequests,
        readyState: document.readyState,
      };
    });
  }

  async _awaitPage(timeoutMs = 5_000) {
    const QUIET_MS = 120;
    const POLL_MS = 100;
    const start = Date.now();
    let lastActivityAt = Date.now();

    while (Date.now() - start < timeoutMs) {
      const state = await this._getLoadingState();
      const now = Date.now();

      if (state.readyState !== "complete") {
        lastActivityAt = Date.now();
        await this.loop.syncUI({ thought: "Waiting for page to load" });
      } else if (state.pendingRequests > 0) {
        lastActivityAt = Date.now();
        await this.loop.syncUI({
          thought: `Waiting for ${state.pendingRequests} network request(s)`,
        });
      } else if (now - lastActivityAt > QUIET_MS) {
        break;
      }

      await this.loop.sleep(POLL_MS);
    }
  }

  async _run<Args extends any[], Return>(
    args: Args,
    callback: (...args: Args) => Return,
  ): Promise<Return> {
    try {
      const results = await browser.scripting.executeScript({
        target: { tabId: this.tabId },
        world: "MAIN",
        args,
        func: callback,
      });
      if (!results || results.length === 0) {
        throw new Error(`No results from tab ${this.tabId}`);
      }

      return results?.[0]?.result as Return;
    } catch (error: any) {
      throw new Error(`Browser exec failed: ${error?.message || error}`);
    }
  }
}
