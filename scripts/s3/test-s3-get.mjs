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
  region,
  service: 's3'
});

// Try HEAD request on a few possible paths
const paths = [
  'Dikho - Corporate Gifting/pens.pdf',
  'Dikho - Corporate Gifting/Pens.pdf',
  'Dikho - Corporate Gifting/',
  'Dikho-Corporate-Gifting/',
];

for (const key of paths) {
  const encodedKey = key.split('/').map(p => encodeURIComponent(p)).join('/');
  const url = `https://${bucket}.s3.${region}.amazonaws.com/${encodedKey}`;
  try {
    const res = await aws.fetch(url, { method: 'HEAD' });
    console.log(`${res.status} - ${key}`);
  } catch (e) {
    console.log(`ERROR - ${key}: ${e.message}`);
  }
}
