#!/usr/bin/env python3
"""Tiny no-cache static server: python3 serve.py  ->  http://localhost:8765"""
import http.server, socketserver, os, sys
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
os.chdir(os.path.dirname(os.path.abspath(__file__)))
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('', PORT), H) as s:
    print(f'SF Bay Boating Trainer -> http://localhost:{PORT}')
    s.serve_forever()
