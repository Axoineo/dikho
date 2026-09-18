import fs from 'fs';
import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';

async function run() {
  const data = new Uint8Array(fs.readFileSync('public/Temps/Sale_DGM_Template.pdf'));
  const doc = await pdfjsLib.getDocument({data: data}).promise;
  const page = await doc.getPage(1);
  const textContent = await page.getTextContent();
  
  for (const item of textContent.items) {
    if (item.str.includes('<') || item.str.includes('GHODAWAT') || item.str.includes('Invoice No')) {
      console.log(`Text: "${item.str}"`);
      console.log(`  X: ${item.transform[4].toFixed(3)}, Y: ${item.transform[5].toFixed(3)}`);
      // Font size is roughly the scale in transform[0] or transform[3]
      console.log(`  Size X: ${item.transform[0].toFixed(3)}, Size Y: ${item.transform[3].toFixed(3)}`);
      console.log(`  Font: ${item.fontName}`);
      if (item.color) console.log(`  Color: ${item.color}`);
    }
  }
}
run().catch(console.error);
