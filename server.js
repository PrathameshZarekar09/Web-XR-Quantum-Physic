const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT_HTTPS = 3443;
const PORT_HTTP = 3000;
const DIR = __dirname;

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.bin': 'application/octet-stream',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

function handleRequest(req, res) {
    let reqPath = req.url.split('?')[0];
    if (reqPath === '/' || reqPath === '') reqPath = '/index.html';

    const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
    const filePath = path.join(DIR, safePath);

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found: ' + reqPath);
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        const totalSize = stats.size;

        // Support Range Requests (important for large 3D models like .glb)
        const range = req.headers.range;
        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
            const chunksize = (end - start) + 1;
            const file = fs.createReadStream(filePath, { start, end });

            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${totalSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': contentType,
                'Access-Control-Allow-Origin': '*'
            });
            file.pipe(res);
        } else {
            res.writeHead(200, {
                'Content-Length': totalSize,
                'Content-Type': contentType,
                'Accept-Ranges': 'bytes',
                'Access-Control-Allow-Origin': '*'
            });
            fs.createReadStream(filePath).pipe(res);
        }
    });
}

// Start HTTPS Server
let httpsServer = null;
try {
    const sslOptions = {
        key: fs.readFileSync(path.join(DIR, 'key.pem')),
        cert: fs.readFileSync(path.join(DIR, 'cert.pem'))
    };

    httpsServer = https.createServer(sslOptions, handleRequest);
    httpsServer.listen(PORT_HTTPS, '0.0.0.0', () => {
        console.log('\n======================================================');
        console.log('🔒 HTTPS WebXR Server Ready for Meta Quest 3S:');
        console.log(`   👉 Quest Browser URL: https://192.168.68.125:${PORT_HTTPS}`);
        console.log(`   👉 Desktop URL:       https://localhost:${PORT_HTTPS}`);
        console.log('======================================================\n');
    });
} catch (e) {
    console.error('Failed to load SSL certificates:', e.message);
}

// Start HTTP Server as fallback
const httpServer = http.createServer(handleRequest);
httpServer.listen(PORT_HTTP, '0.0.0.0', () => {
    console.log(`🌐 HTTP Local Server: http://localhost:${PORT_HTTP}\n`);
});
