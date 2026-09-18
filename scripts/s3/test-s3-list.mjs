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

async function listObjects() {
  // Try listing objects under the prefix
  const prefix = 'Dikho - Corporate Gifting/';
  const url = `https://${bucket}.s3.${region}.amazonaws.com/?list-type=2&prefix=${encodeURIComponent(prefix)}`;
  console.log('Listing objects under prefix:', prefix);
  const res = await aws.fetch(url);
  console.log('Status:', res.status);
  const text = await res.text();
  console.log(text);
}

listObjects();
