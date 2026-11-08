"""Exercise the actual node proxy over isolated local TLS, without real data."""
import copy
import datetime
import hashlib
import http.server
import importlib.util
import json
import pathlib
import socket
import ssl
import sys
import tempfile
import threading
import time
import types
import unittest
from unittest.mock import patch

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

ROOT = pathlib.Path(__file__).resolve().parent.parent
BASELINE = '--baseline' in sys.argv
if BASELINE:
    sys.argv.remove('--baseline')
SOURCE = (ROOT / '.local-dev/old-node-recovery-20261108/ownership-proxy-original.py'
          if BASELINE else ROOT / 'scripts/node-ownership-api.py')
spec = importlib.util.spec_from_file_location('node_proxy_under_test', SOURCE)
proxy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proxy)


class FakeDB:
    def token(self, **_):
        return 'synthetic-node-token'

    def foreign(self, **_):
        return {'another_owner'}


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *_):
        pass

    def do_GET(self):
        self.reply()

    def do_POST(self):
        self.reply()

    def reply(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', '0')))
        self.server.records.append({'method': self.command, 'path': self.path,
                                    'host': self.headers.get('Host'), 'body': body,
                                    'authorization': self.headers.get('Authorization')})
        if self.path == '/lost':
            self.close_connection = True
            self.connection.shutdown(socket.SHUT_RDWR)
            return
        raw = b'{"success":true,"obj":{"ok":true}}'
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Connection', 'close')
        self.end_headers()
        try:
            if self.path == '/slow':
                for byte in raw:
                    self.wfile.write(bytes([byte]))
                    self.wfile.flush()
                    time.sleep(.05)
            else:
                self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError, ssl.SSLError):
            pass
        self.close_connection = True


class TransportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='pvnet-node-ip-')
        cls.dir = pathlib.Path(cls.temp.name)
        cls.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.spki = cls.key.public_key().public_bytes(
            serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
        cls.pin = hashlib.sha256(cls.spki).hexdigest()
        now = datetime.datetime.now(datetime.timezone.utc)
        cls.cert = cls.make_certificate(cls.key, now, 1)
        cls.keyfile = cls.dir / 'test-key.pem'
        cls.certfile = cls.dir / 'test-cert.pem'
        cls.keyfile.write_bytes(cls.key.private_bytes(serialization.Encoding.PEM,
                                serialization.PrivateFormat.PKCS8,
                                serialization.NoEncryption()))
        cls.certfile.write_bytes(cls.cert.public_bytes(serialization.Encoding.PEM))

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    @staticmethod
    def make_certificate(key, now, serial):
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'node.invalid')])
        return (x509.CertificateBuilder().subject_name(name).issuer_name(name)
                .public_key(key.public_key()).serial_number(serial)
                .not_valid_before(now - datetime.timedelta(days=1))
                .not_valid_after(now + datetime.timedelta(days=1))
                .add_extension(x509.SubjectAlternativeName([
                    x509.DNSName('node.invalid')]), critical=False)
                .sign(key, hashes.SHA256()))

    def setUp(self):
        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.daemon_threads = True
        self.server.records = []
        self.context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        self.context.load_cert_chain(self.certfile, self.keyfile)
        self.server.socket = self.context.wrap_socket(self.server.socket, server_side=True)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def state(self, **changes):
        cfg = {'base_path': '/fixture',
               'upstream_origin': 'https://127.0.0.1:' + str(self.server.server_port),
               'upstream_tls_verify_mode': 'pin', 'upstream_spki_sha256': self.pin}
        cfg.update(changes)
        return proxy.State(cfg, FakeDB())

    def request(self, state, method='GET', path='/ok', body=None, budget=2):
        return proxy.upstream_request(state, method, path, body,
                                      {'Authorization': 'Bearer synthetic-node-token'},
                                      time.monotonic() + budget)

    def test_direct_ip_without_dns(self):
        state = self.state()
        with patch.object(proxy.subprocess, 'run', side_effect=AssertionError('DNS helper used')):
            status, _, raw = self.request(state)
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(raw)['success'])
        self.assertEqual(len(self.server.records), 1)
        self.assertEqual(self.server.records[0]['host'], '127.0.0.1:' + str(self.server.server_port))

    def test_wrong_key_is_rejected_before_authorization_is_sent(self):
        with self.assertRaises(ssl.SSLError):
            self.request(self.state(upstream_spki_sha256='0' * 64))
        self.assertEqual(self.server.records, [])

    def test_pin_is_mandatory_and_strict(self):
        for pin in [None, '', 'xyz', '0' * 63, True, ['0' * 64]]:
            with self.subTest(pin=pin), self.assertRaises((ValueError, AssertionError)):
                self.state(upstream_spki_sha256=pin)

    def test_pinned_mode_never_resolves_a_hostname(self):
        with self.assertRaises((ValueError, AssertionError)):
            self.state(upstream_origin='https://unavailable.invalid:2087')

    def test_no_certificate_name_or_external_ca_is_needed_for_pinned_key(self):
        # Trust is the independently provisioned node key, not a CA/hostname exception.
        status, _, _ = self.request(self.state())
        self.assertEqual(status, 200)

    def test_certificate_renewal_with_the_same_key_keeps_its_identity(self):
        renewed = self.make_certificate(self.key, datetime.datetime.now(datetime.timezone.utc), 2)
        self.assertNotEqual(renewed.fingerprint(hashes.SHA256()), self.cert.fingerprint(hashes.SHA256()))
        renewed_spki = renewed.public_key().public_bytes(
            serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
        self.assertEqual(hashlib.sha256(renewed_spki).hexdigest(), self.pin)
        renewed_file = self.dir / 'renewed-cert.pem'
        renewed_file.write_bytes(renewed.public_bytes(serialization.Encoding.PEM))
        self.context.load_cert_chain(renewed_file, self.keyfile)
        self.assertEqual(self.request(self.state())[0], 200)

    def test_system_ca_verification_is_not_silently_bypassed(self):
        with self.assertRaises(ssl.SSLError):
            self.request(self.state(upstream_tls_verify_mode='verify'))
        self.assertEqual(self.server.records, [])

    def test_invalid_routing_options_are_rejected(self):
        for changes in [{'upstream_bind_device': ''}, {'upstream_bind_device': 'wg; unsafe'},
                        {'upstream_socket_mark': True}, {'upstream_socket_mark': -1},
                        {'upstream_socket_mark': 0x100000000}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.state(**changes)

    def test_failed_interface_binding_never_falls_back_to_another_route(self):
        with self.assertRaises((OSError, AttributeError)):
            self.request(self.state(upstream_bind_device='pvnet-missing'))
        self.assertEqual(self.server.records, [])

    def test_lost_write_response_is_not_retried(self):
        with self.assertRaises((OSError, http.client.HTTPException)):
            self.request(self.state(), 'POST', '/lost', b'{"fixture":true}')
        self.assertEqual(len(self.server.records), 1)
        self.assertEqual(self.server.records[0]['body'], b'{"fixture":true}')

    def test_absolute_response_deadline_is_preserved(self):
        start = time.monotonic()
        with self.assertRaises((OSError, http.client.HTTPException, TimeoutError)):
            self.request(self.state(), path='/slow', budget=.2)
        self.assertLess(time.monotonic() - start, 1)
        self.assertEqual(len(self.server.records), 1)

    def test_ownership_filter_does_not_modify_native_user_settings(self):
        original = {'success': True, 'obj': [{'settings': '{"clients":[{"email":"another_owner"}]}',
                    'clientStats': [{'email': 'another_owner', 'up': 999}, {'email': 'owned', 'up': 2}]}]}
        settings = original['obj'][0]['settings']
        filtered, count = proxy.filter_response('inbounds/list', copy.deepcopy(original), {'another_owner'})
        self.assertEqual(count, 1)
        self.assertEqual(filtered['obj'][0]['settings'], settings)
        self.assertEqual(filtered['obj'][0]['clientStats'], [{'email': 'owned', 'up': 2}])


if __name__ == '__main__':
    unittest.main(verbosity=2)
