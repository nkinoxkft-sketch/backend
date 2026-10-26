
import { fileTypeFromBuffer } from 'file-type';
import logger from '../winstonown.js';
import { PutObjectCommand, S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const MAX_TEXT_CHARS = 300_000;
const MAX_TEXT_BYTES = 5 * 1024 * 1024;  // 5 MB
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_PDF_BYTES = 30 * 1024 * 1024;  // 30 MB

export async function prepareFileForClaude(fileBuffer, originalName) {

  if (!fileBuffer || fileBuffer.length === 0) {

    const err = new Error('File is empty');

    err.code = 'frontend';

    throw err;

  }

  const detected = await fileTypeFromBuffer(fileBuffer);

  let detectedMime = null;

  if(detected){

    detectedMime = detected.mime;

  }

  const supportedImages = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (detectedMime && supportedImages.includes(detectedMime)) {

    if (fileBuffer.length > MAX_IMAGE_BYTES) {

      const err =  new Error(`Image is too big: (${(fileBuffer.length / 1024 / 1024).toFixed(1)} MB). Maximum 5 MB.`);

      err.code = 'frontend';

      throw err;

    }
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: detectedMime,
        data: Buffer.from(fileBuffer).toString('base64')
      }
    };
  }

  if (detectedMime === 'application/pdf') {

    if (fileBuffer.length > MAX_PDF_BYTES) {

      const err =  new Error(`A PDF is too big. Maximum 30 MB.`);

      err.code = 'frontend';

      throw err;

    }
    return {
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: Buffer.from(fileBuffer).toString('base64')
      }
    };
  }

  if (detectedMime) {

    const err =  new Error(`${originalName} (${detectedMime}) not supported format. Image, pdf, or text only.`);

    err.code = 'frontend';

    throw err;

  }
    if (fileBuffer.length > MAX_TEXT_BYTES) {

        const err = new Error(`Text is too big.`);

        err.code = 'frontend';

        throw err;

    }

  let textContent;
  try {

    const decoder = new TextDecoder('utf-8', { fatal: true });

    textContent = decoder.decode(fileBuffer);

  } catch {

    const err =  new Error(`${originalName} is not a valid UTF-8 encoded text file.`);

    err.code = 'frontend';

    throw err;

  }


  if (/[\x00-\x08\x0B\x0C\x0E-\x1A\x1C-\x1F]/.test(textContent)) {

    throw new Error(`${originalName} contains non-text control characters.`);

  }

  if (textContent.length > MAX_TEXT_CHARS) {
    throw new Error(`The text file is too long for the context (maximum ~300,000 characters allowed).`);
  }

  return {
    type: 'text',
    text: `<uploaded_file name="${encodeURIComponent(originalName)}">\n${textContent}\n</uploaded_file>`
  };
}


/**
 * @typedef {Object} downloadData 
 * @property {string} file_key
 * @property {string} url
 */

/**
 * 
 * @param {string} file_key
 * @returns {Promise<downloadData>}
 * 
 */
export const getDownloadUrl = async (file_key) =>{

    const command = new GetObjectCommand({

      Bucket: process.env.R2_BUCKET_NAME,
      Key: file_key,

    })

    const url = await getSignedUrl(r2, command, { expiresIn: 900 })

    return {originalName: file_key, fileurl: url};


}



/** 
 * @typedef {Object} options
 * @property {string} options.fileName
 * @property {string} options.fileType
 * 
 * @typedef {Object} uploadResponse
 * @property {string} uniqueFileKey
 * @property {string} uploadUrl
*/

/**
* @param {options} input
* @returns {Promise<uploadResponse>} 
* 
*/
export const getUploadUrl = async ({fileName, fileType, fileSize}, userId) =>{

  const MAX_FILE_SIZE = 5 * 1024 * 1024;

  if(fileSize > MAX_FILE_SIZE){

    return { 
      uniqueFileKey: null,
      uploadUrl: null
    } 

  }

  const uniqueFileKey = `${userId}/${crypto.randomUUID()}-${fileName}`;

  const command = new PutObjectCommand({

    Bucket: process.env.R2_BUCKET_NAME,
    Key: uniqueFileKey,
    ContentType: fileType,
    ContentLength: fileSize,

  })

  const url = await getSignedUrl(r2, command, { expiresIn: 900 })

  return { 
    uniqueFileKey: uniqueFileKey,
    uploadUrl: url
  } 


}


/**
 * @typedef {Object} R2FileResponse
 * @property {import('stream').Readable | ReadableStream | Blob} Body
 * @property {string} [ContentType] 
 * @property {number} [ContentLength]
 * @property {string} [ETag]
 */

/**
* @param {string} filekey
* @returns {Promis<R2FileResponse>} 
* 
*/
export const downloadFromR2 = async (filekey) =>{

    const command = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: filekey,
    });

    const file = await r2.send(command);

    return file;



}


/**
* @param {R2FileResponse} file
* @returns {Promise<Uint8Array>} 
* 
*/
export const transformFile = async (file) => {

  return await file.Body.transformToByteArray();

} 


/**
 * 
 * @typedef {Object} source
 * @property {string} type
 * @property {string} media_type
 * @property {string} data
 */
/**
 * @typedef {Object} prepared_file
 * @property {string} type
 * @property {source} source
 * 
 */

/**
* @param {string} json_file_key
* @param {prepared_file} prepared_file
* @returns {Promise<Uint8Array>} 
* 
*/
export const uploadJson = async (json_file_key, prepared_file) =>{



    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: json_file_key,
      Body: JSON.stringify(prepared_file),
      ContentType: 'application/json',
    });

    await r2.send(command);



}


/**
 * 
 * @param {string} file_key
 * @returns {Promise<prepared_file>}
 * 
 * 
 */
export const downloadJson = async (file_key) => {

    const command = new GetObjectCommand({

      Bucket: process.env.R2_BUCKET_NAME,
      Key: file_key,

    })

    const response = await r2.send(command);

    const jsonString = await response.Body.transformToString();

    return JSON.parse(jsonString);

}
