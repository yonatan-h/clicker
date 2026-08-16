import { browser } from "wxt/browser";

export type AXNode = {
  nodeId: string;
  ignored?: boolean;
  role?: { value: string };
  name?: { value: string };
  description?: { value: string };
  value?: { value: string };
  properties?: { name: string; value: { value: any } }[];
  childIds?: string[];
  backendDOMNodeId?: number;
};

export async function cdpSnapshot(tabId: number): Promise<string | null> {
  const debuggee = { tabId };
  try {
    // 1. Attach the Chrome Debugger to the target tab
    await chrome.debugger.attach(debuggee, "1.3");
    
    // 2. Enable DOM and Page to get the frameId (required in newer Chrome versions)
    await chrome.debugger.sendCommand(debuggee, "DOM.enable");
    await chrome.debugger.sendCommand(debuggee, "Page.enable");
    const { frameTree } = (await chrome.debugger.sendCommand(debuggee, "Page.getFrameTree")) as any;
    const frameId = frameTree.frame.id;

    await chrome.debugger.sendCommand(debuggee, "DOM.getDocument", { depth: -1 });

    // 3. Enable the Accessibility domain
    await chrome.debugger.sendCommand(debuggee, "Accessibility.enable");
    
    // Give Chrome a moment to compute the tree asynchronously
    await new Promise((r) => setTimeout(r, 200));

    // 4. Fetch the full, raw accessibility tree from the browser using the frameId
    const { nodes } = (await chrome.debugger.sendCommand(
      debuggee,
      "Accessibility.getFullAXTree",
      { frameId }
    )) as { nodes: AXNode[] };

    // 4. Create a map for quick node lookups by their ID
    const nodeMap = new Map<string, AXNode>();
    for (const n of nodes) nodeMap.set(n.nodeId, n);

    // 5. Define which roles we consider "interactive" (need an AI ID)
    const interactiveRoles = new Set([
      "button", "link", "textbox", "checkbox", "radio", "combobox",
      "menuitem", "tab", "switch", "slider", "spinbutton", "searchbox", "option",
    ]);

    let aiId = 1;
    const idAssignments: { backendDOMNodeId: number; aiId: number }[] = [];
    const lines: string[] = [];

    // 6. Recursive function to walk the tree and build the text snapshot
    function walk(nodeId: string, indent: string) {
      const node = nodeMap.get(nodeId);
      
      // Skip nodes that don't exist or are explicitly ignored by screen readers
      if (!node || node.ignored) return;

      const role = node.role?.value || "";
      const name = node.name?.value || "";
      const value = node.value?.value || "";


      // 8. Extract boolean properties (like disabled, checked, expanded)
      const props = node.properties || [];
      const getProp = (n: string) => props.find((p) => p.name === n)?.value?.value;

      const states: string[] = [];
      if (getProp("disabled")) states.push("disabled");
      if (getProp("checked") === "true") states.push("checked");
      if (getProp("expanded") === "true") states.push("expanded");
      if (getProp("expanded") === "false") states.push("collapsed");
      if (getProp("required")) states.push("required");

      const isInteractive = interactiveRoles.has(role);
      const stateStr = states.length ? ` [${states.join(", ")}]` : "";
      const valStr = value ? ` val="${value}"` : "";
      const nameStr = name ? ` "${name}"` : "";

      // 9. Format the current node into a text line
      if (isInteractive && node.backendDOMNodeId) {
        // If it's interactive, assign it our numeric [aiId] and record the mapping
        idAssignments.push({ backendDOMNodeId: node.backendDOMNodeId, aiId });
        lines.push(`${indent}[${aiId}] ${role}${nameStr}${valStr}${stateStr}`);
        aiId++;
      } else if (role === "StaticText" || role === "InlineTextBox") {
        // If it's just text, print the text without a role prefix
        if (name) lines.push(`${indent}"${name}"`);
      } else if (name || (node.childIds && node.childIds.length > 0)) {
        // If it's a structural node (like a heading) with a name or children, print it
        lines.push(`${indent}${role}${nameStr}${stateStr}`);
      }

      // 10. Recurse into children
      for (const childId of node.childIds || []) {
        walk(childId, indent + "  ");
      }
    }

    // 11. Start the walk from the root node
    const root = nodes[0];
    if (root) walk(root.nodeId, "");

    // 12. Enable the DOM domain so we can modify the page HTML
    await chrome.debugger.sendCommand(debuggee, "DOM.enable");
    
    // 13. Apply the `data-ai-id` attributes to the real DOM elements
    for (const { backendDOMNodeId, aiId } of idAssignments) {
      try {
        // Convert the backend node ID into a live JS object ID
        const { object } = (await chrome.debugger.sendCommand(
          debuggee,
          "DOM.resolveNode",
          { backendNodeId: backendDOMNodeId },
        )) as { object: { objectId: string } };
        
        // Execute a small JS snippet on that specific element to set the attribute
        await chrome.debugger.sendCommand(debuggee, "Runtime.callFunctionOn", {
          objectId: object.objectId,
          functionDeclaration: `function(id) { this.setAttribute("data-ai-id", id); }`,
          arguments: [{ value: String(aiId) }],
        });
      } catch {}
    }

    const title = (await browser.tabs.get(tabId)).title || "";
    const url = (await browser.tabs.get(tabId)).url || "";

    // 14. Always detach the debugger when done
    await chrome.debugger.detach(debuggee);
    return `Page: ${title}\nURL: ${url}\n\nAccessibility Tree:\n${lines.join("\n")}`;
  } catch (err) {
    // Failsafe: if anything crashes, try to detach so we don't leave the yellow warning bar up
    try {
      await chrome.debugger.detach(debuggee);
    } catch {}
    console.error("CDP snapshot error:", err);
    return null;
  }
}
