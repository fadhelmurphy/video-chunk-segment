const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const cache = require('memory-cache');

// Route untuk streaming video dengan HTTP Range (Chunk)
app.get('/chunk-video', (req, res) => {
    const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB per chunk
    const range = req.headers.range;
    const videoPath = path.join(__dirname, 'public/videos/chunk/sample.mp4');
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

// Folder untuk menyimpan segmen video
const segmentsPath = path.join(__dirname, 'public/videos/segments');

// Middleware untuk melayani file statis (segmen video)
app.use('/segments', express.static(segmentsPath, {
    setHeaders: (res, path) => {
        res.setHeader('Content-Type', `video/mp4`);
        res.setHeader('Accept-Ranges', `bytes`);
        res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache selama 1 tahun
    }
}));

// Endpoint untuk mendapatkan daftar segmen
app.get('/api/segments', (req, res) => {
    fs.readdir(segmentsPath, (err, files) => {
        if (err) {
            console.error('Error reading segments directory:', err);
            return res.status(500).json({ error: 'Failed to retrieve segments' });
        }
        // Filter hanya file dengan ekstensi .mp4 dan buat URL
        const segmentURLs = files
            .filter(file => file.endsWith('.mp4'))
            .map(file => `/segments/${file}`);
        res.json(segmentURLs);
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
