// utils/audioDuration.js
import ffmpeg from 'fluent-ffmpeg';
import ffprobeStatic from 'ffprobe-static';
import fs from 'fs';
import os from 'os';
import path from 'path';

let ffprobePath = null;
try {
    ffprobePath = (ffprobeStatic && (ffprobeStatic.path || ffprobeStatic.default?.path)) || null;
} catch (e) {
    ffprobePath = null;
}

if (!ffprobePath) {
    // Common system location fallback (adjust if your server uses different path)
    ffprobePath = '/usr/bin/ffprobe';
}

try {
    if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath);
} catch (e) {
    console.warn('Could not set ffprobe path for fluent-ffmpeg:', e?.message ?? e);
}

/**
 * Get duration (seconds) from a multer file object (disk or memory).
 * Returns number (seconds, float) or null on failure.
 */
export async function getAudioDuration(file) {
    if (!file) return null;

    return new Promise((resolve) => {
        if (!ffmpeg || !ffmpeg.ffprobe) {
            console.warn('fluent-ffmpeg not available; cannot compute audio duration');
            return resolve(null);
        }

        // If disk storage: use file.path
        if (file.path) {
            ffmpeg.ffprobe(file.path, (err, metadata) => {
                if (err) {
                    console.warn('ffprobe error (path):', err?.message ?? err);
                    return resolve(null);
                }
                const dur = metadata?.format?.duration ?? null;
                return resolve(dur ? Number(dur) : null);
            });
            return;
        }

        // Memory buffer: write to temp file and probe
        if (file.buffer) {
            const ext = path.extname(file.originalname) || '.tmp';
            const tmpPath = path.join(os.tmpdir(), `probe-${Date.now()}${ext}`);
            try {
                fs.writeFileSync(tmpPath, file.buffer);
                ffmpeg.ffprobe(tmpPath, (err, metadata) => {
                    try { fs.unlinkSync(tmpPath); } catch (e) { /* ignore */ }
                    if (err) {
                        console.warn('ffprobe error (buffer):', err?.message ?? err);
                        return resolve(null);
                    }
                    const dur = metadata?.format?.duration ?? null;
                    return resolve(dur ? Number(dur) : null);
                });
            } catch (e) {
                try { fs.unlinkSync(tmpPath); } catch (er) { /* ignore */ }
                console.warn('ffprobe exception (buffer):', e?.message ?? e);
                return resolve(null);
            }
            return;
        }

        resolve(null);
    });
}
