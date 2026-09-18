const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
const fs = require('fs');

async function run() {
  const data = new Uint8Array(fs.readFileSync('public/Temps/Sale_DGM_Template.pdf'));
  const doc = await pdfjsLib.getDocument({data: data}).promise;
  const page = await doc.getPage(1);
  const textContent = await page.getTextContent();
  
  textContent.items.forEach(item => {
    if (item.str.includes('<')) {
      // transform: [scaleX, skewY, skewX, scaleY, translateX, translateY]
      console.log(`Text: "${item.str}"`);
      console.log(`  X: ${item.transform[4]}, Y: ${item.transform[5]}`);
      console.log(`  Width: ${item.width}, Height: ${item.height}`);
      console.log(`  Font Name: ${item.fontName}, Dir: ${item.dir}`);
    }
  });
}
run().catch(console.error);
