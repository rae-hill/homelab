/**
 * In-page capture script for the DOCX render path, evaluated via
 * `page.evaluate(DOCX_CAPTURE_SCRIPT)`. String form on purpose — this node
 * package avoids DOM-lib types (same pattern as the localStorage seed in
 * `resume-printing-service.ts`).
 *
 * Runs AFTER `page.emulateMediaType("print")` so the site's existing
 * `@media print` rules apply before capture: app chrome that must never reach
 * a document (FABs, dialogs, toasts) computes to `display: none` and is
 * pruned here — physically, because the converter applies no CSS.
 *
 * The HTML→DOCX converter (`@turbodocx/html-to-docx`) parses ONLY inline
 * `style` attributes: it never fetches external stylesheets and never
 * resolves the CSS cascade. This script therefore bakes chrome's computed
 * styles (whitelisted to the properties the converter understands) onto every
 * surviving element, and replaces inline `<svg>` icons (react-icons) with
 * data-URL `<img>` elements so the converter's image pipeline rasterizes them
 * to PNG via sharp (`svgHandling: "convert"`, doc 08 OQ4).
 *
 * Returns the full HTML document string (`<!DOCTYPE html>` + serialized
 * document element). The page is disposable (the puppeteer session closes it
 * right after), so mutating the DOM in place is safe.
 */
export const DOCX_CAPTURE_SCRIPT = `(() => {
  // Property whitelist ≈ the CSS subset the converter maps into OOXML
  // (doc 08 fact sheet 2). Computed values arrive in px/rgb() — accepted by
  // the converter's CSS parser; tune after the owner fidelity gate.
  const KEEP = [
    "display", "width", "height", "vertical-align",
    "color", "background-color",
    "font-family", "font-size", "font-weight", "font-style",
    "line-height", "text-align", "text-decoration",
    "margin-top", "margin-right", "margin-bottom", "margin-left",
    "padding-top", "padding-right", "padding-bottom", "padding-left",
    "border-top-width", "border-top-style", "border-top-color",
    "border-right-width", "border-right-style", "border-right-color",
    "border-bottom-width", "border-bottom-style", "border-bottom-color",
    "border-left-width", "border-left-style", "border-left-color"
  ]
  const DROP_TAGS = new Set(["SCRIPT", "NOSCRIPT", "TEMPLATE", "IFRAME", "STYLE", "LINK", "META"])

  if (!document.body) {
    return ""
  }

  // The head only carries stylesheets/meta for screen rendering — the
  // converter ignores it, and its nodes would just waste capture work.
  if (document.head) {
    document.head.remove()
  }

  // 1) Prune print-hidden subtrees (FABs, dialogs, toasts) and nodes the
  //    converter cannot represent.
  const prune = (element) => {
    for (const child of Array.from(element.children)) {
      if (DROP_TAGS.has(child.tagName)) {
        child.remove()
        continue
      }
      if (getComputedStyle(child).display === "none") {
        child.remove()
        continue
      }
      prune(child)
    }
  }
  prune(document.body)

  // 2) Replace inline SVGs with data-URL images so sharp rasterizes them.
  //    Rendered size is baked into width/height attributes (react-icons SVGs
  //    size via CSS, which the converter would never see).
  for (const svg of Array.from(document.querySelectorAll("svg"))) {
    try {
      const rect = svg.getBoundingClientRect()
      const xml = new XMLSerializer().serializeToString(svg)
      const img = document.createElement("img")
      img.setAttribute("src", "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(xml))))
      const width = Math.round(rect.width)
      const height = Math.round(rect.height)
      if (width > 0) {
        img.setAttribute("width", String(width))
      }
      if (height > 0) {
        img.setAttribute("height", String(height))
      }
      svg.replaceWith(img)
    } catch (error) {
      svg.remove()
    }
  }

  // 3) Bake computed styles onto every element. Two passes on purpose: ALL
  //    computed styles are read before ANY style attribute is written, so the
  //    reads reflect chrome's real layout — not our own overrides cascading
  //    into later reads.
  const baked = []
  const collect = (element) => {
    const computed = getComputedStyle(element)
    let css = ""
    for (const property of KEEP) {
      const value = computed.getPropertyValue(property)
      if (value) {
        css += property + ":" + value + ";"
      }
    }
    baked.push([element, css])
    for (const child of element.children) {
      collect(child)
    }
  }
  collect(document.body)
  for (const entry of baked) {
    entry[0].setAttribute("style", entry[1])
  }

  return "<!DOCTYPE html>\\n" + document.documentElement.outerHTML
})()`
