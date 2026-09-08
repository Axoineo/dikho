import fs from 'fs';
import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';

async function run() {
  const data = new Uint8Array(fs.readFileSync('Temps/Sale_DGM_Example.pdf'));
  const doc = await pdfjsLib.getDocument({data: data}).promise;
  const page = await doc.getPage(1);
  const textContent = await page.getTextContent();
  
  for (const item of textContent.items) {
    if (['1', 'Amazon', '₹39,200.00', 'Total', 'Taxable Value', 'Thirty-nine'].some(t => item.str.includes(t))) {
      console.log(`Text: "${item.str}"`);
      console.log(`  X: ${item.transform[4].toFixed(3)}, Y: ${item.transform[5].toFixed(3)}`);
      console.log(`  Size X: ${item.transform[0].toFixed(3)}, Size Y: ${item.transform[3].toFixed(3)}`);
      console.log(`  Font: ${item.fontName}`);
    }
  }
}
run().catch(console.error);
