const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const cors = require('cors');
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
const segmentsPath = path.join(__dirname, 'public/videos');
fs.mkdirSync(segmentsPath, { recursive: true });

// Setup Multer for file upload
const upload = multer({ dest: 'uploads/' });

// Route to upload video
app.post('/upload', upload.single('video'), async (req, res) => {
    const file = req.file;
    // const outputDir = path.join(segmentsPath, Date.now().toString());

    const outputDir = path.join(segmentsPath, 'dash');
    fs.mkdirSync(outputDir, { recursive: true });

    const inputPath = file.path;
    const outputPath = path.join(outputDir, 'manifest.mpd');

    ffmpeg(inputPath)
    .complexFilter([
      '[0:v]split=4[v1][v2][v3][v4]; \
      [v1]scale=256:144[v1out]; \
      [v2]scale=640:360[v2out]; \
      [v3]scale=1280:720[v3out]; \
      [v4]scale=1920:1080[v4out]',
    ])
    .outputOptions([
      '-preset ultrafast',
      '-keyint_min 60',
      '-g 60',
      '-sc_threshold 0',
      '-map [v1out]', '-b:v:0 100k',
      '-map [v2out]', '-b:v:1 500k',
      '-map [v3out]', '-b:v:2 1000k',
      '-map [v4out]', '-b:v:3 3000k',
      '-map 0:a:0', '-b:a 128k',
      '-c:v libx264',
      '-c:a aac',
      '-f dash',
      '-use_template 1',
      '-use_timeline 1',
      '-init_seg_name init-$RepresentationID$.mp4',
      '-media_seg_name chunk-$RepresentationID$-$Number$.m4s',
    ])
    .on('progress', (progress) => {
        console.log('Processing: ', progress);
    })
    .on('error', (err) => {
        console.error('Error processing video:', err);
    })
    .on('end', () => {
      console.log('Processing finished!');
    })
        .save(outputPath);
});

// Middleware untuk melayani file statis (segmen video)
app.use('/segments', express.static(segmentsPath, {
    setHeaders: (res, path) => {
        // res.setHeader('Content-Type', `video/mp4`);
        res.setHeader('Accept-Ranges', `bytes`);
        res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache selama 1 hari
    }
}));
// Mapping RepresentationID ke resolusi
const resolutionMap = {
  "0": "144p",
  "1": "360p",
  "2": "720p",
  "3": "1080p"
};

app.get('/api/segments/dash/count', (req, res) => {
  fs.readdir(`${segmentsPath}/dash`, (err, files) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to read directory' });
    }

    const segmentCounts = {};

    // Filter file berdasarkan segmen .m4s
    files.filter(file => file.endsWith('.m4s')).forEach(file => {
      // Ambil RepresentationID dari nama file menggunakan regex
      const match = file.match(/^chunk-(\d+)-\d+\.m4s$/);
      if (match) {
        const representationID = match[1]; // RepresentationID dari nama file
        const resolutionLabel = resolutionMap[representationID]; // Mapping ke label resolusi

        if (resolutionLabel) {
          if (!segmentCounts[resolutionLabel]) {
            segmentCounts[resolutionLabel] = 0;
          }
          segmentCounts[resolutionLabel]++;
        }
      }
    });

    // Kirim respons JSON
    res.json({ segments: segmentCounts });
  });
});

  app.get('/api/segments/hls/count', (req, res) => {
    
    // Baca file dalam direktori
    fs.readdir(`${segmentsPath}/hls`, (err, files) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to read directory' });
      }
  
      const segments = files.filter(file => file.endsWith('.ts'));
      
      res.json({ totalSegments: segments.length });
    });
  });

  app.get('/api/segments/hls', (req, res) => {
    fs.readdir(`${segmentsPath}/hls`, (err, files) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to read directory' });
      }
  
      // Filter hanya file .m4s
      const segments = files.filter(file => file.endsWith('.ts'));
      res.json({ segments });
    });
  });


  app.get('/api/segments/dash', (req, res) => {
    fs.readdir(`${segmentsPath}/dash`, (err, files) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to read directory' });
      }
  
      // Filter hanya file .m4s
      const segments = files.filter(file => file.endsWith('.ts'));
      res.json({ segments });
    });
  });

// Static serving
app.use(express.static(path.join(__dirname, 'public')));

// Start server
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
