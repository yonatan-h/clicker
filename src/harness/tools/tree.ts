export type TreeNode = {
  id: number;
  props: Record<string, string>;
  text: string;
  children: TreeNode[];
  tag: string;
  isInteractable: boolean;
};

export type CNode = {
  id: number;
  props: Record<string, string>;
  text: string;
  children: TreeNode[];
  tag: string;

  element: Element;
  _cNodeChildren: CNode[];
  _isSemantic: boolean;
  _semanticNodes: number;
  _isInteractableNode: boolean;
  _interactableNodes: number;
};

export function toTreeNode(cnode: CNode): TreeNode {
  return {
    id: cnode.id,
    tag: cnode.element.tagName.toLowerCase(),
    props: cnode.props,
    text: cnode.text,
    children: cnode._cNodeChildren.map((child) => toTreeNode(child)),
    isInteractable: cnode._isInteractableNode,
  };
}

export function getBody(ID_ATTR: string): TreeNode {
  const count = (tree: CNode) => {
    const countNodes = (node: CNode) => {
      let nodes = 1;
      for (const child of node._cNodeChildren) {
        nodes += countNodes(child);
      }
      return nodes;
    };

    const countWords = (node: CNode) => {
      let words = 0;
      words += node.text.split(" ").length;
      for (const child of node._cNodeChildren) {
        words += countWords(child);
      }
      return words;
    };

    const nodes = countNodes(tree);
    const words = countWords(tree);
    return `[${nodes.toLocaleString()} nodes, ${words.toLocaleString()} words]`;
  };

  const localToTreeNode = (cnode: CNode): TreeNode => {
    return {
      id: cnode.id,
      tag: cnode.element.tagName.toLowerCase(),
      props: cnode.props,
      text: cnode.text,
      children: cnode._cNodeChildren.map((child) => localToTreeNode(child)),
      isInteractable: cnode._isInteractableNode,
    };
  };

  const makeCNode = (element: Element) => {
    const node: CNode = {
      element,
      tag: "",
      children: [],

      id: 0,
      _cNodeChildren: [],
      _semanticNodes: 0,
      _isSemantic: false,
      props: {},
      _isInteractableNode: false,
      _interactableNodes: 0,
      text: "",
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
    const interactiveLeafs = ["button", "a", "select", "input", "textarea"];
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
      if (child.nodeType === Node.TEXT_NODE && child.nodeValue?.trim() !== "") {
        textContent += child.nodeValue?.trim() + " ";
        isSemantic = true;
      }
    }
    textContent = textContent.trim();

    const role = node.element.getAttribute("role")?.trim();
    const isSemanticRole = role && role !== "presentation" && role !== "none";
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
    node._semanticNodes = node._isSemantic ? 1 : 0;
    node._interactableNodes = node._isInteractableNode ? 1 : 0;
    for (const child of node._cNodeChildren) {
      recalculateCounts(child);
      node._semanticNodes += child._semanticNodes;
      node._interactableNodes += child._interactableNodes;
    }
  };

  const buildTree = (node: CNode) => {
    runningId++;
    const props = getSemanticProperties(node);
    node.id = runningId;
    node._cNodeChildren = [];
    node._isSemantic = props.isSemantic;
    node.props = props.semanticProperties;
    node.text = props.textContent;
    node._isInteractableNode = isInteractableNode(node);
    node.element.setAttribute(ID_ATTR, runningId.toString());

    for (const childEl of node.element.children) {
      const childNode = makeCNode(childEl);
      node._cNodeChildren.push(buildTree(childNode));
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
        const matches = node._cNodeChildren.filter(
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

    node._cNodeChildren = node._cNodeChildren
      .map((child) => pruneTree(child))
      .filter((child) => child !== null) as CNode[];

    node._semanticNodes = node._isSemantic ? 1 : 0;
    for (const child of node._cNodeChildren) {
      node._semanticNodes += child._semanticNodes;
    }

    if (node._semanticNodes === 0) {
      addStat("no-semantic", pruneStats);
      return null;
    }

    const children = node._cNodeChildren;
    if (!node._isSemantic && children.length === 1) {
      addStat("single-child-layout-wrapper", pruneStats);
      return node._cNodeChildren[0] || null;
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
        node.text = input.value || input.placeholder + "(placeholder)" || "";
      } else {
        node.text = getPrunedInnerText(node);
      }

      //img
      //TODO: handle multiple images, multiple tags
      const alt = getAltText(el);
      if (alt) {
        node.props["inner-img"] = alt;
      }

      //links
      if (tag === "a" && node.text && node.props.href) {
        delete node.props.href;
      }
      node._isSemantic = true;
      node._cNodeChildren = [];
    } else if (tag === "svg") {
      node._isSemantic = true;
      node._cNodeChildren = [];
    } else if (
      textTags.includes(tag) &&
      node._interactableNodes === 0 &&
      !el.querySelector("img, svg, picture") &&
      getPrunedInnerText(node)
    ) {
      node.text = getPrunedInnerText(node);
      node._isSemantic = true;
      node._cNodeChildren = [];
    } else {
      node._cNodeChildren = node._cNodeChildren
        .map((child) => compressLeaves(child))
        .filter((child) => child !== null) as CNode[];
    }

    return node;
  };

  const pruneProperties = (node: CNode) => {
    //de-duplicate aria titles, text content, and title
    let props = Object.entries(node.props);
    const titlishKeys = ["aria-label", "title", "aria-labelledby", "inner-img"];
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
          delete node.props[key2];
        }
      }
    }

    props = Object.entries(node.props);
    //de-duplicate aria, titles etc with text content
    for (const [key, val] of props) {
      const sameText =
        val
          .toLowerCase()
          .replace(/[-_\s]/g, " ")
          .trim() ===
        node.text
          .toLowerCase()
          .replace(/[-_\s]/g, " ")
          .trim();

      if (titlishKeys.includes(key) && sameText) {
        delete node.props[key];
      }
    }

    node._cNodeChildren.forEach(pruneProperties);

    return node;
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
  // console.log(stringifyTree(root, 0, false));
  console.log(summary);
  return localToTreeNode(root);
}

export function stringifyTree(
  node: TreeNode,
  depth: number,
  devMode: boolean,
): string {
  const GRAY = "\x1b[90m";
  const RESET = "\x1b[0m";
  const propsStr = Object.entries(node.props)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");

  const textContent = node.text.replace(/\n/g, "\\n");
  let str = `${(devMode ? "| " : "\t").repeat(depth)}${node.tag} #${node.id}${
    devMode
      ? `${GRAY} sem=${(node as any)._semanticNodes}|int=${(node as any)._interactableNodes} ${RESET}`
      : ""
  }${propsStr ? ` ${propsStr}` : ""}${textContent ? ` > ${textContent}` : ""}\n`;

  for (const child of node.children) {
    str += stringifyTree(child, depth + 1, devMode);
  }
  return str;
}

export function listNodes(node: TreeNode): TreeNode[] {
  const nodes: TreeNode[] = [node];
  for (const child of node.children) {
    nodes.push(...listNodes(child));
  }
  return nodes;
}
