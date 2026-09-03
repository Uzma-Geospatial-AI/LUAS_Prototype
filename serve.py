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


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('', PORT), Handler) as httpd:
    url = f'http://localhost:{PORT}'
    print(f'Portal WQI LUAS  ->  {url}\nTekan Ctrl+C untuk berhenti.')
    try:
        webbrowser.open(url)
    except Exception:
        pass
    httpd.serve_forever()
