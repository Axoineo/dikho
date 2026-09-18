import fs from 'fs';
import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';

async function run() {
  const data = new Uint8Array(fs.readFileSync('public/Temps/SO_template.pdf'));
  const doc = await pdfjsLib.getDocument({data: data}).promise;
  const page = await doc.getPage(1);
  const textContent = await page.getTextContent();
  
  for (const item of textContent.items) {
    if (['GSTIN:', 'PAN:', 'Rate', 'GST (%)', 'Taxable Value', 'Total Amount', 'HSN/SAC', 'Total Tax'].includes(item.str)) {
      console.log(`Text: "${item.str}"`);
      console.log(`  X: ${item.transform[4].toFixed(3)}, Y: ${item.transform[5].toFixed(3)}`);
      console.log(`  Width: ${item.width.toFixed(3)}`);
    }
  }
}
run().catch(console.error);
