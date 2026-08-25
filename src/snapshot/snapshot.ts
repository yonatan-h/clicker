import { browser } from "wxt/browser";
import { ID_ATTR, type SnapshotResult } from "../utils/shared";

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

export async function takeSnapshot(tabId: number): Promise<SnapshotResult> {
  console.log(tabId);
  try {
    const results = await browser.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [ID_ATTR],
      func: (ID_ATTR: string): SnapshotResult => {
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
        const GRAY = "\x1B[90m";
        const RESET = "\x1B[0m";
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
              textContent += child.nodeValue?.trim() + " ";
              isSemantic = true;
            }
          }
          textContent = textContent.trim();

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

        const getPrunedInnerText = (node: CNode): string => {
          let text = "";
          for (const childNode of Array.from(node.element.childNodes)) {
            if (childNode.nodeType === Node.TEXT_NODE) {
              text += childNode.nodeValue + " ";
            } else if (childNode.nodeType === Node.ELEMENT_NODE) {
              const el = childNode as Element;
              const matches = node.children.filter(
                (c) => c.element === el || el.contains(c.element),
              );
              for (const child of matches) {
                text += getPrunedInnerText(child) + " ";
              }
            }
          }
          return text.trim().replace(/\s+/g, " ");
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

          const children = node.children;
          if (!node.isSemantic && children.length === 1) {
            addStat("single-child-layout-wrapper", pruneStats);
            return node.children[0] || null;
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
              node.textContent = getPrunedInnerText(node);
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
            node.isSemantic = true;
            node.children = [];
          } else if (tag === "svg") {
            node.isSemantic = true;
            node.children = [];
          } else if (
            textTags.includes(tag) &&
            node.interactableNodes === 0 &&
            !el.querySelector("img, svg, picture") &&
            getPrunedInnerText(node)
          ) {
            node.textContent = getPrunedInnerText(node);
            node.isSemantic = true;
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
          let props = Object.entries(node.semanticProperties);
          const titlishKeys = [
            "aria-label",
            "title",
            "aria-labelledby",
            "inner-img",
          ];
          for (let i = 0; i < props.length; i++) {
            const keyVal1 = props[i];
            if (!keyVal1) continue;
            const [key1, val1] = keyVal1;
            for (let j = i + 1; j < props.length; j++) {
              const keyVal2 = props[j];
              if (!keyVal2) continue;
              const [key2, val2] = keyVal2;
              if (
                val1 === val2 &&
                titlishKeys.includes(key1) &&
                titlishKeys.includes(key2)
              ) {
                delete node.semanticProperties[key2];
              }
            }
          }

          props = Object.entries(node.semanticProperties);
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
            .join(" ");

          const textContent = node.textContent.replace(/\n/g, "\\n");
          let str = `${(devMode ? "| " : "\t").repeat(depth)}${node.element.tagName.toLowerCase()} #${node.id}${
            devMode
              ? `${GRAY} sem=${node.semanticNodes}|int=${node.interactableNodes} ${RESET}`
              : ""
          }${propsStr ? ` ${propsStr}` : ""}${textContent ? ` > ${textContent}` : ""}\n`;

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

          const countWords = (node: CNode) => {
            let words = 0;
            words += node.textContent.split(" ").length;
            for (const child of node.children) {
              words += countWords(child);
            }
            return words;
          };

          const nodes = countNodes(tree);
          const words = countWords(tree);

          const str = stringifyTree(tree, 0, false);
          const tokens = str.match(/[\w]+|[^\s\w]/g)?.length || 0;

          return `[${nodes.toLocaleString()} nodes, ${words.toLocaleString()} words, ${tokens.toLocaleString()} tokens]`;
        };

        buildTree(root);
        recalculateCounts(root);
        const originalSize = count(root);

        root = pruneTree(root) || dummyNode;
        recalculateCounts(root);
        const afterPrune = count(root);

        root = compressLeaves(root) || dummyNode;
        recalculateCounts(root);
        const afterCompress = count(root);

        root = pruneProperties(root) || dummyNode;
        recalculateCounts(root);
        const afterPruneProperties = count(root);

        console.log(pruneStats);

        const summary = `original: ${originalSize}\nafter-prune: ${afterPrune}\nafter-compress: ${afterCompress}\nafter-prune-props: ${afterPruneProperties}`;
        console.log(stringifyTree(root, 0, false));
        console.log(summary);
        return {
          success: true,
          snapshot: stringifyTree(root, 0, false),
          pageTitle: document.title,
          pageUrl: window.location.href,
        };
      },
    });

    if (results && results.length > 0 && results[0]?.result) {
      return results[0].result as SnapshotResult;
    }
    return {
      success: false,
      error: "No results from script injection",
      snapshot: "<snapshot could not be taken>",
      pageTitle: "<unknown>",
      pageUrl: "<unknown>",
    };
  } catch (err) {
    console.error("DOM snapshot error:", err);
    return {
      success: false,
      error: JSON.stringify(err),
      snapshot: "<snapshot could not be taken>",
      pageTitle: "<unknown>",
      pageUrl: "<unknown>",
    };
  }
}
