const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const app = express();
const cache = require('memory-cache');

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

const segmentsPath = path.join(__dirname, 'public/videos');
fs.mkdirSync(segmentsPath, { recursive: true });

const upload = multer({ dest: 'uploads/' });

// Route to upload video
app.post('/upload', upload.single('video'), async (req, res) => {
  const file = req.file;
  const inputPath = file.path;
  const outputDir = path.join(__dirname, 'public', 'videos', 'dash'); 
  const outputPath = path.join(outputDir, 'manifest.mpd');

  fs.mkdirSync(outputDir, { recursive: true });

const ffmpegCommand = [
  `"${ffmpegPath}"`,
  `-i "${inputPath}"`,
  '-filter_complex "[0:v]split=4[v1][v2][v3][v4]; [v1]scale=256:144[v1out]; [v2]scale=640:360[v2out]; [v3]scale=1280:720[v3out]; [v4]scale=1920:1080[v4out]"',
  '-preset fast',
  '-keyint_min 60',
  '-g 60',
  '-sc_threshold 0',
  '-map "[v1out]" -b:v:0 100k -maxrate:v:0 100k -bufsize:v:0 200k',
  '-map "[v2out]" -b:v:1 750k -maxrate:v:1 750k -bufsize:v:1 1500k',
  '-map "[v3out]" -b:v:2 1500k -maxrate:v:2 1500k -bufsize:v:2 3000k',
  '-map "[v4out]" -b:v:3 3000k -maxrate:v:3 3000k -bufsize:v:3 6000k',
  '-map 0:a:0 -c:a libopus -b:a 96k', // Efficient audio codec
  '-c:v libx264',
  '-f dash',
  '-use_template 1',
  '-use_timeline 1',
  '-adaptation_sets "id=0,streams=v id=1,streams=a"',
  '-seg_duration 6',
  `-init_seg_name "init-\$RepresentationID$.mp4"`,
  `-media_seg_name "chunk-\$RepresentationID$-\$Number$.m4s"`,
  `"${outputDir}/manifest.mpd"`
].join(' ');

  exec(ffmpegCommand, (error, stdout, stderr) => {
      fs.unlinkSync(inputPath); 

      if (error) {
          console.error('FFmpeg error:', stderr);
          return res.status(500).json({ error: 'Error processing video' });
      }

      console.log('FFmpeg output:', stdout);
      const relativeUrl = path.relative(path.join(__dirname, 'public'), outputPath);
      res.json({ url: `/${relativeUrl}` });
  });
});

app.use('/segments', express.static(segmentsPath, {
    setHeaders: (res, path) => {
        // res.setHeader('Content-Type', `video/mp4`);
        res.setHeader('Accept-Ranges', `bytes`);
        res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache 1 hari
    }
}));
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

    files.filter(file => file.endsWith('.m4s')).forEach(file => {
      const match = file.match(/^chunk-(\d+)-\d+\.m4s$/);
      if (match) {
        const representationID = match[1]; 
        const resolutionLabel = resolutionMap[representationID];

        if (resolutionLabel) {
          if (!segmentCounts[resolutionLabel]) {
            segmentCounts[resolutionLabel] = 0;
          }
          segmentCounts[resolutionLabel]++;
        }
      }
    });

    res.json({ segments: segmentCounts });
  });
});

  app.get('/api/segments/hls/count', (req, res) => {
    
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
  
      const segments = files.filter(file => file.endsWith('.ts'));
      res.json({ segments });
    });
  });


  app.get('/api/segments/dash', (req, res) => {
    fs.readdir(`${segmentsPath}/dash`, (err, files) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to read directory' });
      }
  
      const segments = files.filter(file => file.endsWith('.ts'));
      res.json({ segments });
    });
  });

app.use(express.static(path.join(__dirname, 'public')));

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
