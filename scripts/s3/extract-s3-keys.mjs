import { AwsClient } from 'aws4fetch';
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf-8').split('\n').reduce((acc, line) => {
  const [k, ...v] = line.split('=');
  if (k && v.length) acc[k.trim()] = v.join('=').trim();
  return acc;
}, {});

const region = env.AWS_REGION || 'us-east-1';
const bucket = env.S3_BUCKET_NAME;

const aws = new AwsClient({
  accessKeyId: env.AWS_ACCESS_KEY_ID,
  secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  region, service: 's3'
});

async function listAll() {
  let continuationToken = '';
  const allFiles = [];
  
  while (true) {
    let url = `https://${bucket}.s3.${region}.amazonaws.com/?list-type=2&prefix=${encodeURIComponent('Dikho - Corporate Gifting/')}&max-keys=1000`;
    if (continuationToken) url += `&continuation-token=${encodeURIComponent(continuationToken)}`;
    
    const res = await aws.fetch(url);
    const text = await res.text();
    
    const contents = text.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g);
    for (const c of contents) {
      const keyMatch = c[1].match(/<Key>([^<]+)<\/Key>/);
      const sizeMatch = c[1].match(/<Size>([^<]+)<\/Size>/);
      if (keyMatch) {
        const key = keyMatch[1].replace(/&amp;/g, '&');
        const size = sizeMatch ? parseInt(sizeMatch[1]) : 0;
        if (key.endsWith('.pdf')) allFiles.push({ key, size });
      }
    }
    
    if (text.includes('<IsTruncated>true</IsTruncated>')) {
      const tokenMatch = text.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
      if (tokenMatch) { continuationToken = tokenMatch[1]; continue; }
    }
    break;
  }

  // Only use categorized files (not Master/)
  const categorized = allFiles.filter(f => !f.key.includes('/Master/'));
  
  // Group by category folder
  const categories = {};
  for (const f of categorized) {
    const parts = f.key.replace('Dikho - Corporate Gifting/', '').split('/');
    const cat = parts[0];
    if (!categories[cat]) categories[cat] = [];
    // Extract brand name from filename
    const filename = parts[parts.length - 1];
    let name = filename.replace('.pdf', '').replace(/^Dikho_x_/, '').replace(/_/g, ' ').replace(/Exclusives\s*$/, '').trim();
    categories[cat] = categories[cat] || [];
    categories[cat].push({ key: f.key, name, size: f.size });
  }

  // Generate SQL
  let sql = `-- Delete old dummy files\nDELETE FROM catalogue_files;\n\n`;
  sql += `-- Insert real S3 files\nWITH cat AS (SELECT id FROM catalogues WHERE slug = 'corporategifting')\n`;
  sql += `INSERT INTO catalogue_files (catalogue_id, name, category, s3_key, file_size, type, sort_order, active)\nVALUES\n`;
  
  const values = [];
  let sortOrder = 1;
  for (const [cat, files] of Object.entries(categories).sort()) {
    for (const f of files.sort((a, b) => a.name.localeCompare(b.name))) {
      const escapedName = f.name.replace(/'/g, "''");
      const escapedKey = f.key.replace(/'/g, "''");
      const escapedCat = cat.replace(/'/g, "''");
      values.push(`  ((SELECT id FROM cat), '${escapedName}', '${escapedCat}', '${escapedKey}', ${f.size}, 'file', ${sortOrder}, true)`);
      sortOrder++;
    }
  }
  
  sql += values.join(',\n') + ';\n';
  
  fs.writeFileSync('populate-catalogue.sql', sql);
  console.log(`Generated SQL for ${values.length} files across ${Object.keys(categories).length} categories`);
  console.log('Categories:', Object.keys(categories).sort().join(', '));
}

listAll();
