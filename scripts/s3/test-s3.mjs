import { AwsClient } from 'aws4fetch';
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf-8').split('\n').reduce((acc, line) => {
  const [k, ...v] = line.split('=');
  if (k && v) acc[k] = v.join('=').trim();
  return acc;
}, {});

const aws = new AwsClient({
  accessKeyId: env.AWS_ACCESS_KEY_ID,
  secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  region: env.AWS_REGION || 'us-east-1',
  service: 's3'
});

async function test() {
  const key = 'Dikho - Corporate Gifting/pens.pdf';
  const encodedKey = encodeURIComponent(key).replace(/%2F/g, '/');
  const url = `https://${env.S3_BUCKET_NAME}.s3.${env.AWS_REGION || 'us-east-1'}.amazonaws.com/${encodedKey}`;
  
  console.log('Fetching:', url);
  const res = await aws.fetch(url);
  console.log('Status:', res.status);
  console.log('Text:', await res.text());
}
test();
