const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 8080;
const DIR = __dirname;
const WAITLIST_FILE = path.join(DIR, 'waitlist.json');

function loadWaitlist() {
  try {
    if (fs.existsSync(WAITLIST_FILE)) {
      return JSON.parse(fs.readFileSync(WAITLIST_FILE, 'utf8'));
    }
  } catch (e) {}
  return [];
}

function saveWaitlist(emails) {
  fs.writeFileSync(WAITLIST_FILE, JSON.stringify(emails, null, 2));
}

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // Handle POST requests for waitlist
  if (pathname === '/api/waitlist' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const email = data.email && data.email.trim().toLowerCase();

        if (!email || !email.includes('@')) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Invalid email' }));
          return;
        }

        let waitlist = loadWaitlist();
        if (!waitlist.includes(email)) {
          waitlist.push(email);
          saveWaitlist(waitlist);
          console.log(`✓ Added to waitlist: ${email}`);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Server error' }));
      }
    });
    return;
  }

  // Handle static files
  let filePath = path.join(DIR, pathname === '/' ? 'index.html' : pathname);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('404 - File Not Found');
      return;
    }

    const ext = path.extname(filePath);
    let contentType = 'text/html';
    if (ext === '.css') contentType = 'text/css';
    if (ext === '.js') contentType = 'application/javascript';
    if (ext === '.json') contentType = 'application/json';

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
});
