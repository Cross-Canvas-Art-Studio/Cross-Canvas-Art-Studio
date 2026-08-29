"""
Stitchee - Flask backend (Cross Canvas Art Studio).

Converts uploaded images (and LLM-generated descriptions) into cross-stitch yarn
canvas charts, matched against a curated worsted-weight yarn palette. Ships with
an optional JWT auth system, hardened HTTP security, and server-side project
storage. The core design tools work fully offline; the AI helper works offline
via a local Ollama / LM Studio server.
"""

import io
import os
import re
import json
import time
import uuid
import secrets
import threading
import logging
import ipaddress
from datetime import datetime
from logging.handlers import RotatingFileHandler

from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from werkzeug.utils import secure_filename
from PIL import Image

try:
    import webauthn as _webauthn
    from webauthn.helpers.structs import (
        AuthenticatorSelectionCriteria,
        ResidentKeyRequirement,
        UserVerificationRequirement,
        RegistrationCredential,
        AuthenticatorAttestationResponse,
        AuthenticationCredential,
        AuthenticatorAssertionResponse,
        AuthenticatorTransport,
    )
    from webauthn.helpers import (
        base64url_to_bytes as _b64url_to_bytes,
        bytes_to_base64url as _bytes_to_b64url,
    )
    PASSKEY_SUPPORT = True
except ImportError:
    PASSKEY_SUPPORT = False

import palette_manager
import image_manager
import design_manager
import project_manager
import crypto_manager
import user_manager
import auth_manager
from llm_manager import LLMManager

try:  # libmagic may be unavailable on some dev machines; degrade gracefully.
    import magic as _magic
except Exception:  # noqa: BLE001
    _magic = None

# ============================================================================
# App & configuration
# ============================================================================

app = Flask(__name__, static_folder='static', template_folder='templates')
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY') or os.urandom(32).hex()

MAX_UPLOAD_MB = int(os.environ.get('MAX_UPLOAD_MB', '25'))
app.config['MAX_CONTENT_LENGTH'] = MAX_UPLOAD_MB * 1024 * 1024

CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'config.json')
LOG_DIR = os.environ.get('LOG_DIR', '/data/logs')

# --- CORS (tri-state: '*' all, comma list, or same-origin only) --------------
_cors_raw = os.environ.get('CORS_ALLOWED_ORIGINS', '').strip()
if _cors_raw == '*':
    CORS(app, resources={r"/api/*": {"origins": "*"}})
elif _cors_raw:
    CORS(app, resources={r"/api/*": {"origins": [o.strip() for o in _cors_raw.split(',') if o.strip()]}})

# --- Rate limiting -----------------------------------------------------------
limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["300 per minute"],
    storage_uri="memory://",
)

if os.environ.get('TRUST_PROXY', 'false').lower() == 'true':
    from werkzeug.middleware.proxy_fix import ProxyFix
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1)

CONTENT_SECURITY_POLICY = os.environ.get(
    'CONTENT_SECURITY_POLICY',
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob:; "
    "connect-src 'self'; "
    "font-src 'self' data:; "
    "object-src 'none'; "
    "base-uri 'self'; "
    "frame-ancestors 'self'",
).strip()

# --- Feature flags -----------------------------------------------------------
ALLOW_CLIENT_API_KEYS = os.environ.get('ALLOW_CLIENT_API_KEYS', 'true').lower() == 'true'
ALLOW_AUTH = os.environ.get('ALLOW_AUTH', 'false').lower() == 'true'
ALLOW_USER_REGISTRATION = os.environ.get('ALLOW_USER_REGISTRATION', 'true').lower() == 'true'
REQUIRE_AUTH = ALLOW_AUTH and (os.environ.get('REQUIRE_AUTH', 'false').lower() == 'true')
ALLOW_GUEST_LOGIN = ALLOW_AUTH and (os.environ.get('ALLOW_GUEST_LOGIN', 'true').lower() == 'true')
AI_ENABLED = os.environ.get('AI_ENABLED', 'false').lower() == 'true'
REQUIRE_SECRETS = os.environ.get('REQUIRE_SECRETS', 'false').lower() == 'true'

# Local LLM hostnames permitted for client-supplied custom hosts (SSRF guard).
ALLOWED_LOCAL_HOSTS = {'localhost', '127.0.0.1', 'host.docker.internal', '::1', '0.0.0.0'}

