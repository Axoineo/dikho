import { AwsClient } from 'aws4fetch';
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf-8').split('\n').reduce((acc, line) => {
  const [k, ...v] = line.split('=');
  if (k && v.length) acc[k.trim()] = v.join('=').trim();
  return acc;
}, {});

const aws = new AwsClient({
  accessKeyId: env.AWS_ACCESS_KEY_ID,
  secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  region: env.AWS_REGION || 'us-east-1', service: 's3'
});

async function listAll() {
  let continuationToken = '';
  const allFiles = [];
  
  while (true) {
    let url = `https://${env.S3_BUCKET_NAME}.s3.${env.AWS_REGION || 'us-east-1'}.amazonaws.com/?list-type=2&prefix=${encodeURIComponent('Dikho - Corporate Gifting/')}&max-keys=1000`;
    if (continuationToken) url += `&continuation-token=${encodeURIComponent(continuationToken)}`;
    
    const res = await aws.fetch(url);
    const text = await res.text();
    
    const contents = text.matchAll(/<Key>([^<]+)<\/Key>/g);
    for (const c of contents) {
      allFiles.push(c[1].replace(/&amp;/g, '&'));
    }
    
    if (text.includes('<IsTruncated>true</IsTruncated>')) {
      const tokenMatch = text.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
      if (tokenMatch) { continuationToken = tokenMatch[1]; continue; }
    }
    break;
  }
  
  const folders = {};
  for (const f of allFiles) {
    const parts = f.split('/');
    if (parts.length > 2) {
      const folder = parts[1];
      folders[folder] = (folders[folder] || 0) + 1;
    }
  }
  
  console.log("Files per folder:");
  for (const [folder, count] of Object.entries(folders)) {
    console.log(`- ${folder}: ${count} files`);
  }
  console.log("Total files:", allFiles.length);
}

listAll();
