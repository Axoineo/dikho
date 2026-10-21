// Pasted or quoted HTML enters the dashboard's DOM inside the editor, so it is
// cleaned here as well as on the server: no scripts, frames, styles, event
// handlers or script URLs. DOMParser documents never run scripts.
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'BASE', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'SVG', 'MATH', 'TEMPLATE', 'NOSCRIPT', 'TITLE'])
export function cleanHtml(html) {
  const doc = new DOMParser().parseFromString(`<body>${html ?? ''}</body>`, 'text/html')
  const walk = (node) => {
    for (const child of [...node.children]) {
      if (DROP.has(child.tagName)) { child.remove(); continue }
      for (const attr of [...child.attributes]) {
        const name = attr.name.toLowerCase()
        const value = [...attr.value].filter((ch) => ch.codePointAt(0) > 0x20).join('').toLowerCase()
        if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction'
            || ((name === 'href' || name === 'src' || name === 'xlink:href') && !/^(https?:|mailto:|tel:|#|data:image\/(png|jpe?g|gif|webp);)/.test(value))) {
          child.removeAttribute(attr.name)
        }
      }
      if (child.tagName === 'IMG' && !/^data:image\//i.test(child.getAttribute('src') || '')) child.remove()
      else walk(child)
    }
  }
  walk(doc.body)
  return doc.body.innerHTML
}