SERVER_API_KEYS = {
    'openai': os.environ.get('OPENAI_API_KEY', ''),
    'anthropic': os.environ.get('ANTHROPIC_API_KEY', ''),
    'gemini': os.environ.get('GOOGLE_API_KEY', ''),
    'deepseek': os.environ.get('DEEPSEEK_API_KEY', ''),
    'cohere': os.environ.get('COHERE_API_KEY', ''),
    'grok': os.environ.get('GROK_API_KEY', ''),
    'mistral': os.environ.get('MISTRAL_API_KEY', ''),
    'perplexity': os.environ.get('PERPLEXITY_API_KEY', ''),
}

# ============================================================================
# Logging
# ============================================================================

os.makedirs(LOG_DIR, exist_ok=True)
log_file = os.path.join(LOG_DIR, 'cross-canvas-art.log')
file_handler = RotatingFileHandler(log_file, maxBytes=5 * 1024 * 1024, backupCount=3)
file_handler.setFormatter(logging.Formatter('%(asctime)s [%(levelname)s] %(name)s: %(message)s'))
console_handler = logging.StreamHandler()
console_handler.setFormatter(logging.Formatter('%(levelname)s: %(message)s'))
logging.basicConfig(level=logging.INFO, handlers=[file_handler, console_handler])
logger = logging.getLogger('cross-canvas-art')


def load_config():
    try:
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


