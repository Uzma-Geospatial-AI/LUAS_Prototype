#!/usr/bin/env python3
"""Pelayan HTTP tempatan untuk Portal WQI LUAS.

    python serve.py            -> http://localhost:8000
    python serve.py 8080       -> http://localhost:8080

Modul JavaScript memerlukan protokol http://, jadi membuka index.html
terus daripada fail (file://) tidak akan berfungsi.
"""
import http.server, socketserver, sys, webbrowser, os

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
os.chdir(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.geojson': 'application/geo+json',
        '.json': 'application/json',
        '.js': 'text/javascript',
        '.svg': 'image/svg+xml',
    }

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        if '404' in (args[1] if len(args) > 1 else ''):
            super().log_message(fmt, *args)


class Server(socketserver.ThreadingTCPServer):
    """Threaded: the browser opens several connections at once, and the data
    files are large enough that serving them one at a time stalls the page."""

    # On Windows SO_REUSEADDR lets a SECOND server bind a port that is already
    # served, and requests then land on either one at random. Keep the TIME_WAIT
    # convenience on POSIX; on Windows let the bind fail loudly instead.
    allow_reuse_address = os.name != 'nt'
    daemon_threads = True


with Server(('', PORT), Handler) as httpd:
    url = f'http://localhost:{PORT}'
    print(f'Portal WQI LUAS  ->  {url}\nTekan Ctrl+C untuk berhenti.')
    if os.environ.get('NO_BROWSER') != '1':
        try:
            webbrowser.open(url)
        except Exception:
            pass
    httpd.serve_forever()
