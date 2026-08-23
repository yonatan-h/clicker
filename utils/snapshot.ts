import { browser } from "wxt/browser";

interface CNode {
  element: Element;
  id: number;
  children: CNode[];
  semanticNodes: number;
  isSemantic: boolean;
  semanticProperties: Record<string, string>;
  textContent: string;
  isInteractableNode: boolean;
  interactableNodes: number;
}

export async function snapshot(
  tabId: number,
  querySelector: string = "body",
): Promise<{ summary: string; snapshot: string } | null> {
  console.log(tabId);
  try {
    const results = await browser.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [querySelector],
      func: (selector: string) => {
        const makeCNode = (element: Element) => {
          const node: CNode = {
            element,
            id: 0,
            children: [],
            semanticNodes: 0,
            isSemantic: false,
            semanticProperties: {},
            isInteractableNode: false,
            interactableNodes: 0,
            textContent: "",
          };
          return node;
        };

        let runningId = 0;
        let root: CNode = makeCNode(document.body);
        const dummyNode = makeCNode(document.createElement("div"));
        const pruneStats: Record<string, number> = {};
        const addStat = (key: string, record: Record<string, number>) => {
          record[key] = record[key] || 0;
          record[key]++;
        };

        const isInteractableLeaf = (node: CNode) => {
          const interactiveLeafs = [
            "button",
            "a",
            "select",
            "input",
            "textarea",
          ];
          if (interactiveLeafs.includes(node.element.tagName.toLowerCase())) {
            return true;
          }
        };

        const isInteractableNode = (node: CNode) => {
          if (isInteractableLeaf(node)) {
            return true;
          }

          const el = node.element as HTMLElement;
          if (
            el.getAttribute("onclick") ||
            el.getAttribute("onmousedown") ||
            el.getAttribute("onmouseup") ||
            el.getAttribute("onkeypress") ||
            el.getAttribute("onkeydown") ||
            el.getAttribute("onkeyup")
          ) {
            return true;
          }

          return false;
        };

        const getSemanticProperties = (
          node: CNode,
        ): {
          isSemantic: boolean;
          semanticProperties: Record<string, string>;
          textContent: string;
        } => {
          let isSemantic = false;
          let semanticProperties: Record<string, string> = {};
          let textContent: string = "";

          const tag = node.element.tagName.toLowerCase();
          const genericWrappers = ["div", "span", "tbody", "thead", "tfoot"];
          const isCustomElement = tag.includes("-");
          if (!genericWrappers.includes(tag) && !isCustomElement) {
            isSemantic = true;
          }

          for (const child of Array.from(node.element.childNodes)) {
            if (
              child.nodeType === Node.TEXT_NODE &&
              child.nodeValue?.trim() !== ""
            ) {
              textContent = child.nodeValue?.trim() || "";
              isSemantic = true;
            }
          }

          const role = node.element.getAttribute("role")?.trim();
          const isSemanticRole =
            role && role !== "presentation" && role !== "none";
          const ariaLabel = node.element.getAttribute("aria-label")?.trim();
          const title = node.element.getAttribute("title")?.trim();
          const tabIndex = node.element.getAttribute("tabindex")?.trim();
          const href = node.element.getAttribute("href")?.trim();

          if (role && isSemanticRole) {
            isSemantic = true;
            semanticProperties.role = role;
          }
          if (ariaLabel) {
            isSemantic = true;
            semanticProperties["aria-label"] = ariaLabel;
          }
          if (title) {
            isSemantic = true;
            semanticProperties.title = title;
          }
          if (tabIndex) {
            isSemantic = true;
            semanticProperties.tabindex = tabIndex;
          }
          if (href) {
            isSemantic = true;
            // semanticProperties.href = href;
            semanticProperties.href = "dummylink";
          }

          return { isSemantic, semanticProperties, textContent };
        };

        const recalculateCounts = (node: CNode) => {
          node.semanticNodes = node.isSemantic ? 1 : 0;
          node.interactableNodes = node.isInteractableNode ? 1 : 0;
          for (const child of node.children) {
            recalculateCounts(child);
            node.semanticNodes += child.semanticNodes;
            node.interactableNodes += child.interactableNodes;
          }
        };

        const buildTree = (node: CNode) => {
          runningId++;
          const ID_ATTR = "data-clicker4jf8-id";
          const props = getSemanticProperties(node);
          node.id = runningId;
          node.children = [];
          node.isSemantic = props.isSemantic;
          node.semanticProperties = props.semanticProperties;
          node.textContent = props.textContent;
          node.isInteractableNode = isInteractableNode(node);
          node.element.setAttribute(ID_ATTR, runningId.toString());

          for (const childEl of node.element.children) {
            const childNode = makeCNode(childEl);
            node.children.push(buildTree(childNode));
          }

          return node;
        };

        const pruneTree = (node: CNode): CNode | null => {
          const avoidTags = ["script", "style", "noscript"];
          if (avoidTags.includes(node.element.tagName.toLowerCase())) {
            addStat("avoid-tag", pruneStats);
            return null;
          }

          const style = window.getComputedStyle(node.element);
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.opacity === "0" ||
            node.element.getAttribute("aria-hidden") === "true"
          ) {
            addStat("hidden", pruneStats);
            return null;
          }

          //long logic because of youtube's <body> has height=0
          const rect = node.element.getBoundingClientRect();
          const tag = node.element.tagName.toLowerCase();
          const overflowIsHidden =
            style.overflow !== "visible" ||
            style.overflowX !== "visible" ||
            style.overflowY !== "visible";
          if (
            (rect.height === 0 || rect.width === 0) &&
            tag !== "body" &&
            tag !== "html" &&
            overflowIsHidden
          ) {
            addStat("hidden", pruneStats);
            return null;
          }

          node.children = node.children
            .map((child) => pruneTree(child))
            .filter((child) => child !== null) as CNode[];

          node.semanticNodes = node.isSemantic ? 1 : 0;
          for (const child of node.children) {
            node.semanticNodes += child.semanticNodes;
          }

          if (node.semanticNodes === 0) {
            addStat("no-semantic", pruneStats);
            return null;
          }

          if (!node.isSemantic && node.children.length === 1) {
            addStat("single-child-layout-wrapper", pruneStats);
            return node.children[0];
          }

          return node;
        };

        const getAltText = (el: Element): string => {
          const svg = el.querySelector("svg, img, picture");
          return (
            svg?.getAttribute("alt") ||
            svg?.getAttribute("aria-label") ||
            svg?.getAttribute("title") ||
            ""
          );
        };

        const compressLeaves = (node: CNode): CNode | null => {
          const el = node.element;
          const tag = node.element.tagName.toLowerCase();

          const textTags = [
            "p",
            "span",
            "div",
            "li",
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
          ];

          if (isInteractableLeaf(node)) {
            //txt
            if (tag === "input" || tag === "textarea") {
              const input = el as HTMLInputElement | HTMLTextAreaElement;
              node.textContent =
                input.value || input.placeholder + "(placeholder)" || "";
            } else {
              node.textContent = (el as HTMLElement).innerText || "";
            }

            //img
            //TODO: handle multiple images, multiple tags
            const alt = getAltText(el);
            if (alt) {
              node.semanticProperties["inner-img"] = alt;
            }

            //links
            if (
              tag === "a" &&
              node.textContent &&
              node.semanticProperties.href
            ) {
              delete node.semanticProperties.href;
            }
            node.children = [];
          } else if (tag === "svg") {
            node.children = [];
          } else if (
            textTags.includes(tag) &&
            node.interactableNodes === 0 &&
            !el.querySelector("img, svg, picture") &&
            el.textContent?.trim()
          ) {
            node.textContent = `"${el.textContent.replace(/\s+/g, " ").trim()}"`;
            node.children = [];
          } else {
            node.children = node.children
              .map((child) => compressLeaves(child))
              .filter((child) => child !== null) as CNode[];
          }

          return node;
        };

        const pruneProperties = (node: CNode) => {
          //de-duplicate aria titles, text content, and title
          const props = Object.entries(node.semanticProperties);
          const titlishKeys = ["aria-label", "title", "aria-labelledby"];
          for (let i = 0; i < props.length; i++) {
            const [key1, val1] = props[i];
            for (let j = i + 1; j < props.length; j++) {
              const [key2, val2] = props[j];
              if (
                val1 === val2 &&
                titlishKeys.includes(key1) &&
                titlishKeys.includes(key2)
              ) {
                delete node.semanticProperties[key2];
              }
            }
          }

          //de-duplicate aria, titles etc with text content
          for (const [key, val] of props) {
            const sameText =
              val
                .toLowerCase()
                .replace(/[-_\s]/g, " ")
                .trim() ===
              node.textContent
                .toLowerCase()
                .replace(/[-_\s]/g, " ")
                .trim();

            if (titlishKeys.includes(key) && sameText) {
              delete node.semanticProperties[key];
            }
          }

          node.children.forEach(pruneProperties);

          return node;
        };

        const stringifyTree = (
          node: CNode,
          depth: number,
          devMode: boolean,
        ) => {
          const propsStr = Object.entries(node.semanticProperties)
            .map(([k, v]) => `${k}=${v}`)
            .join(", ");
          let str = `${"| ".repeat(depth)}${node.element.tagName.toLowerCase()}[id=${node.id}]${
            devMode ? `[ semanticNodes=${node.semanticNodes} ]` : ""
          }${propsStr ? `[${propsStr}]` : ""}${node.textContent.replace(/\n/g, "\\n")}\n`;

          for (const child of node.children) {
            str += stringifyTree(child, depth + 1, devMode);
          }
          return str;
        };

        const count = (tree: CNode) => {
          const countNodes = (node: CNode) => {
            let nodes = 1;
            for (const child of node.children) {
              nodes += countNodes(child);
            }
            return nodes;
          };

          const nodes = countNodes(tree);

          const str = stringifyTree(tree, 0, false);
          const tokens = str.replace(/\|/g, " ").split(" ").length;

          return `[${nodes.toLocaleString()} nodes, ${tokens.toLocaleString()} tokens]`;
        };

        buildTree(root);
        recalculateCounts(root);
        const originalSize = count(root);

        root = compressLeaves(root) || dummyNode;
        recalculateCounts(root);
        const afterCompress = count(root);

        root = pruneProperties(root) || dummyNode;
        recalculateCounts(root);
        const afterPruneProperties = count(root);

        root = pruneTree(root) || dummyNode;
        recalculateCounts(root);
        const afterPrune = count(root);

        console.log(pruneStats);

        const summary = `Elements count: original=${originalSize}, after-compress=${afterCompress}, after-prune-props=${afterPruneProperties} after-prune=${afterPrune}`;
        console.log(summary);
        console.log(stringifyTree(root, 0, true));
        return {
          summary,
          snapshot: stringifyTree(root, 0, true),
        };
      },
    });

    if (results && results[0] && results[0].result) {
      return results[0].result as { summary: string; snapshot: string };
    }
    return null;
  } catch (err) {
    console.error("DOM snapshot error:", err);
    return null;
  }
}
