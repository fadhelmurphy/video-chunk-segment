const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const cache = require('memory-cache');

// Route untuk streaming video dengan HTTP Range (Chunk)
app.get('/chunk-video', (req, res) => {
    const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB per chunk
    const range = req.headers.range;
    const videoPath = path.join(__dirname, 'public/videos/sample.mp4');
    const videoSize = fs.statSync(videoPath).size;

    const start = Number(range.replace(/\D/g, ""));
    const end = Math.min(videoSize - 1, start + CHUNK_SIZE);
    const cacheKey = `${start}-${end}`;
    const cachedData = cache.get(cacheKey);

    if (cachedData) {
        console.log('Serving from cache');
        return res.writeHead(206, cachedData.headers).end(cachedData.body);
    }

    const headers = {
        "Content-Range": `bytes ${start}-${end}/${videoSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
        "Content-Type": "video/mp4",
        "Cache-Control": "public, max-age=86400" // 1 hari
    };

    const videoStream = fs.createReadStream(videoPath, { start, end });
    let body = Buffer.alloc(0);
    videoStream.on('data', (chunk) => body = Buffer.concat([body, chunk]));
    videoStream.on('end', () => {
        cache.put(cacheKey, { headers, body });
        res.writeHead(206, headers).end(body);
    });
});

// Route untuk mengakses segmen video
app.use('/segments', express.static(path.join(__dirname, 'public/segments')));

// Static serving
app.use(express.static(path.join(__dirname, 'public')));

// Start server
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
