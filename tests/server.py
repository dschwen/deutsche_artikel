"""Static test server supporting the repository's GitHub Pages subpath."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

class Handler(SimpleHTTPRequestHandler):
    worker_mode = "initial"
    def do_GET(self):
        url = urlsplit(self.path)
        if url.path == '/__pwa_test_mode':
            Handler.worker_mode = parse_qs(url.query)['mode'][0]
            self.send_response(200)
            self.end_headers()
            return
        if url.path == '/pwa-update/sw.js':
            source = Path('sw.js').read_text()
            source = source.replace('const VERSION = "', f'const VERSION = "{Handler.worker_mode}-', 1)
            if Handler.worker_mode == 'broken':
                source = source.replace('const ASSETS = [', 'const ASSETS = ["missing-required-file.js",', 1)
            self.send_response(200)
            self.send_header('Content-Type', 'application/javascript')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(source.encode())
            return
        if self.path.startswith('/pwa-update/'):
            self.path = self.path[len('/pwa-update'):]
        if self.path.startswith('/deutsche_artikel/'):
            self.path = self.path[len('/deutsche_artikel'):]
        super().do_GET()

    def log_message(self, *args):
        pass

ThreadingHTTPServer(('127.0.0.1', 8000), Handler).serve_forever()
