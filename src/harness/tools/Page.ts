import { browser } from "wxt/browser";
import { getTree, stringifyTree, toTreeNode, type TreeNode } from "./tree";
import { ID_ATTR } from "../../utils/shared";

export class Page {
  constructor(
    public tabId: number,
    private print: Function
  ) {}

  //dont use. only for testing scripts.
  async _testPrint(...thing: any[]): Promise<void> {
    return await this._run(thing, (...thing) =>
      console.log(...thing, "(test print)"),
    );
  }

  async click(node: TreeNode): Promise<void> {
    await this._run(
      [node.id, ID_ATTR] as [number, string],
      (targetId, idAttr) => {
        const el = document.querySelector(`[${idAttr}="${targetId}"]`);
        if (!(el instanceof HTMLElement)) {
          throw new Error(`Element with id=${targetId} not found`);
        }
        el.click();
      },
    );
  }

  async type(node: TreeNode, text: string): Promise<void> {
    await this._run(
      [node.id, text, ID_ATTR] as [number, string, string],
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

  async navigate(url: string): Promise<void> {
    const dest = url.includes("://") ? url : `https://${url}`;
    await browser.tabs.update(this.tabId, { url: dest });
  }

  async find_node(
    id?: number,
    parent?: TreeNode | null,
    tag?: string,
    contains?: string,
    contains_oneof?: string[],
  ): Promise<TreeNode | null> {
    const root = parent || (await this.get_root());

    const search = (node: TreeNode): TreeNode | null => {
      let isMatch = true;

      if (id !== undefined && node.id !== id) isMatch = false;
      if (tag !== undefined && node.tag !== tag) isMatch = false;

      if (isMatch && (contains !== undefined || contains_oneof !== undefined)) {
        const textContent = (node.text || "").toLowerCase();

        if (
          contains !== undefined &&
          !textContent.includes(contains.toLowerCase())
        ) {
          isMatch = false;
        }

        if (isMatch && contains_oneof !== undefined) {
          const matchOne = contains_oneof.some((c) =>
            textContent.includes(c.toLowerCase()),
          );
          if (!matchOne) isMatch = false;
        }
      }

      if (isMatch) {
        // If they provided only parent, then the parent itself will match immediately
        // if no other criteria are given. To avoid returning the parent immediately when searching for children,
        // wait, if no criteria provided, it returns the root/parent immediately. That is correct behavior.
        return node;
      }

      for (const child of node.children) {
        const found = search(child);
        if (found) return found;
      }

      return null;
    };

    return search(root);
  }

  async get_root(): Promise<TreeNode> {
    const root = await this._run([ID_ATTR], getTree);
    return root;
  }

  async print_tree(node?: TreeNode) {
    const root = await this.get_root();
    const strigified = stringifyTree(node || root, 0, false);
    this.print(strigified)
  }

  describe() {
    return `
TreeNode: Represents an interactive element on the page.
- id (number): Unique identifier for the element.
- children (TreeNode[]): List of child elements.
- props (Record<string, string>): Semantic properties and HTML attributes.
- text (string): Visible text content of the element.

Available Methods:
page.get_root(): TreeNode - Returns the root node of the current interactive DOM tree snapshot.
page.find_node(id?: number, parent?: TreeNode | null, tag?: string, contains?: string, contains_oneof?: string[]): TreeNode | null - Finds a node in the tree matching the given optional criteria.
page.click(node: TreeNode): void - Clicks the element associated with the given node.
page.type(node: TreeNode, text: string): void - Types text into the input element associated with the given node.
page.navigate(url: string): void - Navigates the page to the specified URL.
page.print_tree(node: TreeNode): void - Prints a stringified, human-readable tree representation of the given node.
`;
  }

  private async _run<Args extends any[], Return>(
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
