import fs from 'fs';
import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';

async function run() {
  const data = new Uint8Array(fs.readFileSync('public/Temps/Sale_DGM_Template.pdf'));
  const doc = await pdfjsLib.getDocument({data: data}).promise;
  const page = await doc.getPage(1);
  const textContent = await page.getTextContent();
  
  textContent.items.forEach(item => {
    if (item.str.includes('<')) {
      console.log(`Text: "${item.str}"`);
      console.log(`  X: ${item.transform[4]}, Y: ${item.transform[5]}`);
      console.log(`  Width: ${item.width}, Height: ${item.height}`);
      console.log(`  Font: ${item.fontName}`);
    }
  });
}
run().catch(console.error);
