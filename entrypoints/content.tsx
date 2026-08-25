import ReactDOM from "react-dom/client";
import cssText from "@/assets/tailwind.css?inline";
import ClickerApp from "@/src/content-ui/ClickerApp";

console.log("hello2233");

export default defineContentScript({
  matches: ["<all_urls>"],
  cssInjectionMode: "manual",
  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: "clicker-ui",
      position: "inline",
      anchor: "body",
      css: cssText,
      onMount: (container) => {
        const root = ReactDOM.createRoot(container);
        root.render(<ClickerApp />);
        return root;
      },
      onRemove: (root) => {
        root?.unmount();
      },
    });

    ui.mount();
  },
});