config = load_config()
GRID_CFG = config.get('grid', {})
UPLOAD_CFG = config.get('upload', {})
ALLOWED_EXTENSIONS = set(UPLOAD_CFG.get('allowed_extensions',
                                        ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp']))
ALLOWED_MIME = set(UPLOAD_CFG.get('allowed_mime_types',
                                  ['image/png', 'image/jpeg', 'image/gif', 'image/bmp', 'image/webp']))

# --- Passkey / WebAuthn config --------------------------------------------
# RP_ID must match the hostname only (no port, no scheme). It is permanent —
# changing it invalidates all existing passkeys.
# ORIGIN is a comma-separated list. Supported values:
#   localhost           → accept any http://localhost:PORT
#   yarn                → accept any http(s)://yarn.<DOMAIN>[:<PORT>]
#   https://example.com → accept that exact origin
RP_ID = os.environ.get('RP_ID', 'localhost')
RP_NAME = os.environ.get('RP_NAME', config.get('app', {}).get('title', 'Stitchee'))

_PK_EXACT_ORIGINS: set = set()
_PK_ALLOW_LOCALHOST = False
_PK_ALLOW_YARN = False

for _tok in os.environ.get('ORIGIN', 'localhost').split(','):
    _tok = _tok.strip()
    if _tok.lower() == 'localhost':
        _PK_ALLOW_LOCALHOST = True
    elif _tok.lower() == 'yarn':
        _PK_ALLOW_YARN = True
    elif _tok:
        _PK_EXACT_ORIGINS.add(_tok)

_RE_LOCALHOST = re.compile(r'^https?://localhost(:\d+)?$')
_RE_YARN = re.compile(r'^https?://yarn\.[a-zA-Z0-9.-]+(:\d+)?$')


def _passkey_origin() -> str:
    """Resolve the expected WebAuthn origin from the incoming request Origin header."""
    origin = (request.headers.get('Origin') or '').strip()
    if origin:
        if _PK_ALLOW_LOCALHOST and _RE_LOCALHOST.match(origin):
            return origin
        if _PK_ALLOW_YARN and _RE_YARN.match(origin):
            return origin
        if origin in _PK_EXACT_ORIGINS:
            return origin
    return next(iter(_PK_EXACT_ORIGINS), 'http://localhost')

_pk_challenges: dict = {}
_pk_lock = threading.Lock()


def _pk_put(data: dict) -> str:
    cid = secrets.token_urlsafe(16)
    now = time.time()
    with _pk_lock:
        stale = [k for k, v in list(_pk_challenges.items()) if v['_exp'] < now]
        for k in stale:
            del _pk_challenges[k]
        _pk_challenges[cid] = {**data, '_exp': now + 300}
    return cid


def _pk_take(cid: str):
    with _pk_lock:
        c = _pk_challenges.pop(cid, None)
    if not c or c.get('_exp', 0) < time.time():
        return None
    return c

if REQUIRE_SECRETS and crypto_manager.is_ephemeral():
    raise RuntimeError('REQUIRE_SECRETS is set but no SECRETS environment variable was provided')

if ALLOW_AUTH:
    user_manager.init_db()
    try:
        user_manager.purge_expired_guests()
        user_manager.cleanup_expired_tokens()
    except Exception as exc:  # noqa: BLE001
        logger.warning('Startup auth cleanup failed: %s', exc)

logger.info('=' * 60)
logger.info('Stitchee (Cross Canvas Art Studio) starting')
logger.info('Palette colours: %d | Auth: %s | Max upload: %dMB',
            palette_manager.palette_size(), ALLOW_AUTH, MAX_UPLOAD_MB)
logger.info('=' * 60)


# ============================================================================
# Helpers
# ============================================================================

def mask_api_key(key):
    if not key or len(key) < 10:
        return None
    return f"\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf{key[-6:]}"


def get_api_key(provider, headers):
    """Resolve an API key from client header or server env, gated by feature flag."""
    key_source = headers.get('X-API-Key-Source', 'client')
    client_key = headers.get('X-API-Key', '')
    server_key = SERVER_API_KEYS.get(provider, '')
    if key_source == 'server' and server_key:
        return server_key, 'server'
    if key_source == 'client' and client_key and ALLOW_CLIENT_API_KEYS:
        return client_key, 'client'
    if client_key and ALLOW_CLIENT_API_KEYS:
        return client_key, 'client'
    if server_key:
        return server_key, 'server'
    return None, None


def validate_local_host(host):
    """SSRF guard: only allow loopback / private hosts for local LLM providers."""
    host_lower = (host or '').lower().strip()
    if host_lower in ALLOWED_LOCAL_HOSTS:
        return True
    try:
        ip = ipaddress.ip_address(host_lower)
        return ip.is_private or ip.is_loopback
    except ValueError:
        return False


def resolve_custom_config(provider, data):
    """Extract and SSRF-validate a client-supplied local LLM host config."""
    custom = data.get('config') if isinstance(data.get('config'), dict) else {}
    if LLMManager.is_local(provider) and custom.get('host'):
        if not validate_local_host(custom.get('host')):
            raise ValueError('Custom LLM host is not permitted')
    return custom


def current_owner():
    """(owner_id, is_admin). owner is None when auth is off or user is anonymous."""
    if not ALLOW_AUTH:
        return None, False
    user = auth_manager.get_current_user()
    if not user:
        return None, False
    return user.get('sub'), (user.get('role') == 'admin')


def clamp_int(value, low, high, default):
    try:
        value = int(value)
    except (TypeError, ValueError):
        return default
    return max(low, min(high, value))


def validate_image_upload(file_storage):
    """Return raw image bytes if the upload passes extension + MIME + decode checks."""
    filename = secure_filename(file_storage.filename or '')
    if not filename:
        raise ValueError('Missing filename')
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError(f'Unsupported file type: {ext or "unknown"}')

    data = file_storage.read()
    if not data:
        raise ValueError('Uploaded file is empty')

    if _magic is not None:
        try:
            mime = _magic.from_buffer(data[:8192], mime=True)
        except Exception:  # noqa: BLE001
            mime = None
        if mime and mime not in ALLOWED_MIME:
            raise ValueError(f'File content ({mime}) is not an allowed image type')

    try:
        Image.open(io.BytesIO(data)).verify()
    except Exception:  # noqa: BLE001
        raise ValueError('File is not a valid image')
    return data


# ============================================================================
# Security headers
# ============================================================================

@app.after_request
def add_security_headers(response):
    response.headers.setdefault('X-Content-Type-Options', 'nosniff')
    response.headers.setdefault('X-Frame-Options', 'SAMEORIGIN')
    response.headers.setdefault('Referrer-Policy', 'strict-origin-when-cross-origin')
    response.headers.setdefault('Cross-Origin-Opener-Policy', 'same-origin')
    if CONTENT_SECURITY_POLICY:
        response.headers.setdefault('Content-Security-Policy', CONTENT_SECURITY_POLICY)
    return response


@app.errorhandler(413)
def handle_too_large(_error):
    return jsonify({'error': f'Upload exceeds the {MAX_UPLOAD_MB} MB limit'}), 413


# ============================================================================
# Meta & config routes
# ============================================================================

@app.route('/health')
def health_check():
    return jsonify({'status': 'healthy', 'timestamp': datetime.utcnow().isoformat() + 'Z'})


@app.route('/')
def index():
    _seo = config.get('seo', {})
    return render_template(
        'index.html',
        app_title=config.get('app', {}).get('title', 'Stitchee'),
        seo_title=_seo.get('title', 'Stitchee \u2014 Free Cross-Stitch Pattern Maker and Yarn Canvas Designer'),
        seo_description=_seo.get('description', 'Turn photos and ideas into cross-stitch yarn canvas patterns.'),
        seo_url=_seo.get('url', ''),
        seo_image=_seo.get('image', ''),
        seo_site_name=_seo.get('site_name', 'Stitchee'),
        require_auth=REQUIRE_AUTH,
        ai_enabled=AI_ENABLED,
    )


@app.route('/api/config')
def get_app_config():
    api_keys_info = {}
    for provider, key in SERVER_API_KEYS.items():
        api_keys_info[provider] = {'available': bool(key), 'masked': mask_api_key(key)}

    return jsonify({
        'app': config.get('app', {}),
        'grid': GRID_CFG,
        'upload': {
            'max_file_size_mb': MAX_UPLOAD_MB,
            'allowed_extensions': sorted(ALLOWED_EXTENSIONS),
        },
        'palette': palette_manager.get_palette(),
        'llm': {
            'default_provider': config.get('llm', {}).get('default_provider', 'ollama'),
            'providers': config.get('llm', {}).get('providers', {}),
        },
        'features': {
            'ai_enabled': AI_ENABLED,
            'allow_client_api_keys': ALLOW_CLIENT_API_KEYS,
            'auth_enabled': ALLOW_AUTH,
            'registration_enabled': ALLOW_AUTH and ALLOW_USER_REGISTRATION,
            'require_auth': REQUIRE_AUTH,
            'guest_login_enabled': ALLOW_GUEST_LOGIN,
        },
        'current_user': (lambda u: {'user_id': u.get('sub'), 'username': u.get('username'),
                                    'role': u.get('role'), 'is_guest': u.get('is_guest', False)})(
            auth_manager.get_current_user()
        ) if ALLOW_AUTH and auth_manager.get_current_user() else None,
        'server_api_keys': api_keys_info,
    })


# ============================================================================
# Auth routes (inert unless ALLOW_AUTH)
# ============================================================================

@app.route('/auth/register', methods=['POST'])
def auth_register():
    if not ALLOW_AUTH or not ALLOW_USER_REGISTRATION:
        return jsonify({'error': 'Registration is disabled'}), 404
    ip = auth_manager.client_ip()
    if not auth_manager.register_rate_ok(ip):
        return jsonify({'error': 'Too many registration attempts, please try again later'}), 429
    auth_manager.record_register_attempt(ip)
    data = request.get_json(silent=True) or {}
    try:
        role = 'admin' if user_manager.count_users() == 0 else 'user'
        user = user_manager.create_user(data.get('username'), data.get('password'),
                                        data.get('email'), role=role)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    token, _exp = auth_manager.create_access_token(user['user_id'], user['role'], user['username'])
    logger.info("AUTH: registered '%s' (role=%s)", user['username'], user['role'])
    return jsonify({'user': user, 'token': token}), 201


@app.route('/auth/login', methods=['POST'])
def auth_login():
    if not ALLOW_AUTH:
        return jsonify({'error': 'Authentication is disabled'}), 404
    ip = auth_manager.client_ip()
    if not auth_manager.login_rate_ok(ip):
        return jsonify({'error': 'Too many login attempts, please try again later'}), 429
    data = request.get_json(silent=True) or {}
    user = user_manager.authenticate(data.get('username'), data.get('password'))
    if not user:
        auth_manager.record_login_failure(ip)
        logger.warning("AUTH: failed login for '%s' from %s", data.get('username'), ip)
        return jsonify({'error': 'Invalid credentials'}), 401
    auth_manager.reset_login_attempts(ip)
    token, _exp = auth_manager.create_access_token(user['user_id'], user['role'], user['username'])
    logger.info("AUTH: login success '%s'", user['username'])
    return jsonify({'user': user, 'token': token})


@app.route('/auth/logout', methods=['POST'])
def auth_logout():
    if not ALLOW_AUTH:
        return jsonify({'error': 'Authentication is disabled'}), 404
    token = auth_manager._extract_token()
    if token:
        claims = auth_manager.decode_token(token)
        if claims and claims.get('jti'):
            user_manager.revoke_token(claims['jti'], claims.get('exp', 0))
    return jsonify({'success': True})


@app.route('/auth/me')
def auth_me():
    if not ALLOW_AUTH:
        return jsonify({'error': 'Authentication is disabled'}), 404
    user = auth_manager.get_current_user()
    if not user:
        return jsonify({'error': 'Authentication required'}), 401
    return jsonify({'user': {
        'user_id': user.get('sub'),
        'username': user.get('username'),
        'role': user.get('role'),
        'is_guest': user.get('is_guest', False),
    }})


@app.route('/auth/guest', methods=['POST'])
def auth_guest():
    if not ALLOW_AUTH or not ALLOW_GUEST_LOGIN:
        return jsonify({'error': 'Guest login is disabled'}), 404
    user = user_manager.create_guest_user()
    token, _exp = auth_manager.create_access_token(
        user['user_id'], user['role'], user['username'], extra_claims={'is_guest': True})
    logger.info('AUTH: guest session created for %s', user['username'])
    return jsonify({'user': user, 'token': token}), 201


# ============================================================================
# Passkey (WebAuthn) routes
# ============================================================================

@app.route('/auth/passkey/register/options', methods=['POST'])
def passkey_register_options():
    if not ALLOW_AUTH or not ALLOW_USER_REGISTRATION:
        return jsonify({'error': 'Registration is disabled'}), 404
    if not PASSKEY_SUPPORT:
        return jsonify({'error': 'Passkey support not available on this server'}), 501
    ip = auth_manager.client_ip()
    if not auth_manager.register_rate_ok(ip):
        return jsonify({'error': 'Too many registration attempts, please try again later'}), 429
    data = request.get_json(silent=True) or {}
    username = (data.get('username') or '').strip()
    email = (data.get('email') or '').strip() or None
    err = user_manager.validate_username(username)
    if err:
        return jsonify({'error': err}), 400
    existing = user_manager.get_user_by_username(username)
    if existing:
        # Security: Prevent account takeover. Only allow registering a new passkey
        # for an existing user if they are currently logged in as that exact user.
        curr_user = auth_manager.get_current_user()
        if not curr_user or curr_user.get('sub') != existing['user_id']:
            return jsonify({'error': 'Username already exists'}), 400
        uid_str = existing['user_id']
        is_new_user = False
    else:
        uid_str = str(uuid.uuid4())
        is_new_user = True
    user_id_bytes = bytes.fromhex(uid_str.replace('-', ''))
    options = _webauthn.generate_registration_options(
        rp_id=RP_ID,
        rp_name=RP_NAME,
        user_id=user_id_bytes,
        user_name=username,
        user_display_name=username,
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.PREFERRED,
            user_verification=UserVerificationRequirement.PREFERRED,
        ),
    )
    cid = _pk_put({'challenge': options.challenge, 'username': username,
                   'email': email, 'uid': uid_str, 'is_new_user': is_new_user})
    return jsonify({'cid': cid, 'options': json.loads(_webauthn.options_to_json(options))})


@app.route('/auth/passkey/register/verify', methods=['POST'])
def passkey_register_verify():
    if not ALLOW_AUTH or not ALLOW_USER_REGISTRATION:
        return jsonify({'error': 'Registration is disabled'}), 404
    if not PASSKEY_SUPPORT:
        return jsonify({'error': 'Passkey support not available on this server'}), 501
    ip = auth_manager.client_ip()
    data = request.get_json(silent=True) or {}
    c = _pk_take(data.get('cid'))
    if not c:
        return jsonify({'error': 'Challenge expired — please try again'}), 400
    cred_data = data.get('credential')
    if not cred_data or not isinstance(cred_data, dict):
        return jsonify({'error': 'Missing credential'}), 400
    try:
        resp = cred_data.get('response', {})
        transports = []
        for t in (resp.get('transports') or []):
            try:
                transports.append(AuthenticatorTransport(t))
            except ValueError:
                pass
        cred = RegistrationCredential(
            id=cred_data['id'],
            raw_id=_b64url_to_bytes(cred_data['rawId']),
            response=AuthenticatorAttestationResponse(
                client_data_json=_b64url_to_bytes(resp['clientDataJSON']),
                attestation_object=_b64url_to_bytes(resp['attestationObject']),
                transports=transports,
            ),
        )
    except Exception as exc:
        logger.warning('Passkey register parse error: %s', exc)
        return jsonify({'error': 'Invalid credential format'}), 400
    try:
        verification = _webauthn.verify_registration_response(
            credential=cred,
            expected_challenge=c['challenge'],
            expected_rp_id=RP_ID,
            expected_origin=_passkey_origin(),
            require_user_verification=False,
        )
    except Exception as exc:
        logger.warning('Passkey register verify error: %s', exc)
        return jsonify({'error': 'Passkey verification failed: ' + str(exc)}), 400
    cred_id = _bytes_to_b64url(verification.credential_id)
    pub_key = _bytes_to_b64url(verification.credential_public_key)
    sign_count = verification.sign_count
    transports_list = [t.value if hasattr(t, 'value') else str(t) for t in transports]
    if c['is_new_user']:
        auth_manager.record_register_attempt(ip)
        try:
            role = 'admin' if user_manager.count_users() == 0 else 'user'
            user = user_manager.create_user_passwordless(
                c['username'], c.get('email'), role=role, forced_id=c['uid'])
        except ValueError as exc:
            return jsonify({'error': str(exc)}), 400
    else:
        row = user_manager.get_user_by_id(c['uid'])
        if not row:
            return jsonify({'error': 'User not found'}), 404
        user = user_manager._public(row)
    try:
        user_manager.add_passkey(user['user_id'], cred_id, pub_key, sign_count, transports_list)
    except Exception as exc:
        logger.error('Passkey store error: %s', exc)
        return jsonify({'error': 'Failed to store passkey'}), 500
    token, _exp = auth_manager.create_access_token(
        user['user_id'], user['role'], user['username'])
    logger.info("AUTH: passkey registered for '%s'", user['username'])
    return jsonify({'user': user, 'token': token}), (201 if c['is_new_user'] else 200)


@app.route('/auth/passkey/login/options', methods=['POST'])
def passkey_login_options():
    if not ALLOW_AUTH:
        return jsonify({'error': 'Authentication is disabled'}), 404
    if not PASSKEY_SUPPORT:
        return jsonify({'error': 'Passkey support not available on this server'}), 501
    options = _webauthn.generate_authentication_options(
        rp_id=RP_ID,
        user_verification=UserVerificationRequirement.PREFERRED,
        allow_credentials=[],
    )
    cid = _pk_put({'challenge': options.challenge})
    return jsonify({'cid': cid, 'options': json.loads(_webauthn.options_to_json(options))})


@app.route('/auth/passkey/login/verify', methods=['POST'])
def passkey_login_verify():
    if not ALLOW_AUTH:
        return jsonify({'error': 'Authentication is disabled'}), 404
    if not PASSKEY_SUPPORT:
        return jsonify({'error': 'Passkey support not available on this server'}), 501
    ip = auth_manager.client_ip()
    if not auth_manager.login_rate_ok(ip):
        return jsonify({'error': 'Too many login attempts, please try again later'}), 429
    data = request.get_json(silent=True) or {}
    c = _pk_take(data.get('cid'))
    if not c:
        return jsonify({'error': 'Challenge expired — please try again'}), 400
    cred_data = data.get('credential')
    if not cred_data or not isinstance(cred_data, dict):
        return jsonify({'error': 'Missing credential'}), 400
    passkey = user_manager.get_passkey(cred_data.get('id'))
    if not passkey:
        return jsonify({'error': 'Unknown passkey — please register first'}), 404
    try:
        resp = cred_data.get('response', {})
        cred = AuthenticationCredential(
            id=cred_data['id'],
            raw_id=_b64url_to_bytes(cred_data['rawId']),
            response=AuthenticatorAssertionResponse(
                client_data_json=_b64url_to_bytes(resp['clientDataJSON']),
                authenticator_data=_b64url_to_bytes(resp['authenticatorData']),
                signature=_b64url_to_bytes(resp['signature']),
                user_handle=_b64url_to_bytes(resp['userHandle']) if resp.get('userHandle') else None,
            ),
        )
    except Exception as exc:
        logger.warning('Passkey login parse error: %s', exc)
        return jsonify({'error': 'Invalid credential format'}), 400
    try:
        verification = _webauthn.verify_authentication_response(
            credential=cred,
            expected_challenge=c['challenge'],
            expected_rp_id=RP_ID,
            expected_origin=_passkey_origin(),
            credential_public_key=_b64url_to_bytes(passkey['public_key']),
            credential_current_sign_count=passkey['sign_count'],
            require_user_verification=False,
        )
    except Exception as exc:
        auth_manager.record_login_failure(ip)
        logger.warning('Passkey login verify error: %s', exc)
        return jsonify({'error': 'Passkey authentication failed'}), 401
    user_manager.update_passkey_sign_count(passkey['cred_id'], verification.new_sign_count)
    row = user_manager.get_user_by_id(passkey['user_id'])
    if not row:
        return jsonify({'error': 'User not found'}), 404
    user = user_manager._public(row)
    if user['status'] != 'active':
        return jsonify({'error': 'Account is not active'}), 403
    auth_manager.reset_login_attempts(ip)
    token, _exp = auth_manager.create_access_token(
        user['user_id'], user['role'], user['username'])
    logger.info("AUTH: passkey login '%s'", user['username'])
    return jsonify({'user': user, 'token': token})
# ============================================================================

@app.route('/api/analyze-image', methods=['POST'])
@limiter.limit("30 per minute")
def analyze_image():
    if 'image' not in request.files:
        return jsonify({'error': 'No image file provided'}), 400
    file_storage = request.files['image']
    try:
        image_bytes = validate_image_upload(file_storage)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    form = request.form
    min_size = int(GRID_CFG.get('min_size', 5))
    max_size = int(GRID_CFG.get('max_size', 200))
    width = clamp_int(form.get('width'), min_size, max_size, int(GRID_CFG.get('default_width', 60)))
    height = clamp_int(form.get('height'), min_size, max_size, int(GRID_CFG.get('default_height', 80)))
    max_colors = clamp_int(form.get('max_colors'), int(GRID_CFG.get('min_colors', 2)),
                           palette_manager.palette_size(), int(GRID_CFG.get('default_max_colors', 16)))
    alpha_threshold = clamp_int(form.get('alpha_threshold'), 0, 255,
                                int(GRID_CFG.get('alpha_threshold', 128)))
    resample = form.get('resample', 'smooth')

    try:
        result = image_manager.analyze(
            image_bytes, width, height,
            max_colors=max_colors, alpha_threshold=alpha_threshold, resample=resample,
            min_size=min_size, max_size=max_size, palette_max=palette_manager.palette_size(),
        )
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    except Exception as exc:  # noqa: BLE001
        logger.exception('Image analysis failed')
        return jsonify({'error': f'Image analysis failed: {exc}'}), 500

    result['success'] = True
    return jsonify(result)


@app.route('/api/generate-design', methods=['POST'])
@limiter.limit("15 per minute")
def generate_design():
    data = request.get_json(silent=True) or {}
    provider = data.get('provider', 'ollama')
    if provider not in LLMManager.PROVIDER_CONFIGS:
        return jsonify({'error': 'Unknown provider'}), 400
    model = (data.get('model') or '').strip()
    if not model:
        return jsonify({'error': 'A model must be selected'}), 400

    try:
        custom_config = resolve_custom_config(provider, data)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    api_key, _src = get_api_key(provider, request.headers)
    # Shapes are rendered server-side so any canvas size is fine.
    max_size = int(GRID_CFG.get('max_size', 200))
    width = clamp_int(data.get('width'), 5, max_size, 32)
    height = clamp_int(data.get('height'), 5, max_size, 32)
    max_colors = clamp_int(data.get('max_colors'), 2, palette_manager.palette_size(), 12)

    design, error = design_manager.generate(
        data.get('description'), width, height, provider, model,
        api_key=api_key, custom_config=custom_config, max_colors=max_colors,
    )
    if error:
        return jsonify({'error': error}), 502 if 'LLM' in error or 'model' in error.lower() else 400
    design['success'] = True
    return jsonify(design)


# ============================================================================
# LLM utility routes
# ============================================================================

@app.route('/api/llm/test', methods=['POST'])
@limiter.limit("20 per minute")
def test_llm_connection():
    data = request.get_json(silent=True) or {}
    provider = data.get('provider', 'ollama')
    if provider not in LLMManager.PROVIDER_CONFIGS:
        return jsonify({'success': False, 'error': 'Unknown provider'}), 400
    try:
        custom_config = resolve_custom_config(provider, data)
    except ValueError as exc:
        return jsonify({'success': False, 'connected': False, 'error': str(exc)}), 400

    api_key, key_source = get_api_key(provider, request.headers)
    conn = LLMManager.test_connection(provider, api_key, custom_config)
    if not conn['connected']:
        return jsonify({'success': False, 'connected': False,
                        'error': conn['error'], 'status_code': conn['status_code']}), 503
    models = LLMManager.list_models(provider, api_key, custom_config)
    return jsonify({
        'success': True, 'connected': True, 'provider': provider,
        'models': models.get('models', []), 'model_count': len(models.get('models', [])),
        'key_source': key_source, 'error': models.get('error'),
    })


@app.route('/api/llm/models', methods=['POST'])
@limiter.limit("30 per minute")
def get_llm_models():
    data = request.get_json(silent=True) or {}
    provider = data.get('provider', 'ollama')
    if provider not in LLMManager.PROVIDER_CONFIGS:
        return jsonify({'models': [], 'error': 'Unknown provider'}), 400
    try:
        custom_config = resolve_custom_config(provider, data)
    except ValueError as exc:
        return jsonify({'models': [], 'error': str(exc)}), 400

    api_key, key_source = get_api_key(provider, request.headers)
    result = LLMManager.list_models(provider, api_key, custom_config)
    return jsonify({'models': result.get('models', []), 'provider': provider,
                    'key_source': key_source, 'error': result.get('error')})


# ============================================================================
# Project storage routes
# ============================================================================

@app.route('/api/projects', methods=['GET'])
def list_projects():
    owner, is_admin = current_owner()
    if REQUIRE_AUTH and owner is None:
        return jsonify({'error': 'Authentication required'}), 401
    return jsonify({'projects': project_manager.list_projects(owner=owner, is_admin=is_admin)})


@app.route('/api/projects', methods=['POST'])
@limiter.limit("60 per minute")
def create_project():
    owner, _is_admin = current_owner()
    if REQUIRE_AUTH and owner is None:
        return jsonify({'error': 'Authentication required'}), 401
    data = request.get_json(silent=True) or {}
    try:
        meta = project_manager.create_project(
            data.get('title'), data.get('grid'), owner=owner,
            description=data.get('description', ''))
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    return jsonify({'success': True, 'project': meta}), 201


@app.route('/api/projects/<project_id>', methods=['GET'])
def get_project(project_id):
    owner, is_admin = current_owner()
    if REQUIRE_AUTH and owner is None:
        return jsonify({'error': 'Authentication required'}), 401
    project = project_manager.get_project(project_id)
    if project is None:
        return jsonify({'error': 'Project not found'}), 404
    if not project_manager.can_access(project, owner, is_admin):
        return jsonify({'error': 'Access denied'}), 403
    return jsonify({'project': project})


@app.route('/api/projects/<project_id>', methods=['PUT'])
@limiter.limit("60 per minute")
def update_project(project_id):
    owner, is_admin = current_owner()
    if REQUIRE_AUTH and owner is None:
        return jsonify({'error': 'Authentication required'}), 401
    data = request.get_json(silent=True) or {}
    try:
        meta = project_manager.update_project(
            project_id, data.get('title'), data.get('grid'),
            owner=owner, is_admin=is_admin, description=data.get('description'))
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403
    except ValueError as exc:
        code = 404 if 'not found' in str(exc).lower() else 400
        return jsonify({'error': str(exc)}), code
    return jsonify({'success': True, 'project': meta})


@app.route('/api/projects/<project_id>', methods=['DELETE'])
def delete_project(project_id):
    owner, is_admin = current_owner()
    if REQUIRE_AUTH and owner is None:
        return jsonify({'error': 'Authentication required'}), 401
    try:
        ok = project_manager.delete_project(project_id, owner=owner, is_admin=is_admin)
    except PermissionError as exc:
        return jsonify({'error': str(exc)}), 403
    if not ok:
        return jsonify({'error': 'Project not found'}), 404
    return jsonify({'success': True})


if __name__ == '__main__':
    port = int(os.environ.get('PORT', '5000'))
    app.run(host='0.0.0.0', port=port, debug=os.environ.get('FLASK_DEBUG', 'false').lower() == 'true')
