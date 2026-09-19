import { browser } from "wxt/browser";
import { getBody, stringifyTree, type TreeNode } from "./tree";
import { ID_ATTR } from "../../utils/shared";
import type { Loop } from "../Loop";

export class Node {
  constructor(
    public _treeNode: TreeNode,
    private page: Page,
  ) {}

  text() {
    return this._treeNode.text;
  }
  tag() {
    return this._treeNode.tag.toLowerCase();
  }

  async click() {
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
  }

  async type(text: string): Promise<void> {
    await this.page._run(
      [this._treeNode.id, text, ID_ATTR] as [number, string, string],
      (targetId, val, idAttr) => {
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
        el.value = val;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      },
    );
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
    const dest = url.includes("://") ? url : `https://${url}`;
    await browser.tabs.update(this.tabId, { url: dest });
    this.loop.syncUI({ thought: "navigated to " + url });
  }

  async print_tree(node?: Node) {
    node = node || (await this.body());
    const root = (await this.body())._treeNode;
    const strigified = stringifyTree(node?._treeNode || root, 0, false);
    this.print(strigified);
    this.loop.syncUI({ thought: `Printed ${node.tag()}` });
  }

  static describe() {
    return `Page: Controls the browser tab.
  page.navigate(url: string) - Navigates to the given URL.
  page.print_tree(node?: Node) - Prints the interactive DOM tree (or a subtree from a Node).
  page.body(): Node - Returns the root Element of the current page.
  page.find_by_id(id: int): Node | None - Returns the Node with the specified ID.
`;
  }

  async find_by_id(id: number): Promise<Node|null> {
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
    return foundNode ? new Node(foundNode, this) : null;
  }

  async body(): Promise<Node> {
    const root = await this._run([ID_ATTR], getBody);
    return new Node(root, this);
  }

  async _getSummary(): Promise<string> {
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
    ].join("\n");
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
