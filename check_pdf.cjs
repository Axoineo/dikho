const fs = require('fs');
const { PDFDocument } = require('pdf-lib');

async function run() {
  const bytes = fs.readFileSync('Temps/Sale_DGM_Template.pdf');
  const doc = await PDFDocument.load(bytes);
  const form = doc.getForm();
  const fields = form.getFields();
  console.log("Fields found:", fields.length);
  fields.forEach(f => console.log(f.getName()));
}
run().catch(console.error);
