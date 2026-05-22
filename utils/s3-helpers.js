// src/utils/s3-helpers.js
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import s3Client from '../config/aws-config.js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
dotenv.config();

/**
 * Lightweight filename -> mime fallback (covers common audio/video/image that you use)
 */
function mimeFromFilename(filename) {
  if (!filename) return null;
  const ext = (path.extname(filename) || '').replace('.', '').toLowerCase();
  switch (ext) {
    case 'mp3': return 'audio/mpeg';
    case 'm4a': return 'audio/mp4'; // or audio/m4a if you prefer
    case 'aac': return 'audio/aac';
    case 'wav': return 'audio/wav';
    case 'ogg': return 'audio/ogg';
    case 'flac': return 'audio/flac';
    case 'mp4': return 'video/mp4';
    case 'mov': return 'video/quicktime';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    default: return null;
  }
}

/**
 * uploadFileToS3(file, contentType = null)
 * - file: multer file object (memoryStorage: buffer OR diskStorage: path)
 * - contentType: optional override string (e.g. 'audio/mp4', 'audio/aac')
 *
 * Returns: { Location, Key }
 */
const uploadFileToS3 = async (file, contentType = null) => {
  if (!file) throw new Error('No file provided to uploadFileToS3');

  // Resolve a sensible content type (explicit param wins)
  const resolvedContentType = contentType
    || file.mimetype
    || mimeFromFilename(file.originalname)
    || 'application/octet-stream';

  const key = `${Date.now()}_${file.originalname || 'upload'}`;

  const uploadParams = {
    Bucket: process.env.S3_BUCKET_NAME,
    Key: key,
    Body: undefined,
    ContentType: resolvedContentType,
    ACL: 'public-read', // keep if you want public access
  };

  // If multer used diskStorage, use stream to avoid loading into memory
  if (file.path && fs.existsSync(file.path)) {
    uploadParams.Body = fs.createReadStream(file.path);
  } else if (file.buffer) {
    uploadParams.Body = file.buffer;
  } else {
    throw new Error('File object does not contain path or buffer');
  }

  try {
    await s3Client.send(new PutObjectCommand(uploadParams));
    return {
      Location: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${encodeURIComponent(key)}`,
      Key: key,
      ContentType: resolvedContentType,
    };
  } catch (err) {
    console.error("Error uploading file to S3: ", err);
    throw err;
  }
};

const deleteFileFromS3 = async (fileKey) => {
  const deleteParams = {
    Bucket: process.env.S3_BUCKET_NAME,
    Key: fileKey,
  };

  try {
    await s3Client.send(new DeleteObjectCommand(deleteParams));
  } catch (err) {
    console.error("Error deleting file from S3: ", err);
    throw err;
  }
};

export {
  uploadFileToS3,
  deleteFileFromS3,
};
