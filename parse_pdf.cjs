const fs = require('fs');
const { PDFDocument } = require('pdf-lib');

async function run() {
  const bytes = fs.readFileSync('Temps/Sale_DGM_Template.pdf');
  const doc = await PDFDocument.load(bytes);
  console.log("Pages:", doc.getPageCount());
  // Unfortunately pdf-lib doesn't have a simple text extractor.
  // We can try to see the content stream but it's encoded.
}
run().catch(console.error);
