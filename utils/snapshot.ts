import { browser } from "wxt/browser";

export async function snapshot(
  tabId: number,
  querySelector: string = "body",
): Promise<{ summary: string; snapshot: string } | null> {
  try {
    const results = await browser.scripting.executeScript({
      target: { tabId },
      args: [querySelector],
      func: (selector: string) => {
        // 1. Generate Summary
        const elementsToCount = [
          "nav",
          "a",
          "button",
          "p",
          "section",
          "h1",
          "h2",
          "h3",
          "h4",
          "h5",
          "h6",
          "dialog",
          "form",
          "input",
        ];
        const counts: Record<string, number> = {};
        for (const tag of elementsToCount) {
          counts[tag] = document.querySelectorAll(tag).length;
        }

        const h1s = Array.from(document.querySelectorAll("h1"))
          .map((el) => el.textContent?.trim() || "")
          .filter(Boolean);
        const h2s = Array.from(document.querySelectorAll("h2"))
          .map((el) => el.textContent?.trim() || "")
          .filter(Boolean);

        const summary = [
          `Page: ${document.title}`,
          `URL: ${window.location.href}`,
          `Element Counts: ${JSON.stringify(counts)}`,
          `H1s: ${JSON.stringify(h1s)}`,
          `H2s: ${JSON.stringify(h2s)}`,
        ].join("\n");

        // 2. Generate Snapshot
        let root: Element[] | null;
        try {
          root = [...document.querySelectorAll(selector)];
        } catch (e) {
          return { summary: `Could not take snapshot, error: ${e}" "` };
        }

        const interactiveSelectors = [
          "a[href]",
          "button",
          "input",
          "select",
          "textarea",
          '[tabindex]:not([tabindex="-1"])',
          '[role="button"]',
          '[role="link"]',
          '[role="checkbox"]',
          '[role="menuitem"]',
          '[role="tab"]',
          '[role="switch"]',
          '[role="slider"]',
        ].join(", ");

        let aiId = 1;
        const lines: string[] = [];

        function walk(node: Node, indent: string) {
          // Text nodes: just print the text
          if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent?.trim();
            if (text) lines.push(`${indent}"${text}"`);
            return;
          }

          if (node.nodeType !== Node.ELEMENT_NODE) return;
          const el = node as HTMLElement;

          // Skip invisible and non-content elements
          const style = window.getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") return;
          if (["SCRIPT", "STYLE", "NOSCRIPT", "SVG"].includes(el.tagName))
            return;

          const tag = el.tagName.toLowerCase();
          const label =
            el.getAttribute("aria-label") ||
            (el as HTMLInputElement).placeholder ||
            el.getAttribute("alt") ||
            "";

          let nextIndent = indent;

          if (el.matches(interactiveSelectors)) {
            // Interactive element: assign a clickable ID
            el.setAttribute("data-clickeru7i8p-id", String(aiId));
            const val = (el as HTMLInputElement).value;
            lines.push(
              `${indent}[${aiId}] ${tag}${label ? ` "${label}"` : ""}${val ? ` val="${val}"` : ""}`,
            );
            aiId++;
            nextIndent = indent + "  ";
          } else if (/^h[1-6]$/.test(tag)) {
            // Headings: always print
            lines.push(`${indent}${tag}`);
            nextIndent = indent + "  ";
          }
          // Everything else: just recurse (no line printed for wrapper divs etc.)

          for (const child of Array.from(el.childNodes)) {
            walk(child, nextIndent);
          }
        }

        if (root) {
          walk(root, "");
        } else {
          lines.push(
            `error: No element found with selector='${querySelector}'`,
          );
        }
        let snapshotStr = lines.join("\n");

        // 3. Enforce 500-word limit on snapshot
        const words = snapshotStr.split(/\s+/);
        if (words.length > 500) {
          snapshotStr = words.slice(0, 500).join(" ") + "\n... (truncated)";
        }

        return { summary, snapshot: snapshotStr };
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

